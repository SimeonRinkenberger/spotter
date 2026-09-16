// Compile sheet-probe.swift together with the real shared sources against the
// iphonesimulator SDK and run it inside a booted simulator, so the measurement
// is of the code that ships rather than of a Mac-flavoured copy of it.
//
//   node tools/ios/sheet-probe.mjs <out-dir> url  https://www.tiktok.com/@x/video/123
//   node tools/ios/sheet-probe.mjs <out-dir> file /path/to/clip.mp4
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [outDir, mode, target] = process.argv.slice(2);
if (!outDir || !['url', 'file'].includes(mode) || !target) {
  console.error('usage: node tools/ios/sheet-probe.mjs <out-dir> url|file <target>');
  process.exit(2);
}

const xcode = process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer';
const sdk = spawnSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).stdout.trim();
const version = spawnSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-platform-version'], { encoding: 'utf8' }).stdout.trim();
const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const dir = mkdtempSync(join(tmpdir(), 'spotter-sheet-probe-'));
const binary = join(dir, 'sheet-probe');
// Swift only allows top-level statements in a file literally called main.swift.
const entry = join(dir, 'main.swift');
copyFileSync('tools/ios/sheet-probe.swift', entry);

const build = spawnSync(`${xcode}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc`, [
  '-sdk', sdk,
  '-target', `${arch}-apple-ios${version.split('.')[0]}.0-simulator`,
  '-O', '-module-cache-path', join(dir, 'cache'),
  'ios/App/Shared/SheetSpec.swift',
  'ios/App/Shared/ContactSheet.swift',
  'ios/App/Shared/TikTokMedia.swift',
  entry,
  '-o', binary
], { encoding: 'utf8' });
if (build.status !== 0) { console.error(build.stderr); process.exit(1); }

mkdirSync(resolve(outDir), { recursive: true });
const run = spawnSync('xcrun', ['simctl', 'spawn', 'booted', binary, resolve(outDir), mode, target], {
  encoding: 'utf8', maxBuffer: 8e6
});
process.stdout.write(run.stdout || '');
if (run.stderr) process.stderr.write(run.stderr);
process.exit(run.status ?? 1);
