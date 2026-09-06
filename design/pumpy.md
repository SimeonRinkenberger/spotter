# Pumpy: art and contextual help

Released 6 September 2026. The user's supplied sketches and orange plate reference establish Pumpy's identity. Still artwork was generated with the built-in image tool, then resized and compressed for the app. The rack-pose blink uses Midjourney video, with the eye movement isolated in a fixed illustration. The drawings use ink variation and pencil texture; they are not represented as drawings made by the original artist.

## Product direction

A calm coach: short, useful sentences beside the current action. New accounts get three brief, skippable introduction steps; the rest is contextual. No confetti, XP, extra notifications or moving mascot in workout controls. Four full poses have distinct facial acting: conversational clipboard/open hand, focused planning on a bench, quietly pleased thumbs-up, and relaxed leaning on a squat rack with a peace sign. A separate face crop remains legible in the tab bar and shared workout cards.

- [Apple onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding): make learning brief, optional and contextual. In Spotter, the short introduction covers saving, finding workouts in Library, and accessing Pumpy. Later help lives inside the relevant page or sheet.
- [Apple TipKit](https://developer.apple.com/documentation/tipkit/tips): use eligibility, display limits and completed actions. Spotter only counts a tip when at least 80% visible; background page warming cannot count a visit.
- [Atlassian empty states](https://atlassian.design/components/empty-state): connect an empty screen to the next useful action. Pumpy accompanies existing actionable copy, with no additional step.
- [Duolingo imagery](https://design.duolingo.com/identity/imagery): distinct poses support a consistent character. The application here is visual consistency and expressive variety; Spotter keeps its quieter coaching tone.

## Behavior

Six topics: saving a video, exercise options, logging a set, planning, weekly progress, and adding workout references to a Pumpy conversation. Each automatic tip is shown once per account/device, at most two per page-load session, at least 90 seconds apart. Existing plans and completed relevant actions retire their introductory tips. Dismissing also retires a tip. An explicit visit must occur; pre-rendering the four tab panels does not trigger tips.

The automatic introduction is eligible for accounts created on or after 6 September 2026 at 14:30 UTC with an empty library, after both profile and library load. Existing accounts are not interrupted. Skip, finish, Escape, backdrop dismissal or a back gesture retire it. Completion is stored locally and merged into `profiles.settings.pumpyWelcome`, so a returning account does not repeat it on another device after a successful sync. Local persistence still works if the profile write fails. Settings replay is always available. The three steps share a fixed layout, use Next/Back/Skip, announce the current step, hide inactive pages from accessibility, and trap keyboard focus.

Settings → Pumpy has Helpful tips, Little animations, and Quick guide, including Replay the short introduction. The guide uses expandable topics and includes a deliberate reset. Preferences and impressions use localStorage scoped by user ID; storage failure falls back to session behavior. No migration, analytics event or AI request is needed. Intro completion adds one profile-settings write; tips remain local.

Motion: one restrained blink on the “Hey, I’m Pumpy” empty chat screen (five-second asset, mostly still), or one 2.4-second wing beat in an empty Progress state or completed-workout summary. Each pose plays at most once per page load. Animated WebP preserves an image-only path, with no audio session or video player. Assets start only when 80% visible and stop on leaving the viewport, navigation, backgrounding, disabling motion or system Reduce Motion. Slow-loading assets receive their full playback window; failures fall back to the still. Unused animations are not fetched. The introduction itself uses still artwork. Optional GIF downloads are available in the gallery.

Help disclosures and tip dismissal use interruptible 240ms height transitions. Sheet exits hold the retiring tip’s geometry while the sheet slides away. The introduction uses a stable three-page grid and a small eased crossfade/slide. Reduce Motion removes the sliding/size animation. Existing tab swipes retain their interruptible spring.
The avatar stays inside a self-contained SVG with a data-embedded WebP, preserving the existing share-canvas rendering contract. Larger artwork is loaded from first-party WebP files and cached on demand by service worker v5. App art URLs are versioned to refresh existing caches. The edge-served page points at the same assets on GitHub Pages. The supplied video has a baked checkerboard background, so it is reference only and is not shipped.

Incidental fixes: arriving on a warmed Pumpy tab preserves the existing greeting instead of interrupting its animation with a redundant redraw; profile loading ignores late responses after an account switch; replay closes the underlying guide/settings sheets before returning focus to the app; saving a preference preserves unrelated existing profile settings.

## Assets

| File | Use |
| --- | --- |
| [coach.webp](../docs/assets/pumpy/coach.webp) | Empty library, introduction and contextual tips |
| [plan.webp](../docs/assets/pumpy/plan.webp) | Planning tips and manual guide |
| [proud.webp](../docs/assets/pumpy/proud.webp) | Progress and session completion |
| [avatar.webp](../docs/assets/pumpy/avatar.webp) | Compact identity and share canvas |
| [hello.webp](../docs/assets/pumpy/hello.webp) | Relaxed rack pose for chat and introduction |
| [hello-motion.webp](../docs/assets/pumpy/hello-motion.webp) | One isolated Midjourney blink |
| [proud-wing.webp](../docs/assets/pumpy/proud-wing.webp) | One smooth wing beat |
| [hello-motion.gif](../docs/assets/pumpy/hello-motion.gif), [proud-wing.gif](../docs/assets/pumpy/proud-wing.gif) | Optional downloads; app uses smaller animated WebP |

The full illustrations are 480px WebP, about 27–29KB each. Avatar is 128px, about 4KB. Animations are 320px: the blink is about 76KiB and the wing beat about 192KiB. Still spans are coalesced into longer frames; no repeated idle frames need downloading. The ivory background is intentional: image generation did not produce reliable alpha, so it is framed as a small illustration panel rather than pretending a checkerboard is transparency.

[Phone-friendly art preview](https://simeonrinkenberger.github.io/spotter/pumpy.html)

## Generation prompts

The final coach image used the orange plate identity image and a PNG conversion of the supplied original plate sketch as references. Later poses used the final coach drawing as the identity reference. Two earlier transparency attempts were rejected and are not shipped.

### Base coach (before expression edit)

Edit supplied Pumpy illustration. Replace the ENTIRE checkerboard backdrop with absolutely flat solid warm ivory #F5F1E8. No checkerboard anywhere, no transparent background, no transparency preview. Every background pixel is solid ivory, including between legs and between wings and arms. Keep this exact coach Pumpy with clipboard, same hand-inked drawing, ink texture, closed smile, orange 5 LB plate, feather wings, sneakers, same position and size. No new objects or letters. Production illustration on solid ivory.

### Planning pose

Use case: illustration-story. Reference is Pumpy, preserve exact identity, colors, weight plate anatomy, cream face, 5 LB markings, small orange nose, feather wings and ink/hatching style. New unique pose for a fitness planner: Pumpy sitting comfortably on a low graphite gym bench, angled slightly to the left, looking thoughtfully at a small cream weekly planner resting on his knee, pencil in gloved right hand, sneakers planted, other hand steadies planner. Calm focused coach, closed-mouth thoughtful smile, no sad or clown expression. Full body isolated in a square on absolutely solid warm ivory #F5F1E8 background. No background scene, checkerboard, transparency, ground shadow, stars or slogans. Hand-drawn ink contours slightly imperfect, limited orange/graphite/cream palette, same scale, generous 10% padding.

### Completed-work pose

Use case: illustration-story. Produce a NEW pose of the identical Pumpy character shown in reference, final fitness app artwork. Pumpy is an orange circular 5 LB weight plate with thick graphite rim, cream center face, small orange nose, confident eyebrows and a subtle closed-mouth pleased smile. Strong black arms, cream gloves, black gym sneakers. Pose: standing front-on with both feet steady, right hand offers a modest thumbs-up at hip height, left hand rests on hip. Two small cream feather wings extend out from behind plate at its upper left and upper right, clearly separated from both arms, symmetrical and easy to animate. No clipboard, flag, bench, stars, sparks, motion lines, words, or other props. Preserve hand-inked slightly irregular contours, paper-like pencil hatching inside character, restrained orange/graphite/cream palette. Proud and supportive coach, no yelling, huge grin or clown details. Centered full body on a perfectly flat solid warm ivory #F5F1E8 background. Background contains NO texture, gradient, checkerboard, transparency pattern, shadow, or floor. Wings within left and right outer upper thirds with clear ivory around them. Generous 10% outer padding.

### Compact avatar

Use case: logo-brand. Asset: small app avatar for Pumpy fitness coach. Reference identity must match exactly: orange weight plate, thick graphite circular rim, cream circular face, confident dark eyebrows, friendly closed smile and small orange nose. Draw ONLY a front-facing circular weight plate with face, no arms, legs, shoes, wings, clipboard, lettering or numbers. Circle almost fills square with 5% padding. Simplify hatching and facial features to read clearly at 28 pixels, warm hand-inked imperfect outline, flat fills, no glossy shine. Background perfectly solid warm ivory #F5F1E8, no checkerboard, no scene, no shadow. Symmetric face with calm warm expression. Same orange/graphite/cream character as reference.

## Final expression edits

### coach

Use case: precise-object-edit. Edit target: supplied Pumpy clipboard illustration. Change ONLY the features INSIDE the cream center face to give this pose a distinct conversational expression: one eyebrow raised slightly, the other gently relaxed; eyes looking toward the viewer with an attentive slight squint; a small asymmetrical open speaking smile, as if a thoughtful gym coach is calmly explaining one useful thing. The mouth is a modest half-open shape with a little cream tooth edge, not a huge grin or shout. No tongue sticking out. Warm, knowing and approachable, not clowny, not smug. Preserve the exact original drawing outside the cream face: body size and placement, weight plate rim, orange, 5 LB lettering, wings, arms, clipboard, hand gestures, legs, sneakers, crop, flat warm ivory backdrop and hand-ink/pencil texture. Preserve nose size. Do not redraw the whole character or simplify the linework. Facial acting should look drawn deliberately by the same artist.

### plan

Use case: precise-object-edit. Edit target: supplied Pumpy seated with weekly planner. Change ONLY the expression inside the cream circular face. Give him a focused, thoughtful coach expression: both pupils clearly look DOWN toward the planner at lower right; upper lids lowered a little in concentration, one brow gently tilted inward and the other raised just a touch; small off-center closed mouth, gently pursed in thought rather than smiling at the camera. Warm concentration, no angry scowl, no sad face, no giant smile, no cute tongue. This expression must read distinctly differently from a generic happy mascot at small size. Preserve exact body/pose/position/size, nose, cream face boundary, orange 5 LB plate, rim, wings, arms, hands, pencil, planner, bench, sneakers, backdrop and hand-drawn ink and pencil texture. Do not change lettering or framing. Same artist's drawing with facial acting only.

### proud

Use case: precise-object-edit. Edit target: supplied standing Pumpy thumbs-up illustration. Change ONLY expression within the cream center face. A distinct relaxed 'good work' coach face: eyes gently CLOSED into natural upward happy arcs, eyebrows relaxed and slightly asymmetric, cheeks subtly lifted, a broad but CLOSED soft smile with one corner slightly higher. Content and quietly proud after a workout, not laughing, no open mouth, no teeth, no confetti, no clown exaggeration. Keep his small orange nose unchanged. Preserve every feature outside the cream face EXACTLY including the entire plate and 5 LB lettering, both wings in the same position (they will be animated separately), hands and gestures, legs/sneakers, proportions, padding, solid ivory background and textured hand-ink style. No camera/framing change. Only face expression.

## Rack pose prompt

Use case: illustration-story. Asset: the 'Hey, I’m Pumpy' welcome illustration in a refined fitness app, also the start frame for a very subtle animation. Reference image is the identity and hand-ink style guide. Draw the SAME orange 5 LB plate mascot, graphite rubber rim, cream center face, small orange nose, strong black arms, cream gloves, black/orange sneakers, small feather wings. NEW pose and scene: Pumpy casually leans his LEFT elbow against the upright of a compact graphite squat rack on the LEFT of the frame. His weight rests on one leg and his other ankle crosses loosely in front. His RIGHT gloved hand gives a relaxed two-finger peace sign beside his shoulder. He looks toward us with softly half-lidded confident eyes, one brow slightly raised, a small crooked closed smile: the approachable cool coach at your gym. Natural, relaxed attitude; no sunglasses, no hat, no costume, no clown grin. Only the simple rack upright and short base with a few adjustment holes; no complex gym scene or other equipment. Keep face and peace hand unobscured, both wings visible but small. Handmade pen and pencil texture, slightly irregular confident ink contours, matte limited orange/graphite/cream palette. Whole character and rack contained in a square, generous 10% margins on all sides, solid uniform warm ivory #F5F1E8 backdrop with no floor shadow, gradients, checkerboard or extra text. Not glossy, not 3D, not a sticker collage. Cohesive single illustration.

## Animation recipe

The proud still’s wing regions receive opposing ±0.035-radian sinusoidal rotations over 2.4 seconds, sampled at 50fps. Body, face, hands and feet remain fixed. The animated WebP and optional GIF play once.

For the rack pose, Midjourney generated two batches of two five-second videos using the published `hello.webp` as the start/end frame, Low Motion, Loop, Raw and `--bs 2`. The unconstrained outputs moved the face and limbs too much and are not shipped. The final animation extracts the brief eyelid closure from frames 15–17 of [Midjourney job 7019c1a3, variant 1](https://www.midjourney.com/jobs/7019c1a3-6eaf-433e-93ae-81d4b7dcc231?index=1), reverses it to reopen, and feathers it over the original illustration. Only the two eye regions are allowed to change. A 48fps blend smooths the closure; most of the five-second asset is still.

[The FFmpeg filter](../tools/pumpy-blink.ffmpeg) records the edit. Input 0 is a looped `hello.webp`; input 1 is the original downloaded Midjourney video. Export `[out]` for five seconds with `libwebp_anim`, `-lossless 1 -compression_level 6 -loop 1`. Lossless encoding keeps every pixel outside the eye region fixed. Optional GIFs use a shared palette and cumulative centisecond timing. Original video is retained in the owner’s Midjourney account, not loaded by the app.

References: [Midjourney video controls](https://docs.midjourney.com/hc/en-us/articles/37460773864589-Video), [Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion).

### Midjourney final generation prompt

Static illustration with an extremely subtle eye blink. The character remains frozen in this exact pose and facial expression. The mouth is a fixed closed ink line. One gentle eyelid blink is the entire animation. Everything else is perfectly still. Fixed camera. --raw --bs 2

The prompt alone did not enforce stillness; the spatial edit above does.

## Verification

Run `node build.mjs`, then `node tools/pumpy-harness.mjs`. The harness needs LinkeDOM; install it outside the repository with `npm install --prefix /tmp/spotter-qa linkedom`, or set `SPOTTER_DOM_MODULE` to its ESM entry point. Checks cover real helper code with controlled visibility, account changes, persistence failures, cooldown, session cap, disabled tips, reduced motion, offscreen motion, and generated page parity. The 37 checks include intro eligibility, three steps, Back/Next, skip/completion persistence, replay returning to the app, animation loading failures, one-play behavior and interruptible resizing. Browser QA used a disposable account, 375×812 dark mode and 375×667 light-mode CSS fixture. All three intro steps kept the same sheet height; focus wrapping, skip and profile completion were verified. A reduced-motion fixture displayed only the still image. Temporary frame instrumentation observed progressive disclosure heights with no runtime errors. No owner workout data was changed. These browser checks do not claim physical iPhone or VoiceOver testing.
