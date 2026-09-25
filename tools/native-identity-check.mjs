// Is the native bundle this tree builds byte for byte the one another commit builds?
//
//   node tools/native-identity-check.mjs [ref] [--report]      (ref defaults to main)
//
// Builds native-dist/ twice with the real scripts (build.mjs, then tools/ios/build.mjs,
// which is `npm run ios:assets`): once here, and once from `git archive <ref>` in a
// temporary directory that borrows this tree's node_modules, so both use the same
// esbuild and the same Capacitor and Supabase packages. Then compares every file:
// the same paths, and the same SHA-256 for each. native-dist/ is exactly what
// `cap sync` copies into the iOS and Android shells.
//
// Exits 1 on any difference, which is the proof a change like retiring the web app
// needs ("the native app must not change"). With --report it prints the same table
// and exits 0: CI runs it that way on every pull request, so a reviewer can see
// whether a branch changes what phones get, and so whether it needs a new store build.
// SPOTTER_TEST_STORE is cleared for both builds; a Test Store bundle is never compared.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const report = args.includes('--report');
const ref = args.find((a) => !a.startsWith('--')) || 'main';

const env = { ...process.env };
delete env.SPOTTER_TEST_STORE;
function run(cwd, cmd, argv) {
  const r = spawnSync(cmd, argv, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(r.stdout + r.stderr);
    throw new Error(cmd + ' ' + argv.join(' ') + ' failed in ' + cwd);
  }
  return r.stdout;
}
function buildNative(cwd) {
  run(cwd, 'node', ['build.mjs']);
  run(cwd, 'node', ['tools/ios/build.mjs']);
  return manifest(path.join(cwd, 'native-dist'));
}
function manifest(root) {
  const out = new Map();
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const bytes = readFileSync(p);
        out.set(path.relative(root, p), { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  })(root);
  return out;
}

const here = process.cwd();
const sha = run(here, 'git', ['rev-parse', '--verify', ref + '^{commit}']).trim();
const work = mkdtempSync(path.join(tmpdir(), 'spotter-native-identity-'));
let theirs, ours;
try {
  const tar = spawnSync('sh', ['-c', 'git archive "$0" | tar -x -C "$1"', sha, work], { cwd: here, env, encoding: 'utf8' });
  if (tar.status !== 0) throw new Error('git archive ' + ref + ' failed: ' + tar.stderr);
  symlinkSync(path.join(here, 'node_modules'), path.join(work, 'node_modules'));
  theirs = buildNative(work);
} finally {
  rmSync(work, { recursive: true, force: true });
}
ours = buildNative(here);

const names = [...new Set([...theirs.keys(), ...ours.keys()])].sort();
const differ = [];
console.log('native-dist/ built from ' + ref + ' (' + sha.slice(0, 7) + ') and from this tree:\n');
for (const n of names) {
  const a = theirs.get(n), b = ours.get(n);
  const same = a && b && a.sha256 === b.sha256;
  if (!same) differ.push(n);
  console.log((same ? '  same  ' : '  DIFF  ') + n.padEnd(40) + String(b ? b.size : '-').padStart(9) + '  ' +
    (b ? b.sha256 : 'missing here') + (same ? '' : '   (' + ref + ': ' + (a ? a.sha256 : 'missing') + ')'));
}
console.log('');
if (!differ.length) {
  console.log('IDENTICAL: all ' + names.length + ' files of the native bundle match ' + ref + ' byte for byte.');
} else {
  console.log((report ? 'NOTE' : 'FAIL') + ': ' + differ.length + ' of ' + names.length + ' native-bundle files differ from ' + ref +
    ' — this branch changes what the iOS and Android apps run, and ships only in a new store build.');
  if (!report) process.exitCode = 1;
}
if (!existsSync(path.join(here, 'native-dist', 'index.html'))) process.exitCode = 1;
