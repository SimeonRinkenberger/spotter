#!/usr/bin/env node
// Add an existing file to one or more targets in ios/App/App.xcodeproj.
//
//   node tools/ios/add-file.mjs <Target> <path/relative/to/ios/App> [<Target2> ...]
//   node tools/ios/add-file.mjs SpotterWidgets SpotterWidgets/Widgets/WeekWidget.swift
//   node tools/ios/add-file.mjs App Shared/Thing.swift SpotterWidgets SpotterWatch
//
// Why this exists: four agents are about to add Swift files to a project file
// none of them owns, in parallel. Hand-editing project.pbxproj is how you get a
// merge conflict in a machine-generated file, or a target that silently does not
// compile the file you just wrote. This does the same edit the same way every
// time, and refuses rather than guesses.
//
// Why not the `xcode` npm package, which is already in node_modules: its
// writeSync() reformats the whole project file. That turns a five-line change
// into a thousand-line diff, and this project deliberately keeps objectVersion
// 60 and classic groups so the Capacitor CLI and CI keep parsing it. Text edits
// against known anchors keep the diff the size of the change.
//
// Properties this guarantees:
//   - Idempotent. Running it twice adds nothing the second time and says so.
//   - Deterministic ids, derived from the path and target, so two agents adding
//     the same file on two branches produce the same bytes and merge cleanly.
//   - Validated. The file is only written if `plutil -lint` accepts the result.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appDir = join(root, 'ios/App');
const projectPath = join(appDir, 'App.xcodeproj/project.pbxproj');

// Which build phase a file belongs in, by extension. Anything not listed is
// added as a project reference only — an Info.plist or an entitlements file is
// named by a build setting, and copying it into the bundle as a resource is a
// real (and quiet) packaging bug.
const SOURCES = new Set(['.swift', '.m', '.mm', '.c', '.cc', '.cpp']);
const RESOURCES = new Set(['.xcassets', '.storyboard', '.xib', '.strings', '.stringsdict',
  '.png', '.jpg', '.pdf', '.json', '.intentdefinition', '.mlmodel', '.xcdatamodeld']);
const REFERENCE_ONLY = new Set(['.plist', '.entitlements', '.xcconfig', '.md']);

// Where a new reference is filed in the Xcode navigator, by its first path
// segment. Cosmetic, but a file nobody can find in the sidebar may as well not
// be in the project.
const GROUP_FOR_PREFIX = {
  SpotterWidgets: 'SpotterWidgets',
  SpotterWatch: 'SpotterWatch',
  Shared: 'Live Session',
  App: 'Live Session'
};

const FILE_TYPES = {
  '.swift': 'sourcecode.swift',
  '.m': 'sourcecode.c.objc',
  '.h': 'sourcecode.c.h',
  '.xcassets': 'folder.assetcatalog',
  '.plist': 'text.plist.xml',
  '.entitlements': 'text.plist.entitlements',
  '.json': 'text.json',
  '.png': 'image.png',
  '.storyboard': 'file.storyboard',
  '.xib': 'file.xib',
  '.strings': 'text.plist.strings',
  '.md': 'net.daringfireball.markdown'
};

function fail(message) {
  console.error('add-file: ' + message);
  process.exit(1);
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

/// A stable 24-hex-digit object id. Xcode only requires uniqueness within the
/// file; deriving it from what the object IS means the same addition always
/// produces the same id, which is what keeps two branches mergeable.
function objectId(kind, ...parts) {
  return createHash('sha1').update(['spotter', kind, ...parts].join('\u0000'))
    .digest('hex').slice(0, 24).toUpperCase();
}

/// The body of the object with this id, plus where it sits in the text.
function findObject(text, id) {
  const match = new RegExp('\\n\\t\\t' + id + '\\b[^\\n]*= \\{([\\s\\S]*?)\\n\\t\\t\\};').exec(text);
  return match ? { body: match[1], start: match.index, end: match.index + match[0].length } : null;
}

/// Insert a line just before the end of a section.
function appendToSection(text, section, line) {
  const marker = '/* End ' + section + ' section */';
  const at = text.indexOf(marker);
  if (at === -1) fail('no ' + section + ' section in project.pbxproj');
  return text.slice(0, at) + line + '\n' + text.slice(at);
}

/// Insert an entry into an object's `files = ( ... );` list.
function appendToFiles(text, id, line) {
  const object = findObject(text, id);
  if (!object) fail('object ' + id + ' not found');
  const region = text.slice(object.start, object.end);
  const at = region.indexOf('files = (');
  if (at === -1) fail('object ' + id + ' has no files list');
  const close = region.indexOf('\t\t\t);', at);
  if (close === -1) fail('object ' + id + ' has an unterminated files list');
  const updated = region.slice(0, close) + line + '\n' + region.slice(close);
  return text.slice(0, object.start) + updated + text.slice(object.end);
}

/// Every native target, by name, with the ids of its build phases.
function targets(text) {
  const section = /\/\* Begin PBXNativeTarget section \*\/([\s\S]*?)\/\* End PBXNativeTarget section \*\//.exec(text);
  if (!section) fail('no PBXNativeTarget section');
  const found = {};
  const blocks = section[1].matchAll(/\n\t\t([0-9A-F]{24})\b[^\n]*= \{([\s\S]*?)\n\t\t\};/g);
  for (const block of blocks) {
    const name = /\n\t\t\tname = "?([^";\n]+)"?;/.exec(block[2]);
    const phases = /buildPhases = \(([\s\S]*?)\);/.exec(block[2]);
    if (!name) continue;
    found[name[1]] = {
      id: block[1],
      phases: phases ? [...phases[1].matchAll(/([0-9A-F]{24})/g)].map(m => m[1]) : []
    };
  }
  return found;
}

