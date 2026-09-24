import assert from 'node:assert/strict';
import { shareAccess, takeParked } from '../../native/share-access.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let written = [], active = 0;
const configure = shareAccess({ configure: async (options) => {
  assert.equal(active++, 0);
  await new Promise(resolve => setTimeout(resolve, 2));
  written.push(options); active--;
  if (options.key === 'fail') throw new Error('Keychain unavailable');
}});
await Promise.allSettled([configure('account-a'), configure(null), configure('account-b', { plan: 'plus' }),
  configure('fail'), configure(null, { plan: 'plus' }), configure('account-c', { plan: '' })]);
assert.deepEqual(written, [{ key: 'account-a' }, { key: null }, { key: 'account-b', plan: 'plus' },
  { key: 'fail' }, { key: null }, { key: 'account-c' }],
  'the plan hint rides with a key only; a sign-out never carries one');
// The parked-link reader never rejects and hands back one plain shape.
assert.deepEqual(await takeParked({ takeParked: async () => ({ url: 'https://vt.tiktok.com/Z/', at: 5 }) })(), { url: 'https://vt.tiktok.com/Z/', at: 5 });
assert.equal(await takeParked({ takeParked: async () => ({}) })(), null);
assert.equal(await takeParked({ takeParked: async () => { throw new Error('UNIMPLEMENTED'); } })(), null);
assert.equal(await takeParked({})(), null, 'a shell without the method has nothing parked');
const bridge = readFileSync('native/bridge.js', 'utf8');
assert(bridge.includes('takeParkedShare: android ? () => Promise.resolve(null) : takeParked(ShareAccessHost)'), 'the page reaches parked links through SpotterNative.takeParkedShare');
const plugin = readFileSync('ios/App/App/ShareAccess.swift', 'utf8');
assert(plugin.includes('CAPPluginMethod(name: "takeParked"') && plugin.includes('ParkedShare.take(for: saveKey)') &&
  plugin.includes('let saveKey = (try? ShareCredential.read()) ?? nil'), 'ShareAccess exposes takeParked, for the account configured now');
// R-5: configuring a key claims the parked store for that account; clearing it
// (sign-out, and every launch before sign-in) does not, so links parked while
// signed out still wait for the account they were parked under.
assert(/try ShareCredential\.write\(key\)[\s\S]{0,400}if let key = key \{ ParkedShare\.claim\(saveKey: key\) \}/.test(plugin),
  'R-5: configure(key) claims the parked links for that account');
// iOS sharingd rejects aggregate literal expressions even though NSPredicate
// evaluates them on macOS. This guard catches the exact hidden-extension regression;
// a real iOS share-sheet pass is still required for changes to activation rules.
for (const path of ['ShareExtension', 'ActionExtension']) {
  const plist = readFileSync(`ios/App/${path}/Info.plist`, 'utf8');
  assert(!plist.includes(' IN {'), `${path}: iOS rejects aggregate literals`);
  assert(!plist.includes('TRUEPREDICATE'), `${path}: never activate for unsupported content`);
  // Only equality, UTI-CONFORMS-TO and @count comparisons — the forms Apple's
  // own activation-rule examples use and iOS has accepted on a device.
  const rule = /<key>NSExtensionActivationRule<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)[1];
  const clauses = rule.match(/ANY \$attachment\.registeredTypeIdentifiers (==|UTI-CONFORMS-TO) "[a-z0-9.-]+"/g) || [];
  assert.equal(rule.replace(/ANY \$attachment\.registeredTypeIdentifiers (==|UTI-CONFORMS-TO) "[a-z0-9.-]+"/g, 'X')
    .replace(/SUBQUERY\(extensionItems, \$item, SUBQUERY\(\$item\.attachments, \$attachment, [X OR]+\)\.@count (&gt;|==) [01]\)\.@count (&gt;|==) [01]/g, 'Y')
    .replace(/Y OR Y/, 'Y'), 'Y', `${path}: activation rule uses only the safe predicate forms`);
  assert(clauses.some(c => c.endsWith('UTI-CONFORMS-TO "public.movie"')), `${path}: accepts a video file`);
  // The extension reads SharedStore (parked links); it must follow the app's
  // App Group switch or the two would look in different places once it flips.
  assert(plist.includes('<key>SpotterAppGroup</key>\n\t<string>$(SPOTTER_APP_GROUP)</string>'), `${path}: SpotterAppGroup follows the app`);
}
const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
assert.equal((project.match(/SharedStore\.swift in Sources \*\/,/g) || []).length, 4, 'SharedStore is compiled into the app, the widgets and both share extensions');

