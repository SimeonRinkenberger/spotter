# Pumpy: art and contextual help

Released 6 September 2026. The user's supplied sketches and orange plate reference establish Pumpy's identity. Artwork was generated with the built-in image tool, then resized and compressed for the app. The drawings use ink variation and pencil texture; they are not represented as drawings made by the original artist.

## Product direction

A calm coach: short, useful sentences beside the current action. No introductory tour, modal walkthrough, confetti, XP, extra notifications or moving mascot in the workout controls. The three full poses are clipboard/open hand, planning on a bench, and a quiet thumbs-up. A separate face crop remains legible in the tab bar and shared workout cards.

- [Apple onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding): make learning brief, optional and contextual. In Spotter, help lives inside the relevant page or sheet.
- [Apple TipKit](https://developer.apple.com/documentation/tipkit/tips): use eligibility, display limits and completed actions. Spotter only counts a tip when at least 80% visible; background page warming cannot count a visit.
- [Atlassian empty states](https://atlassian.design/components/empty-state): connect an empty screen to the next useful action. Pumpy accompanies existing actionable copy, with no additional step.
- [Duolingo imagery](https://design.duolingo.com/identity/imagery): distinct poses support a consistent character. The application here is visual consistency and expressive variety; Spotter keeps its quieter coaching tone.

## Behavior

Six topics: saving a video, exercise options, logging a set, planning, weekly progress, and adding workout references to a Pumpy conversation. Each automatic tip is shown once per account/device, at most two per page-load session, at least 90 seconds apart. Existing plans and completed relevant actions retire their introductory tips. Dismissing also retires a tip. An explicit visit must occur; pre-rendering the four tab panels does not trigger tips.

Settings → Pumpy has Helpful tips, Little animations, and Quick guide. The guide uses expandable topics and includes a deliberate reset. Preferences and impressions use localStorage scoped by user ID; storage failure falls back to session behavior. No migration, analytics event, AI request or new server cost.

Motion: one 2.4-second wing beat, only in an empty Progress state or completed-workout summary, then the still image returns. No infinite loop or audio. The GIF starts only when 80% visible and stops on leaving the viewport, page/sheet navigation, backgrounding, disabling motion, or a change to system Reduce Motion. Unused GIFs are not fetched. Existing rest/workout motion is unchanged.

The avatar stays inside a self-contained SVG with a data-embedded WebP, preserving the existing share-canvas rendering contract. Larger artwork is loaded from first-party WebP files and cached on demand by service worker v4. The edge-served page points at the same assets on GitHub Pages. The supplied video has a baked checkerboard background, so it is reference only and is not shipped.

Incidental fix: saving a preference preserves unrelated existing profile settings instead of replacing the JSON with only recognized fields.

## Assets

| File | Use |
| --- | --- |
| [coach.webp](../docs/assets/pumpy/coach.webp) | Empty library/chat and contextual tips |
| [plan.webp](../docs/assets/pumpy/plan.webp) | Planning tips and manual guide |
| [proud.webp](../docs/assets/pumpy/proud.webp) | Progress and session completion |
| [avatar.webp](../docs/assets/pumpy/avatar.webp) | Compact identity and share canvas |
| [proud-wing.gif](../docs/assets/pumpy/proud-wing.gif) | One gentle wing beat |

The full illustrations are 480px WebP, about 27–32KB each. Avatar is 128px, about 4KB. GIF is 256px and about 83KB. The ivory background is intentional: image generation did not produce reliable alpha, so it is framed as a small illustration panel rather than pretending a checkerboard is transparency.

[Phone-friendly art preview](https://simeonrinkenberger.github.io/spotter/pumpy.html)

## Generation prompts

The final coach image used the orange plate identity image and a PNG conversion of the supplied original plate sketch as references. Later poses used the final coach drawing as the identity reference. Two earlier transparency attempts were rejected and are not shipped.

### Final coach

Edit supplied Pumpy illustration. Replace the ENTIRE checkerboard backdrop with absolutely flat solid warm ivory #F5F1E8. No checkerboard anywhere, no transparent background, no transparency preview. Every background pixel is solid ivory, including between legs and between wings and arms. Keep this exact coach Pumpy with clipboard, same hand-inked drawing, ink texture, closed smile, orange 5 LB plate, feather wings, sneakers, same position and size. No new objects or letters. Production illustration on solid ivory.

### Planning pose

Use case: illustration-story. Reference is Pumpy, preserve exact identity, colors, weight plate anatomy, cream face, 5 LB markings, small orange nose, feather wings and ink/hatching style. New unique pose for a fitness planner: Pumpy sitting comfortably on a low graphite gym bench, angled slightly to the left, looking thoughtfully at a small cream weekly planner resting on his knee, pencil in gloved right hand, sneakers planted, other hand steadies planner. Calm focused coach, closed-mouth thoughtful smile, no sad or clown expression. Full body isolated in a square on absolutely solid warm ivory #F5F1E8 background. No background scene, checkerboard, transparency, ground shadow, stars or slogans. Hand-drawn ink contours slightly imperfect, limited orange/graphite/cream palette, same scale, generous 10% padding.

### Completed-work pose

Use case: illustration-story. Produce a NEW pose of the identical Pumpy character shown in reference, final fitness app artwork. Pumpy is an orange circular 5 LB weight plate with thick graphite rim, cream center face, small orange nose, confident eyebrows and a subtle closed-mouth pleased smile. Strong black arms, cream gloves, black gym sneakers. Pose: standing front-on with both feet steady, right hand offers a modest thumbs-up at hip height, left hand rests on hip. Two small cream feather wings extend out from behind plate at its upper left and upper right, clearly separated from both arms, symmetrical and easy to animate. No clipboard, flag, bench, stars, sparks, motion lines, words, or other props. Preserve hand-inked slightly irregular contours, paper-like pencil hatching inside character, restrained orange/graphite/cream palette. Proud and supportive coach, no yelling, huge grin or clown details. Centered full body on a perfectly flat solid warm ivory #F5F1E8 background. Background contains NO texture, gradient, checkerboard, transparency pattern, shadow, or floor. Wings within left and right outer upper thirds with clear ivory around them. Generous 10% outer padding.

### Compact avatar

Use case: logo-brand. Asset: small app avatar for Pumpy fitness coach. Reference identity must match exactly: orange weight plate, thick graphite circular rim, cream circular face, confident dark eyebrows, friendly closed smile and small orange nose. Draw ONLY a front-facing circular weight plate with face, no arms, legs, shoes, wings, clipboard, lettering or numbers. Circle almost fills square with 5% padding. Simplify hatching and facial features to read clearly at 28 pixels, warm hand-inked imperfect outline, flat fills, no glossy shine. Background perfectly solid warm ivory #F5F1E8, no checkerboard, no scene, no shadow. Symmetric face with calm warm expression. Same orange/graphite/cream character as reference.

## Animation recipe

The wing regions of the proud still receive an opposing ±0.035-radian sinusoidal rotation over 2.4 seconds at 16fps. Body, face, hands and feet remain fixed. Export is a 128-color 256px GIF with no loop extension; the UI restores WebP after 2.5 seconds. No generated video or Midjourney account was needed.

## Verification

Run `node build.mjs`, then `node tools/pumpy-harness.mjs`. The harness needs LinkeDOM; install it outside the repository with `npm install --prefix /tmp/spotter-qa linkedom`, or set `SPOTTER_DOM_MODULE` to its ESM entry point. Checks cover real helper code with controlled visibility, account changes, persistence failures, cooldown, session cap, disabled tips, reduced motion, offscreen motion, and generated page parity. Browser QA uses a disposable account and a 375×812 viewport; no owner workout data is changed.