/// The id of this target's phase of the given isa, or null.
function phaseOfType(text, target, isa) {
  for (const id of target.phases) {
    const object = findObject(text, id);
    if (object && object.body.includes('isa = ' + isa + ';')) return id;
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    fail('usage: node tools/ios/add-file.mjs <Target> <path/relative/to/ios/App> [<Target2> ...]');
  }
  // The brief's argument order: a target, the path, then any further targets.
  const path = args[1].replace(/^\.?\//, '');
  const wanted = [args[0], ...args.slice(2)];

  if (!existsSync(join(appDir, path))) fail('no such file: ios/App/' + path);

  let text = readFileSync(projectPath, 'utf8');
  const before = text;
  const all = targets(text);
  for (const name of wanted) {
    if (!all[name]) fail('no target named ' + name + ' (have: ' + Object.keys(all).join(', ') + ')');
  }

  const ext = extensionOf(path);
  const base = path.slice(path.lastIndexOf('/') + 1);
  const fileType = FILE_TYPES[ext] || 'text';
  const notes = [];

  // 1. The file reference, shared by every target that compiles the file.
  let fileRef = new RegExp('\\n\\t\\t([0-9A-F]{24}) [^\\n]*isa = PBXFileReference;[^\\n]*path = "?' +
    path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"?;').exec(text);
  let fileRefId;
  if (fileRef) {
    fileRefId = fileRef[1];
  } else {
    fileRefId = objectId('fileRef', path);
    text = appendToSection(text, 'PBXFileReference',
      '\t\t' + fileRefId + ' /* ' + base + ' */ = {isa = PBXFileReference; name = "' + base +
      '"; path = "' + path + '"; sourceTree = "<group>"; fileEncoding = 4; lastKnownFileType = ' + fileType + '; };');
    notes.push('added file reference ' + fileRefId);

    // File it in the navigator group that matches its directory.
    const groupName = GROUP_FOR_PREFIX[path.split('/')[0]];
    const group = groupName && new RegExp('\\n\\t\\t([0-9A-F]{24}) /\\* ' + groupName +
      ' \\*/ = \\{\\n\\t\\t\\tisa = PBXGroup;').exec(text);
    if (group) {
      text = text.replace(new RegExp('(\\n\\t\\t' + group[1] + ' [\\s\\S]*?children = \\()'),
        '$1\n\t\t\t\t' + fileRefId + ' /* ' + base + ' */,');
      notes.push('filed under group "' + groupName + '"');
    } else {
      notes.push('no matching group; the reference is in the project but not in a navigator group');
    }
  }

  // 2. Membership, one build file per target.
  if (REFERENCE_ONLY.has(ext)) {
    notes.push(base + ' is a ' + ext + ' file: added as a reference only, not to a build phase');
  } else {
    const isa = SOURCES.has(ext) ? 'PBXSourcesBuildPhase'
      : RESOURCES.has(ext) ? 'PBXResourcesBuildPhase' : null;
    if (!isa) fail('unknown file kind "' + ext + '": add it to SOURCES, RESOURCES or REFERENCE_ONLY first');
    const label = isa === 'PBXSourcesBuildPhase' ? 'Sources' : 'Resources';

    for (const name of wanted) {
      const phase = phaseOfType(text, all[name], isa);
      if (!phase) fail('target ' + name + ' has no ' + label + ' build phase');
      const buildId = objectId('buildFile', path, name);
      if (text.includes(buildId)) {
        notes.push(name + ': already a member, unchanged');
        continue;
      }
      text = appendToSection(text, 'PBXBuildFile',
        '\t\t' + buildId + ' /* ' + base + ' in ' + label + ' */ = {isa = PBXBuildFile; fileRef = ' +
        fileRefId + ' /* ' + base + ' */; };');
      text = appendToFiles(text, phase, '\t\t\t\t' + buildId + ' /* ' + base + ' in ' + label + ' */,');
      notes.push(name + ': added to ' + label);
    }
  }

  if (text === before) {
    console.log('add-file: ' + path + ' — nothing to do');
    for (const note of notes) console.log('  ' + note);
    return;
  }

  // 3. Never leave a project file that Xcode cannot open.
  const temp = projectPath + '.add-file-check';
  writeFileSync(temp, text);
  const lint = spawnSync('plutil', ['-lint', temp], { encoding: 'utf8' });
  if (lint.status !== 0) {
    console.error(lint.stdout || '', lint.stderr || '');
    fail('the edit produced a project file plutil rejects; nothing was written (kept ' + temp + ')');
  }
  spawnSync('rm', ['-f', temp]);
  writeFileSync(projectPath, text);

  console.log('add-file: ' + path);
  for (const note of notes) console.log('  ' + note);
}

main();
