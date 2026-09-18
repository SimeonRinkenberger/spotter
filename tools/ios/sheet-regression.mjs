// Real UIKit/AVFoundation regression using a generated local clip and an already
// booted simulator. No app installation, network request, upload or model call.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'spotter-sheet-regression-'));
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 4e6});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const clip = join(dir, 'moving.mp4');
run('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=270x480:rate=24','-t','12','-c:v','libx264','-pix_fmt','yuv420p',clip]);
writeFileSync(join(dir, 'main.swift'), `
import Foundation
import Darwin
let done = DispatchSemaphore(value: 0)
var failed: Int32 = 0
Task {
  defer { done.signal() }
  do {
    let clip = URL(fileURLWithPath: CommandLine.arguments[1])
    let sheet = try await ContactSheetBuilder.build(mp4: clip, duration: 999, deadline: Date().addingTimeInterval(30))
    precondition(abs(sheet.duration - 12) < 0.1, "measured duration must override stale page hint")
    precondition(sheet.requested == 8)
    let times = sheet.pages.flatMap { $0.times }
    precondition(times.count >= 4 && times.first! < 1 && times.last! > 10.5, "samples must span the clip")
    precondition(sheet.pages.allSatisfy { !$0.jpeg.isEmpty && $0.jpeg.count <= SheetSpec.jpegMaxBytes })
    do {
      _ = try await ContactSheetBuilder.build(mp4: clip, duration: 12, deadline: Date().addingTimeInterval(-1))
      preconditionFailure("expired extraction must not return a prefix")
    } catch ContactSheetError.noFrames { }
    print("PASS real iOS decoder: measured duration, complete sparse coverage, image byte cap, expired deadline rejected")
  } catch { print("FAIL \\(error)"); failed = 1 }
}
done.wait()
exit(failed)
`);
const sdk = run('xcrun', ['--sdk','iphonesimulator','--show-sdk-path']);
const version = run('xcrun', ['--sdk','iphonesimulator','--show-sdk-platform-version']).split('.')[0];
const binary = join(dir, 'check');
run('xcrun', ['swiftc','-sdk',sdk,'-target',`${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-ios${version}.0-simulator`, '-module-cache-path',join(dir,'cache'),'ios/App/Shared/SheetSpec.swift','ios/App/Shared/ContactSheet.swift',join(dir,'main.swift'),'-o',binary]);
console.log(run('xcrun', ['simctl','spawn','booted',binary,clip]));
