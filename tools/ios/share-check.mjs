import assert from 'node:assert/strict';
import { shareAccess } from '../../native/share-access.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let written = [], active = 0;
const configure = shareAccess({ configure: async ({key}) => {
  assert.equal(active++, 0);
  await new Promise(resolve => setTimeout(resolve, 2));
  written.push(key); active--;
  if (key === 'fail') throw new Error('Keychain unavailable');
}});
await Promise.allSettled([configure('account-a'), configure(null), configure('account-b'), configure('fail'), configure(null)]);
assert.deepEqual(written, ['account-a', null, 'account-b', 'fail', null]);
const dir = mkdtempSync(join(tmpdir(), 'spotter-share-test-'));
writeFileSync(join(dir, 'main.swift'), `
import Foundation
import UniformTypeIdentifiers
let _ = UTType.utf8PlainText
let infoData = try Data(contentsOf: URL(fileURLWithPath: "ios/App/ShareExtension/Info.plist"))
let info = try PropertyListSerialization.propertyList(from: infoData, format: nil) as! [String: Any]
let ext = info["NSExtension"] as! [String: Any]
let attributes = ext["NSExtensionAttributes"] as! [String: Any]
let activation = NSPredicate(format: attributes["NSExtensionActivationRule"] as! String)
func activates(_ types: [[String]]) -> Bool {
 activation.evaluate(with: ["extensionItems": [["attachments": types.map { ["registeredTypeIdentifiers": $0] }]]])
}
precondition(activates([["public.url"]]))
precondition(activates([["public.utf8-plain-text"]]))
precondition(activates([["public.url"], ["public.jpeg"]]))
precondition(activates([["public.utf8-plain-text"], ["public.movie"]]))
precondition(!activates([["public.jpeg"]]))
precondition(!activates([["public.movie"]]))
precondition(!activates([]))
let links = [
 "https://www.tiktok.com/@trainer/video/1234567890123456789",
 "https://vm.tiktok.com/ZExample/", "https://www.tiktok.com/t/ZExample/",
 "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc", "https://youtu.be/dQw4w9WgXcQ",
 "https://youtube.com/shorts/dQw4w9WgXcQ", "https://instagram.com/reel/ABC123/",
 "https://www.facebook.com/reel/123456789", "https://fb.watch/ABC123/",
 "https://x.com/trainer/status/123456", "https://www.reddit.com/r/fitness/comments/abc/workout/",
 "https://pin.it/ABC123", "https://www.threads.net/@trainer/post/ABC123",
 "https://www.snapchat.com/spotlight/ABC123", "https://vimeo.com/123456",
 "https://www.strava.com/activities/123456", "https://example.com/workout?sets=3&reps=10"
]
for link in links {
 precondition(SharedLink.urls(in: link).first?.absoluteString == link, link)
 precondition(SharedLink.urls(in: "💪 Try this workout! \\(link) #fitness").first?.absoluteString == link, link)
}
precondition(SharedLink.urls(in: "No link here").isEmpty)
precondition(SharedLink.urls(in: "file:///private/test").isEmpty)
precondition(SharedLink.urls(in: "mailto:hello@example.com").isEmpty)
precondition(SharedLink.urls(in: "https://name:password@example.com/workout").isEmpty)
precondition(SharedLink.urls(in: String(repeating: "a", count: 64001)).isEmpty)
precondition(SharedLink.urls(in: links[0] + " " + links[0]).count == 1)
precondition(SharedLink.urls(in: links[0] + " " + links[1]).count == 2)
for state in ["saved", "processing", "exists"] {
 precondition(SharedLink.savedMessage(status: 200, body: ["status":state,"id":"workout"]) != nil)
 precondition(SharedLink.savedMessage(status: 202, body: ["status":state,"id":"workout"]) != nil)
 precondition(SharedLink.savedMessage(status: 500, body: ["status":state,"id":"workout"]) == nil)
}
for state in ["error", "blocked", "limit", "ok", "unknown"] {
 precondition(SharedLink.savedMessage(status: 200, body: ["status":state,"id":"workout"]) == nil)
}
precondition(SharedLink.savedMessage(status: 200, body: ["status":"saved"]) == nil)
print("PASS native activation including mixed thumbnail/link payloads, 17 social/web URL formats, captions, invalid inputs, deduplication, multiple links, durable-save acknowledgement and error responses")
`);
const r = spawnSync('/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc', ['-sdk','/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk','-target',process.arch === 'arm64' ? 'arm64-apple-macosx14.0' : 'x86_64-apple-macosx14.0','-module-cache-path',join(dir,'cache'),'ios/App/Shared/SharedLink.swift',join(dir,'main.swift'),'-o',join(dir,'check')], { encoding:'utf8' });
assert.equal(r.status, 0, r.stderr);
const result = spawnSync(join(dir,'check'), [], {encoding:'utf8'});
assert.equal(result.status, 0, result.stderr); process.stdout.write(result.stdout);
console.log('PASS serialized account switching, sign-out, credential-write failure recovery');