// Save first, frames after (audit S5/S6): the one POST is the first request the
// controller makes with the key, prepare is never on its path, and the frames
// follow the confirmation through the media route.
const controller = readFileSync('ios/App/ShareExtension/ShareViewController.swift', 'utf8');
const saveLink = controller.slice(controller.indexOf('private func saveLink('), controller.indexOf('/// The server\'s answer to a save'));
assert(saveLink.indexOf('post("/api/ingest"') > 0, 'saveLink posts the save');
assert(!saveLink.includes('SheetPipeline.run'), 'no frames work before the save answers');
assert(saveLink.indexOf('post("/api/ingest"') < saveLink.indexOf('sendFrames('), 'frames only after the save');
assert(saveLink.includes('payload["frames_pending"] = true') && saveLink.includes('ShareCredential.plusPlan(plan)'), 'frames_pending only on a Plus hint');
assert(!controller.includes('/api/ingest/prepare'), 'the extension never asks prepare on the save path');
const sendFrames = controller.slice(controller.indexOf('private func sendFrames('));
assert(sendFrames.includes('precheck: false') && sendFrames.includes('/api/workouts/\\(id)/media'), 'frames go to the held card, without prepare');
assert(controller.indexOf('begin()\n    }\n\n    override func viewDidAppear') > 0, 'work starts in viewDidLoad, under the sheet animation');
assert(controller.includes('async let access = Self.readAccess()'), 'the Keychain read overlaps the item reading');
assert(!controller.includes('"HEAD"'), 'no warm-up request: the save is on the wire within ~30 ms of the view loading');
// The video door streams from disk and never reads the file into memory.
assert(controller.includes('transport.upload(for: put, fromFile: file.url'), 'upload from the file');
assert(!/Data\(contentsOf:/.test(controller), 'no whole file in memory');
const pipeline = readFileSync('ios/App/Shared/SheetPipeline.swift', 'utf8');
assert(pipeline.includes('async let page = try? TikTokMedia.page(pageURL, session: session)') &&
  pipeline.indexOf('async let page') < pipeline.indexOf('guard await framesWanted('), 'C5a: the page loads while prepare is asked');
assert(pipeline.indexOf('guard await framesWanted(') < pipeline.indexOf('TikTokMedia.download('), 'C5a: consent is known before the MP4');
assert(pipeline.includes('withTaskGroup(of: (Int, Bool).self)') && pipeline.includes('guard landed.count == built.pages.count else { return nil }'), 'C5b: pages go up together, all or nothing');

const cases = JSON.parse(readFileSync('tools/ios/fixtures/share-cases.json', 'utf8')).cases;
const dir = mkdtempSync(join(tmpdir(), 'spotter-share-test-'));
writeFileSync(join(dir, 'cases.json'), JSON.stringify(cases));
// An Info.plist linked into the test binary gives SharedStore an App Group
// suite (plain UserDefaults on a Mac), so the parked-link store runs for real.
const suite = 'app.spotter.share-check.' + process.pid;
writeFileSync(join(dir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.spotter.share-check</string>
<key>SpotterAppGroup</key><string>${suite}</string></dict></plist>`);
writeFileSync(join(dir, 'main.swift'), `
import Foundation
import UniformTypeIdentifiers
let _ = UTType.utf8PlainText
for extensionName in ["ShareExtension", "ActionExtension"] {
let infoData = try Data(contentsOf: URL(fileURLWithPath: "ios/App/\\(extensionName)/Info.plist"))
let info = try PropertyListSerialization.propertyList(from: infoData, format: nil) as! [String: Any]
let ext = info["NSExtension"] as! [String: Any]
let attributes = ext["NSExtensionAttributes"] as! [String: Any]
let activation = NSPredicate(format: attributes["NSExtensionActivationRule"] as! String)
func activates(_ types: [[String]]) -> Bool {
 activation.evaluate(with: ["extensionItems": [["attachments": types.map { ["registeredTypeIdentifiers": $0] }]]])
}
func activatesItems(_ items: [[[String]]]) -> Bool {
 activation.evaluate(with: ["extensionItems": items.map { ["attachments": $0.map { ["registeredTypeIdentifiers": $0] }] }])
}
precondition(activates([["public.url"]]))
precondition(activates([["public.utf8-plain-text"]]))
precondition(activates([["public.url"], ["public.jpeg"]]))
precondition(activates([["public.utf8-plain-text"], ["public.movie"]]))
precondition(!activates([["public.jpeg"]]))
precondition(!activates([]))
// The second door: exactly one video file, as Photos and Files hand it over.
precondition(activates([["public.movie"]]), "a single video")
precondition(activates([["com.apple.quicktime-movie"]]), "a .mov from Photos")
precondition(activates([["public.mpeg-4"]]), "an .mp4")
precondition(!activates([["public.movie"], ["public.movie"]]), "two videos in one item")
precondition(!activatesItems([[["public.mpeg-4"]], [["com.apple.quicktime-movie"]]]), "two videos in two items")
precondition(!activates([["public.image"], ["public.jpeg"]]))
precondition(!activates([["public.audio"]]), "audio files stay in the app")
}
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

// S1: one post, however it is spelled.
func key(_ s: String) -> SharedLink.Identity { SharedLink.identity(of: URL(string: s)!) }
for s in ["https://www.tiktok.com/@thewodfather/video/7679960172495785246", "https://tiktok.com/@thewodfather/video/7679960172495785246/",
          "https://m.tiktok.com/v/7679960172495785246.html", "https://www.tiktok.com/@thewodfather/video/7679960172495785246?_r=1&_t=ZT-9",
          "https://www.tiktok.com/embed/v2/7679960172495785246", "https://www.tiktok.com/player/v1/7679960172495785246",
          "https://www.tiktokv.com/share/video/7679960172495785246/", "https://www.tiktok.com/@x/photo/7679960172495785246"] {
 precondition(key(s) == SharedLink.Identity(key: "tt-7679960172495785246", isPost: true), s)
}
for s in ["https://www.instagram.com/reel/DBGi0r0pHZ4/", "https://instagram.com/reel/DBGi0r0pHZ4", "https://m.instagram.com/reels/DBGi0r0pHZ4/",
          "https://www.instagram.com/reel/DBGi0r0pHZ4/?igsh=MTc4MmM1YmI2Ng==", "https://www.instagram.com/coachjaeo/reel/DBGi0r0pHZ4/",
          "https://instagr.am/reel/DBGi0r0pHZ4", "https://www.instagram.com/p/DBGi0r0pHZ4/?img_index=3", "http://instagram.com/reel/DBGi0r0pHZ4"] {
 precondition(key(s) == SharedLink.Identity(key: "ig-DBGi0r0pHZ4", isPost: true), s)
}
for s in ["https://youtube.com/shorts/X5W_jSPCV3g?si=A", "https://youtu.be/X5W_jSPCV3g?si=A", "https://m.youtube.com/shorts/X5W_jSPCV3g",
          "https://www.youtube.com/watch?feature=share&v=X5W_jSPCV3g", "https://www.youtube.com/embed/X5W_jSPCV3g"] {
 precondition(key(s) == SharedLink.Identity(key: "yt-X5W_jSPCV3g", isPost: true), s)
}
precondition(key("https://vt.tiktok.com/ZSe4FqkKd/") == key("https://vt.tiktok.com/ZSe4FqkKd"), "a short link with and without its slash")
precondition(key("https://vt.tiktok.com/ZSe4FqkKd/").isPost)
precondition(key("https://www.instagram.com/share/reel/BAGabc123xy/") == SharedLink.Identity(key: "ig-share-BAGabc123xy", isPost: true), "a share token is a post, not a code")
precondition(key("https://www.instagram.com/share/reel/BAGabc123xy/").key != "ig-reel")
precondition(!key("https://www.instagram.com/reels/audio/1234567890123456/").isPost, "a sound page is not a post")
precondition(!key("https://www.instagram.com/coachjaeo/").isPost)
precondition(!key("https://www.tiktok.com/@thewodfather").isPost)
precondition(!key("https://linktr.ee/coachjaeo").isPost)
precondition(key("https://www.youtube.com/@channel").isPost == false)
precondition(key("https://example.com/a?x=1") == key("https://www.example.com/a/?x=2"), "other pages: host and path, query dropped")

// The audit's share payloads, through the extension's own decision.
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let cases = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
var outcomes: [String: Int] = [:]
for c in cases {
 let id = c["id"] as! String
 var attached: [URL] = [], text: [URL] = []
 let att = c["attachment"] as? String ?? ""
 if let u = URL(string: att), u.scheme != nil, !att.contains(" ") { attached += SharedLink.urls(in: u.absoluteString) }
 else { text += SharedLink.urls(in: att) }
 if let t = c["contentText"] as? String { text += SharedLink.urls(in: t) }
 let choice = SharedLink.choose(attached: attached, text: text)
 if let expect = c["expect"] as? [String: Any] {
  guard let choice = choice else { preconditionFailure(id + ": no link chosen") }
  if let link = expect["link"] as? String { precondition(choice.link.absoluteString == link, id + ": saved " + choice.link.absoluteString) }
  precondition(choice.setAside == expect["setAside"] as! Int, id + ": set aside \\(choice.setAside)")
  precondition((SharedLink.setAsideNote(choice) != nil) == (choice.setAside > 0), id)
  outcomes["submit", default: 0] += 1
 } else {
  precondition(choice == nil, id + ": expected no link")
  outcomes["no-link", default: 0] += 1
 }
}
precondition(outcomes["submit"] == cases.count - 1 && outcomes["no-link"] == 1)
let two = SharedLink.choose(attached: [URL(string: "https://www.instagram.com/reel/DBGi0r0pHZ4/")!], text: [URL(string: "https://www.tiktok.com/@a/video/7679960172495785246")!])!
precondition(SharedLink.setAsideNote(two)!.hasPrefix("You shared two posts, so Spotter saved the first one."))
let pages = SharedLink.choose(attached: [URL(string: "https://example.com/a")!], text: [URL(string: "https://linktr.ee/b")!, URL(string: "https://example.org/c")!])!
precondition(SharedLink.setAsideNote(pages)!.hasPrefix("You shared 3 links"))

// Save-first answers: only a new, held job wants frames.
precondition(SharedLink.wantsFrames(status: 202, body: ["status":"processing","id":"w","job_id":"j"]))
precondition(!SharedLink.wantsFrames(status: 202, body: ["status":"processing","id":"w","job_id":"j","frames_wanted":false]))
precondition(!SharedLink.wantsFrames(status: 200, body: ["status":"processing","id":"w"]), "a save already in flight")
precondition(!SharedLink.wantsFrames(status: 200, body: ["status":"saved","id":"w"]), "a cache hit")
precondition(!SharedLink.wantsFrames(status: 200, body: ["status":"exists","id":"w"]), "a duplicate")
precondition(!SharedLink.wantsFrames(status: 202, body: ["status":"processing","id":"w"]), "no job named")
precondition(ShareCredential.plusPlan("plus") && ShareCredential.plusPlan("staff") && ShareCredential.plusPlan("pro"))
precondition(!ShareCredential.plusPlan("free") && !ShareCredential.plusPlan(nil) && !ShareCredential.plusPlan(""))
precondition(TikTokMedia.isPhoto(URL(string: "https://www.tiktok.com/@maxndah/photo/7686591894004026657")!))
precondition(!TikTokMedia.isPhoto(URL(string: "https://www.tiktok.com/@maxndah/video/7686591894004026657")!))
precondition(!TikTokMedia.isPhoto(URL(string: "https://vt.tiktok.com/ZSe4FqkKd/")!))

for state in ["saved", "processing", "exists"] {
 precondition(SharedLink.savedMessage(status: 200, body: ["status":state,"id":"workout"]) != nil)
 precondition(SharedLink.savedMessage(status: 202, body: ["status":state,"id":"workout"]) != nil)
 precondition(SharedLink.savedMessage(status: 500, body: ["status":state,"id":"workout"]) == nil)
}
for state in ["error", "blocked", "limit", "ok", "unknown"] {
 precondition(SharedLink.savedMessage(status: 200, body: ["status":state,"id":"workout"]) == nil)
}
precondition(SharedLink.savedMessage(status: 200, body: ["status":"saved"]) == nil)
precondition(SharedLink.failureMessage(status: 403, body: ["code":"ai_consent_required"]).contains("Data & privacy"))
// The extension asks for AI permission itself; the version it records must be
// the one the server and the app carry, or the server refuses the agreement.
precondition(SharedLink.needsConsent(status: 403, body: ["code":"ai_consent_required"]))
precondition(!SharedLink.needsConsent(status: 403, body: ["message":"This account cannot save."]))
precondition(!SharedLink.needsConsent(status: 200, body: ["code":"ai_consent_required"]))
let versions = try String(contentsOfFile: "supabase/functions/spotter/index.ts", encoding: .utf8)
precondition(versions.contains("const AI_CONSENT_VERSION = \\"\\(SharedLink.consentVersion)\\""), "extension and server agree on the AI wording version")
let appVersions = try String(contentsOfFile: "supabase/functions/spotter/app.ts", encoding: .utf8)
precondition(appVersions.contains("var AI_CONSENT_VERSION = \\"\\(SharedLink.consentVersion)\\""), "extension and app agree on the AI wording version")
precondition(SharedLink.consentText.contains("OpenAI or Google") && SharedLink.consentText.contains("quarterdeckcollective.com/spotter/privacy"))
precondition(SharedLink.consentDeclinedMessage.contains("Data & privacy"))
precondition(SharedLink.consentFailureMessage(status: 409, body: ["code":"ai_consent_version"]).contains("Update Spotter"))
precondition(SharedLink.consentFailureMessage(status: 401, body: [:]).contains("sign-in"))
precondition(SharedLink.consentFailureMessage(status: 0, body: [:]).contains("connection"))
precondition(SharedLink.failureMessage(status: 401, body: [:]).contains("sign-in"))
precondition(SharedLink.failureMessage(status: 403, body: ["message":"This account cannot save."]) == "This account cannot save.")
precondition(SharedLink.failureMessage(status: 429, body: ["message":"Monthly allowance reached."]) == "Monthly allowance reached.")

// Every failure: one sentence, and "Try again" only where trying again can help.
typealias F = SharedLink.Failure
let unavailable = "This post is private, deleted or unavailable to Spotter."
precondition(SharedLink.failure(status: 422, body: ["status":"error","code":"unavailable","message":unavailable]) == F(message: unavailable, retry: false))
precondition(SharedLink.failure(status: 404, body: ["code":"unavailable"]).message.contains("share it again"))
let busy = "Still saving your last share — try again in a few seconds."
precondition(SharedLink.failure(status: 429, body: ["status":"limit","kind":"request","code":"busy","message":busy]) == F(message: busy, retry: true))
precondition(SharedLink.failure(status: 429, body: ["code":"busy"]) == F(message: busy, retry: true))
precondition(SharedLink.failure(status: 429, body: ["status":"limit","kind":"request","code":"minute","message":"Too many saves in a minute."]).retry)
precondition(!SharedLink.failure(status: 429, body: ["status":"limit","kind":"library","message":"Your library is full."]).retry)
precondition(!SharedLink.failure(status: 429, body: ["status":"limit","kind":"saves","message":"That is today's 30."]).retry)
precondition(SharedLink.failure(status: 429, body: ["status":"limit","message":"Uploads are busy right now. Please try again later."]).retry, "a busy upload permit clears")
precondition(!SharedLink.failure(status: 429, body: ["status":"limit","kind":"request","code":"daily","message":"You have reached the limit for now. Please try again later."]).retry, "a daily admission cap does not clear in seconds")
precondition(!SharedLink.failure(status: 429, body: ["status":"limit","kind":"request","code":"credits_month","message":"x"]).retry)
precondition(!SharedLink.failure(status: 400, body: ["status":"error","message":"No workout link found in what was shared."]).retry)
precondition(!SharedLink.failure(status: 400, body: ["status":"blocked","message":"private address"]).retry)
precondition(SharedLink.failure(status: 500, body: ["status":"error","message":"Something broke."]).retry)
precondition(SharedLink.failure(status: 502, body: [:]) == F(message: "Spotter couldn’t save this link. Please try again.", retry: true))
precondition(!SharedLink.failure(status: 403, body: [:]).retry)
precondition(!SharedLink.failure(status: 401, body: [:]).retry)

// The video door's sentences: each names the problem and the next step.
precondition(SharedLink.videoMaxBytes == 26_214_400, "the server's and the bucket's 25 MB")
let upload = try String(contentsOfFile: "supabase/functions/spotter/index.ts", encoding: .utf8)
for ext in SharedLink.videoTypes.keys { precondition(upload.contains("\\"" + ext + "\\""), "the server accepts ." + ext) }
precondition(SharedLink.videoProblem(.tooBig(48_000_000)).hasPrefix("This video is 46 MB, and Spotter takes videos up to 25 MB."))
precondition(SharedLink.videoProblem(.tooBig(48_000_000)).contains("Trim it in Photos"))
precondition(SharedLink.videoProblem(.unsupported("avi")).contains("a .avi file"))
precondition(SharedLink.videoProblem(.unreadable).contains("Save it to Photos"))
precondition(SharedLink.videoNotHereYet.contains("Upload a video from your phone"))
precondition(SharedLink.noLinkMessage.contains("share the video file itself"))

// S14: parked while signed out, handed to the app once, oldest first.
let now = Date()
SharedStore.remove(key: ParkedShare.key)
SharedStore.remove(key: ParkedShare.ownerKey)
let keyA = String(repeating: "a", count: 32), keyB = String(repeating: "b", count: 32)
precondition(ParkedShare.take(for: keyA, now: now) == nil)
try ParkedShare.park(URL(string: "https://vt.tiktok.com/A/")!, now: now.addingTimeInterval(-8 * 24 * 3600))
try ParkedShare.park(URL(string: "https://www.instagram.com/reel/DBGi0r0pHZ4/")!, now: now.addingTimeInterval(-60))
try ParkedShare.park(URL(string: "https://vt.tiktok.com/B/")!, now: now.addingTimeInterval(-30))
try ParkedShare.park(URL(string: "https://www.instagram.com/reel/DBGi0r0pHZ4/")!, now: now)
let first = ParkedShare.take(for: keyA, now: now)!
precondition(first.url == "https://vt.tiktok.com/B/", "a week-old link is dropped, and a re-shared link moves to the back")
precondition(first.at == ((now.timeIntervalSince1970 - 30) * 1000).rounded())
precondition(ParkedShare.take(for: keyA, now: now)?.url == "https://www.instagram.com/reel/DBGi0r0pHZ4/")
precondition(ParkedShare.take(for: keyA, now: now) == nil, "each link is handed over once")
for i in 0..<15 { try ParkedShare.park(URL(string: "https://vt.tiktok.com/\\(i)/")!, now: now) }
var kept: [String] = []
while let item = ParkedShare.take(for: keyA, now: now) { kept.append(item.url) }
precondition(kept.count == ParkedShare.limit && kept.first == "https://vt.tiktok.com/5/", "at most ten, the newest kept")
// R-5: a parked link belongs to the account signed in last on this phone.
SharedStore.remove(key: ParkedShare.ownerKey)
try ParkedShare.park(URL(string: "https://vt.tiktok.com/first/")!, now: now)
precondition(ParkedShare.take(for: nil, now: now) == nil, "R-5: nothing is handed over before the app has configured an account")
ParkedShare.claim(saveKey: keyA, now: now)
precondition(ParkedShare.take(for: keyA, now: now)?.url == "https://vt.tiktok.com/first/", "R-5: a link parked before any account goes to the first one")
// A signs out (the tag stays), somebody shares, B signs in on the same phone.
try ParkedShare.park(URL(string: "https://vt.tiktok.com/after-a/")!, now: now)
ParkedShare.claim(saveKey: keyB, now: now)
precondition(ParkedShare.take(for: keyB, now: now) == nil, "R-5: a link parked after A signed out never reaches B")
ParkedShare.claim(saveKey: keyA, now: now)
precondition(ParkedShare.take(for: keyA, now: now) == nil, "R-5: and it is dropped, not kept for later")
// A signs out and back in: what they shared meanwhile is still theirs.
try ParkedShare.park(URL(string: "https://vt.tiktok.com/mine/")!, now: now)
ParkedShare.claim(saveKey: keyA, now: now)
precondition(ParkedShare.take(for: keyA, now: now)?.url == "https://vt.tiktok.com/mine/", "R-5: the same account signing back in gets its links")
// A deletes the account; a new account signs up on the phone.
try ParkedShare.park(URL(string: "https://vt.tiktok.com/before-new/")!, now: now)
precondition(ParkedShare.take(for: keyB, now: now) == nil, "R-5: a different account asking directly gets nothing either")
precondition(!ParkedShare.tag(forKey: keyA).contains(keyA) && ParkedShare.tag(forKey: keyA).count == 16 && ParkedShare.tag(forKey: keyA) != ParkedShare.tag(forKey: keyB),
  "R-5: the tag is a one-way 16-hex digest, distinct per key")
precondition(SharedLink.parkedMessage == "You’re signed out. Sign in to Spotter and it will be saved.")
print("PASS native activation incl. one video file (and not two), safe predicate forms, 17 social/web URL formats, one post however it is spelled, \\(cases.count) share payloads each saving one link, set-aside notes, save-first frames rules, failure retry rules incl. unavailable/busy, video-door sentences, parked links (expiry, order, once, per account), durable-save acknowledgement and the in-sheet AI permission")
`);
const swiftc = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc';
const sdk = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk';
const target = process.arch === 'arm64' ? 'arm64-apple-macosx14.0' : 'x86_64-apple-macosx14.0';
const r = spawnSync(swiftc, ['-sdk', sdk, '-target', target, '-module-cache-path', join(dir, 'cache'),
  'ios/App/Shared/SharedLink.swift', 'ios/App/Shared/TikTokMedia.swift', 'ios/App/Shared/ShareCredential.swift',
  'ios/App/Shared/SharedStore.swift', join(dir, 'main.swift'),
  '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', join(dir, 'Info.plist'),
  '-o', join(dir, 'check')], { encoding: 'utf8' });
assert.equal(r.status, 0, r.stderr);
const result = spawnSync(join(dir, 'check'), [join(dir, 'cases.json')], { encoding: 'utf8' });
spawnSync('defaults', ['delete', suite]);
rmSync(join(process.env.HOME, 'Library/Preferences', suite + '.plist'), { force: true });
assert.equal(result.status, 0, result.stderr); process.stdout.write(result.stdout);
console.log('PASS serialized account switching with the plan hint, sign-out, credential-write failure recovery, parked-link bridge, save-first source order, C5 pipeline overlap');
