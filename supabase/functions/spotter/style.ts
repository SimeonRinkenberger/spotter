// Spotter design system. Wrapped in String.raw; never use backticks or "${" inside.
export const STYLE = String.raw`<style>
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  :root {
    color-scheme: light dark;
    /* surfaces — cool graphite, never pure white */
    --paper: #F5F6F8; --card: #FFFFFF; --sand: #E9ECF1;
    /* --muted carries the small print and was 2.81:1 on paper: same grey, walked
       down to 4.52 on paper, 4.89 on card. */
    --ink: #14171A; --ink-2: #58626E; --muted: #68727E;
    --line: rgba(20,23,26,.09); --line-2: rgba(20,23,26,.18);
    /* one accent, capped at ~10% of any screen */
    /* --ember does not move: every fill, glow and lit muscle is made of it. The
       ink ON it does — near-white was 3.48:1, and this is the ink dark mode
       already uses, so the schemes agree instead of inverting. */
    --ember: #E8551F; --ember-ink: #BE3F0E; --ember-soft: #FDEDE6; --on-ember: #17100C;
    --good: #178055; --warn: #AE7400;
    /* The tab bar's selection capsule: a tint read as glass, not a second
       accent. 7% is where it stops costing the lit label its AA — a tenth put
       ember-ink on 4.41 against it, under the 4.5 that 10px type needs; this
       measures 4.58. Dark affords more: there the label lightens as the
       capsule darkens (6.85). */
    --pill: color-mix(in srgb, var(--ember) 7%, transparent);
    /* body map: the silhouette, then the muscles that sit on it untargeted */
    --body-skin: #DCE1E8; --body-mus: #AEB7C3;
    --scrim: rgba(12,16,22,.55);
    --glow: rgba(232,85,31,.28);
    --sh-sm: 0 1px 2px rgba(16,22,32,.06), 0 2px 6px rgba(16,22,32,.05);
    --sh-md: 0 1px 2px rgba(16,22,32,.05), 0 6px 14px rgba(16,22,32,.07), 0 16px 30px rgba(16,22,32,.05);
    --sh-lg: 0 2px 6px rgba(16,22,32,.07), 0 12px 28px rgba(16,22,32,.11), 0 30px 56px rgba(16,22,32,.08);
    --sh-up: 0 -6px 34px rgba(12,18,28,.18);
    --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E");
    /* Space Grotesk is on every 2026 list of fonts that give an AI-built app
       away, and it is wide: at 375px the landing headline needed three lines.
       Cabinet Grotesk sets 10% narrower for the same size, which buys back a
       line on the hero and a line on every card title, and it has a voice.
       ITF Free Font Licence, so commercial use and CDN loading are allowed.
       Every negative track below was retuned for it; the uppercase ones were
       not, because the two faces set capitals to within a third of a percent. */
    --display: "Cabinet Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --sans: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    --e-out: cubic-bezier(.22,.9,.3,1);
    --e-spring: cubic-bezier(.32,.72,0,1);
    --e-soft: cubic-bezier(.4,0,.2,1);
    /* The one curve missing: one that LEAVES. Material's emphasized-accelerate. */
    --e-in: cubic-bezier(.3,0,.8,.15);
    --t-1: 150ms; --t-2: 220ms; --t-3: 320ms; --t-4: 420ms;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #101214; --card: #191D21; --sand: #232931;
      --ink: #EEF2F6; --ink-2: #AFBAC6; --muted: #7C8794;
      --line: rgba(238,242,246,.10); --line-2: rgba(238,242,246,.19);
      --ember: #FF7A45; --ember-ink: #FF9166; --ember-soft: #33190F; --on-ember: #17100C;
      --good: #3FD096; --warn: #E8B54A;
      --pill: color-mix(in srgb, var(--ember) 15%, transparent);
      --body-skin: #23282F; --body-mus: #3C4650;
      --scrim: rgba(2,4,8,.66);
      --glow: rgba(255,122,69,.26);
      --sh-sm: 0 1px 2px rgba(0,0,0,.44), 0 2px 8px rgba(0,0,0,.34);
      --sh-md: 0 2px 6px rgba(0,0,0,.46), 0 10px 24px rgba(0,0,0,.38);
      --sh-lg: 0 4px 12px rgba(0,0,0,.54), 0 20px 46px rgba(0,0,0,.46);
      --sh-up: 0 -8px 40px rgba(0,0,0,.58);
      --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.09'/%3E%3C/svg%3E");
    }
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; background-color: var(--paper); color: var(--ink);
    font-family: var(--sans); overscroll-behavior-y: none;
    -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  /* Quotes and brackets hang into the margin instead of indenting the line they
     start. One declaration, Safari-supported, and it is the difference between
     type that was set and type that was poured in. */
  body { background-image: var(--grain); hanging-punctuation: first; }
  button, input, select, textarea { font-family: var(--sans); }
  button { cursor: pointer; }
  .hide { display: none !important; }

  /* ---------- icons ----------
     The sprite is a real element in the flow, so it is taken out of it here
     rather than with display:none, which stops <use> resolving in WebKit.
     Everything else is one class: 1em square by default, so an icon is the size
     of the text it sits beside, and stroked in currentColor, so it takes the
     colour of whatever it is in — including the tab bar's per-frame colour-mix. */
  .sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
  .ic { width: 1em; height: 1em; display: block; flex: 0 0 auto; fill: none;
    stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  /* A favourite is a filled star, everywhere it is shown. */
  .iconbtn.on .ic, .fav .ic { fill: currentColor; }
  .iconbtn .ic { width: 18px; height: 18px; }
  .addbtn .ic { width: 20px; height: 20px; }
  .addbtn.ghost .ic { width: 18px; height: 18px; }
  .chip .ic, .mbtn .ic, .btn .ic { width: 15px; height: 15px; }
  .exhelp .ic, .colrow .mark .ic, .daydone .ic { width: 14px; height: 14px; }
  .searchico .ic { width: 16px; height: 16px; }
  .stepper button .ic { width: 20px; height: 20px; }
  /* Every control that used to centre a glyph with line-height now has a box to
     centre instead, and a box only centres inside a flex container. */
  .addbtn, .planx, .pumpyctx button, #hint button, .stepper button {
    display: flex; align-items: center; justify-content: center; }
  .btn { display: flex; align-items: center; justify-content: center; gap: 7px; }
  .daydone { display: inline-flex; align-items: center; gap: 4px; }

  /* ---------- landing (signed out) ---------- */
  #landing { display: none; min-height: 100vh; min-height: var(--vvh, 100dvh); }
  #landing.open { display: block; }
  .land { max-width: 460px; margin: 0 auto; padding: calc(38px + env(safe-area-inset-top)) 24px 60px; }
  .brandrow { display: flex; align-items: center; gap: 11px; margin-bottom: 40px; }
  .brandrow img { width: 40px; height: 40px; border-radius: 11px; box-shadow: var(--sh-sm); }
  .brandrow span { font-family: var(--display); font-size: 21px; font-weight: 700; letter-spacing: -.012em; }
  .hero { font-family: var(--display); font-size: 38px; line-height: 1.08; font-weight: 800;
    letter-spacing: -.02em; margin: 0 0 16px; }
  .hero em { font-style: normal; color: var(--ember); }
  .sub { font-size: 15.5px; line-height: 1.6; color: var(--ink-2); margin: 0 0 34px; }
  .authcard { background: var(--card); border: 1px solid var(--line); border-radius: 20px;
    padding: 22px 20px; box-shadow: var(--sh-md); }
  .authcard h2 { font-family: var(--display); font-size: 19px; margin: 0 0 16px; font-weight: 700;
    letter-spacing: -.012em; }
  .field { margin-bottom: 12px; }
  /* ---------- the small labels ----------
     Eighteen rules used to set their label in caps with a tenth of an em between
     the letters, which is the single most-cited tell of an interface nobody drew.
     The five that are STRUCTURE — the header subtitle, a section head, a chart
     head, a day, a month — keep it, because there caps are doing the work of a
     rule or a border. The rest are captions, and captions are sentence case: same
     colour, one size up so the hierarchy survives losing the spacing. */
  .field label { display: block; font-size: 11px; font-weight: 600;
    color: var(--muted); margin-bottom: 6px; }
  /* A label with a way out beside it: Change on the exercise name opens the bank. */
  .fieldhead { display: flex; justify-content: space-between; align-items: baseline; }
  .fieldlink { background: none; border: none; padding: 0 0 6px; font-size: 12px; font-weight: 650;
    color: var(--ember-ink); }
  .field input { width: 100%; border: 1px solid var(--line); border-radius: 13px; padding: 12px 14px;
    font-size: 16px; background: var(--sand); color: var(--ink); outline: none;
    transition: border-color var(--t-2), background-color var(--t-2); }
  .field input:focus { border-color: var(--ember); background: var(--card); }
  /* A password you can look at. The eye sits inside the field's own box, a
     44px target on the trailing edge, and swaps the input between password and
     text — the field, its id and its autofill hints are untouched, so the
     browser's own password tooling keeps working. */
  .pwbox { position: relative; }
  .pwbox input { padding-right: 50px; }
  .pweye { position: absolute; right: 2px; top: 50%; width: 44px; height: 44px; margin-top: -22px;
    border: none; background: none; border-radius: 12px; color: var(--muted);
    display: flex; align-items: center; justify-content: center;
    transition: color var(--t-2), transform var(--t-1) var(--e-out); }
  .pweye .ic { width: 19px; height: 19px; }
  .pweye[aria-pressed="true"] { color: var(--ember-ink); }
  .pweye:active { transform: scale(.9); }
  .field textarea { width: 100%; border: 1px solid var(--line); border-radius: 13px; padding: 12px 14px;
    font-size: 16px; line-height: 1.55; background: var(--sand); color: var(--ink); outline: none;
    resize: vertical; min-height: 148px;
    transition: border-color var(--t-2), background-color var(--t-2); }
  .field textarea:focus { border-color: var(--ember); background: var(--card); }
  .btn { width: 100%; border: none; border-radius: 14px; padding: 14px; font-size: 15.5px;
    font-weight: 650; background: var(--ember); color: var(--on-ember); box-shadow: 0 3px 14px var(--glow);
    transition: transform var(--t-1) var(--e-out), opacity var(--t-2); letter-spacing: -.01em; }
  .btn:active { transform: scale(.978); }
  .btn[disabled] { opacity: .55; }
  .btn.ghost { background: var(--sand); color: var(--ink); box-shadow: none; }
  .authswap { text-align: center; margin-top: 14px; font-size: 13.5px; color: var(--ink-2); }
  .authswap button { background: none; border: none; color: var(--ember-ink); font-weight: 650;
    font-size: 13.5px; padding: 4px; }
  .autherr { font-size: 13px; color: var(--ember-ink); margin-top: 12px; line-height: 1.5;
    background: var(--ember-soft); padding: 10px 12px; border-radius: 11px; display: none; }
  .autherr.show { display: block; }

  /* ---------- the signup abuse boundary ----------
     An empty box is a box with no site key behind it: no rule fires, so the card
     keeps its old spacing to the pixel. Centred once the widget is in, because an
     interactive challenge is a fixed 300px block that would otherwise hang off
     the leading edge at 375. */
  /* The consent sentence: small, quiet, and never below the fold of the card —
     it has to be read before the button under it is pressed. --ink-2 rather than
     --muted because this is the one line on the page a person is being asked to
     agree to, and --muted is only just AA at this size. */
  .consent { font-size: 12.5px; line-height: 1.55; color: var(--ink-2); margin: 0 0 14px; }
  .consent a { color: var(--ink-2); text-decoration: underline; text-underline-offset: 2px; }
  .consentrow { border: 1px solid var(--line-2); border-radius: 16px;
    padding: 14px 14px 12px; margin-bottom: 20px; }
  .consentrow .consent { margin-bottom: 12px; }
  .consentrow .btn { padding: 11px; font-size: 14.5px; }
  .capgate:not(:empty) { display: flex; justify-content: center; margin-bottom: 12px; }
  /* One face at a time. Everything the card was offering is a dead end until the
     link in the inbox is followed, so it goes away rather than greying out — but
     NOT the captcha box, because Resend needs a token too and a challenge nobody
     can see is a challenge nobody can answer. */
  .authcard.sent > :not(#mailsent):not(#capgate) { display: none; }
  .authcard.sent > #capgate { margin: 0; }
  .mailsent { animation: cardin var(--t-3) var(--e-out); outline: none; }
  .mailsent h2 { font-family: var(--display); font-size: 19px; margin: 14px 0 8px;
    font-weight: 700; letter-spacing: -.012em; }
  .mailsent p { font-size: 14px; line-height: 1.55; color: var(--ink-2); margin: 0 0 18px; }
  /* A code is read digit by digit, so it is set that way. The indent pays back
     the trailing letter-space, which would otherwise sit the digits left of the
     centre by about half a character. */
  .mailsent .field input { text-align: center; letter-spacing: .28em; text-indent: .28em;
    font-weight: 600; }
  .mailsent .btn.ghost { margin-top: 12px; }
  /* An address is the one string on this card that has no natural break, and a
     long one must wrap rather than widen the card past the viewport. */
  .mailsent b { color: var(--ink); font-weight: 650; overflow-wrap: anywhere; }
  .mailmark { display: flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 999px;
    background: var(--ember-soft); color: var(--ember-ink); }
  .mailmark .ic { width: 21px; height: 21px; }
  @media (prefers-reduced-motion: reduce) { .mailsent { animation: none; } }

  /* ---------- provider sign-in (Google / Apple) ----------
     Both marks sit on the same neutral button so the row reads as one control
     type. --card is the only surface token that satisfies both brand rules at
     once: white in light (Google light theme, Apple "white with outline") and
     near-black in dark (Google dark theme, Apple black). On a --card authcard
     that leaves the 1px stroke and --sh-sm doing the separating, which is how
     Google's own light button looks on a white sheet.
     Sizes come from Apple's HIG: minimum width 140px, minimum height 30pt, and
     a margin of at least 1/10 of the button height around the content. 48px
     matches the height of the ember Create-account button above, because Apple
     asks that its button be no smaller than the other sign-in buttons. */
  .oauth { margin-top: 18px; }
  .oauthdiv { display: flex; align-items: center; gap: 12px; margin: 0 0 12px;
    color: var(--muted); font-size: 11px; font-weight: 600; }
  .oauthdiv::before, .oauthdiv::after { content: ""; flex: 1 1 0; height: 1px; background: var(--line); }
  .oauthbtns { display: flex; flex-direction: column; gap: 10px; }
  .oabtn { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 140px;
    min-height: 48px; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 14px;
    background: var(--card); color: var(--ink); box-shadow: var(--sh-sm);
    font-size: 15.5px; font-weight: 650; letter-spacing: -.01em;
    transition: transform var(--t-1) var(--e-out), border-color var(--t-2), opacity var(--t-2); }
  .oabtn:active { transform: scale(.978); }
  .oabtn:focus-visible { outline: 2px solid var(--ember); outline-offset: 2px; }
  .oabtn[disabled] { opacity: .55; }
  .oamark { flex: 0 0 auto; width: 20px; height: 20px; display: flex;
    align-items: center; justify-content: center; }
  .oamark svg { display: block; }
  /* Mark on the leading edge, title optically centred in the whole button: the
     padding matches the mark plus its gap so the label sits on the mid-line. */
  .oalabel { flex: 1 1 auto; min-width: 0; text-align: center; padding-right: 30px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) {
    .oabtn { transition: none; }
    .oabtn:active { transform: none; }
  }
  .landfoot { text-align: center; margin-top: 30px; font-size: 12px; color: var(--muted); }
  .landfoot a { color: var(--muted); }

  /* ---------- app shell, and the frame everything full-screen is drawn in ----------
     #app owns the viewport instead of the document: the three pages scroll inside
     it while the header and the tab bar stay put, which is the only arrangement
     in which a page can slide sideways. Its size is --vvh/--vvtop, and so is every
     other full-screen layer's. The frame is the dynamic viewport, and nothing
     larger: on the owner's iPhone, installed, iOS 26 hosts the app in a web view
     that is a status bar short of the screen (852pt screen, 793pt view, Apple's
     FB20169593) and clips at its own edge, so a frame sized from 100vh put the tab
     bar's lower third — its labels and its home-indicator padding — into a band
     no pixel of ours can reach. The same bug makes the bottom inset a lie there:
     the home indicator sits below the view, not inside it. --sab is the inset
     the view can actually give back — the reported one less whatever 100vh claims
     beyond the dynamic viewport, never below zero — and every bottom edge in the
     app pads with it. On a phone without the bug 100vh equals 100dvh, --sab is the
     real inset, and this reads as it always did. fitViewport() takes the frame
     over for the keyboard only. */
  :root { --vvh: 100dvh; --vvtop: 0px; --sab: env(safe-area-inset-bottom); }
  @supports (height: 100dvh) {
    :root { --sab: max(0px, calc(env(safe-area-inset-bottom) - (100vh - 100dvh))); }
  }
  #app { position: fixed; left: 0; right: 0; top: var(--vvtop); height: var(--vvh);
    overflow: hidden; }

  /* ---------- header ---------- */
  header, .trainseg { background: color-mix(in srgb, var(--paper) 84%, transparent);
    -webkit-backdrop-filter: blur(20px) saturate(1.5); backdrop-filter: blur(20px) saturate(1.5); }
  header { position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    padding: calc(12px + env(safe-area-inset-top)) 18px 12px; }
  /* The hairline belongs at the bottom of the whole translucent bar, and on
     Library that bar ends at the search field, which carries its own and slides
     away with the page. --x is the track position in pages, so the two lines
     cross-fade: mid-swipe you see half of each instead of both at full strength. */
  header::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
    background: var(--line); opacity: clamp(0, var(--x, 0), 1); }
  .titlerow { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .tstack { flex: 1 1 auto; min-width: 0; }
  h1 { font-family: var(--display); font-size: 27px; margin: 0; font-weight: 700;
    letter-spacing: -.018em; line-height: 1; }
  .count { color: var(--muted); font-size: 10.5px; margin-top: 7px; font-weight: 700;
    letter-spacing: .15em; text-transform: uppercase; }
  /* One title strip per page, stacked in a single grid cell so the header keeps
     one height whatever is showing. Each slides a quarter of the page's travel
     and fades as it leaves — a large title crossing over, not a text swap. */
  #apptitle, #count { display: grid; }
  #apptitle .ts, #count .ts { grid-area: 1 / 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    transform: translateX(calc((var(--i, 0) - var(--x, 0)) * 24px));
    opacity: calc(1 - max(var(--i, 0) - var(--x, 0), var(--x, 0) - var(--i, 0))); }
  .ts:nth-child(1) { --i: 0; }
  .ts:nth-child(2) { --i: 1; }
  .ts:nth-child(3) { --i: 2; }
  .hbtns { display: flex; gap: 8px; }

  /* ---------- the pager ----------
     No touch-action on purpose. Asking for pan-y let WebKit start scrolling
     before the drag had said a word, and it then cancelled our pointer on any
     drag that was not ruler-straight. Left alone, WebKit waits for the verdict
     of the non-passive touchmove in app.ts, so the axis is ours to decide. */
  .pages { position: absolute; inset: 0; overflow: hidden; }
  .track { display: flex; height: 100%; }
  .track.dragging { will-change: transform; }
  .page { flex: 0 0 100%; height: 100%; overflow-y: auto; overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--ptab, 78px) + 24px); }
  /* The header's height as a real box rather than the scroller's top padding:
     engines disagree about which edge a sticky inset inside a PADDED scroller
     is measured from, and with no padding there is nothing to disagree about.
     A pseudo-element because renderPlan and renderProgress empty their page
     with innerHTML and would take a real spacer with them. */
  .page::before { content: ""; display: block; flex: 0 0 auto; height: var(--hdr, 92px); }
  /* Reduced motion: the track jumps and the arriving page fades in instead. */
  .page.xfade { animation: fadeonly var(--t-2) var(--e-soft); }
  .addbtn { width: 40px; height: 40px; border-radius: 14px; border: none; background: var(--ember);
    color: var(--on-ember); font-size: 23px; line-height: 1; font-weight: 600;
    box-shadow: 0 3px 12px var(--glow); transition: transform var(--t-1) var(--e-out); }
  .addbtn:active { transform: scale(.92); }
  .addbtn.ghost { background: var(--sand); color: var(--ink-2); font-size: 16px; box-shadow: none; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* The search is the Library page's own first row, not the header's, so it
     slides away with Library instead of hanging over Plan. Sticking it at the
     header's height and painting it in the header's glass keeps it reading as
     one bar: at rest there is no line between them, only the one underneath. */
  .searchwrap { position: sticky; top: var(--hdr, 92px); z-index: 5; display: block;
    padding: 8px 18px 12px;
    background: color-mix(in srgb, var(--paper) 84%, transparent);
    -webkit-backdrop-filter: blur(20px) saturate(1.5); backdrop-filter: blur(20px) saturate(1.5); }
  .searchwrap::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
    background: var(--line); opacity: calc(1 - clamp(0, var(--x, 0), 1)); }
  /* Spanning the input's own band rather than half of a padded box, so the mark
     stays on the field's mid-line whatever the field's height turns out to be. */
  .searchico { position: absolute; left: 32px; top: 8px; bottom: 12px;
    color: var(--muted); pointer-events: none; display: flex; align-items: center; }
  .search { width: 100%; border: 1px solid var(--line); border-radius: 14px;
    padding: 11px 14px 11px 40px; font-size: 16px; background: var(--sand); color: var(--ink);
    outline: none; transition: border-color var(--t-2), background-color var(--t-2); }
  .search:focus { border-color: var(--ember); background: var(--card); }
  .search::placeholder { color: var(--muted); }
  /* The way out of typing, beside the field for exactly as long as the field has
     the keyboard: the trailing slot UISearchBar gives its Cancel. It closes the
     keyboard and keeps the query, because the results are what the reader wanted
     room to see; clearing stays with the field's own clear button. The field
     gives it room the way UIKit's does, by getting narrower. */
  #searchwrap { display: flex; align-items: center; }
  #searchwrap .search { flex: 1 1 auto; width: auto; min-width: 0; }
  .searchx { flex: 0 0 auto; width: 0; height: 44px; margin-left: 0; padding: 0; border: none;
    border-radius: 999px; background: var(--sand); color: var(--ink-2); overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transform: scale(.6); pointer-events: none;
    transition: width var(--t-2) var(--e-in), margin-left var(--t-2) var(--e-in),
      opacity var(--t-1) var(--e-in), transform var(--t-2) var(--e-in); }
  #searchwrap:focus-within .searchx { width: 44px; margin-left: 8px; opacity: 1; transform: none;
    pointer-events: auto;
    transition: width var(--t-2) var(--e-out), margin-left var(--t-2) var(--e-out),
      opacity var(--t-2) var(--e-out), transform var(--t-2) var(--e-out); }
  #searchwrap:focus-within .searchx:active { transform: scale(.92); transition-duration: var(--t-1); }
  .searchx .ic { width: 18px; height: 18px; }
  @media (prefers-reduced-motion: reduce) {
    .searchx, #searchwrap:focus-within .searchx { transform: none;
      transition: opacity var(--t-1) var(--e-soft); }
  }

  /* ---------- filter chips ---------- */
  /* This row used to ask for horizontal pans back, because the pager was taking
     them away at the top. It no longer takes them, so there is nothing to ask. */
  /* The row's side inset lives on the end chips, not on the scroller: Blink measures
     a sticky inset from the scrollport's content box and WebKit from its padding box,
     so a padded scroller pins the Sort chip 18px apart on the two engines. With no
     horizontal padding there is nothing for them to disagree about. */
  .chips { display: flex; gap: 7px; overflow-x: auto; padding: 14px 0 6px; scrollbar-width: none;
    -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent 100%);
    mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent 100%); }
  .chips::-webkit-scrollbar { display: none; }
  .chips > :first-child { margin-left: 18px; }
  .chips > :last-child { margin-right: 18px; }
  .chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
    border: none; background: var(--sand); color: var(--ink-2);
    border-radius: 999px; padding: 9px 14px; font-size: 13px; font-weight: 600; line-height: 1;
    letter-spacing: -.005em;
    transition: background-color var(--t-2) var(--e-soft), color var(--t-2) var(--e-soft),
      transform var(--t-1) var(--e-out), box-shadow var(--t-2) var(--e-soft); }
  .chip:active { transform: scale(.94); }
  .chip.active { background: var(--ember); color: var(--on-ember); box-shadow: 0 3px 12px var(--glow); }
  .chip .n { opacity: .5; font-weight: 700; margin-left: 5px; font-size: 11px; font-variant-numeric: tabular-nums; }
  .chip.active .n { opacity: .75; }
  /* ---------- today ----------
     The Plan's own day card, borrowed to answer the question the app is opened
     with. It sits beside the chip row and hides with it: the view switch turns
     that row off when the Library is not on screen, and this has to leave too
     rather than sit on top of the Plan. Trained already and the ember goes —
     nothing left to do here today. */
  .todaywrap { padding: 12px 18px 0; }
  .chips.hide + .todaywrap { display: none; }
  /* ---------- a paused session ----------
     The card the Library leads with while a workout is waiting: what was paused,
     how far it got, one button that picks it up. It used to be a toast for
     thirty seconds and then nothing — a session the reader had every intention
     of finishing, gone from sight behind a grid of other cards. Same card as
     Today, ember all round so it reads as the thing to do, and it stays until
     the session is resumed or ended. */
  .resumewrap { padding: 12px 18px 0; }
  .resumewrap .daycard { margin-bottom: 0; border-color: var(--ember); }
  .resumewrap .dayname { color: var(--ember-ink); }
  .resumewrap .tclock { font-family: var(--display); font-size: 13px; font-weight: 700; color: var(--muted);
    font-variant-numeric: tabular-nums; }
  .resumewrap .tbtns { margin-top: 12px; }
  .resumewrap .tend { flex: 0 0 auto; width: auto; padding: 12px 16px; font-size: 14px; }
  .resumewrap .tstart { flex: 1; }
  .todaywrap .daycard { margin-bottom: 0; }
  .todaywrap .daycard.done { border-color: var(--line); }
  .todaywrap .daycard.done .dayname { color: var(--muted); }
  .ttitle { display: block; width: 100%; text-align: left; border: none; background: none;
    padding: 3px 0 0; color: var(--ink); font-family: var(--display); font-size: 18px;
    font-weight: 700; line-height: 1.22; letter-spacing: -.015em; }
  .tdose { font-size: 12.5px; color: var(--muted); margin: 5px 0 12px; }
  .tstart { padding: 12px; font-size: 14.5px; border-radius: 12px; }

  /* ---------- collections ----------
     A collection is the general form of a favourite: the same chip row, the same
     sand-and-ember palette, one more kind of filter. The bar below the chips
     appears only while a collection is the active filter, and is where it is
     renamed or deleted — no long-press, no drag. */
  .colbar { display: flex; align-items: center; gap: 8px; padding: 6px 18px 0; font-size: 12.5px;
    color: var(--ink-2); }
  .colbar b { flex: 1; min-width: 0; font-weight: 700; color: var(--ink); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .colbar button { flex: 0 0 auto; border: none; background: var(--sand); color: var(--ink-2);
    border-radius: 999px; padding: 7px 11px; font-size: 12px; font-weight: 650; line-height: 1;
    transition: transform var(--t-1) var(--e-out); }
  .colbar button:active { transform: scale(.94); }
  .colbar button.warn { color: var(--ember-ink); }
  .colbar .clr { display: inline-flex; align-items: center; gap: 5px; }
  .colbar .clr .ic { width: 13px; height: 13px; }
  .colrow { display: flex; align-items: center; gap: 12px; padding: 10px 6px; border: none;
    background: none; text-align: left; border-radius: 13px; width: 100%; }
  .colrow:active { background: var(--sand); }
  .colrow .mark { width: 24px; height: 24px; border-radius: 8px; border: 1.5px solid var(--line-2);
    display: flex; align-items: center; justify-content: center; font-size: 12px; line-height: 1;
    color: transparent; flex: 0 0 auto; transition: background-color var(--t-2), border-color var(--t-2); }
  .colrow.in .mark { background: var(--ember); border-color: var(--ember); color: var(--on-ember); }
  .colrow .ce { width: 26px; font-size: 18px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center; }
  .colrow .ct { flex: 1; min-width: 0; }
  .colrow .ct b { display: block; font-size: 14px; font-weight: 600; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .colrow .ct span { font-size: 11.5px; color: var(--muted); }
  .newcol { display: flex; gap: 8px; margin-top: 14px; }
  .newcol input { border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px;
    font-size: 16px; background: var(--sand); color: var(--ink); outline: none; min-width: 0;
    transition: border-color var(--t-2), background-color var(--t-2); }
  .newcol input:focus { border-color: var(--ember); background: var(--card); }
  .newcol .emo { width: 56px; text-align: center; flex: 0 0 auto; }
  .newcol .nm { flex: 1; }
  .newcol .btn { width: auto; flex: 0 0 auto; padding: 11px 14px; font-size: 14px; border-radius: 12px; }

  /* ---------- library grid ---------- */
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px 13px; padding: 12px 18px 24px; }
  @media (min-width: 640px) { .grid { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 980px) { .grid { grid-template-columns: repeat(4, 1fr); } }

  /* ---------- sections ----------
     Grouped, the grid becomes one grid per section under a heading that stays put
     while its own cards are on screen and is pushed off by the next — the plain
     list of Photos and Apple Music. Each heading sticks inside its own <section>,
     which is what stops twelve of them stacking at the top. It rests under the app
     header AND the search bar (--gsec, measured: both grow with the system) and
     below the search bar's layer, so it slides beneath that glass, not over it. */
  .grid.grouped { display: block; padding: 2px 0 24px; }
  .grouped .grid { padding: 10px 18px 22px; }
  .ghead { position: sticky; top: var(--gsec, 155px); z-index: 4; display: flex;
    align-items: stretch; padding-left: 18px;
    background: color-mix(in srgb, var(--paper) 84%, transparent);
    -webkit-backdrop-filter: blur(20px) saturate(1.5); backdrop-filter: blur(20px) saturate(1.5); }
  .gname { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
    border: none; background: none; text-align: left; padding: 12px 0 10px; color: var(--ink);
    font-family: var(--display); font-size: 17px; font-weight: 700; letter-spacing: -.015em;
    transition: opacity var(--t-1) var(--e-out); }
  .gname b { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gname .ic { width: 14px; height: 14px; color: var(--muted); flex: 0 0 auto; }
  .gn { flex: 0 0 auto; font-size: 12px; font-weight: 700; color: var(--ink-2);
    font-variant-numeric: tabular-nums; }
  /* 44px wide: a control in its own right, not a decoration on one. */
  .gjump { flex: 0 0 auto; width: 44px; border: none; background: none; color: var(--ink-2);
    display: flex; align-items: center; justify-content: center;
    transition: opacity var(--t-1) var(--e-out); }
  .gname:active, .gjump:active { opacity: .5; }
  @media (prefers-reduced-motion: reduce) { .gname, .gjump { transition: none; } }
  .carditem { background: none; border: none; padding: 0; display: flex; flex-direction: column;
    cursor: pointer; min-width: 0; text-align: left; transition: transform var(--t-2) var(--e-out); }
  .carditem:active { transform: scale(.968); }
  .carditem.in { animation: cardin var(--t-4) var(--e-out) both; }
  @keyframes cardin { from { opacity: 0; transform: translateY(14px); } }
  .carditem.fresh { animation: fadeonly var(--t-2) var(--e-out); }
  @media (prefers-reduced-motion: reduce) { .carditem.fresh { animation: none; } }
  .thumbwrap { position: relative; aspect-ratio: 4 / 5; border-radius: 18px; overflow: hidden;
    background: var(--sand); box-shadow: var(--sh-md); isolation: isolate; }
  .thumbwrap img { width: 100%; height: 100%; object-fit: cover; display: block;
    opacity: 0; transform: scale(1.05);
    transition: opacity 400ms var(--e-soft), transform 700ms var(--e-out); }
  .thumbwrap.loaded img { opacity: 1; transform: none; }
  /* Finite sweep on purpose: lazy images far below the fold stay pending indefinitely,
     and an infinite animation per card would keep the compositor busy all session. */
  .thumbwrap.loading::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(100deg, transparent 25%, rgba(255,255,255,.30) 50%, transparent 75%);
    transform: translateX(-100%); animation: shimmer 1.4s var(--e-soft) 3; }
  @keyframes shimmer { to { transform: translateX(100%); } }
  .thumbwrap .noimg { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; font-size: 38px; opacity: .45; }
  .thumbwrap::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1;
    box-shadow: inset 0 0 0 1px var(--line); border-radius: inherit; }
  .fav { position: absolute; top: 9px; right: 9px; z-index: 2; width: 27px; height: 27px;
    display: flex; align-items: center; justify-content: center; font-size: 13px; line-height: 1;
    background: rgba(10,14,20,.46); border-radius: 999px; color: #FFC9A8; }
  .durbadge { position: absolute; left: 9px; bottom: 9px; z-index: 2; font-size: 10.5px; font-weight: 700;
    letter-spacing: .02em; font-variant-numeric: tabular-nums;
    color: #fff; background: rgba(10,14,20,.56); padding: 4px 8px;
    border-radius: 999px; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
  .cardbody { padding: 11px 3px 0; min-width: 0; }
  .cardkick { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    margin-bottom: 5px; min-width: 0; }
  /* 10.5 rather than the 11 the other captions took: these two sit directly above
     a 15px title in a two-column grid, and at 11 they compete with it. */
  .catpill { font-size: 10.5px; font-weight: 650;
    color: var(--ember-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .diffpill { font-size: 10.5px; font-weight: 600; color: var(--muted); white-space: nowrap; flex: 0 0 auto; }
  .cardtitle { font-family: var(--display); font-size: 15px; font-weight: 650; line-height: 1.25;
    letter-spacing: -.011em; color: var(--ink); display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .cardmeta { color: var(--muted); font-size: 11.5px; margin-top: 5px; font-weight: 500;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ---------- a card whose extraction has not finished ---------- */
  /* The row exists the instant the user hits save; only its contents are pending.
     Showing the card straight away in this state is the whole point of making
     ingest asynchronous — a spinner on the add sheet would just be the old
     synchronous wait with a nicer name. Unlike the lazy-image shimmer above this
     one does loop, because it marks work genuinely in flight and it stops the
     moment the row fills in. */
  .thumbwrap.pending::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(100deg, transparent 25%, rgba(255,255,255,.34) 50%, transparent 75%);
    transform: translateX(-100%); animation: shimmer 1.5s var(--e-soft) infinite; }
  .carditem.pending .cardtitle, .carditem.pending .cardmeta { opacity: .62; }
  .carditem.pending .catpill { color: var(--muted); }
  .thumbwrap.pending .noimg { animation: floaty 3.4s ease-in-out infinite; }
  .carditem.pending .noimg, .carditem.pending .thumbwrap::after { animation-play-state: paused; }
  .carditem.pending.awake .noimg, .carditem.pending.awake .thumbwrap::after { animation-play-state: running; }
  .asleep .carditem.pending .noimg, .asleep .carditem.pending .thumbwrap::after,
  .page[inert] .carditem.pending .noimg, .page[inert] .carditem.pending .thumbwrap::after { animation-play-state: paused; }
  .thumbwrap.failed { background: var(--sand); }
  .carditem.failed .catpill { color: var(--ember-ink); }
  .retryline { color: var(--ember-ink); font-weight: 650; white-space: normal;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .retrybtn { width: 100%; margin: 0 0 14px; padding: 14px; border-radius: 16px; border: none;
    font: inherit; font-weight: 700; cursor: pointer; color: var(--on-ember);
    background: var(--ember); box-shadow: var(--sh-md); }
  .retrybtn:disabled { opacity: .55; }
  /* The second rung under a failed card: quieter than the retry, because it asks
     the user to do work and the retry does not. */
  .retrybtn.ghost { background: var(--card); color: var(--ink); border: 1px solid var(--line-2);
    box-shadow: none; font-weight: 650; }

  /* ---------- empty states ---------- */
  .empty { text-align: center; padding: 54px 32px 40px; color: var(--ink-2); }
  .empty .big { position: relative; width: 96px; height: 96px; margin: 0 auto 22px;
    border-radius: 999px; background: radial-gradient(circle at 50% 36%, var(--card), var(--sand));
    box-shadow: var(--sh-md); display: flex; align-items: center; justify-content: center;
    font-size: 38px; color: var(--ember); animation: floaty 5.5s ease-in-out infinite; }
  /* A drawn mark, not a 96px emoji. Thinner than the rest of the set because it
     is four times the size: 2px at 38px reads as a marker pen. */
  .empty .big .ic { stroke-width: 1.5; }
  .empty .big::after { content: ""; position: absolute; inset: -11px;
    border-radius: 999px; border: 1px dashed var(--line-2); }
  @keyframes floaty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  .empty h2 { color: var(--ink); font-family: var(--display); font-size: 21px; font-weight: 700;
    margin: 0 0 10px; letter-spacing: -.015em; }
  .empty p { font-size: 13.5px; line-height: 1.65; margin: 5px auto; max-width: 300px; }
  .empty b { color: var(--ember-ink); font-weight: 700; }

  /* ---------- detail overlay ---------- */
  .overlay { position: fixed; left: 0; right: 0; top: var(--vvtop); height: var(--vvh);
    z-index: 50; background-color: var(--paper);
    background-image: var(--grain); overflow-y: auto; -webkit-overflow-scrolling: touch;
    visibility: hidden; pointer-events: none; opacity: 0; transform: translateY(18px);
    transition: opacity var(--t-2) var(--e-in), transform var(--t-2) var(--e-in); }
  .overlay.open { visibility: visible; pointer-events: auto; opacity: 1; transform: none;
    transition: opacity var(--t-3) var(--e-out), transform var(--t-3) var(--e-out); }
  .overlay.closing { visibility: visible; }
  /* The edge swipe home (app.ts, "the edge swipe home"). Under a finger the card
     is being moved, not animating; let go past the point of no return it keeps
     going off the right edge, whole and opaque, the way a navigation stack pops
     — and outranks the fade-and-drop a button close gets, because that is a
     different exit. The shadow is what says the library is underneath rather
     than beside. */
  .overlay.edging { transition: none; }
  .overlay.edging, .overlay.edgeout { box-shadow: var(--sh-lg); }
  .overlay.edgeout { transform: translateX(100%); opacity: 1;
    transition: transform var(--t-2) var(--e-out); }
  .dtop { position: sticky; top: 0; z-index: 5; display: flex; align-items: center;
    justify-content: space-between; gap: 8px;
    padding: calc(10px + env(safe-area-inset-top)) 14px 10px;
    background: color-mix(in srgb, var(--paper) 82%, transparent);
    -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  .iconbtn { width: 38px; height: 38px; border-radius: 12px; border: none; background: var(--sand);
    color: var(--ink); font-size: 16px; line-height: 1; display: flex; align-items: center;
    justify-content: center; transition: transform var(--t-1) var(--e-out); flex: 0 0 auto; }
  .iconbtn:active { transform: scale(.92); }
  .iconbtn.on { background: var(--ember); color: var(--on-ember); }
  /* The chevrons that step to the next saved workout, beside Back because that is
     where the other way through a stack lives. Auto margin, not a slot in the
     space-between: the header's own buttons stay pinned at the far end. The ::after
     buys the 44px of reach a 38px button does not have. */
  .dnav { display: flex; gap: 4px; margin-right: auto; }
  .dnav button { position: relative;
    transition: transform var(--t-1) var(--e-out), opacity var(--t-1) var(--e-soft); }
  .dnav button::after { content: ""; position: absolute; inset: -3px; }
  .dnav button:first-child .ic { transform: rotate(180deg); }
  .dnav.gone, .dnav .gone { opacity: 0; visibility: hidden; pointer-events: none; }
  .dinner { padding: 4px 18px calc(46px + var(--sab)); max-width: 720px; margin: 0 auto; }
  /* A lean pushes the card's right edge past the overlay: clipped, or the scroller
     it lives in grows a sideways scroll and refuses the drag that caused it. */
  #detail { overflow-x: hidden; }
  /* Timing off while a finger holds the lean and back on for the release, so a drag
     that does not commit springs home rather than snapping. The card that does land
     borrows the plan's entrance, from whichever side the finger came. */
  .dinner.dmove { transition: transform var(--t-2) var(--e-out), opacity var(--t-2) var(--e-out); }
  .dinner.din { animation: planin var(--t-3) var(--e-out); }
  @media (prefers-reduced-motion: reduce) {
    .dinner.dmove { transition: none; }
    .dinner.din { animation: planswap var(--t-2) var(--e-out); }
  }
  .embedwrap { position: relative; border-radius: 20px; overflow: hidden; background: var(--sand);
    box-shadow: var(--sh-md); margin-bottom: 20px; }
  .embedwrap iframe { display: block; width: 100%; border: 0; }
  /* The last resort only: app.ts sizes a card's frame inline before it paints, out
     of what this platform last reported at this width. The transition is for the
     correction that is left, grown and not jumped so the title below slides. */
  .embedwrap.vertical iframe { height: 640px; transition: height var(--t-3) var(--e-out); }
  .embedwrap.wide { aspect-ratio: 16 / 9; }
  .embedwrap.wide iframe { height: 100%; }
  @media (prefers-reduced-motion: reduce) {
    .embedwrap.vertical iframe { transition: none; }
  }
  .dphoto { width: 100%; display: block; border-radius: 20px; box-shadow: var(--sh-md); margin-bottom: 20px; }
  .dkick { font-size: 11px; font-weight: 650; color: var(--ember-ink); margin-bottom: 8px; }
  .dtitle { font-family: var(--display); font-size: 28px; font-weight: 700; line-height: 1.14;
    letter-spacing: -.019em; margin: 0 0 10px; }
  /* People save from three or four creators they trust, not thirty, so the handle
     is a filter and not a caption. Drawn exactly as before: the padding and the
     negative top margin buy 44px of reach and change nothing else. */
  .dauthor { display: block; width: fit-content; max-width: 100%; border: none; background: none;
    text-align: left; color: var(--muted); font-size: 13px; padding: 15px 0; margin: -13px 0 1px;
    text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px;
    transition: color var(--t-1) var(--e-soft); }
  .dauthor:active { color: var(--ember-ink); }
  /* ---------- managing a card ----------
     Rename, collections and remove as one row, in the same quiet card style as
     .sect. Favourite stays in the top bar: it is a state, these are actions. */
  .managerow { display: flex; gap: 8px; margin: 0 0 12px; }
  .mbtn { flex: 1; min-width: 0; border: 1px solid var(--line); background: var(--card);
    color: var(--ink-2); border-radius: 13px; padding: 10px 8px; font-size: 12.5px; font-weight: 650;
    display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: var(--sh-sm);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1;
    transition: transform var(--t-1) var(--e-out), background-color var(--t-2); }
  .mbtn:active { transform: scale(.96); }
  .mbtn .n { font-size: 11px; opacity: .6; font-variant-numeric: tabular-nums; }
  .mbtn.on { background: var(--ember-soft); color: var(--ember-ink); border-color: transparent; }
  .mbtn.quiet { color: var(--muted); }
  .colpills { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 16px; }
  .colpills .pill { border: none; cursor: pointer; font-family: var(--sans); }
  .pillrow { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 16px; }
  .pill { font-size: 12px; font-weight: 600; padding: 7px 11px; border-radius: 999px;
    background: var(--sand); color: var(--ink-2); line-height: 1; }
  .pill.accent { background: var(--ember-soft); color: var(--ember-ink); }
  /* Content-sized rather than four equal quarters: the values are a duration, a
     count and a word, and "Intermediate" needs more room than "3". Equal cells
     made the longest one bleed into its own padding. Each still grows into the
     leftover, so the strip is full width whatever it is holding. */
  .spec { flex: 1 1 auto; padding: 13px 8px; text-align: center;
    border-right: 1px solid var(--line); min-width: 0; }
  .spec:last-child { border-right: none; }
  .spec .v { font-family: var(--display); font-size: 17px; font-weight: 700; letter-spacing: -.012em;
    color: var(--ink); font-variant-numeric: tabular-nums; }
  .spec .k { font-size: 11px; font-weight: 600; color: var(--muted); margin-top: 4px; }
  .startbtn { width: 100%; border: none; border-radius: 16px; padding: 16px; font-size: 16px;
    font-weight: 700; background: var(--ember); color: var(--on-ember); box-shadow: 0 4px 18px var(--glow);
    margin-bottom: 22px; letter-spacing: -.01em; transition: transform var(--t-1) var(--e-out); }
  .startbtn:active { transform: scale(.982); }
  .sect { background: var(--card); border: 1px solid var(--line); border-radius: 18px;
    padding: 16px 16px 6px; margin-bottom: 14px; box-shadow: var(--sh-sm); }
  .sect h3 { font-family: var(--display); font-size: 12px; font-weight: 700; letter-spacing: .11em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 12px; }
  .blockmeta { font-size: 11.5px; color: var(--muted); margin-bottom: 11px; font-weight: 600; }
  /* ---------- an exercise row, and the drawer behind it ----------
     .exrow is the window, .exmain the content that slides, .exacts the drawer under
     it. The row bleeds back through .sect's 16px padding so the buttons meet the
     card edge, as an inset-grouped cell does. No touch-action, for the pager's
     reason: WebKit must wait for app.ts to name the axis. */
  .exrow { position: relative; overflow: hidden; margin: 0 -16px; --exw: 64px; }
  /* The hairline was the row's border and would now travel with the content.
     Drawn instead, inset where it was, and left behind. */
  .exrow::before { content: ""; position: absolute; left: 16px; right: 16px; top: 0;
    height: 1px; background: var(--line); }
  .exrow:first-of-type::before { display: none; }
  /* Padding, not margin: the row reaches the card edge, the words do not move.
     44px is the floor a one-line row would otherwise miss. */
  .exmain { display: flex; align-items: flex-start; gap: 11px; padding: 11px 16px;
    min-height: 44px; position: relative; cursor: pointer;
    -webkit-user-select: none; user-select: none;
    transition: transform var(--t-3) var(--e-spring), background var(--t-1) var(--e-out); }
  /* iOS lights a row on touch and drops it when the finger scrolls, which is what
     :active means there — and cursor: pointer is what turns it on. */
  .exmain:active { background: var(--sand); }
  .exname { flex: 1; min-width: 0; font-size: 14.5px; line-height: 1.35; font-weight: 550; }
  .exnote { font-size: 12px; color: var(--muted); margin-top: 3px; line-height: 1.45; font-weight: 400; }
  .exdose { flex: 0 0 auto; font-family: var(--display); font-size: 13.5px; font-weight: 700;
    color: var(--ember-ink); font-variant-numeric: tabular-nums; padding-top: 1px; }
  .exacts { position: absolute; top: 0; right: 0; bottom: 0; display: flex;
    transition: transform var(--t-3) var(--e-spring); transform: translateX(100%); }
  /* Closed, each button is folded onto the one to its right. */
  .exact { width: var(--exw); border: 0; padding: 0; background: var(--sand); color: var(--ink-2);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    font-size: 10.5px; font-weight: 650; line-height: 1;
    transition: transform var(--t-3) var(--e-spring);
    transform: translateX(calc(var(--i, 0) * var(--exw) * -1)); }
  .exact:nth-child(2) { --i: 1; }
  .exact:nth-child(3) { --i: 2; }
  .exact .ic { width: 16px; height: 16px; }
  /* Two sand rectangles side by side read as one; a hairline says they are two. */
  .exact + .exact:not(.prim) { border-left: 1px solid var(--line); }
  /* One accent, spent on the thing the row is most often opened for. */
  .exact.prim { background: var(--ember); color: var(--on-ember); }
  .exact:active { filter: brightness(.93); }
  .exrow.open .exmain { transform: translateX(calc(var(--exw) * -3)); }
  .exrow.open .exacts, .exrow.open .exact { transform: none; }
  /* While a finger is on it the row is not animating, it is being moved. */
  .exrow.drag .exmain, .exrow.drag .exacts, .exrow.drag .exact { transition: none; }
  /* A mouse has no swipe. Hover lays the drawer over the end of the row rather
     than pushing the row aside, as a desktop list does. */
  @media (hover: hover) {
    .exrow:hover .exacts, .exrow:hover .exact { transform: none; }
  }
  .exhelp { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 999px; border: 1px solid var(--line-2);
    background: none; color: var(--muted); font-size: 12px; line-height: 1; display: flex;
    align-items: center; justify-content: center; }
  /* An exercise the user has corrected or added by hand. The card still shows the
     creator's wording everywhere else, so this is the only mark that says which
     lines are theirs — quiet, and it never appears on model output. */
  .exmine { font-size: 11px; font-weight: 600; color: var(--muted); margin-top: 4px; }
  /* Where a coach borrowed the line from: the voice of "Added by you", and not a
     link — the source is one tap away in the strip above, and a fourth target on a
     row holding three buttons is a row nobody can aim at. */
  .exfrom { font-size: 11px; font-weight: 600; color: var(--muted); margin-top: 4px; }
  /* "Built from your videos" — artwork, who, which: the order the App Store shelf
     and Perplexity's source row both put a source in. Wrapping, not scrolling: two
     fit a 375px card, and a source hidden off the edge of a strip about sources is
     a bad joke. */
  .fromstrip { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .fromchip { flex: 1 1 148px; min-width: 0; display: flex; align-items: center; gap: 10px;
    padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--sand);
    color: var(--ink); font: inherit; text-align: left;
    transition: transform var(--t-2) var(--e-out); }
  .fromchip:active { transform: scale(.975); }
  .fromthumb { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 11px; overflow: hidden;
    background: var(--card); color: var(--muted); display: flex; align-items: center;
    justify-content: center; }
  .fromthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .fromthumb .ic { width: 19px; height: 19px; }
  .fromthumb .pmark { width: 100%; height: 100%; border-radius: 0; }
  .fromtext { flex: 1; min-width: 0; }
  .fromwho { display: block; font-size: 11px; font-weight: 700; color: var(--ember-ink); }
  .fromtitle { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (prefers-reduced-motion: reduce) {
    .fromchip, .fromchip:active { transition: none; transform: none; }
  }
  /* Same visual language as .selectrow select — sand fill, hairline, 12px radius —
     one step quieter, because adding a missed exercise is a repair, not an action
     the card is asking for. */
  .addex { width: 100%; border: 1px solid var(--line); border-radius: 12px; background: var(--sand);
    color: var(--ink-2); font-size: 13px; font-weight: 650; padding: 10px; margin: 4px 0 12px;
    transition: transform var(--t-1) var(--e-out); }
  .addex:active { transform: scale(.985); }
  .fieldrow { display: flex; gap: 9px; }
  .fieldrow .field { flex: 1; min-width: 0; }
  /* A caption is a couple of thousand characters of wrapped text a long way below
     the fold of a card just opened: the most expensive thing on that screen that
     nobody is looking at. Skipped until it is scrolled near, with a remembered
     intrinsic size — auto, so the real height is used from the second time on —
     to keep the scrollbar honest meanwhile. 400px is the middle of what a real
     caption measures (a long one came out at 875px at 375 wide), which is the
     number that makes the first scroll to the bottom least wrong. */
  .capbox { font-size: 13.5px; line-height: 1.62; color: var(--ink-2); white-space: pre-wrap;
    word-break: break-word; content-visibility: auto; contain-intrinsic-size: auto 400px; }
  /* Shown only when the extraction could not be traced back to the source text.
     Deliberately quiet: it is a caveat on a card that still works, not an error.
     A disclosure like the rows around it: the headline is the whole caveat for
     most people, and four lines of sand box above the Start button read as a
     problem on every card that has one. The eye stays; the chevron says there
     is more. */
  .disclosure.unverified { margin: 0 0 14px; }
  .disclosure.unverified > summary { gap: 9px; color: var(--ink); font-weight: 650; }
  .disclosure.unverified > summary b { font-weight: inherit; min-width: 0; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .unverified .ic { flex: 0 0 auto; width: 17px; height: 17px; color: var(--ember-ink); }
  .disclosure.unverified .disclosure-body { padding: 0 16px 14px; font-size: 12.5px;
    line-height: 1.55; color: var(--ink-2); }
  .unverified .fixlink { display: inline; background: none; border: 0; padding: 0; margin: 0;
    font: inherit; color: var(--ember-ink); font-weight: 650; text-decoration: underline;
    text-underline-offset: 2px; cursor: pointer; }
  .notesarea { width: 100%; border: 1px solid var(--line); border-radius: 13px; padding: 12px;
    font-size: 14px; line-height: 1.55; background: var(--sand); color: var(--ink); outline: none;
    resize: vertical; min-height: 78px; }
  .notesarea:focus { border-color: var(--ember); background: var(--card); }
  .selectrow { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .selectrow select { flex: 1; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px;
    font-size: 14px; background: var(--sand); color: var(--ink); outline: none; }
  .danger { background: none; border: none; color: var(--muted); font-size: 13px; padding: 12px;
    display: block; margin: 6px auto 0; }

  /* ---------- bottom sheets ---------- */
  /* Above Workout Mode (80), not below it. At 70 every sheet opened from the
     workout — logging a set, the exercise list, the clip — was laid out, animated
     and hit-testable underneath an opaque full-screen overlay, so the taps landed
     on nothing. Still under the toast at 90, still over the detail overlay at 50. */
  /* Hidden between showings, never display:none — the overlay above too. Display
     threw the layout away and rebuilt it in the entrance's own first frame, and a
     keyframe restarted on an element just back from display:none does not reliably
     begin at that frame: why every opening after the first was the jerky one. Laid
     out and transitioned instead, as Vaul, Ionic and UIKit's sheet do. The 3px blur
     went with it: on the element whose opacity animated it made WebKit re-blur,
     every frame, a backdrop far heavier than at launch. Apple's dim is plain. */
  .sheet { position: fixed; left: 0; right: 0; top: var(--vvtop); height: var(--vvh);
    z-index: 85; background: var(--scrim); display: flex; align-items: flex-end;
    visibility: hidden; pointer-events: none; opacity: 0;
    transition: opacity var(--t-2) var(--e-soft); }
  /* Only while it moves: 14 permanent layers is memory wasted. */
  .sheet.open { visibility: visible; pointer-events: auto; opacity: 1; will-change: opacity; }
  .sheet.closing { visibility: visible; will-change: opacity; }
  .sheet.open .sheetbody, .sheet.closing .sheetbody { will-change: transform; }
  @keyframes fadein { from { opacity: 0; } }
  /* 88% of the frame, so an eighth of the screen is always scrim you can tap: as
     86vh of a viewport whose own top was off screen, Settings left none. The
     bounce is off because the drag owns what happens at the top edge. */
  .sheetbody { position: relative; width: 100%; max-height: 88%; overflow-y: auto;
    overscroll-behavior: none; background: var(--paper);
    background-image: var(--grain); border-radius: 26px 26px 0 0; box-shadow: var(--sh-up);
    padding: 8px 20px calc(26px + var(--sab));
    transform: translateY(100%); transition: transform var(--t-2) var(--e-in); }
  /* The slower, springier half: iOS presents a sheet in about .4s. */
  .sheet.open .sheetbody { transform: none; transition: transform .38s var(--e-spring); }
  /* The finger is the animation, so nothing may be timed — and it has to outrank
     the open rule above or the drag lags a frame behind the thumb. Taken off with
     the inline transform, so both endings start from where the sheet is. */
  .sheet.open .sheetbody.dragging { transition: none; }
  /* The tallest sheet leaves the least scrim, so it also says how to leave. The
     app's own icon button, so it is the same 38px control with the same 44px
     reach as every other way out of a screen. */
  /* Scoped to the sheet body so it outranks the reach block further down, which
     makes every .iconbtn position: relative for its hit area and would otherwise
     leave this one sitting in the flow at the top LEFT of the sheet. */
  .sheetbody .sheetx { position: absolute; top: 10px; right: 14px; z-index: 1; }
  /* Closing is the resting state coming back: .closing holds the sheet visible
     while the base values transition it away. fadeout stays for others. */
  @keyframes fadeout { to { opacity: 0; } }
  .grabber { width: 38px; height: 4px; border-radius: 999px; background: var(--line-2);
    margin: 6px auto 16px; }
  .sheetbody h2 { font-family: var(--display); font-size: 20px; font-weight: 700; margin: 0 0 6px;
    letter-spacing: -.015em; }
  .sheetbody p.lede { font-size: 13.5px; line-height: 1.6; color: var(--ink-2); margin: 0 0 18px; }
  .sheetbody .aitext { font-size: 14.5px; line-height: 1.68; color: var(--ink-2); white-space: pre-wrap; }

  /* ---------- the plan sheet ----------
     A sheet and not a takeover: what is being asked for is money, which is
     exactly why it must be as easy to leave as the collection picker. Every
     value below is a token or a shape the system already had. The context line
     sits ABOVE the title because it is the reason the sheet opened, and a reason
     that arrives after the pitch reads as an excuse for the pitch. */
  .planctx { font-size: 13px; line-height: 1.55; color: var(--muted); margin: 2px 0 12px; }
  .plangood { margin: 14px 0 4px; }
  /* Basic | Plus, Hevy and Strong's way: each row names Basic's number plainly.
     The Plus column is one tinted band; Basic's own usage sits under its figure
     in the grey the Settings lines use. Below 360px each row stacks, the label
     over its two values, rather than crushing the labels. */
  .ptable { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13.5px;
    line-height: 1.35; font-variant-numeric: tabular-nums; }
  .ptable th, .ptable td { padding: 10px 8px; text-align: left; vertical-align: top; }
  .ptable tbody > * > * { border-top: 1px solid var(--line); }
  .ptable tbody th { padding-left: 0; font-weight: 500; color: var(--ink-2); }
  .ptable thead th { padding-bottom: 7px; font-size: 11.5px; font-weight: 750; letter-spacing: .05em;
    text-transform: uppercase; color: var(--muted); }
  .ptable td { width: 29%; font-weight: 650; color: var(--ink); }
  .ptable .pplus { background: var(--ember-soft); }
  .ptable thead .pplus { color: var(--ember-ink); border-radius: 12px 12px 0 0; }
  .ptable tr:last-child .pplus { border-radius: 0 0 12px 12px; }
  .ptable .ic { display: inline-block; width: 13px; height: 13px; margin: 0 4px -1px 0; color: var(--ember-ink);
    stroke-width: 3; }
  .ptable small { display: block; margin-top: 3px; font-size: 11.5px; font-weight: 500; color: var(--muted); }
  .ptable small.out { color: var(--ember-ink); }
  .ptable .pno { color: var(--muted); font-weight: 500; }
  .pfree { display: flex; align-items: flex-start; gap: 10px; margin: 12px 0 0; padding: 12px 14px;
    border-radius: 14px; background: var(--sand); font-size: 13px; line-height: 1.5; color: var(--ink-2); }
  .pfree .ic { flex: 0 0 auto; width: 16px; height: 16px; margin-top: 2px; color: var(--good); }
  .pfree b { font-weight: 650; color: var(--ink); }
  .plansoft { font-size: 13px; line-height: 1.5; color: var(--muted); margin: 4px 0; }
  @media (max-width: 359px) {
    .ptable thead { display: none; }
    .ptable tr { display: grid; grid-template-columns: 1fr 1fr; gap: 0 6px; padding: 10px 0 2px;
      border-top: 1px solid var(--line); }
    .ptable tbody > * > * { border-top: 0; }
    .ptable tbody th { grid-column: 1 / -1; padding: 0 0 4px; }
    .ptable td, .ptable tr:last-child .pplus { width: auto; padding: 6px 8px; border-radius: 10px; }
    .ptable td::before { content: attr(data-l); display: block; font-size: 10.5px; font-weight: 750;
      letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
    .ptable .pplus::before { color: var(--ember-ink); }
  }
  .plancards { margin: 16px 0 0; }
  /* The whole rectangle is the radio, so there is no small circle to hit. Label
     left, amount right, the rest wrapping underneath — which is what keeps the
     founding line from pushing the amount off the edge at 375px. */
  .pcard { display: block; width: 100%; text-align: left; font: inherit; color: inherit;
    background: var(--card); border: 1px solid var(--line-2); border-radius: 16px;
    padding: 13px 15px; margin-bottom: 9px; box-shadow: var(--sh-sm);
    transition: border-color var(--t-2) var(--e-out), background-color var(--t-2) var(--e-out),
      transform var(--t-1) var(--e-out); }
  .pcard.on { border-color: var(--ember); background: var(--ember-soft); }
  .pcard:active { transform: scale(.985); }
  .pcard.off { opacity: .55; box-shadow: none; transform: none; }
  .prow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .pname { font-size: 14.5px; font-weight: 650; letter-spacing: -.01em; }
  .pamt { font-family: var(--display); font-size: 17px; font-weight: 700; letter-spacing: -.015em;
    font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pold { color: var(--muted); font-weight: 500; text-decoration: line-through; margin-right: 7px; }
  .pmeta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px;
    font-size: 11.5px; line-height: 1.45; color: var(--muted); }
  .pmeta .pill { font-size: 10.5px; padding: 5px 9px; }
  .pcard .pamt { font-size: 24px; }
  .pcard .pold { font-size: 14px; }
  .psavings { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0 5px;
    color: var(--ember-ink); font-size: 16px; line-height: 1.4; }
  .psavebadge { display: inline-block; padding: 4px 9px; border-radius: 8px;
    background: var(--ember); color: var(--on-ember); font-size: 12px; font-weight: 750; }
  .pcompare, .prenew { color: var(--ink-2); font-size: 12px; line-height: 1.5; }
  .prenew { margin-top: 5px; font-weight: 650; }
  .plantrial { font-size: 13px; line-height: 1.5; color: var(--ink-2); margin: 4px 0 14px; }
  /* Where the prices would be when there are none: the price cards' own shape,
     so the page keeps its rhythm in every state. */
  .plansoon { margin: 16px 0 12px; padding: 14px 15px; border-radius: 16px; background: var(--card);
    border: 1px solid var(--line-2); box-shadow: var(--sh-sm); }
  .plansoon b { display: block; font-size: 14.5px; font-weight: 650; line-height: 1.45; }
  .plansoon p { margin: 5px 0 0; font-size: 13px; line-height: 1.5; color: var(--ink-2); }
  .plansoon .btn { margin-top: 12px; min-height: 44px; }
  .planbuy { margin-top: 4px; min-height: 48px; }
  /* Cross-fades rather than cutting: this is the one thing a person watches
     while deciding, and a word that snaps under the thumb reads as a mis-tap. */
  .planbuy b { font-weight: 650; transition: opacity var(--t-1) var(--e-soft); }
  .planbuy b.fade { opacity: 0; }
  /* 14px rather than 13: the dismiss has to be as easy to hit as the button that
     charges you, and 13 left it a pixel short of the 44 Apple asks for. */
  .plannot { display: block; width: 100%; background: none; border: none; font: inherit;
    font-size: 13.5px; font-weight: 600; color: var(--muted); padding: 14px; margin-top: 2px; }
  .planfine { font-size: 11.5px; line-height: 1.5; color: var(--muted); margin-top: 8px; }
  /* ---------- creator codes ----------
     One small link where a field would be noise, on the sign-up card and the
     paywall both; the field it unfolds is the app's own. */
  .codeask { display: block; background: none; border: none; font: inherit; font-size: 13px;
    font-weight: 600; color: var(--ember-ink); padding: 2px 0 10px; }
  .codeform { display: flex; gap: 9px; align-items: stretch; }
  .codeform .field { flex: 1; min-width: 0; margin: 0; }
  .codeform .btn { flex: 0 0 auto; width: auto; padding: 12px 18px; }
  .plancode { margin: 6px 0 4px; }
  .plancodeline { font-size: 13px; line-height: 1.5; color: var(--ink-2); margin: 2px 0 12px; }
  .planredeem { margin-top: 9px; }
  /* Apple's 3.1.2 asks for working Terms and Privacy on the screen that sells,
     and 3.1.1 for a restore. On the web the restore is a re-read from Stripe. */
  .planlegal { display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: 9px; margin-top: 14px; }
  .planlegal a, .planlegal button { font: inherit; font-size: 12px; font-weight: 500;
    color: var(--muted); text-decoration: none; background: none; border: none; padding: 4px 2px; }
  .planlegal span { color: var(--line-2); font-size: 12px; }
  /* ---------- waiting for the prices ----------
     Never "$undefined" and never an empty sheet: the shapes that are coming. The
     sweep loops because the work is real, and stops when the numbers land. */
  .skel { position: relative; overflow: hidden; background: var(--sand); border-radius: 12px; }
  .skel::after { content: ""; position: absolute; inset: 0;
    background: linear-gradient(100deg, transparent 25%, rgba(255,255,255,.26) 50%, transparent 75%);
    transform: translateX(-100%); animation: shimmer 1.5s var(--e-soft) infinite; }
  .skel.sline { height: 15px; margin: 15px 0; }
  .skel.sline.half { width: 62%; }
  .skel.scard { height: 66px; margin-bottom: 9px; border-radius: 16px; }
  /* ---------- how full the free shelf is ----------
     A line of text with a tap in it, over the grid it is counting, and nothing at
     all until the count is known and the plan is free. Ember from the warn point
     on, which is the only warning this app gives before the wall. */
  .libcount { display: block; width: auto; margin: 12px 18px 0; padding: 6px 0;
    background: none; border: none; font: inherit; font-size: 12.5px; font-weight: 600;
    color: var(--muted); text-align: left; letter-spacing: -.005em;
    transition: color var(--t-2) var(--e-soft); }
  .libcount b { font-weight: 700; color: var(--ink-2); }
  .libcount.near, .libcount.near b { color: var(--ember-ink); }
  /* ---------- Settings, the Plan group ---------- */
  .setnote.warn { color: var(--ember-ink); }
  .setlink { display: block; width: 100%; background: none; border: none; font: inherit;
    font-size: 13px; font-weight: 600; color: var(--ember-ink); padding: 13px; margin-top: 2px; }
  /* Pumpy's own way to the sheet: a chip under the sentence he just said, rather
     than a sheet thrown over his face while he is mid-answer. */
  .msgcol .chip { align-self: flex-start; }
  @media (prefers-reduced-motion: reduce) {
    .pcard, .planbuy b, .libcount { transition: none; }
    .pcard:active { transform: none; }
    .skel::after { animation: none; }
  }

  /* ---------- how to do this ----------
     The creator's line is the only thing here drawn in full ink: it came out of the
     video the user saved, and everything under it is generic by comparison. */
  .said { margin: 4px 0 16px; padding-left: 13px; border-left: 2px solid var(--ember); }
  .saidlab { font-size: 11.5px; font-weight: 650; color: var(--muted); margin-bottom: 5px;
    line-height: 1.4; }
  .saidq { font-size: 15px; line-height: 1.55; color: var(--ink); word-break: break-word; }
  .said .chip, #watchbody .chip { margin-top: 11px; padding: 11px 15px; }
  /* ---------- as performed ----------
     The section between what the creator SAID and a stranger's demonstration, and
     the only one that can contradict the clip below it. It is not quoted, so it does
     not wear the ember rule the said block wears: this is Spotter reporting what it
     saw, and the ink weight is the difference between a quote and an observation.

     The chips are the app's own .chip, unchanged: they are the same object the
     filter row and the said block already use, and a second pill that looked almost
     like the first would be a second pill to keep in step. They wrap rather than
     scroll — there are at most four and they are at most three words each, and a
     horizontal scroller for that is a scrollbar nobody asked for. */
  .perf { margin-bottom: 18px; }
  .perfchips { display: flex; flex-wrap: wrap; gap: 7px; }
  /* ---------- the delta and the second, on a card row ---------- */
  .exmarks { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  /* One line, truncated: the sheet says the delta in full, and a row whose height
     depends on how long a delta turned out to be makes the list breathe unevenly. */
  .dchip { min-width: 0; border-radius: 999px; padding: 5px 10px; line-height: 1.2;
    background: var(--ember-soft); color: var(--ember-ink); font-size: 11px; font-weight: 650;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The second is pushed to the end, where a reader's eye already goes for a
     duration, and set in tabular digits so a column of them lines up. */
  .t { flex: 0 0 auto; margin-left: auto; font-size: 11px; font-weight: 650;
    color: var(--muted); font-variant-numeric: tabular-nums; }
  /* "Watch this bit" sat on the chip above it with no gap at all, and on a row
     with no cue it ran on inline after the name ("Lat pulldown [Watch this
     bit]"), pushing the name off the dose's baseline. A line of its own, as
     wide as its words, with the air a paragraph gets. */
  .exname > .chip { display: flex; width: fit-content; margin-top: 9px; }
  /* ---------- the demonstration clip ----------
     One 16:9 slot, a byline, the other creators who filmed it, a way out — the shape
     Hevy, Fitbod and Nike Training Club all settled on for the demo inside an exercise
     screen. Ours is somebody else's video rather than one we filmed, so the channel
     line is not decoration: it says whose gym you are standing in.

     The slot is a grid row that grows from 0fr to 1fr, which is the one way to
     animate to a height nobody knows in advance. It matters because the answer
     arrives after the sheet is already open and reading: without it the
     explanation would jump down the moment a clip was found. */
  .vslot { display: grid; grid-template-rows: 0fr;
    transition: grid-template-rows var(--t-3) var(--e-out); }
  .vslot.on { grid-template-rows: 1fr; }
  .vslot > div { overflow: hidden; min-height: 0; }
  .ytbox { padding-top: 2px; }
  .ytbox .saidlab { margin-bottom: 7px; }
  /* What the clip is, when it is not simply this exercise, and how the creator's
     version differed. Both sit between a header and the thing they qualify, because
     that is the order the claim is made in: "the standard version" first, then whose
     version differs and how. */
  .ytrel, .perfdelta { font-size: 12.5px; line-height: 1.5; color: var(--ink-2);
    overflow-wrap: anywhere; }
  .ytrel { margin: -3px 0 9px; }
  .perfdelta { margin-top: 9px; }
  .ytface { display: block; width: 100%; margin: 0; padding: 0; border: 0; background: none;
    text-align: left; color: inherit; font: inherit;
    transition: transform var(--t-1) var(--e-out), opacity var(--t-2) var(--e-soft); }
  .ytface:active { transform: scale(.985); }
  /* hqdefault is 480x360 with letterbox bars top and bottom; cropped to 16:9 they
     are exactly what comes off, so this covers rather than contains. */
  .ytshot { position: relative; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden;
    background: var(--sand); border: 1px solid var(--line); }
  .ytshot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    display: block; }
  /* Ember, not a red YouTube button: this is Spotter offering the clip, and the
     accent guarantees the mark reads whatever the thumbnail turns out to be. */
  .ytplay { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px;
    margin: -27px 0 0 -27px; border-radius: 999px; display: flex; align-items: center;
    justify-content: center; background: var(--ember); color: var(--on-ember);
    box-shadow: 0 3px 16px var(--glow); }
  .ytplay .ic { width: 20px; height: 20px; fill: currentColor; margin-left: 2px; }
  /* The byline. Curated clips read creator first — .ytch over .ytsub — because a
     person chose that channel; a search result keeps .ytt over .ytc, the humbler claim.
     The block crossfades on a chip tap, opacity only: the slot above is a grid row
     animating its own height and a second height animation would fight it. */
  .ytby { margin-top: 9px; transition: opacity var(--t-2) var(--e-soft); }
  .ytby.swapping, .ytface.swapping { opacity: 0; }
  .ytch { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 650;
    line-height: 1.4; color: var(--ink); }
  .ytch .ic { width: 14px; height: 14px; }
  /* Not the red logo: YouTube's terms ask only that the source be identifiable, and a
     brand colour here would outrank the creator's own name, which is the point. */
  .ytlen { color: var(--muted); font-weight: 600; font-variant-numeric: tabular-nums; }
  /* One line, always: a two-line title on one clip and a one-line title on the next
     would move the chips under it every time a chip is tapped. */
  .ytsub { font-size: 12.5px; line-height: 1.4; color: var(--muted); margin-top: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ytt { font-size: 13.5px; line-height: 1.45; color: var(--ink);
    font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; }
  .ytc { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 1.4;
    color: var(--muted); margin-top: 3px; }
  .ytc .ic { width: 13px; height: 13px; }
  /* The other creators who filmed this movement. It scrolls rather than wraps, so the
     slot's height never depends on how long "Renaissance Periodization" is. */
  .ytalts { display: flex; gap: 7px; margin-top: 11px; padding: 6px 0; overflow-x: auto;
    scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .ytalts::-webkit-scrollbar { display: none; }
  .ytalt { position: relative; flex: none; height: 32px; padding: 0 13px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--sand); color: var(--ink-2); font: inherit;
    font-size: 12.5px; font-weight: 600; white-space: nowrap;
    transition: background var(--t-1) var(--e-out), color var(--t-1) var(--e-out),
      border-color var(--t-1) var(--e-out), transform var(--t-1) var(--e-out); }
  /* Drawn 32 tall so the row stays a row; hit 44, which is Apple's floor. */
  .ytalt::after { content: ""; position: absolute; inset: -6px 0; }
  .ytalt.on { background: var(--ember-soft); color: var(--ember-ink); border-color: transparent; }
  .ytalt:active { transform: scale(.96); }
  /* A row, not a button: the clip is the offer and this is the door beside it. */
  .ytmore { position: relative; display: inline-flex; align-items: center; gap: 5px;
    margin: 12px 0 16px; font-size: 13.5px; font-weight: 600; color: var(--ember-ink);
    text-decoration: none; transition: opacity var(--t-1) var(--e-out); }
  /* Drawn at its text height; only the hit area grows, to Apple's 44. */
  .ytmore::after { content: ""; position: absolute; inset: -14px -8px; }
  .ytmore:active { opacity: .6; }
  .ytmore .ic { width: 13px; height: 13px; }
  /* The player takes the facade's frame exactly, and loses the detail embed's drop
     shadow: the slot clips its own overflow, and a clipped shadow is a hard edge. */
  .ytbox .embedwrap.wide { margin-bottom: 0; border-radius: 14px; box-shadow: none;
    border: 1px solid var(--line); }
  /* ---------- was that right? ----------
     Under the explanation, never beside it: the verdict is about the paragraph above
     and a control that floats next to prose reads as part of the prose. The row
     fades in with the text rather than being there waiting, because there is nothing
     to have an opinion about until the words arrive.

     All three are .chip, which already carries the padding, the press and the lit
     state: a thumb is a filter pill that happens to hold a mark, and inventing a
     second pill for it would be a second pill to keep in step with the first. */
  .votes { display: flex; align-items: center; gap: 8px; margin-top: 16px;
    animation: msgin var(--t-3) var(--e-out) both; }
  /* Square, because the label is the icon. The height has to be stated: a chip is
     as tall as its padding makes it, and a chip with no padding is as tall as a
     16px glyph. Drawn 36, hit 44 — Apple's floor, from the ::after the filter chips
     already use, inset the 4px that makes 36 into 44 in both directions. */
  .vote { width: 36px; height: 36px; padding: 0; justify-content: center; }
  .vote .ic { width: 16px; height: 16px; }
  /* A thumbs-down is a thumbs-up reflected in its own middle — the two paths are the
     same fourteen curves with every y mirrored about 12 — so the page carries one
     symbol and this turns it over. Nothing about the drawing changes; it is one
     fewer copy of a path to keep in step with the other. */
  .vote.down .ic { transform: scaleY(-1); }
  /* The way out, at the end of the row: a reader who knows the movement better than
     Spotter does should be able to fix the card, not only mark the answer wrong. */
  .votefix { margin-left: auto; }
  @media (prefers-reduced-motion: reduce) {
    .votes { animation: none; }
    .vslot { transition: none; }
    .ytface { transition: none; }
    .ytface:active { transform: none; }
    .ytmore { transition: none; }
    /* The swap still happens, it just happens at once — vidSwap skips the delay too,
       so the thumbnail is never blank. */
    .ytby, .ytalt { transition: none; }
    .ytby.swapping, .ytface.swapping { opacity: 1; }
    .ytalt:active { transform: none; }
  }
  .kv { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 13px 0; border-top: 1px solid var(--line); font-size: 14px; }
  .kv:first-of-type { border-top: none; }
  .kv .k { color: var(--ink-2); }
  .kv .v { font-weight: 650; font-variant-numeric: tabular-nums; }
  .keybox { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
    background: var(--sand); border-radius: 11px; padding: 11px 12px; word-break: break-all;
    color: var(--ink-2); margin: 8px 0 12px; line-height: 1.5; }
  .btnrow { display: flex; gap: 9px; margin-top: 10px; }
  .btnrow .btn { flex: 1; }
  /* The third choice on the AI sheet. As a pill it sat flush under the pair
     above, sand on sand, and the three read as one lumpy shape; a text action
     with its own air is how a sheet offers the thing most people will not
     take. Ink rather than ember: turning AI off is a setting, not a link out. */
  .btnrow + .revoke { margin-top: 8px; color: var(--ink-2); font-weight: 650; }
  /* The AI sheet's three paragraphs are one piece of writing: the lede's size
     and colour for all of it, rather than a small grey opening under a large
     white middle. */
  #aiconsentsheet p { font-size: 13.5px; line-height: 1.6; color: var(--ink-2); margin: 0 0 14px; }
  #aiconsentsheet p a { color: var(--ember-ink); font-weight: 650; }
  #aiconsentsheet p:empty { display: none; }

  /* ---------- upload a video you saved ----------
     A tertiary control under the primary one, never a second primary: the URL
     field is the everyday path and this is its fallback. A hairline is the whole
     separator — an "or" chip would give the two paths equal billing.
     The bar is determinate because we know the byte count, and a 25 MB file on
     mobile data is well past the ten seconds at which a spinner stops being an
     honest answer to "how long". */
  .upblock { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
  /* "Add the video": no link to paste, so the sheet is the picker alone. */
  #addsheet.attach .field, #addsheet.attach #addgo { display: none; }
  #addsheet.attach .upblock { margin-top: 4px; padding-top: 0; border-top: 0; }
  .uploadrow { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
    background: var(--card); border: 1px solid var(--line-2); border-radius: 16px;
    padding: 13px 14px; color: var(--ink); box-shadow: var(--sh-sm);
    transition: border-color var(--t-2) var(--e-out), transform var(--t-1) var(--e-out),
      opacity var(--t-2); }
  .uploadrow:active { transform: scale(.985); }
  .uploadrow:focus-visible { outline: 2px solid var(--ember); outline-offset: 2px; }
  .uploadrow[disabled] { opacity: .5; }
  .upmark { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 11px; display: grid;
    place-items: center; background: var(--ember-soft); color: var(--ember-ink);
    font-size: 17px; font-weight: 700; line-height: 1; }
  .uptext { display: block; min-width: 0; }
  .uptext b { display: block; font-size: 14.5px; font-weight: 650; letter-spacing: -.01em; }
  .uptext small { display: block; margin-top: 3px; font-size: 12.5px; line-height: 1.45;
    color: var(--muted); }
  /* Inline on the control that caused it, not a toast: the fix is to pick a
     different file, which means the message has to still be there when the user
     looks back at the row. */
  .uperr { margin-top: 10px; font-size: 13px; line-height: 1.5; color: var(--ember-ink);
    background: var(--ember-soft); border-radius: 12px; padding: 10px 12px;
    animation: fadein var(--t-2) var(--e-soft); }
  .upprog { margin-top: 12px; }
  .upbar { height: 6px; border-radius: 999px; background: var(--sand); overflow: hidden; }
  .upbar i { display: block; height: 100%; width: 0; border-radius: 999px; background: var(--ember);
    transition: width var(--t-2) var(--e-out); }
  .upnote { margin-top: 7px; font-size: 12.5px; color: var(--ink-2);
    font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) {
    .uploadrow, .upbar i { transition: none; }
    .uperr { animation: none; }
  }

  /* ---------- save from any app ----------
     The share sheet's own row, drawn small: the share glyph, the round More and
     Spotter's real icon, chevrons between. The app's add sheet opens as this
     (.share); on the web, which has no share extension, it stays hidden and the
     link box leads as before. Spotter's tile keeps an ember ring, "this is the one
     you tap", and on opening a ring walks the row once, the way a thumb would. */
  .sharehow, .orpaste { display: none; }
  #addsheet.share .sharehow { display: block; }
  #addsheet.share .orpaste { display: flex; }
  .shareflow { display: flex; justify-content: center; align-items: flex-start; margin: 0 0 12px;
    padding: 16px 6px 13px; list-style: none; background: var(--card); border: 1px solid var(--line);
    border-radius: 18px; box-shadow: var(--sh-sm); }
  .shareflow li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
    width: 68px; font-size: 12.5px; font-weight: 650; color: var(--ink); letter-spacing: -.005em; }
  .shareflow li + li { margin-left: 20px; }
  /* Two borders of a turned square: a chevron with nothing to load. */
  .shareflow li + li::before { content: ""; position: absolute; left: -16px; top: 20px; width: 7px; height: 7px;
    border-top: 2px solid var(--muted); border-right: 2px solid var(--muted); transform: rotate(45deg); }
  .sfmark { position: relative; width: 46px; height: 46px; display: grid; place-items: center;
    border-radius: 13px; background: var(--sand); color: var(--ink); }
  .sfmark .ic { width: 22px; height: 22px; }
  .sfmark.more { border-radius: 999px; }
  .sfmark.more .ic { stroke-width: 3.4; }
  .sfmark.app img { display: block; width: 46px; height: 46px; border-radius: 11px; }
  .sfmark::after { content: ""; position: absolute; inset: -4px; border-radius: 16px;
    border: 2px solid var(--ember); opacity: 0; pointer-events: none; }
  .sfmark.more::after { border-radius: 999px; }
  .sfmark.app::after { border-radius: 14px; opacity: 1; }
  #addsheet.open .sfmark::after { animation: sftap .6s var(--e-out) .45s both; }
  #addsheet.open li:nth-child(2) .sfmark::after { animation-delay: .85s; }
  #addsheet.open .sfmark.app::after { animation: sfstay .5s var(--e-spring) 1.25s both; }
  @keyframes sftap { 0% { opacity: 0; transform: scale(.84); } 35% { opacity: 1; transform: none; }
    100% { opacity: 0; transform: scale(1.1); } }
  @keyframes sfstay { from { opacity: 0; transform: scale(.84); } }
  .sfnote { margin: 0 4px 6px; text-align: center; font-size: 12.5px; line-height: 1.5; color: var(--ink-2); }
  .sfnote b, .webnote b { color: var(--ink); font-weight: 650; }
  .sftip .ic { display: inline-block; width: 13px; height: 13px; margin: 0 5px 0 0; vertical-align: -2px;
    color: var(--ember-ink); fill: currentColor; }
  .sfopen { display: flex; justify-content: center; gap: 8px; margin: 12px 0 0; }
  .sfopen .chip { flex: 1 1 0; max-width: 176px; min-height: 44px; justify-content: center; padding: 0 12px;
    background: var(--card); color: var(--ink); border: 1px solid var(--line-2); font-size: 13px; }
  .sfopen .chip .ic { width: 14px; height: 14px; color: var(--ember-ink); }
  /* The second way in, headed as the second way: a rule either side of the words. */
  .orpaste { align-items: center; gap: 12px; margin: 18px 0 12px; font-size: 12px; font-weight: 600;
    color: var(--muted); }
  .orpaste::before, .orpaste::after { content: ""; flex: 1; height: 1px; background: var(--line-2); }
  /* Quiet until there is a link to save; ember the moment one is pasted. */
  #addsheet #addgo { transition: transform var(--t-1) var(--e-out), opacity var(--t-2),
    background-color var(--t-2) var(--e-soft), color var(--t-2) var(--e-soft), box-shadow var(--t-2) var(--e-soft); }
  #addsheet.share:has(#addurl:placeholder-shown) #addgo { background: var(--sand); color: var(--ink); box-shadow: none; }
  #addsheet.share .upblock { margin-top: 12px; padding-top: 0; border-top: 0; }
  /* Pumpy's first tip lands under the row; "Or paste a link" already spaces below it. */
  #addsheet.share .pumpy-tip { margin: 14px 0 0; }
  .webnote { margin: 12px 2px 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-2); }
  #addsheet.attach .webnote { display: none; }
  /* The empty library shows the same row, lighter: no card, tiles on their own. */
  .empty .shareflow { margin: 18px auto 0; padding: 0; background: none; border: 0; box-shadow: none; }
  .empty .sfmark { background: var(--card); box-shadow: var(--sh-sm); }
  @media (max-width: 359px) { .sfopen .chip .ic { display: none; } }
  @media (prefers-reduced-motion: reduce) {
    #addsheet.open .sfmark::after, #addsheet.open .sfmark.app::after { animation: none; }
    #addsheet #addgo { transition: none; }
  }

  /* ---------- swap or modify ----------
     Reason and body-area pickers reuse the library chips; the answer is a list
     in the detail view's exercise-row rhythm, with the trade-off one step quieter
     than the why, and the non-medical line quietest of all. */
  .swapsummary { font-size: 14px; line-height: 1.6; color: var(--ink-2); margin: 6px 0 8px; }
  .swapsect { margin: 14px 0 4px; }
  .swapsect h3 { font-family: var(--display); font-size: 12px; font-weight: 700; letter-spacing: .11em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
  .swapitem { padding: 11px 0; border-top: 1px solid var(--line); }
  .swapitem:first-of-type { border-top: none; }
  .swapitem b { font-size: 14.5px; font-weight: 650; line-height: 1.35; }
  .swapitem .tag { font-size: 11px; font-weight: 600;
    color: var(--ember-ink); margin-left: 8px; white-space: nowrap; }
  .swapitem .why { font-size: 13px; color: var(--ink-2); line-height: 1.5; margin-top: 3px; }
  .swapitem .trade { font-size: 12.5px; color: var(--muted); line-height: 1.5; margin-top: 3px; }
  .swapnote { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 14px 0 4px; padding-top: 10px;
    border-top: 1px solid var(--line); }
  /* The way round the model: a row under the reasons into the bank, and a chip on
     each alternative that does the same with the suggestion already picked. */
  .swapbank { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 14px;
    font-size: 13px; color: var(--muted); }
  .swapitem .use { margin-top: 8px; }

  /* ---------- picker list ---------- */
  .picklist { display: flex; flex-direction: column; gap: 2px; }
  /* color: inherit, because WebKit paints a bare <button> system blue — the leave
     sheet's two rows came up as links on the 17 Pro while every other row was ink. */
  .pickrow { display: flex; align-items: center; gap: 12px; padding: 11px 6px; border: none;
    background: none; text-align: left; border-radius: 13px; width: 100%; color: inherit; }
  .pickrow:active { background: var(--sand); }
  .pickrow img { width: 46px; height: 46px; border-radius: 11px; object-fit: cover; background: var(--sand);
    flex: 0 0 auto; }
  .pickrow .pt { flex: 1; min-width: 0; }
  .pickrow .pt b { display: block; font-size: 14px; font-weight: 600; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pickrow .pt span { font-size: 11.5px; color: var(--muted); }
  /* The leave sheet's two doors: an icon in a sand tile, a title, a line saying
     what each one keeps. The same row Options uses, with a tile so the two read
     as choices rather than as a list. */
  .leaverow { min-height: 60px; padding: 8px 6px; }
  .leaverow .ic { width: 42px; height: 42px; padding: 11px; border-radius: 12px; background: var(--sand);
    color: var(--ember-ink); }
  .leaverow .pt b { font-size: 15px; white-space: normal; }
  .leaverow .pt span { display: block; margin-top: 1px; line-height: 1.4; }

  /* ---------- sort and jump ----------
     A mark against the one in force, which is what Apple says people scan a list of
     attributes for — not a segmented control, whose equal segments would clip the
     longest of three unequal labels at 375px. 44px rows, iOS's default size. */
  .sortrow { min-height: 44px; gap: 10px; }
  .sortrow b { flex: 1; min-width: 0; font-size: 15px; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sortrow .ic { width: 17px; height: 17px; flex: 0 0 auto; color: var(--ember-ink); }
  .sortrow.on b { color: var(--ember-ink); }
  .jumpwrap { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
  .jumpwrap h3 { margin: 0 0 4px 6px; font-family: inherit; font-size: 11.5px; font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
  /* The sheet stays open on the choice, so its new sections have to arrive rather
     than be there: it grows into the measured --jh and the rows above ride up.
     Reduced motion keeps the fade and drops the growing. */
  .jumpwrap.in { overflow: hidden; animation: jumpin var(--t-2) var(--e-out) backwards; }
  @keyframes jumpin { from { max-height: 0; margin-top: 0; padding-top: 0; opacity: 0; }
    to { max-height: var(--jh, 70vh); } }
  @media (prefers-reduced-motion: reduce) { .jumpwrap.in { animation-name: fadein; } }

  /* ---------- toast ---------- */
  /* Hung from the frame's bottom edge, not the layout viewport's — not the same
     edge on an installed iPhone. -100% makes top the line the toast sits ON, so
     the 96px of clearance still means 96px. */
  #toast { position: fixed; left: 50%;
    top: calc(var(--vvtop) + var(--vvh) - 96px - var(--sab));
    transform: translate(-50%, calc(-100% + 14px)); z-index: 90; background: var(--ink); color: var(--paper);
    padding: 12px 18px; border-radius: 999px; font-size: 13.5px; font-weight: 600; opacity: 0;
    pointer-events: none; transition: opacity var(--t-2), transform var(--t-2) var(--e-out);
    box-shadow: var(--sh-lg); max-width: 88vw; text-align: center; }
  #toast.show { opacity: 1; transform: translate(-50%, -100%); }
  /* Workout Mode has no tab bar to clear but a rest strip lands where the toast
     does: 76px of bottom bar, 48px of strip, 12px of air. "New best" used to sit
     on +15 s and Skip for three seconds. */
  #workout.open ~ #toast { top: calc(var(--vvtop) + var(--vvh) - 136px - var(--sab)); }
  #toast.tappable { pointer-events: auto; cursor: pointer; }
  /* The one toast the landing ever shows — a shared link waiting for sign-in —
     belongs above the fold, not across the sign-in card. There is no tab bar here
     to clear, and the top of the landing is the only empty band on the screen.
     The 14px entrance offset still reads as an arrival from off-screen. */
  body:not(.app) #toast { top: calc(14px + env(safe-area-inset-top)); bottom: auto;
    transform: translate(-50%, -14px); }
  body:not(.app) #toast.show { transform: translate(-50%, 0); }

  /* ---------- tab bar ----------
     Nothing here transitions any more, and that is the point: every item is drawn
     from --x, the track's position measured in pages, so a tap, a fling and a
     finger halfway between two tabs all move the bar by the same rule. The spring
     in app.ts is the timing; a CSS transition on top of it would fight it. */
  /* Absolute inside #app rather than fixed: the frame knows where the bottom of
     the screen is and the layout viewport does not. #app is itself fixed, so this
     is the same box in the same stacking context it has always been. */
  .tabbar { position: absolute; left: 0; right: 0; bottom: 0; z-index: 40; display: flex;
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    -webkit-backdrop-filter: blur(22px) saturate(1.6); backdrop-filter: blur(22px) saturate(1.6);
    border-top: 1px solid var(--line); padding: 8px 6px calc(6px + var(--sab)); }
  /* The selected item rides a capsule instead of being announced by colour alone,
     the way the iOS 26 tab bar glides its glass pill between items. The pill box
     is a whole tab wide so translateX(100%) is exactly one tab; the visible
     capsule is the inset pseudo-element. */
  .tabpill { position: absolute; left: 6px; top: 8px; bottom: calc(6px + var(--sab));
    width: calc((100% - 12px) / 3); pointer-events: none;
    transform: translateX(calc(var(--x, 0) * 100%)); }
  .tabpill::after { content: ""; position: absolute; inset: 0 5px; border-radius: 14px;
    background: var(--pill); }
  .tab { flex: 1; position: relative; z-index: 1; border: none; background: none; display: flex;
    flex-direction: column; align-items: center; gap: 4px; padding: 5px 2px; font-size: 10px;
    font-weight: 650; letter-spacing: .02em;
    --d: calc(var(--i, 0) - var(--x, 0));
    --p: clamp(0, calc(1 - max(var(--d), 0 - var(--d))), 1);
    color: var(--muted);
    color: color-mix(in srgb, var(--ember-ink) calc(var(--p) * 100%), var(--muted)); }
  .tab:nth-child(2) { --i: 0; }
  .tab:nth-child(3) { --i: 1; }
  .tab:nth-child(4) { --i: 2; }
  .tab:focus-visible { outline: 2px solid var(--ember); outline-offset: -3px; border-radius: 14px; }
  /* The grayscale filter is gone with the emoji it was there to launder: a line
     icon in currentColor already takes the muted-to-ember mix on the .tab above,
     per frame, which is what the emoji could never do. */
  .tab .ti { line-height: 1; opacity: calc(.62 + .38 * var(--p));
    transform: translateY(calc(-1px * var(--p))) scale(calc(1 + .08 * var(--p))); }
  /* A 2px stroke at 21px is the weight of a 700 label; the lit tab earns a little
     more of it, the way SF Symbols go from Regular to Semibold on selection. */
  .tab .ti .ic { stroke-width: calc(1.85 + .35 * var(--p)); }
  /* The label in a box of its own, on its own layer. On the owner's iPhone the
     icons painted and the words under them did not, with the layout itself
     correct — the signature of WebKit dropping an anonymous text run inside a
     backdrop-filtered bar while a transformed sibling repaints every frame. */
  .tab .tl { display: block; transform: translateZ(0); }

  /* ---------- pull to refresh ---------- */
  #ptr { position: fixed; top: calc(env(safe-area-inset-top) + 6px); left: 50%; z-index: 30;
    width: 30px; height: 30px; margin-left: -15px; border-radius: 999px; background: var(--card);
    box-shadow: var(--sh-md); display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; color: var(--ember); font-size: 15px; }
  /* Only on release: mid-drag this would lag the thumb. */
  #ptr.back { transition: opacity var(--t-2) var(--e-soft), transform var(--t-3) var(--e-out); }

  /* viewIn() in app.ts always existed and never did anything: it re-triggered an
     entrance nothing declared, so every view switch, empty state and exercise
     change snapped. Only the arriving screen animates. */
  .viewin { animation: viewin var(--t-3) var(--e-out); }
  @keyframes viewin { from { opacity: 0; transform: translateY(7px); } }

  /* ---------- train ---------- */
  /* Train and Pumpy are always-mounted pages; only the side gutter is theirs,
     the vertical padding belongs to .page. */
  .view { padding-left: 18px; padding-right: 18px; }

  /* The streak on the left, the ring on the right, and nothing between them: the
     two things a training week is judged by, at a glance, above everything the
     week can be browsed into. */
  .trainhero { display: flex; align-items: center; justify-content: space-between; gap: 14px;
    margin: 4px 0 12px; min-height: 84px; }
  .wkleft { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .wkbig { font-family: var(--display); font-size: 26px; font-weight: 800; line-height: 1;
    letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .wksub { font-size: 12px; font-weight: 600; color: var(--muted); }
  .trainhero.risk .wksub { color: var(--ember-ink); }
  .trainhero.full .wksub { color: var(--good); }
  /* The ring as a button: it is the door to what counts, which is where the day
     dots used to lead. 84px is the mockup's, and it carries its own 44px. */
  .ringwrap.rsm { width: 84px; height: 84px; margin: 0; flex: 0 0 auto; border: 0;
    background: none; padding: 0; }
  .rsm .rnum { font-size: 22px; }
  .rsm .rof { font-size: 10px; }
  .rsm .rcheck .ic { width: 26px; height: 26px; }

  .weekbar { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; }
  .weekbar b, .secthead b { font-family: var(--display); font-size: 16px; font-weight: 700;
    letter-spacing: -.012em; }
  .wbnav { margin-left: auto; display: flex; align-items: center; gap: 2px; }

  /* Seven days, one row, one dot each. The cell is the target — 48px across on a
     375px phone and 56 deep — because a dot is not something anyone can hit. */
  .wstrip { display: flex; gap: 4px; margin: 0 0 12px; }
  .wday { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center;
    gap: 6px; min-height: 56px; padding: 8px 0 7px; border-radius: 12px; background: none;
    border: 1px solid transparent; transition: transform var(--t-1) var(--e-out); }
  .wday:active { transform: scale(.93); }
  .wday.today { background: var(--card); border-color: var(--ember); box-shadow: var(--sh-sm); }
  .wdl { font-size: 10.5px; font-weight: 650; color: var(--muted); letter-spacing: .04em; }
  .wdn { font-family: var(--display); font-size: 15px; font-weight: 700; color: var(--ink-2);
    font-variant-numeric: tabular-nums; }
  .wday.today .wdn { color: var(--ink); }

  /* ---------- train / the dot language ----------
     Five states, spoken by the strip, the month grid and the key under it:
     filled is done, filled with a ring is done exactly as planned, hollow ember
     is planned, a grey cross is planned and missed, sand is a free day. The ring
     is drawn in --card so it reads on a card and in a cell.

     Missed used to be a hollow amber ring — the same shape as planned in a hue a
     shade off ember, which at 8px the owner could not tell apart ("too close in
     color and the same symbol", 21 Sept). It is now the one mark that is not a
     circle, and not ember: the cross every habit tracker and training calendar
     (Streaks, Runna, TrainingPeaks) uses for a day that did not happen, in the
     grey of the small print rather than an alarm red — Spotter does not punish a
     missed day, it just says so. Shape and hue both differ, so it holds without
     colour vision. --muted is 4.5:1 on paper and 4.9 on a card; the ember family
     stays for the three days that were trained or are still to come. */
  .dmark { width: 8px; height: 8px; border-radius: 999px; background: var(--sand);
    display: block; flex: 0 0 auto; position: relative; }
  .dmark.on { background: var(--ember); }
  .dmark.as { background: var(--ember);
    box-shadow: 0 0 0 2px var(--dbg, var(--paper)), 0 0 0 3.5px var(--ember); }
  .mcell, .wday.today { --dbg: var(--card); }
  .mcell.out { --dbg: var(--paper); }
  .dmark.plan { background: none; box-shadow: inset 0 0 0 1.6px var(--ember); }
  .dmark.miss { background: none; }
  .dmark.miss::before, .dmark.miss::after { content: ""; position: absolute; left: 50%; top: 50%;
    width: 10px; height: 1.8px; border-radius: 1px; background: var(--muted);
    transform: translate(-50%, -50%) rotate(45deg); }
  .dmark.miss::after { transform: translate(-50%, -50%) rotate(-45deg); }
  .dlegend { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin: 9px 2px 0;
    font-size: 11.5px; font-weight: 600; color: var(--muted); }
  .dlegend .lg { display: flex; align-items: center; gap: 6px; }

  /* ---------- train / today ---------- */
  .daycard { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 13px 15px; margin-bottom: 9px; box-shadow: var(--sh-sm); }
  .daycard.today { border-color: var(--ember); }
  .dayhead { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin-bottom: 2px; }
  .dayname { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--muted); }
  .daycard.today .dayname { color: var(--ember-ink); }
  .daydone { color: var(--good); font-size: 12px; font-weight: 700; }
  .tcard { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; margin: 0 0 12px; }
  .tcard .dayhead { margin-bottom: 0; }
  /* The overflow reads as a glyph, not as a second button competing with Start. */
  .tmore { background: none; color: var(--muted); margin: -3px -6px -3px 0; }
  .tbody { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .tthumb { width: 44px; height: 55px; border-radius: 12px; object-fit: cover;
    background: var(--sand); flex: 0 0 auto; }
  .ttxt { min-width: 0; }
  .tcard .ttitle { font-size: 17px; padding: 0; }
  .tcard .tdose { margin: 3px 0 0; font-size: 13px; color: var(--ink-2); }
  .tbtns { display: flex; gap: 8px; }
  .tbtns .btn { flex: 1; min-width: 0; min-height: 44px; }
  .tbtns .tmove { flex: 0 0 auto; width: auto; padding: 14px 16px; font-size: 14px; }
  .planitem { display: flex; align-items: center; gap: 11px; margin-top: 9px; }
  .planitem img { width: 42px; height: 42px; border-radius: 10px; object-fit: cover;
    background: var(--sand); flex: 0 0 auto; }
  .planitem .pt { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .planadd { background: none; border: 1px dashed var(--line-2); color: var(--muted); width: 100%;
    border-radius: 12px; padding: 10px; font-size: 13px; font-weight: 600; margin-top: 9px; }
  .planx { background: none; border: none; color: var(--muted); font-size: 15px; padding: 6px; }

  /* ---------- train / the segmented control ----------
     Apple's segmented control: the selection is one thumb travelling between
     seats, not three pictures of a state, so the pill is a single node sliding on
     --t-2 while the labels hold still. Three title-case nouns and no action among
     them — a segmented control chooses a view and never does a thing.
     Sticky in the header's own glass, bled to the page edges, because the days
     above it scroll away and the question "which of the three am I reading" must
     not. No touch-action anywhere in here: the pager's axis lock depends on the
     page declaring nothing. */
  .trainseg { position: sticky; top: var(--hdr, 92px); z-index: 5; margin: 0 -18px 14px;
    padding: 8px 18px 10px; }
  .seg { position: relative; display: flex; flex: 0 0 auto; background: var(--sand);
    border-radius: 11px; padding: 3px; }
  .segpill { position: absolute; top: 3px; bottom: 3px; left: 3px;
    width: calc((100% - 6px) / var(--n, 2));
    background: var(--card); border-radius: 9px; box-shadow: var(--sh-sm);
    transform: translateX(calc(var(--s, 0) * 100%));
    transition: transform var(--t-2) var(--e-spring); }
  /* --ink-2, not --muted: --muted measures 4.13 on sand. */
  .segbtn { position: relative; z-index: 1; flex: 1; min-width: 0; min-height: 32px; border: none;
    background: none; color: var(--ink-2); font-size: 13px; font-weight: 700; padding: 0 10px;
    letter-spacing: -.005em; transition: color var(--t-2) var(--e-soft); }
  .segbtn[aria-selected="true"] { color: var(--ink); }
  .planacts { display: flex; align-items: center; gap: 7px; margin: 0 0 12px; }
  .planbtn { border: 1px solid var(--line); background: var(--card); color: var(--ink-2);
    border-radius: 999px; padding: 0 13px; min-height: 32px; font-size: 12.5px; font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    transition: transform var(--t-1) var(--e-out), border-color var(--t-2) var(--e-soft); }
  .planbtn:active { transform: scale(.94); }
  /* A crossfade and nothing more: the tap did not say which way time went. */
  .planswap { animation: planswap var(--t-2) var(--e-out); }
  @keyframes planswap { from { opacity: 0; } }
  /* A swipe on the band leans the week the way the finger goes and then sends it
     out that way, so the week arriving comes in from the far side — the crossfade
     above cannot say which direction time went. The days, the card and whichever
     segment is open lean together, because they are one week. Transform and
     opacity only, and .pbmove is timing: on for the release, off while a finger is
     holding it, so tracking is 1:1 and the let-go is the only thing that eases. */
  .trainlean.pbmove { transition: transform var(--t-2) var(--e-out), opacity var(--t-2) var(--e-out); }
  .weekbar b { transition: transform var(--t-2) var(--e-spring); }
  .weekbar.wbdrag b { transition: none; }
  .planin { animation: planin var(--t-3) var(--e-out); }
  @keyframes planin { from { opacity: 0; transform: translateX(var(--pin, 26px)); } }

  /* ---------- train / the month ----------
     iOS Calendar's compact month: a number and one mark, with the key under the
     grid doing the naming. Seven columns in a 375px phone leave 45px each, which
     is what an 8px dot and a 12.5px number were sized against. */
  .mgrid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
  .mdow { text-align: center; font-size: 10px; font-weight: 700; letter-spacing: .08em;
    color: var(--muted); padding-bottom: 5px; }
  .mcell { display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    gap: 6px; min-height: 48px; padding: 8px 1px; background: var(--card);
    border: 1px solid var(--line); border-radius: 11px; box-shadow: var(--sh-sm);
    transition: transform var(--t-1) var(--e-out); }
  .mcell:active { transform: scale(.93); }
  /* Present and tappable but no longer cards: 35 equal boxes hide the 1st. */
  .mcell.out { background: none; border-color: transparent; box-shadow: none; }
  /* Colour and weight, not opacity: --muted measures 4.52 on paper, and ink at
     .45 lands on 3.4 and stops being AA. */
  .mcell.out .mnum { color: var(--muted); font-weight: 600; }
  .mcell.today { border-color: var(--ember); box-shadow: 0 0 0 1px var(--ember); }
  .mnum { font-size: 12.5px; font-weight: 700; color: var(--ink); line-height: 1;
    font-variant-numeric: tabular-nums; }
  .mcell.today .mnum { color: var(--ember-ink); }
  /* The day sheet borrows .planitem and .planadd whole, and .histrow for the
     sessions above them. */
  #daylist { margin-bottom: 4px; }
  #daylist .lede { margin: 10px 0 0; }
  .dayses { width: 100%; min-height: 44px; background: none; border: 0;
    border-top: 1px solid var(--line); text-align: left; color: var(--ink); }
  .dayses:first-child { border-top: none; }
  .dayses .ic { color: var(--muted); flex: 0 0 auto; }

  /* ---------- train / sets per day ----------
     Seven bars, no axes, no SVG: the shape of the week is the message and the
     figure beside the heading is the only number worth reading exactly. */
  .cardhead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    margin: 0 0 12px; }
  .cardhead h3 { margin: 0; }
  .cardsub { font-size: 12px; font-weight: 600; color: var(--muted); flex: 0 0 auto; }
  .cardnum { flex: 0 0 auto; }
  .sbars { display: flex; gap: 6px; align-items: flex-end; }
  .sbcol { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center;
    gap: 5px; justify-content: flex-end; }
  .sbar { width: 100%; max-width: 26px; border-radius: 6px 6px 3px 3px; background: var(--ember);
    transition: height var(--t-3) var(--e-out); }
  .sbar.zero { background: var(--sand); }
  .sbl { font-size: 10.5px; font-weight: 650; color: var(--muted); }
  .secthead { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin: 18px 2px 8px; }
  .linkbtn { background: none; border: 0; color: var(--ember-ink); font-size: 12.5px;
    font-weight: 700; padding: 6px 2px; }

  /* ---------- programs / copy a week ----------
     A destination is a row you tap, and the weeks it will land on light up
     together: four weeks should look like four weeks before you commit. Card
     and --line, not sand — --muted is 4.89 on card and 4.13 on sand. */
  .copyhead { margin-bottom: 15px; }
  .copywks { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
  .copysum { font-size: 13px; color: var(--ink-2); line-height: 1.45; }
  .copysum b { color: var(--ink); font-weight: 700; }
  .copyweeks { display: flex; flex-direction: column; gap: 6px; }
  .copyweek { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    width: 100%; min-height: 44px; text-align: left; background: var(--card);
    border: 1px solid var(--line); border-radius: 12px; padding: 10px 13px;
    transition: background-color var(--t-2) var(--e-soft), border-color var(--t-2) var(--e-soft),
      transform var(--t-1) var(--e-out); }
  .copyweek b { font-size: 14px; font-weight: 700; color: var(--ink); }
  .copyweek .n { font-size: 12px; font-weight: 600; color: var(--muted); flex: 0 0 auto; }
  .copyweek:active { transform: scale(.98); }
  .copyweek.on { background: var(--ember-soft); border-color: var(--ember); }
  .copyweek.on .n { color: var(--ember-ink); }
  .copyrep { display: flex; align-items: center; gap: 11px; flex-wrap: wrap; margin: 17px 0 3px; }
  .copyrep > span { font-size: 13px; font-weight: 700; color: var(--ink-2); }
  .copychips { display: flex; gap: 6px; flex-wrap: wrap; }
  /* 44 outright: these wrap, and a hit area that deep would overlap the row. */
  .copychips .chip { min-width: 44px; justify-content: center;
    padding: 9px 11px; font-variant-numeric: tabular-nums; }
  .copywks .chip, .copychips .chip { min-height: 44px; }
  /* iOS has ignored user-scalable=no since iOS 10, so a quick second tap on one
     of these can still be taken for a double-tap zoom and never reach the
     button. manipulation is the one word that says tapped, not zoomed, and it
     stays scoped to this sheet: the pager's axis lock needs the rest of the page
     to keep declaring nothing. */
  #copysheet button { touch-action: manipulation; }
  .planbtn.wide { width: 100%; min-height: 44px; margin-top: 11px; font-size: 13.5px; }
  /* Already 44, and stacked between two controls whose hit areas it would eat. */
  .planbtn.wide::after { display: none; }
  .trainbody > .planbtn.wide { margin-top: 16px; }
  .planbtn .pumpmark { border-radius: 50%; overflow: hidden; width: 18px; height: 18px; color: var(--ember); flex: 0 0 auto; }
  .planbtn .pumpmark svg { border-radius: 50%; width: 100%; height: 100%; display: block; }
  /* The answer without the travel: the pill still moves, instantly. */
  @media (prefers-reduced-motion: reduce) {
    .segpill { transition: none; }
    .planbtn:active, .segbtn, .mcell, .copyweek { transition: none; }
    .planswap { animation: none; }
    /* The week still changes and still says so, with the crossfade this section
       already uses rather than a slide. The drag itself moves nothing: app.ts
       asks lessMotion() before it paints a lean. */
    .trainlean.pbmove, .weekbar b, .sbar, .wday { transition: none; }
    .planin { animation: planswap var(--t-2) var(--e-out); }
  }

  /* ---------- train / the ring ----------
     Apple's Activity shape with ONE arc, because a second ring is a second thing
     to fail at. Only stroke-dashoffset moves, and every colour is a token, so the
     dark scheme costs nothing. */
  .ringwrap { position: relative; width: min(96px, 26vw); height: min(96px, 26vw);
    margin: 13px auto 11px; }
  .wring { display: block; width: 100%; height: 100%; overflow: visible; }
  .rtrack, .rarc { fill: none; stroke-width: 4.2; }
  .rtrack { stroke: var(--sand); }
  .rarc { stroke: var(--ember); stroke-linecap: round;
    transform: rotate(-90deg); transform-origin: 50% 50%;
    transition: stroke-dashoffset var(--t-4) var(--e-out), stroke var(--t-3) var(--e-soft); }
  .trainhero.full .rarc, .sumweek.full .rarc { stroke: var(--good); }
  /* Once, two seconds, on a week still winnable but tight. Something that pulses
     forever is an alarm; this is a nudge. */
  .trainhero.risk .wring { animation: ringpulse 2s var(--e-soft) 1; }
  @keyframes ringpulse { 0%, 100% { filter: none; }
    50% { filter: drop-shadow(0 0 6px var(--glow)); } }
  .rmid { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 1px; }
  .rnum { font-family: var(--display); font-size: min(40px, 11vw); font-weight: 800;
    line-height: 1; letter-spacing: -.02em; color: var(--ink); }
  .rof { font-size: 11px; font-weight: 600; color: var(--muted); }
  .rcheck { display: flex; color: var(--good); }
  .rcheck .ic { width: 34px; height: 34px; stroke-width: 2.6; }
  .rnum, .rof, .rmeta, .tweek, .sumweek, .wkbig { font-variant-numeric: tabular-nums; }
  .rmeta { font-size: 11.5px; color: var(--muted); padding-bottom: 8px; }
  /* The same sentence on the today card and at the end of a session. */
  .tweek { font-size: 12px; font-weight: 600; color: var(--ember-ink); margin: 0 0 12px; }
  .tweek.risk { color: var(--ember); }
  .tdose + .tweek { margin-top: -7px; }
  .sumweek { display: flex; align-items: center; justify-content: center; gap: 9px;
    margin: 13px 0 0; font-size: 13px; font-weight: 600; color: var(--ink-2); }
  .sumweek.full { color: var(--good); }
  .wring.small { width: 26px; height: 26px; flex: 0 0 auto; }
  .wring.small .rtrack, .wring.small .rarc { stroke-width: 9; }
  /* Medallions: an ember disc for what happened, a sand silhouette carrying the
     requirement for what has not. auto-fill at 96px is three across on a 375px
     phone and simply grows on anything wider. */
  .tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 15px 8px; }
  .medal { text-align: center; animation: cardin var(--t-3) var(--e-out) both; }
  .mdisc, .sdisc { border-radius: 999px; background: var(--ember-soft); color: var(--ember-ink);
    display: flex; align-items: center; justify-content: center;
    box-shadow: inset 0 0 0 1px var(--line); }
  .mdisc { width: 54px; height: 54px; margin: 0 auto 8px; }
  .mdisc .ic { width: 22px; height: 22px; }
  .medal.lock .mdisc { background: var(--sand); color: var(--muted); }
  .mname { font-size: 12px; font-weight: 650; line-height: 1.3; }
  .medal.lock .mname { color: var(--ink-2); font-weight: 600; }
  .mwhen { font-size: 10.5px; color: var(--muted); margin-top: 2px;
    font-variant-numeric: tabular-nums; }
  /* The ember seal. One object, one sweep, one haptic — then it settles and stays
     on the card as a badge, which is what an award is. Confetti is a party for
     the app rather than for the person who just trained. */
  .seal { display: flex; flex-direction: column; align-items: center; gap: 9px; margin: 15px 0 0; }
  .sdisc { position: relative; width: 74px; height: 74px; }
  .sdisc .ic { width: 30px; height: 30px; }
  .sdisc .wring { position: absolute; inset: 0; width: 100%; height: 100%; }
  .seal .rtrack { display: none; }
  .seal.in .sdisc { animation: sealin var(--t-4) var(--e-spring) both; }
  @keyframes sealin { from { opacity: 0; transform: scale(.86); } }
  .sname { font-family: var(--display); font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
  #workout.summary .wblock { transition: opacity var(--t-2) var(--e-soft); }
  #workout.summary .wblock.fade { opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    /* The seal keeps the crossfade and loses the sweep and the scale. */
    .medal, .seal.in .sdisc { animation: none; }
    /* The arc still says the right thing without travelling to say it, and the
       at-risk week still glows — it just stops breathing. */
    .rarc { transition: none; }
    .trainhero.risk .wring { animation: none; filter: drop-shadow(0 0 6px var(--glow)); }
  }
  .chartcard { background: var(--card); border: 1px solid var(--line); border-radius: 18px;
    padding: 16px; margin-bottom: 14px; box-shadow: var(--sh-sm); }
  .chartcard h3 { font-family: var(--display); font-size: 12px; font-weight: 700; letter-spacing: .11em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 14px; }
  .chartcard svg { display: block; width: 100%; height: auto; overflow: visible; }
  .bar { fill: var(--ember); }
  .bar.dim { fill: var(--line-2); }
  .axis { fill: var(--muted); font-size: 9px; font-weight: 600; font-family: var(--sans); }
  .prrow, .histrow { display: flex; align-items: center; gap: 11px; padding: 11px 0;
    border-top: 1px solid var(--line); }
  .prrow:first-of-type, .histrow:first-of-type { border-top: none; }
  .prrow .n, .histrow .n { flex: 1; min-width: 0; font-size: 14px; font-weight: 550; line-height: 1.35; }
  .prrow .n span, .histrow .n span { display: block; font-size: 11.5px; color: var(--muted);
    font-weight: 400; margin-top: 2px; }
  .prrow .v, .cardnum { font-family: var(--display); font-size: 14px; font-weight: 700;
    color: var(--ember-ink); font-variant-numeric: tabular-nums; }
  .monthhead { font-family: var(--display); font-size: 12px; font-weight: 700; letter-spacing: .11em;
    text-transform: uppercase; color: var(--muted); margin: 20px 0 8px; }

  /* ---------- body diagram ----------
     An anatomical figure, not a silhouette with blobs on it: the body is a quiet
     neutral and every muscle Spotter has a word for is its own shape on top of it,
     grey until something asks for it. Lit muscles are the one accent — full strength
     for primary, faint for secondary, and a four-step ramp on Progress. One hue
     throughout: a second colour would be a new claim on the eye for a distinction
     weight already tells. Swatches in the legend take the same classes as the paths,
     so the key can never drift from the figure. */
  .bodywrap { display: flex; justify-content: center; gap: 14px; padding: 2px 0 0; }
  .bodyfig { flex: 1 1 0; min-width: 0; max-width: 148px; text-align: center;
    animation: bodyin var(--t-4) var(--e-out) both; }
  @keyframes bodyin { from { opacity: 0; transform: scale(.955); } }
  .bodyfig svg.bodysvg { display: block; width: 100%; height: auto; overflow: visible; }
  .bodyskin { fill: var(--body-skin); stroke: var(--line-2); stroke-width: 1.1px;
    vector-effect: non-scaling-stroke; }
  .bodybox .bodymus, .bodybox .sw { fill: var(--body-mus); background-color: var(--body-mus);
    transition: fill var(--t-3) var(--e-out), background-color var(--t-3) var(--e-out),
      fill-opacity var(--t-3) var(--e-out), opacity var(--t-3) var(--e-out); }
  .bodybox .lit { fill: var(--ember); background-color: var(--ember); }
  /* One number, spent twice: fill-opacity on the figure, opacity on the legend's
     swatches. A path's own opacity takes its selection ring down with it, and the
     ring has to read on the faintest band as well as the brightest. */
  .bodybox .bodymus { fill-opacity: var(--o, 1); }
  .bodybox .sw { opacity: var(--o, 1); }
  .bodybox.s2 .lv1 { --o: .45; }
  .bodybox.s2 .lv2 { --o: 1; }
  /* Primary carries a rim as well as its weight, so the split survives a colour-blind
     eye and a bad screen. MuscleWiki hatches its primaries for the same reason; a rim
     is the version of that which does not turn ten regions into texture. */
  .bodybox.s2 .bodymus.lv2, .bodybox.s2 .sw.lv2 { stroke: var(--ember-ink);
    stroke-width: 1px; vector-effect: non-scaling-stroke;
    box-shadow: inset 0 0 0 1px var(--ember-ink); }
  .bodybox.s4 .lv1 { --o: .26; }
  .bodybox.s4 .lv2 { --o: .5; }
  .bodybox.s4 .lv3 { --o: .74; }
  .bodybox.s4 .lv4 { --o: 1; }
  .bodybox .bodymus { cursor: pointer; outline: none; }
  /* No one colour can ring a shape that might be any of eight fills: ink on a
     dark-mode ember is 2.3:1, and pale fails the other way at 1.2:1 on the
     untargeted grey. So the ring is a pair — an ink line with a paper halo outside
     it — and whichever half a fill swallows, the other stands at 4.8:1 or better,
     both schemes, all eight. .lit matches the primary's ember rim above for weight
     and comes after it, so a tapped primary wears this instead. */
  .bodybox .bodymus.sel, .bodybox .bodymus.sel.lit,
  .bodybox .bodymus:focus-visible, .bodybox .bodymus.lit:focus-visible {
    stroke: var(--ink); stroke-width: 2px; vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 1px var(--paper)) drop-shadow(0 0 1px var(--paper)); }
  .bodybox .bodymus.sel { animation: setpop var(--t-3) var(--e-spring);
    transform-box: fill-box; transform-origin: center; }
  .bodylbl { font-size: 11px; font-weight: 600; color: var(--muted); margin-top: 7px;
    text-transform: capitalize; }
  .bodylegend { display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
    gap: 5px 14px; margin: 15px 0 0; }
  .bodylegend .lg { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600;
    color: var(--ink-2); }
  .bodylegend .sw { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 3px;
    margin-right: 2.5px; }
  .bodylegend .sw:last-of-type { margin-right: 7px; }
  .bodypick { min-height: 34px; display: flex; align-items: center; justify-content: center;
    text-align: center; font-size: 12px; line-height: 1.45; color: var(--muted);
    margin: 9px 0 0; transition: color var(--t-2) var(--e-out); }
  .bodypick.on { color: var(--ink); font-weight: 550; }
  .bodynote { font-size: 12px; color: var(--muted); text-align: center; line-height: 1.5; margin: 10px 0 8px; }
  @media (prefers-reduced-motion: reduce) {
    .bodyfig, .bodybox .bodymus.sel { animation: none; }
    .bodybox .bodymus, .bodybox .sw, .bodypick { transition: none; }
  }

  /* ---------- workout mode ---------- */
  #workout { position: fixed; left: 0; right: 0; top: var(--vvtop); height: var(--vvh);
    z-index: 80; background-color: var(--paper);
    background-image: radial-gradient(140% 90% at 50% -10%, var(--ember-soft), transparent 62%), var(--grain);
    display: none; flex-direction: column; }
  #workout.open { display: flex; animation: fadein var(--t-3) var(--e-soft); }
  #workout.closing { display: flex; pointer-events: none;
    animation: fadeout var(--t-2) var(--e-in) both; }
  /* No global touch-action, on purpose: the pager needs WebKit to hold the scroll
     (see .pages). This overlay has no pager under it, so its controls can say they
     are taps — manipulation drops only double-tap zoom, and the wait for it. */
  #workout button { touch-action: manipulation; }
  /* Three columns rather than space-between, because the right-hand side gained a
     second button and the elapsed clock has to stay on the centre line anyway. */
  .wtop { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px;
    padding: calc(10px + env(safe-area-inset-top)) 16px 6px; }
  .wtools { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .wclock { font-family: var(--display); font-size: 14px; font-weight: 700; color: var(--muted);
    font-variant-numeric: tabular-nums; }
  .wdots { display: flex; gap: 5px; justify-content: center; flex-wrap: wrap; padding: 8px 20px 0; }
  .wdot { width: 6px; height: 6px; border-radius: 999px; background: var(--line-2);
    transition: background-color var(--t-2), transform var(--t-2) var(--e-out); }
  .wdot.on { background: var(--ember); transform: scale(1.4); }
  .wdot.done { background: var(--good); }
  .wmain { flex: 1; display: flex; flex-direction: column; justify-content: center;
    padding: 10px 26px; text-align: center; overflow-y: auto; }
  /* No touch-action, for the pager's reason: WebKit holds the vertical scroll
     until the non-passive touchmove has run, by which time app.ts has chosen the
     axis. .wmease is timing — on for the release, off while a finger holds it, so
     tracking is 1:1 and the let-go is the only thing that eases. */
  .wmain.wmease { transition: transform var(--t-2) var(--e-out), opacity var(--t-2) var(--e-out); }
  .wmain.wmin { animation: wmin var(--t-3) var(--e-out); }
  @keyframes wmin { from { opacity: 0; transform: translateX(var(--wmx, 30px)); } }
  .wblock { font-size: 12.5px; font-weight: 650; color: var(--ember-ink); margin-bottom: 12px; }
  .wname { font-family: var(--display); font-size: 32px; font-weight: 800; line-height: 1.12;
    letter-spacing: -.021em; margin: 0 0 12px; }
  .wdose { font-size: 16px; color: var(--ink-2); font-weight: 600; margin-bottom: 4px; }
  .wnote { font-size: 13.5px; color: var(--muted); line-height: 1.55; margin-top: 10px; }
  /* "last time · 3 × 10 at 60 lb · 5d ago" is a reference, not a headline: muted,
     one line, clipping rather than pushing the set pills down the screen. */
  .wlast, .setlast, .wup { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wlast { margin-top: 6px; }
  .setlast { margin: 0 0 2px; }
  .wlast:empty, .setlast:empty { display: none; }
  .setpills { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 22px 0 6px; }
  .setpill { border: 1px solid var(--line-2); background: var(--card); border-radius: 14px;
    padding: 10px 13px; min-width: 74px; font-size: 12px; color: var(--muted); font-weight: 600;
    line-height: 1.3; transition: transform var(--t-1) var(--e-out),
      background-color var(--t-2) var(--e-soft), border-color var(--t-2) var(--e-soft),
      color var(--t-2) var(--e-soft); }
  .setpill:active { transform: scale(.94); }
  .setpill b { display: block; font-family: var(--display); font-size: 15px; color: var(--ink);
    font-weight: 700; margin-bottom: 2px; font-variant-numeric: tabular-nums; }
  .setpill.done { background: var(--ember); border-color: var(--ember); color: var(--on-ember); }
  .setpill.done b { color: var(--on-ember); }
  /* An iOS PWA cannot answer this tap with a buzz — Safari has no
     Navigator.vibrate — so the picture is the whole receipt. */
  .setpill.just { animation: setpop var(--t-3) var(--e-out); }
  @keyframes setpop { 0% { transform: scale(.9); } 55% { transform: scale(1.05); } }
  /* A best is the one celebration lifters ask for: a ring and a longer pop, not
     confetti. The ring stays put — the point is it is still true ten minutes on. */
  .setpill.pr { box-shadow: 0 0 0 2px var(--paper), 0 0 0 3.5px var(--ember); }
  .setpill.just.pr { animation: setpr var(--t-4) var(--e-spring); }
  @keyframes setpr { 0% { transform: scale(.88); } 45% { transform: scale(1.09); } }
  .wactions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 18px; }
  .wbottom { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 16px calc(14px + var(--sab)); }
  .wnav { border: none; background: var(--sand); color: var(--ink); border-radius: 999px;
    width: 52px; height: 52px; font-size: 19px; display: flex; align-items: center; justify-content: center;
    transition: transform var(--t-1) var(--e-out); }
  .wnav:active { transform: scale(.9); }
  .wnav[disabled] { opacity: .35; }
  .wfinish { flex: 1; border: none; background: var(--ember); color: var(--on-ember); border-radius: 999px;
    padding: 15px; font-size: 15px; font-weight: 700; box-shadow: 0 4px 18px var(--glow);
    transition: transform var(--t-1) var(--e-out); }
  .wfinish:active { transform: scale(.978); }
  /* A rest has a known length, so the ring says what is left of it. The strip sits
     between the exercise and the bottom bar rather than inside the screen, so it
     outlives the swipe to the next movement; the ring is also the pause button,
     which is why it is 44px and not the 34 it looks like it needs. */
  .reststrip { display: none; align-items: center; justify-content: center; gap: 8px;
    padding: 0 16px 4px; animation: viewin var(--t-2) var(--e-out); }
  .reststrip.on { display: flex; }
  .reststrip.gone { animation: fadeout var(--t-2) var(--e-in) both; }
  .ring { position: relative; flex: 0 0 auto; width: 44px; height: 44px; padding: 0;
    border: none; border-radius: 999px; display: flex; align-items: center; justify-content: center;
    background: conic-gradient(var(--ember) calc(var(--rest, 1) * 1turn), var(--ember-soft) 0);
    transition: transform var(--t-1) var(--e-out); }
  .ring::after { content: ""; position: absolute; inset: 4px; border-radius: 999px;
    background: var(--paper); }
  /* z-index: ::after is the last child, so it paints over the number without it. */
  .ring span { position: relative; z-index: 1; font-size: 12px; font-weight: 700;
    color: var(--ember-ink); font-variant-numeric: tabular-nums; letter-spacing: -.03em; }
  .ring:active { transform: scale(.92); }
  /* Idle and paused share a look on purpose: both mean the clock is not moving. */
  .reststrip.paused .ring, .wtimer.idle .ring {
    background: conic-gradient(var(--line-2) calc(var(--rest, 1) * 1turn), var(--sand) 0); }
  .reststrip.paused .ring span, .reststrip.paused .restword,
  .wtimer.idle .ring span, .wtimer.idle .wphase { color: var(--muted); }
  .restword { font-size: 13px; font-weight: 650; color: var(--ember-ink); }
  /* Muted, and the strip says so instead of just going quiet. Grey, 14px, next to
     the word — a note, not a control; the control is in the top bar. */
  .wmute { display: none; width: 14px; height: 14px; color: var(--muted); margin-left: -2px; }
  .reststrip.muted .wmute { display: block; }
  .reststrip .chip { min-height: 44px; display: flex; align-items: center; }

  /* Rest stays above the controls while the exercise area remains scrollable. */
  .reststrip { flex-shrink: 0; margin: 8px 16px 0; padding: 14px; gap: 16px;
    border: 1px solid var(--ember); border-radius: 24px; background: var(--ember-soft); }
  .reststrip .ring { width: 88px; height: 88px; }
  .reststrip .ring::after { inset: 6px; }
  .reststrip .ring span { font-family: var(--display); font-size: 29px; }
  .restinfo { flex: 1; min-width: 0; }
  .restheading { display: flex; align-items: center; gap: 8px; }
  .restword { font-family: var(--display); font-size: 21px; font-weight: 750; }
  .resthint { color: var(--ink-2); font-size: 12px; margin: 4px 0 8px; }
  .restcontrols { display: flex; gap: 8px; }
  .restcontrols .chip { justify-content: center; padding: 8px 12px; background: var(--card); }
  .reststrip.paused { border-color: var(--line-2); background: var(--sand); }
  .wbottom { flex-shrink: 0; display: grid; grid-template-columns: 52px minmax(0, 1fr) 52px; }
  #waddexercise { grid-column: 2; grid-row: 1; min-height: 48px; }
  #wnext { grid-column: 3; grid-row: 1; }
  .wfinish { grid-column: 1 / -1; grid-row: 2; width: 100%; min-height: 60px; font-size: 18px; padding: 18px; border-radius: 18px; }
  .wmain { min-height: 0; justify-content: flex-start; }
  .wmain > * { flex-shrink: 0; }
  .wo-extra-set { min-height: 48px; width: 100%; margin-bottom: 10px; }

  /* ---------- adding a movement mid-workout ----------
     The picker is a list first and a form second, so the only chrome it gets is
     the field that filters it — the Library's own search field, in a band that
     stays put while the list scrolls under it: a couple of hundred movements is a
     long way to scroll back to change a word. */
  .woasearch { position: sticky; top: 0; z-index: 2; display: block;
    margin: 0 -20px 4px; padding: 2px 20px 10px;
    background: var(--paper); background-image: var(--grain); }
  .woasearch .searchico { left: 34px; top: 2px; bottom: 10px; }
  .woasearch .search { min-height: 44px; box-sizing: border-box; }
  .woahead { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    color: var(--muted); padding: 14px 2px 4px; }
  #woalist .pickrow { min-height: 52px; }
  .woaback { min-height: 44px; margin-bottom: 12px; }
  #woalast { margin: 6px 0 16px; }
  #woalast:empty, #woawhere:empty { display: none; }
  #woawhere { margin: 16px 0 4px; }
  #woawhere .wnote { margin: 0; }
  /* A switch drawn as a row, because it carries a sentence that changes with it. */
  .woakeep { min-height: 56px; margin-bottom: 4px; padding: 10px 13px;
    border: 1px solid var(--line-2); border-radius: 15px; background: var(--card);
    transition: border-color var(--t-2) var(--e-out), background-color var(--t-2) var(--e-out); }
  .woakeep.on { border-color: var(--ember); background: var(--ember-soft); }
  /* The filter, folded: one word above the list until it is wanted. */
  .woafilt { margin: 0 0 8px; }
  .woafilt > summary { padding: 10px 14px; min-height: 40px; }
  .woafilt .woahead { padding: 6px 2px 4px; }
  .woafilt .pillrow { margin-bottom: 4px; }
  /* The foot of the list, where Fitbod keeps the same action. Dashed, because it
     is an invitation and not one of the card's own exercises. */
  .waddcard { margin-top: 14px; padding: 13px; border: 1px dashed var(--line-2);
    border-radius: 18px; background: none;
    transition: background-color var(--t-2) var(--e-out), transform var(--t-1) var(--e-out); }
  .waddcard:active { transform: scale(.985); }
  .waddcard .ic { flex: 0 0 auto; color: var(--ember); }
  /* ---------- reps or time ----------
     The segment sits over the dose fields of both sheets. The fields under it
     trade places with a crossfade and nothing more — the tap did not say which
     way anything moved — and the row keeps its width, so nothing under the
     thumb jumps. */
  .doseseg { margin-bottom: 12px; }
  .dosefields.swap .field { animation: fadein var(--t-2) var(--e-out); }
  /* ---------- choosing a rest ----------
     Clock's timer wheel: two scroll-snapped columns over one rounded band, each
     unit fixed beside its column inside the band. Rows are 44px, not
     UIPickerView's 32pt, because a row is also a target (a tap brings it to the
     band). Five show in the rest sheet; three in the panes and the section
     sheet, where the wheel is one field among several. The spacers let the
     first and last rows reach the band. */
  .restpick { --wrow: 44px; --rows: 5; --wpad: calc(var(--wrow) * (var(--rows) - 1) / 2);
    max-width: 300px; margin: 0 auto; }
  .restpick.short { --rows: 3; }
  .wheel { position: relative; display: flex; -webkit-user-select: none; }
  .wband { position: absolute; inset: var(--wpad) 0 auto; height: var(--wrow);
    border-radius: 12px; background: var(--sand); }
  .wcol { position: relative; flex: 1; }
  .wsc { height: calc(var(--wrow) * var(--rows)); overflow-y: scroll; scroll-snap-type: y mandatory;
    overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: none; border-radius: 12px; }
  .wsc::-webkit-scrollbar { display: none; }
  .wsc::before, .wsc::after { content: ""; display: block; height: var(--wpad); }
  .wit { height: var(--wrow); line-height: var(--wrow); padding-right: 54%; text-align: right;
    scroll-snap-align: center; font-size: 22px; font-variant-numeric: tabular-nums; perspective: 300px; }
  .wit span { display: block; opacity: .35; transition: opacity var(--t-1) var(--e-out); }
  .wit.on span { opacity: 1; }
  .wunit { position: absolute; left: 54%; top: var(--wpad); line-height: var(--wrow);
    font-size: 15px; font-weight: 650; pointer-events: none; }
  .wfoot { display: flex; align-items: center; justify-content: space-between; min-height: 48px; }
  .wsay { font-size: 14px; font-weight: 650; color: var(--ink-2); }
  .wdef { transition: opacity var(--t-2) var(--e-out), visibility var(--t-2); }
  .wdef:disabled { opacity: 0; visibility: hidden; }
  /* The drum: each row's own trip through the column is its timeline, so its
     text tilts, closes up on the band and fades on WebKit's scroll, not on
     script. The row stays square and only its span moves, since a snap area is
     the transformed box. The keyframes are a cylinder sampled every row and a
     half of the five-row wheel; the three-row one reads the same curve as a
     smaller drum. Without it, and under reduced motion, the rows stay flat and
     only the one in the band is lit. */
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .wit { view-timeline: --wit; }
      .wit span { animation: wdrum linear both; animation-timeline: --wit; }
    }
  }
  @keyframes wdrum {
    0% { transform: translateY(-77%) rotateX(-75deg); opacity: 0; }
    25% { transform: translateY(-10%) rotateX(-37deg); opacity: .45; }
    50% { transform: none; opacity: 1; }
    75% { transform: translateY(10%) rotateX(37deg); opacity: .45; }
    100% { transform: translateY(77%) rotateX(75deg); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dosefields.swap .field { animation: none; }
    .wdef, .wit span { transition: none; }
    .woakeep, .waddcard { transition: none; }
    .waddcard:active { transform: none; }
  }
  .wtimer.resting { border: 1px solid var(--ember); border-radius: 24px; background: var(--ember-soft); padding: 16px; }
  .wtimer.resting .wphase { font-size: 22px; font-weight: 750; }
  @media (max-width: 350px) {
    .reststrip { gap: 10px; padding: 10px; }
    .reststrip .ring { width: 76px; height: 76px; }
    .restcontrols .chip { padding: 8px; }
  }

  /* ---------- a timed move ----------
     The rest ring again, at the size a countdown needs when the phone is on the
     floor and you are not, and doubling as the start/pause button. */
  .wtimer { display: flex; flex-direction: column; align-items: center; margin: 16px 0 2px; }
  .wtimer .ring { width: 164px; height: 164px; }
  .wtimer .ring::after { inset: 9px; }
  .wtimer .ring span { font-family: var(--display); font-size: 44px; font-weight: 800;
    letter-spacing: -.024em; color: var(--ink); }
  .wtimer .ring:active { transform: scale(.965); }
  .wphase { margin: 12px 0 0; }
  .wup { color: var(--ink-2); font-weight: 600; }
  .wstart { align-self: center; max-width: 280px; margin-top: 16px; }

  /* ---------- a complex, all at once ----------
     Five movements against a clock is ONE thing to do, so the screen holds all of
     it at once: the cap, the score, every movement in order, and a button wide
     enough to hit with a kettlebell still in the other hand. The dial is the rest
     ring again at a smaller 132 — the list below it is the substance here, and a
     164 clock pushed the round button off an 812pt screen. The rows are the picker
     list, which already draws a name over a detail with a check that fades in on
     .on, so a marked movement here is a checked row there and costs nothing. */
  .cxtitle { font-size: 19px; margin-bottom: 8px; }
  .cxhead { display: flex; align-items: center; justify-content: center; gap: 18px; }
  .wtimer.cap { margin: 0; }
  .wtimer.cap .ring { width: 104px; height: 104px; }
  .wtimer.cap .ring::after { inset: 7px; }
  .wtimer.cap .ring span { font-size: 27px; }
  .wtimer.cap .wphase { margin-top: 8px; }
  /* The last minute is the one people sprint. Ember, not louder. */
  .wtimer.cap.last .ring span { color: var(--ember-ink); }
  .cxscore { min-width: 0; text-align: left; }
  .cxscore b { display: block; font-family: var(--display); font-size: 42px; font-weight: 800;
    letter-spacing: -.035em; line-height: 1; color: var(--ember-ink);
    font-variant-numeric: tabular-nums; }
  .cxscore span { display: block; font-size: 13px; font-weight: 600; color: var(--ink-2);
    line-height: 1.35; margin-top: 4px; }
  .cxlist { display: flex; flex-direction: column; gap: 4px; margin-top: 14px; }
  .cxmove { min-height: 50px; padding: 7px 11px; border: 1px solid var(--line);
    background: var(--card); transition: transform var(--t-1) var(--e-out),
      background-color var(--t-2) var(--e-soft), border-color var(--t-2) var(--e-soft); }
  .cxmove:active { transform: scale(.985); }
  .cxmove.cur { border-color: var(--ember); }
  .cxmove.on { background: var(--ember-soft); border-color: var(--ember); }
  /* One line per movement, so five of them still leave room for the button. The
     one being done gets the whole of its line — the delta is the detail you want
     for the movement you are on, and clutter on the four you are not. */
  .cxmove .pt span { display: block; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .cxmove.cur .pt span { white-space: normal; }
  /* Muted on the ember wash measures 4.29:1, which is under AA. The detail line
     steps up to ink-2 on a marked row rather than the wash being lightened, so the
     row still reads as filled from across a gym. */
  .cxmove.on .pt span { color: var(--ink-2); }
  /* 64px because it is tapped mid-effort, by someone who is not looking at it. */
  .cxdone { min-height: 64px; margin-top: 14px; font-size: 17px; }
  .cxundo { min-height: 44px; margin-top: 8px; padding: 10px; font-size: 14px; }

  /* ---------- a superset, one screen ----------
     Every member on one screen and one of them open — the owner's accordion. A
     shut panel is Material's expansion-panel header, one line that summarises;
     the chevron is Apple's disclosure, sideways shut and down open, like every
     other disclosure here. The members are joined by a thin ember line down
     their letters — Strong's line down a superset's left — which the opaque
     cards cover, so it reads as a link in each gap between them. The fold is the
     0fr to 1fr grid row the demo slot already uses, the content fading inside. */
  .ssstack { position: relative; display: flex; flex-direction: column; gap: 10px;
    margin: 2px -10px 0; text-align: left; }
  .ssstack::before { content: ""; position: absolute; left: 27px; top: 28px; bottom: 28px;
    width: 2px; background: var(--ember); }
  .sspanel { position: relative; background: var(--card); border: 1px solid var(--line);
    border-radius: 18px; transition: border-color var(--t-2) var(--e-out); }
  .sspanel.open { border-color: var(--ember); }
  .sshead { min-height: 56px; padding: 8px 18px 8px 13px; border-radius: 17px; }
  .open > .sshead:active { background: none; }
  .ssletter, .sshead::after { flex: none; transition: all var(--t-2) var(--e-out); }
  .ssletter { width: 28px; height: 28px; border-radius: 99px; display: grid; place-items: center;
    font: 800 14px var(--display); background: var(--sand); color: var(--ink-2); }
  .sspanel.open .ssletter { background: var(--ember); color: var(--on-ember); }
  .sshead .pt span { display: block; font-size: 12px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .sscount { font-size: 13px; font-weight: 650; color: var(--muted); font-variant-numeric: tabular-nums; }
  .sspanel.done .sscount { color: var(--good); }
  .sshead::after { content: ""; width: 6px; height: 6px; border: solid var(--muted);
    border-width: 0 1.5px 1.5px 0; transform: rotate(-45deg); }
  .sspanel.open .sshead::after { transform: rotate(45deg); }
  .sswrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--t-3) var(--e-out); }
  .sspanel.open .sswrap { grid-template-rows: 1fr; }
  .ssbody { overflow: hidden; min-height: 0; }
  .ssin { padding: 0 14px 14px; text-align: center; opacity: 0; transform: translateY(-6px);
    transition: opacity var(--t-2) var(--e-out), transform var(--t-3) var(--e-out); }
  .sspanel.open .ssin { opacity: 1; transform: none; }
  .ssstack.hand .sswrap, .ssstack.hand .ssin { transition-delay: 90ms; }
  .ssin .setpills { margin: 12px 0 2px; }
  .ssin .stepper { margin: 8px 0; }
  .sslog { min-height: 54px; margin-top: 8px; }
  .ssin .wtimer .ring { width: 124px; height: 124px; }
  .ssin .wup { display: none; }
  .ssin .wstart { margin: 14px auto 0; }
  @media (prefers-reduced-motion: reduce) {
    .sspanel, .ssletter, .sshead::after, .sswrap, .ssin { transition: none; }
  }

  /* ---------- the session summary ----------
     Finishing used to be a toast, gone before the phone was back in the pocket.
     It is the one moment in the loop that is pure payoff, so it takes the screen
     it is already on. The figures and the bests are set pills, deliberately: the
     summary should speak in the same objects that were tapped all session. No
     confetti — the numbers are the reward, and lifters can tell the difference. */
  #workout.summary .wdots, #workout.summary .wbottom,
  #workout.summary .reststrip { display: none; }
  /* Hidden, not removed: the clock stays centred between the two top corners. */
  /* Both top-bar tools go quiet on the summary: there is no list left to open and
     no clock left to mute, and a control that does nothing is a small lie. */
  #workout.summary #wlist, #workout.summary #wsound { visibility: hidden; }
  /* ---------- the share card ----------
     The one thing a finished session can leave the phone as. Both card palettes
     live here rather than in the draw code, and both are written out in full so
     the card's theme stays the poster's choice and not the phone's scheme:
     ground, panel, ink, quiet ink, ember, hairline. */
  :root {
    --sc-dark: #0E1013 #171B20 #F2F5F8 #98A3AF #FF7A45 #2A3138;
    --sc-light: #F1F3F6 #FFFFFF #14171A #68727E #E8551F #E2E6EC;
  }

  .sumawards { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px 24px; }
  .sumawards:empty { display: none; }
  .sumawards .seal { flex: 0 1 140px; min-width: 0; }
  .sumfigs { margin-top: 20px; }
  .sumfigs .setpill b { font-size: 23px; letter-spacing: -.035em; }
  .sumfigs .setpill, .sumprs .setpill { animation: viewin var(--t-2) var(--e-out) both; }
  .sumfigs .setpill:nth-child(2) { animation-delay: 70ms; }
  .sumfigs .setpill:nth-child(3) { animation-delay: 140ms; }
  .sumprs { margin-top: 4px; }
  .sumprs .setpill { animation-delay: 210ms; }
  .sumprs .setpill b { color: var(--ember-ink); font-size: 12px; }
  .sumdone { margin-top: 24px; animation: viewin var(--t-3) var(--e-out) 260ms both; }
  /* The overflow exists only where there is something in it: a live session is
     ended by its own Save button and has nothing to delete yet. */
  #wmore { display: none; }
  #workout.summary.past #wmore { display: flex; }
  /* The receipt under the figures. Left-aligned inside a centred screen, because
     a column of "Set 3 / 205 lb" reads down its two edges and not down its middle. */
  .sumlog { text-align: left; margin-top: 18px; }
  .sumlog .session-exercise:last-child { border-bottom: 0; padding-bottom: 0; }
  /* The one line in it that was a record on the day, marked as the pill above is. */
  .session-set b.was { color: var(--ember-ink); }
  .sumprs:empty { display: none; }
  /* Redrawn by a correction: the same bests, not a new arrival. */
  .sumprs.still .setpill { animation: none; }
  /* Every set is a tap to correct it: a 44px row, pressed like a list cell. */
  .sumlog .session-set { width: calc(100% + 16px); min-height: 44px; margin: 0 -8px; padding: 0 8px; gap: 10px;
    align-items: center; border: 0; border-radius: 10px; background: none; color: var(--ink); font-size: 13px; }
  .sumlog .session-set:active { background: var(--sand); }
  .sumlog .session-set:focus-visible { outline: 2px solid var(--ember-ink); outline-offset: -2px; }
  .sumlog .session-set b { margin-left: auto; }
  .sumlog .session-set .ic { width: 14px; height: 14px; flex: none; color: var(--muted); }
  .sumlog .session-set.fixed { animation: setfix var(--t-4) var(--e-soft); }
  @keyframes setfix { from { background: var(--ember-soft); } }
  /* The open row: the set sheet's shape in a line, figure over unit. 18px type,
     because iOS zooms the page into any field set under 16. */
  .sedit { padding: 6px 0 12px; animation: fadeonly var(--t-2) var(--e-out); }
  .sedrow, .sedacts { display: flex; gap: 8px; }
  .sedrow > span, .sedx { flex: 1; padding-top: 13px; font-size: 13px; color: var(--ink-2); }
  .sedx { flex: none; font-style: normal; }
  .sedf { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
    color: var(--muted); white-space: nowrap; }
  .sedf input { width: 60px; height: 44px; padding: 0; border: 1px solid var(--line-2); border-radius: 12px;
    background: var(--paper); color: var(--ink); font: 700 18px var(--display); text-align: center; outline: none;
    appearance: none; }
  .sedf:last-child input { width: 76px; }
  .sedf input:focus { border-color: var(--ember); box-shadow: 0 0 0 3px var(--pill); }
  .sedacts { justify-content: flex-end; margin-top: 12px; }
  .sedacts .btn { width: auto; min-height: 44px; padding: 0 18px; font-size: 14.5px; box-shadow: none; }
  .sedel { display: flex; align-items: center; gap: 6px; min-height: 44px; margin-right: auto; padding: 0 4px; border: 0;
    background: none; color: var(--ember-ink); font-size: 14px; font-weight: 650; }
  .sedel .ic { width: 16px; height: 16px; }
  @media (prefers-reduced-motion: reduce) {
    .eachtag { transition: none; }
    .eachtag.flip, .sumlog .session-set.fixed { animation: none; }
  }
  /* The card's own row: a preview at the size of a thumbnail, the two themes
     beside it, and the buttons under both. The buttons are only added once the
     File exists, so one that says Share is one that can. */
  .sharewrap { margin-top: 22px; animation: viewin var(--t-2) var(--e-out) 250ms both; }
  .sharerow { display: flex; gap: 14px; }
  /* A button, because it opens the card full screen the way a thumbnail does in
     Photos. Padding off: the picture is the control, there is nothing around it. */
  .scprev { flex: 0 0 140px; width: 140px; height: 249px; border-radius: 16px; padding: 0;
    overflow: hidden; background: var(--sand); border: 1px solid var(--line);
    box-shadow: var(--sh-md); cursor: pointer;
    transition: transform var(--t-1) var(--e-out); }
  .scprev:active { transform: scale(.97); }
  .scprev:focus-visible { outline: 2px solid var(--ember-ink); outline-offset: 3px; }
  .scprev img { width: 100%; height: 100%; display: block; object-fit: cover; opacity: 0;
    transition: opacity var(--t-3) var(--e-out); }
  .scprev img.in { opacity: 1; }
  .scside { flex: 1; min-width: 0; display: flex; flex-direction: column;
    justify-content: center; gap: 12px; }
  /* Two to a row rather than one long line: four 44px targets across a 140px
     column would clip at 375px. */
  .scchips { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .scchip { min-width: 0; min-height: 44px; padding: 10px 4px; font-size: 13px;
    font-weight: 650; border: 1px solid var(--line-2); border-radius: 12px;
    background: var(--card); color: var(--ink-2);
    transition: background-color var(--t-2), border-color var(--t-2), color var(--t-2); }
  .scchip[aria-pressed="true"] { background: var(--pill); border-color: var(--ember);
    color: var(--ember-ink); }
  .schint { font-size: 11.5px; line-height: 1.45; color: var(--muted); }
  .scbtns { display: flex; flex-direction: column; gap: 9px; }
  .scbtns.in { margin-top: 14px; animation: viewin var(--t-2) var(--e-out) both; }
  .scbtns .btn { padding: 13px; font-size: 15px; }
  /* The clip's button is late by nature, and leaves and returns with the chip that
     asked for it, so it fades rather than appears. */
  .scvid { animation: viewin var(--t-2) var(--e-out) both; }
  @media (prefers-reduced-motion: reduce) {
    .sharewrap, .scbtns.in, .scvid { animation-name: fadeonly; animation-delay: 0ms; }
    .scprev img { transition: none; }
  }
  /* ---------- proof, in one screenshot ----------
     The card the summary drew, alone on the screen: no tab bar, no header, no
     buttons, nothing of the app at all — so one press of the phone's own screenshot
     buttons IS the proof, and a creator gets one image rather than a cropped
     thread of them. Above every other layer in the page, toast included.

     The picture app.ts hands this element is already drawn at the screen's own
     aspect, so it fills it. contain and not cover is the guard for when it is
     not — a window past the clamp, a rotation mid-view — because cropping is the
     one thing a proof cannot do; #proof carries the card's own ground colour
     behind it, set inline from the palette it was drawn in, so a fit that is
     not exact reads as bleed rather than as letterboxing. */
  #proof { position: fixed; inset: 0; z-index: 95; display: none;
    align-items: center; justify-content: center; background: var(--paper); }
  #proof.open { display: flex; animation: fadein var(--t-3) var(--e-soft); }
  #proof.closing { display: flex; pointer-events: none;
    animation: fadeout var(--t-2) var(--e-in) both; }
  #proof img { display: block; width: 100%; height: 100%; object-fit: contain; }
  /* Timing on for the release, off while a finger holds it: the dismissal tracks
     1:1 and only the let-go eases, which is the rule every sheet here follows. */
  #proof:not(.dragging) { transition: transform var(--t-2) var(--e-out),
    opacity var(--t-2) var(--e-out); }
  /* Said once, then out of the shot, and at the top because the bottom of a card
     laid out for this screen is where "Logged with Spotter" already is. It never
     takes the tap that dismisses. */
  .proofhint { position: absolute; left: 50%; top: calc(20px + env(safe-area-inset-top));
    transform: translateX(-50%); padding: 8px 15px; border-radius: 999px;
    background: rgba(0, 0, 0, .62); color: #FFF; font-size: 12px; font-weight: 600;
    white-space: nowrap; pointer-events: none;
    transition: opacity var(--t-4) var(--e-soft); }
  .proofhint.gone { opacity: 0; }
  /* Both animations here are opacity and nothing else, which the house rule keeps
     under reduced motion; they only get shorter. The release is what loses its
     easing, so a dismissal that was refused snaps home instead of springing. */
  @media (prefers-reduced-motion: reduce) {
    #proof.open { animation-duration: var(--t-2); }
    #proof.closing { animation-duration: var(--t-1); }
    #proof:not(.dragging) { transition: none; }
  }
  /* The clip, in a sheet, at the moment it is wanted. Shorter than the detail
     view's embed so the close button stays on screen with it. */
  #watchbody .embedwrap, #watchbody .dphoto { margin-bottom: 14px; }
  #watchbody .embedwrap.vertical iframe { height: 56vh; }
  /* #copysheet's word, needed here for its reason: with touch-action auto WebKit
     holds every tap 350ms for a possible second, and the second one that comes is
     a double tap — which Safari answers by zooming, having ignored
     user-scalable=no since iOS 10. That zoom is the jump when the plus is tapped
     a lot. The sheet is outside #workout, so that rule never reached it. */
  #setsheet button { touch-action: manipulation; }
  .stepper { display: flex; align-items: center; gap: 12px; justify-content: center; margin: 14px 0; }
  .stepper button { width: 46px; height: 46px; border-radius: 999px; border: 1px solid var(--line-2);
    background: var(--card); color: var(--ink); font-size: 20px; line-height: 1;
    transition: transform var(--t-1) var(--e-out); }
  .stepper button:active { transform: scale(.92); }
  /* A width, not a min-width: the value is the only thing between the two
     buttons, so whatever changes its box moves both. The field is the same box
     in the same face, so tapping to type moves nothing either. */
  .stepper .val { width: 96px; text-align: center; font-family: var(--display); font-size: 30px;
    font-weight: 700; letter-spacing: -.018em; font-variant-numeric: tabular-nums; }
  .stepper .val .num, .stepper .val .numin { font: inherit; letter-spacing: inherit;
    display: block; width: 100%; height: 34px; line-height: 34px; padding: 0; border: 0;
    border-radius: 0; background: none; color: var(--ink); text-align: center; }
  /* 34px is what the figure needs, 46 what a finger does. */
  .stepper .val .num { position: relative; }
  .stepper .val .num::after { content: ""; position: absolute; inset: -6px 0; }
  .stepper .val .numin { display: none; outline: none; appearance: none;
    caret-color: var(--ember); box-shadow: inset 0 -2px 0 var(--ember); }
  .stepper .val.editing .num { display: none; }
  .stepper .val.editing .numin { display: block; }
  .stepper .val small { display: block; font-size: 11px; font-weight: 600;
    color: var(--muted); margin-top: 4px; }
  /* "each": a tag on the unit rather than a longer unit, and the switch for it.
     Drawn 17px, answering 44 through ::after; the negative margins keep the line
     box, so the stepper does not move between a curl and a squat. Re-stated over
     .stepper button, which would make it a 46px circle. */
  .eachtag, .stepper .val .eachtag { position: relative; display: inline-block; width: auto; height: auto;
    margin: -3px 0 -3px 5px; padding: 3px 7px; border: 0; border-radius: 9px; background: var(--ember-soft);
    color: var(--ember-ink); font: 700 10.5px/1 var(--sans); transition: background-color var(--t-2), color var(--t-2); }
  .eachtag::after { content: ""; position: absolute; inset: -13px -6px; }
  .stepper .val .eachtag[hidden] { display: none; }
  .eachtag.one, .stepper .val .eachtag.one { background: var(--sand); color: var(--ink-2); }
  .eachtag.flip { animation: eachflip var(--t-3) var(--e-spring); }
  @keyframes eachflip { from { opacity: .4; transform: scale(.8); } }

  /* ---------- Pumpy ----------
     The coach's mark is currentColor everywhere it appears, so it takes the tab's
     muted/ember state and the avatar's ember-on-soft without extra rules. Chat
     bubbles borrow the card and accent surfaces; the proposal card is the one
     place the accent is used as a border, because it is the one thing on the
     screen asking for a decision. */
  .tab .ti svg { width: 21px; height: 21px; display: block; }
  .pmark { width: 28px; height: 28px; border-radius: 999px; background: var(--ember-soft); color: var(--ember-ink);
    display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .pmark svg { width: 100%; height: 100%; display: block; border-radius: inherit; }
  .noimg.pumpyimg { color: var(--ember); opacity: .9; }
  .noimg.pumpyimg svg { width: 46px; height: 46px; }
  /* Pumpy is a column inside its own scroller, ending exactly on the tab bar so
     the composer lands on it whether the thread is empty or endless. The page's
     usual bottom padding is overridden for that reason: sticky cannot push an
     element past its containing block, so any gap left below the column would
     become a gap under the composer. The log carries no min-height:0 on purpose —
     it has to be allowed to outgrow the column and make the page scroll, which is
     the whole difference between a chat and a list.
     The old note here said an inner scroller would break the iOS keyboard. It
     would have; fitViewport() in app.ts is what now handles that. */
  /* No bottom padding either, for the reason above: the composer's margin, not
     the scroller's padding, is what keeps the tab bar clear — otherwise the
     same disagreement decides whether the composer sits ON the tab bar or a
     whole tab bar's height above it. */
  #pumpyview { display: flex; flex-direction: column; padding-bottom: 0; }
  #pumpylog { display: flex; flex-direction: column; gap: 10px; padding: 6px 0 14px; flex: 1 1 auto; }
  #pumpylog.hello { justify-content: center; }
  /* Stuck under the header for a whole conversation, at the leading edge where
     Apple pins the sidebar toggle and will not let it be customised away: the way
     out of a thread cannot be something you scroll back up to find. Icon only, a
     capsule in the header's glass, over the messages and under the sheets. */
  .pumpybar { position: sticky; top: calc(var(--hdr, 92px) + 6px); z-index: 5;
    align-self: flex-start; display: flex; gap: 2px; margin: 6px 0 8px; padding: 0 3px;
    border-radius: 999px;
    box-shadow: 0 0 0 1px var(--line), var(--sh-sm);
    background: color-mix(in srgb, var(--paper) 82%, transparent);
    -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  .pumpybar button { width: 44px; height: 44px; font-size: 19px; border: none;
    background: none; border-radius: 999px; color: var(--ink-2); display: grid;
    place-items: center; transition: transform var(--t-1) var(--e-out),
      background-color var(--t-2) var(--e-soft); }
  .pumpybar button:active { transform: scale(.9); background: var(--sand); color: var(--ink); }
  @media (prefers-reduced-motion: reduce) { .pumpybar button { transition: none; } }
  .pumpyhello { text-align: center; padding: 22px 12px 8px; color: var(--ink-2); font-size: 14px; line-height: 1.6; }
  .pumpyhello .pmark { width: 60px; height: 60px; margin: 0 auto 12px; box-shadow: var(--sh-md); }
  .pumpyhello .pmark svg { width: 34px; height: 34px; }
  .pumpyhello h2 { font-family: var(--display); font-size: 22px; font-weight: 700; margin: 0 0 6px; color: var(--ink);
    letter-spacing: -.015em; }
  .pumpyhello p { margin: 0 auto; max-width: 340px; }
  .quick { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 16px 0 4px; }
  /* The library chips refuse to shrink; these have to, or a long ask runs off both
     edges of the phone instead of wrapping. */
  .quick .chip { flex: 0 1 auto; max-width: 100%; white-space: normal; text-align: left;
    line-height: 1.3; padding: 9px 13px; }
  .msgrow { display: flex; gap: 8px; align-items: flex-end; max-width: 92%; }
  .msgcol { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .reportresponse { align-self: flex-start; min-height: 44px; padding: 8px 0;
    border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px;
    text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .reportresponse[data-armed="1"] { color: var(--ember-ink); }
  .reportresponse:disabled { cursor: default; text-decoration: none; }
  .msg { padding: 11px 14px; border-radius: 18px; font-size: 14.5px; line-height: 1.55; white-space: pre-wrap;
    word-break: break-word; }
  .msg.me { align-self: flex-end; max-width: 86%; background: var(--ember); color: var(--on-ember);
    border-bottom-right-radius: 6px; box-shadow: 0 3px 12px var(--glow); }
  .msg.pumpy { background: var(--card); border: 1px solid var(--line); box-shadow: var(--sh-sm);
    border-bottom-left-radius: 6px; color: var(--ink); }
  /* Three dots that do not move read as a bubble that broke, not as thinking.
     Opacity only, so it costs the compositor nothing while a model is answering. */
  .msg.typing { display: flex; align-items: center; gap: 5px; padding: 15px 16px; }
  .msg.typing i { width: 6px; height: 6px; border-radius: 999px; background: var(--muted);
    animation: typedot 1.2s var(--e-soft) infinite; }
  .msg.typing i:nth-child(2) { animation-delay: .18s; }
  .msg.typing i:nth-child(3) { animation-delay: .36s; }
  @keyframes typedot { 0%, 65%, 100% { opacity: .3; } 30% { opacity: 1; } }
  .msgin { animation: msgin var(--t-3) var(--e-out); }
  @keyframes msgin { from { opacity: 0; transform: translateY(9px); } }
  /* What the coach is doing while a tool runs; it gives way to the words. */
  .msgstatus { font-size: 12.5px; color: var(--ink-2); line-height: 1.4; padding: 2px 4px;
    animation: msgin var(--t-2) var(--e-out); }
  /* Without a caret a paused stream and a finished one look the same. Opacity
     only, so it costs the compositor nothing while words are arriving. */
  .msg.pumpy.live::after { content: ""; display: inline-block; width: 7px; height: 14px;
    margin-left: 2px; vertical-align: -2px; border-radius: 2px; background: var(--ember);
    animation: caret 1.05s var(--e-soft) infinite; }
  @keyframes caret { 0%, 45% { opacity: 1; } 55%, 100% { opacity: .18; } }
  .proposal { background: var(--card); border: 1.5px solid var(--ember); border-radius: 18px; padding: 14px 16px 12px;
    box-shadow: var(--sh-md); }
  .proposal h4 { font-family: var(--display); font-size: 12.5px; font-weight: 700;
    color: var(--ember-ink); margin: 0 0 8px; }
  .proposal .ptitle { font-family: var(--display); font-size: 18px; font-weight: 700; letter-spacing: -.012em;
    margin: 0 0 4px; line-height: 1.2; }
  .proposal .pmeta { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .proposal .pblock { font-size: 11.5px; font-weight: 600; color: var(--muted); margin: 10px 0 2px; }
  .proposal .pline { font-size: 13.5px; line-height: 1.5; color: var(--ink-2); padding: 6px 0;
    border-top: 1px solid var(--line); }
  .proposal .pline b { color: var(--ink); font-weight: 650; }
  /* Which saved video a proposed line came from, before the user says yes. */
  .proposal .pfrom { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .proposal .btnrow { margin-top: 12px; }
  .proposal .btnrow .btn { padding: 12px; font-size: 14.5px; }
  .proposal .done { color: var(--good); font-weight: 700; font-size: 13px; margin-top: 10px;
    display: flex; align-items: center; gap: 5px;
    animation: donein var(--t-3) var(--e-out); }
  .proposal .done .ic { width: 15px; height: 15px; }
  .proposal .declined { color: var(--muted); font-size: 13px; margin-top: 10px;
    animation: donein var(--t-3) var(--e-out); }
  @keyframes donein { from { opacity: 0; transform: translateY(-5px); } }
  .composer { position: sticky; bottom: var(--ptab, calc(78px + var(--sab)));
    margin-bottom: var(--ptab, calc(78px + var(--sab)));
    padding: 8px 0 10px;
    background: color-mix(in srgb, var(--paper) 90%, transparent);
    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
  /* Keyboard up: #app follows the visual viewport but .tabbar, fixed to the layout
     one, is behind the keys — so the composer's clearance for the bar is a margin
     below nothing. Sit it on the app's own bottom edge and take the bar out of the
     way, as a native chat app does. The browser and the Android shell, whose frame
     really does end at the keyboard; the iOS shell's does not (kb-over, below). */
  html:not(.kb-over) body.kb .composer { bottom: 0; margin-bottom: 0; }
  html:not(.kb-over) body.kb .page { padding-bottom: 24px; }
  body.kb .tabbar { visibility: hidden; }
  /* The Android webview ends at the keyboard; there is no home indicator there.
     Restore the real device inset automatically when the keyboard closes. */
  html.native { --vvh: 100%; --sab: env(safe-area-inset-bottom); }
  html.native:not(.kb-over):has(body.kb) { --sab: 0px; }
  html.native input, html.native textarea { scroll-margin-block: 16px; }
  /* Android resizes the outer frame. Animate only the web content's keyboard
     clearance, so the composer and form padding do not snap ahead of it. */
  html.native.keyboard-moving:not(.kb-over) .composer {
    transition: bottom var(--keyboard-duration) var(--keyboard-curve),
      margin-bottom var(--keyboard-duration) var(--keyboard-curve); }
  html.native.keyboard-moving:not(.kb-over) .page {
    transition: padding-bottom var(--keyboard-duration) var(--keyboard-curve); }
  html.native.keyboard-moving:not(.kb-over) .sheetbody {
    transition: padding-bottom var(--keyboard-duration) var(--keyboard-curve),
      transform var(--t-2) var(--e-in); }
  html.native.keyboard-moving:not(.kb-over) .sheet.open .sheetbody {
    transition: padding-bottom var(--keyboard-duration) var(--keyboard-curve),
      transform .38s var(--e-spring); }
  html.native .tabbar { visibility: visible; opacity: 1;
    transition: opacity var(--keyboard-duration, .25s) var(--keyboard-curve, ease-in-out); }
  html.native body.kb .tabbar { visibility: visible; opacity: 0; pointer-events: none; }
  /* ---------- the keyboard over a still frame (the iOS shell) ----------
     The web view keeps its full height and the keys slide over it, so nothing
     re-lays out while they move. The surface that owns the field rides up on a
     translate — its own property, so it composes with the transform the sheets
     open, close and drag on — for app.ts's --lift, over UIKit's own duration and
     curve (keyboard.js), on the keys' own timeline: --kd is how long they had
     been moving when the page heard, so the lift starts that far in. All three
     live on the moving element, never the root. Individual transform
     properties are composited in WebKit, so a busy main thread cannot stall them
     (checked in the Simulator with a 500ms busy loop mid-lift). */
  html.kb-over .sheetbody { translate: 0 calc(-1 * var(--lift, 0px));
    transition: transform var(--t-2) var(--e-in),
      translate var(--kt, 0s) var(--ke, ease) var(--kd, 0s); }
  html.kb-over .sheet.open .sheetbody {
    transition: transform .38s var(--e-spring),
      translate var(--kt, 0s) var(--ke, ease) var(--kd, 0s); }
  html.kb-over .sheet.open .sheetbody.dragging {
    transition: translate var(--kt, 0s) var(--ke, ease) var(--kd, 0s); }
  html.kb-over .composer { translate: 0 calc(-1 * var(--lift, 0px));
    transition: translate var(--kt, 0s) var(--ke, ease) var(--kd, 0s); }
  /* The iOS 26 keyboard is glass, and with the frame no longer ending at the keys
     whatever the page draws under them shows through: the dimmed workout, Save
     workout's orange smeared across the number pad. A sheet of paper rides up
     under the keys on their own curve instead — what the shell's own paper showed
     there when the frame stopped at the keyboard — above every sheet and below
     the toast. At rest it waits below the screen, a layer already, so the first
     frame of a keyboard does not have to build one. */
  .kbback { display: none; }
  html.kb-over .kbback { display: block; position: fixed; left: 0; right: 0; top: 100%;
    height: 100%; z-index: 89; background: var(--paper); pointer-events: none;
    will-change: translate; translate: 0 calc(-1 * var(--lift, 0px));
    transition: translate var(--kt, 0s) var(--ke, ease) var(--kd, 0s); }
  @media (prefers-reduced-motion: reduce) {
    html.native.keyboard-moving .composer, html.native.keyboard-moving .page,
    html.native.keyboard-moving .sheetbody, html.native.keyboard-moving .sheet.open .sheetbody,
    html.native .tabbar, html.kb-over .sheetbody, html.kb-over .sheet.open .sheetbody,
    html.kb-over .sheet.open .sheetbody.dragging, html.kb-over .composer,
    html.kb-over .kbback { transition: none; }
  }
  .composerrow { display: flex; gap: 8px; align-items: flex-end; }
  .composer textarea { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px;
    font-size: 16px; line-height: 1.4; background: var(--card); color: var(--ink); outline: none; resize: none;
    max-height: 138px; overflow-y: auto; transition: border-color var(--t-2); }
  .composer textarea:focus { border-color: var(--ember); }
  .composer .addbtn { width: 44px; height: 44px; border-radius: 15px; font-size: 20px; }
  .composer .addbtn[disabled] { opacity: .4; box-shadow: none; }
  .pumpycredits { font-size: 11.5px; color: var(--muted); margin: 0 0 7px 6px; line-height: 1.4; }
  /* Six of these wrap rather than run off the phone. Half a row each, so six is
     three rows and not six: at full width one long title per line turned the
     composer into a third of the screen. The cap is the backstop for a phone
     with larger text, and it scrolls rather than pushing the box off-screen. */
  .pumpyctx { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px;
    color: var(--ink-2); margin: 0 0 8px 2px; max-height: 118px; overflow-y: auto;
    /* A wrapped flex box counts the gap after its last row as overflow, so three
       rows that fit are still six scrollable pixels. Hidden the way every other
       strip in here hides one, rather than let a bar sit beside two chips. */
    scrollbar-width: none; }
  .pumpyctx::-webkit-scrollbar { display: none; }
  .refchip { display: inline-flex; align-items: center; gap: 5px; max-width: calc(50% - 5px);
    background: var(--sand); border-radius: 999px; padding: 5px 5px 5px 11px; }
  .refchip b { color: var(--ink); font-weight: 650; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .pumpyctx button { border: none; background: var(--line); color: var(--ink-2); border-radius: 999px;
    width: 22px; height: 22px; font-size: 14px; line-height: 1; flex: 0 0 auto; }
  .pumpyctx button .ic { width: 12px; height: 12px; }
  /* 22px of ink, 44px of finger — the shared rule below gives every small button
     34px, and a chip that will not let go of a workout is worse than a wide one. */
  .pumpyctx .refchip button::after { inset: -11px; }
  .refchip.in { animation: chipin var(--t-2) var(--e-out); }
  .refchip.gone { animation: chipout var(--t-2) var(--e-in) forwards; }
  @keyframes chipin { from { opacity: 0; transform: scale(.86); } }
  @keyframes chipout { to { opacity: 0; transform: scale(.86); } }
  /* #picksheet's list with a state: a check mark that stays, per the HIG. */
  .pickrow .ck { width: 20px; flex: 0 0 auto; color: var(--ember); opacity: 0;
    transition: opacity var(--t-1) var(--e-out); }
  .pickrow .ck .ic { width: 18px; height: 18px; display: block; }
  .pickrow.on .ck { opacity: 1; }
  .pickrow.on .pt b { color: var(--ember-ink); }
  .pickrow[disabled] { opacity: .42; }
  #reflist { max-height: 46vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  #refsheet .newcol { margin: 0 0 8px; }
  /* One conversation per row: the thread on the left, a two-tap delete on the
     right, the open one marked in ember. */
  .threadrow { display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--line); }
  .threadrow:first-child { border-top: none; }
  .threadrow .tmain { flex: 1; min-width: 0; border: none; background: none; text-align: left;
    padding: 12px 8px; border-radius: 13px; color: var(--ink); }
  .threadrow .tmain:active { background: var(--sand); }
  .threadrow .tmain b { display: block; font-size: 14px; font-weight: 600; line-height: 1.35;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .threadrow .tmain span { display: block; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .threadrow.on .tmain b { color: var(--ember-ink); }
  /* No cached list to take a height from, so three grey rows stand in at the REAL
     row height — the point is that the sheet never resizes once it is moving. The
     numbers are a real row's line boxes: 1.35em the title's line-height, 14px the
     second line's. */
  .threadrow.skel .tmain b, .threadrow.skel .tmain span {
    background: var(--line-2); border-radius: 6px; animation: skelfade 1.5s var(--e-soft) infinite; }
  .threadrow.skel .tmain b { width: 62%; height: 1.35em; }
  .threadrow.skel .tmain span { width: 40%; height: 14px; }
  @keyframes skelfade { 50% { opacity: .42; } }
  /* A thread slower than the sheet: the conversation you were reading stays and
     goes quiet rather than being replaced by an empty log. */
  #pumpylog { transition: opacity var(--t-2) var(--e-soft); }
  #pumpylog.waiting { opacity: .42; }
  #pumpylog.resetting { transition: none; overflow-anchor: none; }
  .threadrow .tdel { flex: 0 0 auto; border: none; background: none; color: var(--muted);
    font-size: 12px; font-weight: 600; padding: 11px 8px; border-radius: 999px; }
  .threadrow .tdel[data-armed="1"] { color: var(--ember-ink); }
  .threadnone { font-size: 13.5px; color: var(--muted); padding: 10px 0 4px; line-height: 1.6; }
  .setnote { font-size: 12.5px; color: var(--muted); line-height: 1.5; padding: 6px 4px 0; }
  /* One allowance per line under Plan. The label stays quiet and the count is the
     only thing with weight, so the four rows read as a column of numbers rather
     than four sentences. An exhausted one turns ember — the same colour every
     other "you have reached something" in the app uses — and only the number
     turns, because the label is still true. */
  .setnote .usel { padding: 1px 0; }
  .setnote .usel b { color: var(--ink-2); font-weight: 600; font-variant-numeric: tabular-nums; }
  .setnote .usel.out, .setnote .usel.out b { color: var(--ember-ink); }
  .setnote .usel .nobr { white-space: nowrap; }
  /* The colophon. Quiet on purpose — it is the last thing in the sheet, not an
     invitation to leave. */
  .setnote.foot { text-align: center; margin-top: 18px; }
  .setnote.foot a { color: var(--muted); }

  /* ---------- settings as a grouped list ----------
     Five inset cards with a header over each, which is what iOS Settings and every
     fitness app worth copying does, and what turns a scroll of twenty unrelated
     rows into five short answers. The header keeps caps and tracking because a
     section head is STRUCTURE — it is doing the work of a rule.
     Rows are full-bleed inside their card so the press highlight and the hairline
     both run the whole width; 44px minimum, whatever the row holds. */
  .seth { font-family: var(--display); font-size: 11.5px; font-weight: 700; letter-spacing: .07em;
    text-transform: uppercase; color: var(--muted); margin: 22px 0 8px 4px; }
  .setgroup { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    overflow: hidden; box-shadow: var(--sh-sm); }
  /* The padding is on the rows, not the group, so a row is genuinely full width:
     the hairline and the press highlight both run edge to edge, and a button — which
     shrink-to-fits by default and so needs width: 100% — measures the right thing. */
  .setgroup .kv { min-height: 44px; box-sizing: border-box; padding: 12px 15px;
    border-top: 1px solid var(--line); }
  .setgroup > :first-child.kv { border-top: none; }
  /* The label holds its line and the value gives way: "Saved today" wrapping to two
     lines to make room for a usage string that gets truncated anyway is the worst
     of both. */
  .setgroup .kv .k { white-space: nowrap; }
  .setgroup .kv .v { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The tappable ones. A row that opens a sheet is navigation, so it wears the
     disclosure chevron; a row that only reports a value does not, and setting
     [disabled] on it (a provider account cannot change its own email) turns it
     back into that plain row rather than dimming it. */
  /* border: none first — a button carries a UA border on the three sides .kv never
     names, and inside a group that drew a box around every tappable row. */
  a.kv.row, button.kv.row { display: flex; width: 100%; background: none; font: inherit;
    color: inherit; text-align: left; text-decoration: none; border: none; border-radius: 0;
    border-top: 1px solid var(--line);
    transition: background-color var(--t-1) var(--e-out); }
  a.kv.row:active, button.kv.row:not([disabled]):active { background: var(--sand); }
  /* A stepper, not a cycling chip: seven taps to walk 3 round to 2 is not a
     control. Apple's Activity goal is a stepper for the same reason. */
  .goalset { display: flex; align-items: center; gap: 4px; }
  .goalset .chip { min-width: 32px; padding: 6px 0; justify-content: center; font-size: 15px; }
  .goalset .chip[disabled] { opacity: .38; }
  .goalset b { min-width: 20px; text-align: center; }
  /* The reminder row holds a time and a switch. A native time input rather than a
     wheel of our own: it is the control the phone already knows how to show, it
     is localised and accessible for free, and iOS gives it the same picker every
     alarm in the OS uses. Stripped back to the app's own type so it reads as a
     value in the row, not as a form field dropped into one. */
  .remset { display: flex; align-items: center; gap: 8px; }
  .remtime { font: inherit; font-weight: 650; font-variant-numeric: tabular-nums;
    color: var(--ink); background: var(--sand); border: none; border-radius: 999px;
    padding: 7px 10px; min-height: 32px; -webkit-appearance: none; appearance: none;
    transition: opacity var(--t-2) var(--e-soft); }
  .remtime::-webkit-date-and-time-value { text-align: right; margin: 0; }
  .remtime::-webkit-calendar-picker-indicator { display: none; }
  /* Off is not a disabled state, so the switch keeps full contrast; a row that
     genuinely cannot work — Safari with no PushManager, or a permission the user
     turned off in the OS — dims, and the note under the group says why. */
  .remtime[disabled], #remplan[disabled], #remrisk[disabled] { opacity: .38; }
  @media (prefers-reduced-motion: reduce) { .remtime { transition: none; } }
  .kv .chev { flex: 0 0 auto; width: 16px; height: 16px; color: var(--line-2); margin-right: -3px; }
  .kv.row[disabled] .chev { display: none; }
  .kv.del .k { color: var(--ember-ink); font-weight: 650; }
  .kv.del .chev { color: var(--ember-ink); opacity: .55; }
  /* Sign out ends the Account section rather than the sheet, so it is a secondary
     button with air above it, not a link lost in the colophon. */
  .setout { margin-top: 12px; }
  /* The one destructive button in the app. --ember-ink is the only red the system
     has; --paper on it measures 5.6:1 light and 8.4:1 dark, so the word survives
     both schemes without a second colour being invented for it. */
  .btn.del { background: var(--ember-ink); color: var(--paper); box-shadow: none; }
  /* The same box that carries an auth error, carrying good news instead: a reset
     link on its way, or an account that is gone. */
  .autherr.ok { color: var(--good); }

  /* ---------- the keyboard ring ----------
     Three controls in the whole app showed one. :focus-visible, so a thumb never
     sees it and a Tab key always does; the outline follows each control's own
     border-radius, so it fits a pill as well as it fits a square. */
  button:focus-visible, a:focus-visible, [role="button"]:focus-visible, select:focus-visible, .wsc:focus-visible {
    outline: 2px solid var(--ember); outline-offset: 2px; }
  /* The body map draws its own: an outline round a muscle's bounding box would be
     a rectangle over the figure. */
  .bodybox .bodymus:focus-visible { outline: none; }

  /* ---------- reach ----------
     Apple asks for 44px; these are drawn smaller because their rows are. Only the
     hit area grows, capped at the gap to the next control so no two overlap.
     Insets come off the padding box: a bordered control needs a pixel more. */
  .iconbtn, .addbtn, .exhelp, .planx, .planadd, .mbtn, .addex, .danger, .libcount,
  .planlegal a, .planlegal button, .segbtn, .planbtn, .linkbtn,
  .chips .chip, .said .chip, .votes .chip, .pumpyctx button, .threadrow .tdel, .ttitle { position: relative; }
  .iconbtn::after, .addbtn::after, .exhelp::after, .planx::after, .planadd::after,
  .segbtn::after, .planbtn::after, .linkbtn::after,
  .mbtn::after, .addex::after, .danger::after, .chips .chip::after, .said .chip::after,
  .votes .chip::after,
  .pumpyctx button::after, .threadrow .tdel::after, .ttitle::after,
  .libcount::after, .planlegal a::after, .planlegal button::after { content: ""; position: absolute; }
  .libcount::after { inset: -9px; }
  .planlegal a::after, .planlegal button::after { inset: -11px -4px; }
  .iconbtn::after { inset: -3px; }
  .addbtn::after { inset: -2px; }
  .exhelp::after { inset: -7px -6px; }
  .planx::after { inset: -7px -4px; }
  .planadd::after, .addex::after { inset: -5px 0; }
  .segbtn::after, .planbtn::after { inset: -6px 0; }
  /* "All" is two letters and drew a 20x27 target — the smallest control in the
     app. Nothing interactive sits beside it in the section head, so it can have
     the room on all four sides: 44 across and 45 down. */
  .linkbtn::after { inset: -9px -12px; }
  .mbtn::after { inset: -6px 0; }
  .danger::after, .threadrow .tdel::after { inset: -3px 0; }
  .chips .chip::after, .said .chip::after, .votes .chip::after { inset: -6px 0; }
  /* A square control needs the inset on all four sides: 36 + 4 + 4 is 44 across as
     well as down, and -6px 0 would have left the thumbs 36 wide and 28 tall. */
  .votes .vote::after { inset: -4px; }
  .pumpyctx button::after { inset: -7px; }
  /* Up into the label, which is text and not a control; down to the dose line. */
  .ttitle::after { inset: -14px 0 -5px; }

  /* ---------- install hint ---------- */
  #hint { margin: 12px 18px 0; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; padding: 13px 15px; font-size: 13px; line-height: 1.55; color: var(--ink-2);
    display: none; align-items: flex-start; gap: 11px; box-shadow: var(--sh-sm); }
  #hint.show { display: flex; }
  #hint b { color: var(--ink); }
  /* The dismiss cross only. "Phone save options" is a button in the same box,
     appended after this rule was written, and #hint button was dressing it as a
     17px glyph with no padding, jammed against the sentence above it. */
  #hintx { background: none; border: none; color: var(--muted); font-size: 17px; padding: 0 2px;
    line-height: 1; flex: 0 0 auto; }

  /* ---------- reduced motion, in one place ----------
     Apple's instruction is not "remove the feedback" but "replace transitions in
     x, y and z with fades": entrances keep opacity and lose travel, decorative
     loops stop, informative ones stay. */
  @keyframes fadeonly { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .viewin, .carditem.in, .msgin, .bodyfig, .reststrip, .sumdone,
    .sumfigs .setpill, .sumprs .setpill, .sharewrap, .scbtns.in, .scvid,
    .proposal .done, .proposal .declined {
      animation-name: fadeonly; animation-duration: var(--t-2); animation-delay: 0ms; }
    #workout.closing, .reststrip.gone {
      animation: fadeout var(--t-1) var(--e-soft) both; }
    /* The staggered summary is :nth-child, which outranks the rule above it. */
    .sumfigs .setpill:nth-child(n) { animation-delay: 0ms; }
    /* Fade kept, travel gone; the compounds repeat or the rules above outrank. */
    .overlay, .overlay.open, .overlay.closing { transform: none;
      transition-duration: var(--t-2); }
    /* The edge swipe still leaves; it fades out where it stands. */
    .overlay.edgeout { transform: none; opacity: 0; transition: opacity var(--t-2) var(--e-soft); }
    .sheetbody, .sheet.open .sheetbody { transform: none; transition: none; }
    /* The press still answers, it just answers at once. */
    .stepper button { transition: none; }
    /* The exercise still changes and says so, crossfading rather than sliding.
       The drag moves nothing at all: app.ts asks lessMotion() first. */
    .wmain.wmease { transition: none; }
    .wmain.wmin { animation-name: fadeonly; animation-duration: var(--t-2); }
    /* A marked movement still fills and still ticks; it just does it at once. */
    .cxmove { transition: none; }
    /* The travel stays: it is the gesture itself. The spring goes. */
    .exmain, .exacts, .exact {
      transition-duration: var(--t-1); transition-timing-function: var(--e-soft); }
    .setpill.just, .setpill.just.pr,
    .empty .big, .thumbwrap.pending .noimg, .thumbwrap.failed .noimg,
    .thumbwrap.loading::after, .thumbwrap.pending::after { animation: none; }
    /* The dots stop but stay: they are the only thing saying an answer is coming.
       The caret stays for the same reason — it says the words are not finished. */
    .msg.typing i { animation: none; opacity: .6; }
    .msg.pumpy.live::after { animation: none; opacity: .55; }
    .msgstatus, .refchip.in { animation-name: fadeonly; animation-duration: var(--t-2); }
    /* The chip still has to leave before the row behind it moves: fade, no travel. */
    .refchip.gone { animation-name: fadeout; animation-duration: var(--t-1); }
    .thumbwrap img { transition: none; }
    /* The bars stay — they are the shape of the list, not a moving part. */
    .threadrow.skel .tmain b, .threadrow.skel .tmain span { animation: none; }
    #ptr.back { transition-duration: var(--t-1); }
  }
  /* Pumpy's drawings are printed on warm stock. One small illustration per
     surface keeps the orange in the character, and the rest of the UI quiet. */
  .pumpyart { display: block; flex: 0 0 auto; width: 152px; height: 152px;
    margin: 0 auto 20px; overflow: hidden; border-radius: 32px;
    background: #F5F1E8; box-shadow: 0 0 0 1px var(--line); }
  .pumpyart img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .pumpyart.artfailed { display: none; }
  .pumpyhello .pumpyart { width: 140px; height: 140px; margin-bottom: 16px; }
  /* An unavailable drawing must not move the greeting halfway through its entrance. */
  .pumpyhello .pumpyart.artfailed { display: block; visibility: hidden; }
  #workout.summary .pumpyart { width: 88px; height: 88px; border-radius: 22px; margin-bottom: 12px; }
  #workout.summary .wmain { justify-content: flex-start; align-items: center;
    padding: 22px 20px calc(28px + env(safe-area-inset-bottom)); }
  #workout.summary .wmain > :not(.pumpyart) { max-width: 440px; width: 100%; }
  #workout.summary .sharewrap { text-align: center; }
  #workout.summary .sharerow { align-items: center; justify-content: center; }
  #workout.summary .scside { flex: 0 1 220px; }
  @media (max-width: 380px) {
    #workout.summary .sharerow { flex-direction: column; }
    #workout.summary .scprev { flex: none; }
    #workout.summary .scside { flex: auto; width: 100%; }
  }
  #workout.summary .wmain > * { flex-shrink: 0; }
  #guideclose { width: 44px; height: 44px; }
  .pmark { overflow: hidden; background: #F5F1E8; }
  #pumpytab svg { border-radius: 50%; }
  .pumpyimg svg { border-radius: 50%; width: 72px; height: 72px; }
  .pumpy-tip { position: relative; display: flex; align-items: center; gap: 12px;
    text-align: left; margin: 12px 0 18px; padding: 12px 42px 12px 12px;
    background: var(--card); border: 1px solid var(--line-2); border-radius: 18px;
    color: var(--ink); animation: fadeonly var(--t-2) var(--e-soft) both; }
  .pumpy-tip-slot { display: flow-root; overflow: hidden; flex: 0 0 auto; }
  .pumpy-tip .pumpyart { width: 64px; height: 64px; margin: 0; border-radius: 15px; }
  .pumpy-tip-copy { min-width: 0; flex: 1; }
  .pumpy-tip-copy b { display: block; font-size: 13px; font-weight: 650; line-height: 1.35; }
  .pumpy-tip-copy p { font-size: 12.5px; line-height: 1.5; color: var(--ink-2); margin: 5px 0 0; }
  .pumpy-tip-close { position: absolute; top: 0; right: 0; width: 44px; height: 44px;
    display: grid; place-items: center; border: 0; background: none; color: var(--muted);
    cursor: pointer; border-radius: 14px; touch-action: manipulation; }
  .pumpy-tip-close .ic { width: 15px; height: 15px; }
  #pumpycomposer .pumpy-tip { margin: 0 0 10px; }
  #pumpycomposer .pumpy-tip .pumpyart { width: 48px; height: 48px; }
  .kb #pumpycomposer .pumpy-tip { display: none; }
  #pumpyhelp { width: 100%; cursor: pointer; text-align: left; background: none;
    color: var(--ink); font: inherit; border: 0; }
  #pumpyhelp .ic { width: 16px; height: 16px; color: var(--muted); }
  #guidebody > .pumpyart { width: 100px; height: 100px; border-radius: 24px; margin: 4px auto 18px; }
  .guide-topic { border-top: 1px solid var(--line); overflow: hidden; }
  .guide-topic summary { min-height: 48px; padding: 13px 6px; font-size: 14px; font-weight: 550;
    cursor: pointer; color: var(--ink); touch-action: manipulation; }
  .guide-topic p { margin: 0; padding: 0 6px 16px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
  #guidereset { min-height: 44px; margin-top: 12px; }
  #welcomereplay { min-height: 44px; margin-top: 12px; }
  .welcome-top { display: flex; align-items: center; justify-content: space-between; min-height: 44px;
    color: var(--muted); font-size: 12px; font-weight: 550; }
  #welcomeskip { min-height: 44px; padding: 8px 0 8px 16px; border: 0; background: none;
    color: var(--ink-2); font-size: 14px; touch-action: manipulation; }
  #welcomestage { display: grid; margin: 14px 0 24px; }
  .welcome-page { grid-area: 1 / 1; opacity: 0; transform: translateX(12px); pointer-events: none;
    transition: opacity var(--t-2) var(--e-soft), transform var(--t-3) var(--e-out); text-align: center; }
  .welcome-page.on { opacity: 1; transform: none; pointer-events: auto; }
  .welcome-page .pumpyart { width: 144px; height: 144px; margin-bottom: 22px; }
  .welcome-page h2 { margin-bottom: 12px; }
  .welcome-page p { margin: 0 auto; max-width: 320px; color: var(--ink-2); font-size: 14px; line-height: 1.65; }
  .welcome-actions { display: flex; gap: 12px; }
  .welcome-actions .btn { flex: 1; min-height: 48px; }
  #welcomeback:disabled { opacity: 0; pointer-events: none; }
  @media (max-height: 600px) {
    .welcome-page .pumpyart { width: 88px; height: 88px; margin-bottom: 12px; }
    #welcomestage { margin: 4px 0 16px; }
  }
  @media (max-width: 390px) {
    .pumpy-tip { gap: 10px; padding-left: 10px; }
    .pumpy-tip .pumpyart { width: 52px; height: 52px; border-radius: 13px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pumpy-tip { animation: none; }
    .welcome-page { transform: none; transition: opacity var(--t-1) var(--e-soft); }
    .btn:active, .iconbtn:active, .addbtn:active, .chip:active, .carditem:active,
    .mbtn:active, .startbtn:active, .addex:active, .planbtn:active, .mcell:active,
    .setpill:active, .wnav:active, .wfinish:active, .ring:active, .scprev:active,
    .uploadrow:active, .pumpybar button:active { transform: none; }
  }
  /* Keep the workout visible; supporting detail opens in place on request. */
  .savebtn { width: auto; min-height: 44px; padding: 0 12px; gap: 5px; font-size: 12px; font-weight: 650; white-space: nowrap; }
  .hbtns { align-items: center; flex-shrink: 0; }
  .firstsave { margin-top: 22px; }
  .detail-actions { display: flex; gap: 10px; margin: 8px 0 14px; }
  .detail-actions .chip { min-height: 44px; flex: 1; justify-content: center; }
  #dinner > .startbtn { margin-bottom: 12px; box-shadow: var(--sh-sm); }
  #dinner > .detail-actions { margin: 0 0 20px; }
  #detail { background-image: none; }
  .workout-block { padding: 16px 16px 6px; box-shadow: none; }
  .workout-block > h3 { text-transform: none; letter-spacing: -.01em; font-size: 15px; color: var(--ink); margin-bottom: 4px; }
  .disclosure { border: 1px solid var(--line); background: var(--card); border-radius: 16px; margin: 12px 0; }
  .disclosure > summary { cursor: pointer; padding: 14px 16px; min-height: 48px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
  .disclosure-body { padding: 0 14px 14px; }
  .disclosure-body .embedwrap { margin-top: 12px; }
  .exercise-card { background: var(--card); margin: 0; padding: 4px 0; contain: layout style; }
  .exercise-card + .exercise-card { border-top: 1px solid var(--line); }
  .exercise-main { display: flex; gap: 12px; align-items: flex-start; padding: 14px 0 6px; }
  .exercise-main .exname { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .exercise-main .exdose { flex: 0 0 auto; max-width: 42%; white-space: normal; text-align: right; }
  /* A stable full-width drawer keeps secondary actions quiet, without a flex
     row renegotiating its width when the hidden labels become visible. */
  .exercise-actions { display: block; width: 100%; min-width: 0; padding: 0; position: relative; }
  /* ---------- the rest on the row ----------
     The empty half of the options line, where the owner pointed. Laid over the
     summary's left end, which is only air (its word sits at the right), so the
     drawer under it keeps its full width when it opens; drawn small and reached
     at 44px, like the chips. A rest the card stated is solid; the default is
     outlined and says so — the same number is a different fact. --muted is
     4.89 on card, which is what the outlined one sits on. The .pill shape, on a
     button; no overflow clip, which would take the reach with it — the longest
     word fits a 375px row. */
  .restpill { position: absolute; left: 0; top: 8px; border: 1px solid transparent;
    white-space: nowrap; transition: transform var(--t-1) var(--e-out); }
  .restpill.dflt { background: none; border-color: var(--line-2); color: var(--muted); }
  .restpill:active { transform: scale(.95); }
  .restpill::after { content: ""; position: absolute; inset: -9px 0; }
  .exercise-options { border: 0; margin: 0; border-radius: 0; background: none; min-width: 0; }
  .exercise-actions > .exercise-options { width: 100%; }
  .exercise-options > summary { width: 100%; font-size: 12px; min-height: 44px; padding: 10px 6px;
    justify-content: flex-end; border-radius: 10px; }
  .wactions .exercise-options > summary { justify-content: center; background: var(--sand); border-radius: 12px; font-size: 13px; }
  /* Keep the exercise and logging controls anchored when supporting actions open.
     Centering the whole stack makes every item drift upward during expansion. */
  #workout:not(.summary) .wmain { justify-content: flex-start; min-height: 0;
    padding-top: clamp(20px, calc(var(--vvh) * .04), 32px); }
  #workout:not(.summary) .wmain > * { flex-shrink: 0; }
  .exercise-options .disclosure-body { padding: 4px 12px; margin: 4px 0 10px; background: var(--sand); border-radius: 12px; overflow: hidden; }
  .exercise-options .pickrow { width: 100%; min-height: 48px; padding: 12px 2px; border-radius: 0;
    font-size: 13px; font-weight: 550; background: transparent; color: var(--ink); justify-content: flex-start;
    transition: background-color var(--t-1) var(--e-soft); }
  .exercise-options .pickrow + .pickrow { border-top: 1px solid var(--line); }
  .exercise-options .pickrow .ic { width: 18px; height: 18px; color: var(--ink-2); }
  .exercise-options .pickrow:active { background: var(--card); }
  .exercise-options > summary:active { background: var(--sand); transform: none; }
  .exercise-options[open] > summary { color: var(--ember-ink); }
  .exercise-options.details-closing > summary { color: var(--ink-2); }
  #workmanage .managerow { flex-direction: column; }
  #workmanage .mbtn { flex: auto; min-height: 44px; justify-content: flex-start; }
  #workoptions .pickrow, #recapopts .pickrow { min-height: 48px; }
  /* Destructive, so it takes the one red the system has - the same red Settings
     gives its delete - rather than the muted grey that reads as unavailable. */
  /* "Choose the first exercise" is a sentence, and half a row at 375px wraps
     it: Cancel takes only its own width there, the way a secondary action does. */
  #sectionsheet .btnrow .ghost { flex: 0 0 auto; width: auto; padding: 14px 20px; }
  /* The section sheet's Remove is its last word and its one red one: this one. */
  #recapopts .danger, #sectionremove { color: var(--ember-ink); font-size: 15px; font-weight: 650; }
  #dmore { min-height: 44px; }
  /* The library row wraps rather than scrolls, and a wrapped row cannot carry its
     side inset on its end chips: the second line's first chip is not :first-child,
     so "Clear filter" sat flush against the screen edge under a row inset 18px.
     A wrapping row has no scrollport for the two engines to disagree about, so the
     inset moves back onto the box, and the scroll fade goes with the scrolling. */
  #chips { flex-wrap: wrap; overflow: visible; padding-left: 18px; padding-right: 18px;
    -webkit-mask-image: none; mask-image: none; }
  #chips > :first-child { margin-left: 0; }
  #chips > :last-child { margin-right: 0; }
  /* iOS date inputs can add padding outside their declared width. Let a normal
     box own the inset and border; the native picker remains an unpadded input. */
  .schedule-date-control { display: flex; min-width: 0; padding: 0 14px; border: 1px solid var(--line);
    border-radius: 13px; background: var(--sand); transition: border-color var(--t-2), background-color var(--t-2); }
  .schedule-date-control:focus-within { border-color: var(--ember); background: var(--card); }
  #scheduledate { display: block; flex: 1; width: 100%; min-width: 0; max-width: 100%; min-height: 48px;
    margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; -webkit-appearance: none; appearance: none; }
  #scheduledate::-webkit-date-and-time-value { min-height: 24px; line-height: 24px; text-align: left; }
  #explainask { min-height: 44px; }
  .disclosure summary:focus-visible, .exercise-actions button:focus-visible { outline: 2px solid var(--ember-ink); outline-offset: 2px; }
  .workout-meta { margin: 6px 0 16px; color: var(--ink-2); font-size: 13px; }
  .history-card > summary { position: relative; cursor: pointer; list-style: none; min-height: 44px; padding-right: 20px; }
  .history-card > summary::-webkit-details-marker { display: none; }
  .history-card > summary::after { content: "Session details"; display: block; font-size: 11px; font-weight: 600; color: var(--ember-ink); margin-top: 8px; }
  .history-card > summary::before { content: ""; position: absolute; right: 2px; top: 8px; width: 6px; height: 6px;
    border-right: 1.5px solid var(--ink-2); border-bottom: 1.5px solid var(--ink-2);
    transform: rotate(-45deg); transition: transform var(--t-3) var(--e-soft); }
  .history-card[open] > summary::before { transform: rotate(45deg); }
  .history-card.details-closing > summary::before { transform: rotate(-45deg); }
  .progress-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
    padding: 18px 0; margin-bottom: 16px; border-bottom: 1px solid var(--line); text-align: center; }
  .progress-totals b { display: block; font-family: var(--display); font-size: clamp(20px, 5vw, 28px); overflow-wrap: anywhere; }
  .progress-totals span { display: block; color: var(--ink-2); font-size: 12px; margin-top: 4px; }
  .session-search { width: 100%; min-height: 46px; margin: 14px 0 10px; }
  .session-link { display: block; width: 100%; padding: 16px; text-align: left; color: var(--ink);
    cursor: pointer; transition: border-color var(--t-2), background-color var(--t-2); }
  .session-link:hover { border-color: var(--ember); background: var(--ember-soft); }
  .session-link:focus-visible { outline: 2px solid var(--ember-ink); outline-offset: 3px; }
  .session-link .histrow { border: 0; padding: 0; }
  .session-link .n { min-width: 0; overflow-wrap: anywhere; }
  .session-invite { display: block; color: var(--ember-ink); font-size: 12px; font-weight: 650; margin-top: 12px; }
  .session-exercise { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .session-exercise h4 { margin: 0 0 10px; overflow-wrap: anywhere; }
  .session-set { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; font-size: 13px; }
  .session-set span { color: var(--ink-2); flex-shrink: 0; }
  .session-set b { text-align: right; overflow-wrap: anywhere; }
  @media (prefers-reduced-motion: reduce) { .session-link { transition: none; } }
  #scheduleerror { display: block; }
  #scheduleerror:empty { display: none; }
  /* Measured height moves the following content with the opening section. Only
     the section in flight is clipped; settled content returns to natural height. */
  details { overflow-anchor: none; }
  details.details-moving { overflow: clip; }
  details.details-moving > :not(summary) { will-change: opacity; }
  .disclosure > summary, .guide-topic > summary { list-style: none; display: flex; align-items: center; gap: 10px;
    -webkit-user-select: none; user-select: none; }
  .disclosure > summary::-webkit-details-marker, .guide-topic > summary::-webkit-details-marker { display: none; }
  .disclosure > summary::after, .guide-topic > summary::after { content: ""; flex: 0 0 auto; width: 6px; height: 6px;
    border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; margin-left: auto;
    transform: rotate(-45deg); transition: transform var(--t-3) var(--e-soft); }
  .exercise-options > summary::after { margin-left: 0; }
  .disclosure[open] > summary::after, .guide-topic[open] > summary::after { transform: rotate(45deg); }
  .disclosure.details-closing > summary::after, .guide-topic.details-closing > summary::after { transform: rotate(-45deg); }
  @media (prefers-reduced-motion: reduce) {
    .disclosure > summary::after, .guide-topic > summary::after, .history-card > summary::before,
    .exercise-options .pickrow, .restpill { transition: none; }
  }
  .reader-offer { background: var(--ember-soft); border: 1px solid var(--line); border-radius: 18px; padding: 16px; margin: 16px 0; }
  .reader-offer p { color: var(--ink-2); font-size: 14px; line-height: 1.5; margin: 8px 0 12px; }
  .reader-offer .fixlink { background: none; border: 0; color: var(--ember-ink); font: inherit; text-align: left; padding: 0; display: block; margin-top: 12px; min-height: 44px; }
  .set-goal { color: #bd3434; border: 1px solid currentColor; border-radius: 12px; padding: 12px; margin: 16px 0; font-size: 14px; font-weight: 650; text-align: center; }
  .set-goal.reached { color: var(--good); }
  @media (prefers-color-scheme: dark) { .set-goal:not(.reached) { color: #ff9292; } }
  /* ---------- the rows that can be swiped away ----------
     A card's exercise rows and its block heading each hide one action, Delete,
     behind a leftward swipe. They bleed to the card's inner edge like every
     .exrow does (the base rule's -16px), because that edge is where a row's
     words should disappear under as they slide: clipped at the text's own
     left edge, "Incline Bench" became "ench" floating a finger's width from the
     border, which read as broken rather than as moved. The words keep their
     16px by padding. */
  .delete-swipe { border-radius: 0; }
  .delete-swipe > .exmain { display: block; padding: 0 16px; background: var(--card); }
  .delete-swipe .exercise-card { width: 100%; box-sizing: border-box; }
  .delete-swipe.open > .exmain { transform: translateX(-64px); }
  .exact.danger { background: #bb3030; color: #fff; }
  /* The drawer is a rounded red button standing off the row's edge, not a slab
     the row's full height — a three-line exercise row swiped open showed a
     150px red column with "Delete" lost in the middle of it. The container is
     the 64px the row moves by (56px of button, 8px of air) and is transparent;
     the button is capped and centred in it. Past the button's width a full
     swipe stretches the container under the row (app.ts sets its width while
     the finger is down) and the button, being 100% of it, grows with the
     finger and keeps its corners — iOS 26's action buttons stretch the same
     way. Crossing the point where letting go deletes is marked twice, a tick
     in the hand and the mark growing, so nobody learns where it is by losing
     a row. */
  .delete-swipe > .exacts { top: 0; bottom: 0; right: 8px; width: 56px; align-items: center;
    transform: translateX(calc(100% + 8px));
    transition: transform var(--t-3) var(--e-spring), width var(--t-3) var(--e-spring); }
  /* Re-stated over the generic .danger text link, which is declared later than
     .exact and had been quietly turning this button into a block with a text
     link's padding: the mark over the word, centred. */
  .delete-swipe .exact.danger { width: 100%; height: calc(100% - 16px); max-height: 84px;
    min-height: 44px; border-radius: 14px; flex: 0 0 auto; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 3px; margin: 0; padding: 0; font-size: 10.5px; }
  .delete-swipe .exact.danger .ic { transition: transform var(--t-2) var(--e-spring); }
  .delete-swipe.armed .exact.danger .ic { transform: scale(1.22); }
  /* A row on its way out: nothing under a finger, nothing under the hairline. */
  .exrow.leaving, .workout-block.leaving { pointer-events: none; }
  .exrow.leaving::before { display: none; }
  .segment-label { padding: 12px 16px; background: var(--ember-soft); color: var(--ink); font-weight: 650; }
  .recommendation { color: var(--ember-ink); }
  .thumbwrap img.pumpy-cover { object-fit: contain; background: #f8efdf; }
  /* The block's own row: its name and its one quiet action on a band of paper,
     swipeable like the exercises under it. The band spans the card like the
     rows do and pads by the same 16px, so the name lines up with the exercise
     names below instead of sitting flush against a box of its own. */
  .block-swipe { margin-bottom: 8px; border-radius: 12px; }
  /* The band carries the row's corners itself, not only the window it slides in:
     swiped open, its right edge stands beside the rounded Delete, and with the
     radius left on .block-swipe alone that edge was square (owner, 23 Sept). */
  .block-swipe .exmain { display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 8px 16px; background: var(--paper); border-radius: 12px; }
  .block-swipe h3 { margin: 0; }
  .block-swipe .linkbtn { font-size: 12px; min-height: 44px; color: var(--muted); }
</style>
`;
