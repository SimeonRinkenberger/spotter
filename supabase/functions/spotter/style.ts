// Spotter design system. Wrapped in String.raw; never use backticks or "${" inside.
export const STYLE = String.raw`<style>
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
    --good: #178055; --warn: #C98A00;
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
  .steps { display: flex; flex-direction: column; gap: 14px; margin: 0 0 36px; padding: 0; list-style: none; }
  .steps li { display: flex; gap: 13px; align-items: flex-start; font-size: 14px; line-height: 1.5;
    color: var(--ink-2); }
  .steps .num { flex: 0 0 auto; width: 25px; height: 25px; border-radius: 999px; background: var(--ember-soft);
    color: var(--ember-ink); font-size: 12px; font-weight: 700; display: flex; align-items: center;
    justify-content: center; margin-top: 1px; }
  .steps b { color: var(--ink); font-weight: 650; }
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
  .field input { width: 100%; border: 1px solid var(--line); border-radius: 13px; padding: 12px 14px;
    font-size: 16px; background: var(--sand); color: var(--ink); outline: none;
    transition: border-color var(--t-2), background-color var(--t-2); }
  .field input:focus { border-color: var(--ember); background: var(--card); }
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
     #app owns the viewport instead of the document: the four pages scroll inside
     it while the header and the tab bar stay put, which is the only arrangement
     in which a page can slide sideways. Its size is --vvh/--vvtop, and so is every
     other full-screen layer's, because the layout viewport lies where it matters
     most: an installed iOS app asking for viewport-fit=cover gets an ICB a
     safe-area-inset-top short of the screen (WebKit 254868), so 100dvh,
     -webkit-fill-available and visualViewport.height all read 793 of an 852pt
     phone and everything fixed to the bottom floats a status bar above it. Only vh
     still measures the whole screen there, which is the reverse of the rule for a
     browser tab — hence the scope. fitViewport() takes both for the keyboard. */
  :root { --vvh: 100dvh; --vvtop: 0px; }
  @media all and (display-mode: standalone) { :root { --vvh: 100vh; } }
  :root.sa { --vvh: 100vh; }   /* older iOS answers navigator.standalone, not the feature */
  #app { position: fixed; left: 0; right: 0; top: var(--vvtop); height: var(--vvh);
    overflow: hidden; }

  /* ---------- header ---------- */
  header { position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    background: color-mix(in srgb, var(--paper) 84%, transparent);
    -webkit-backdrop-filter: blur(20px) saturate(1.5); backdrop-filter: blur(20px) saturate(1.5);
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
  .ts:nth-child(4) { --i: 3; }
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

  /* ---------- filter chips ---------- */
  /* This row used to ask for horizontal pans back, because the pager was taking
     them away at the top. It no longer takes them, so there is nothing to ask. */
  .chips { display: flex; gap: 7px; overflow-x: auto; padding: 14px 18px 6px; scrollbar-width: none;
    -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent 100%);
    mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent 100%); }
  .chips::-webkit-scrollbar { display: none; }
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
  .carditem { background: none; border: none; padding: 0; display: flex; flex-direction: column;
    cursor: pointer; min-width: 0; text-align: left; transition: transform var(--t-2) var(--e-out); }
  .carditem:active { transform: scale(.968); }
  .carditem.in { animation: cardin var(--t-4) var(--e-out) both; }
  @keyframes cardin { from { opacity: 0; transform: translateY(14px); } }
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
  .thumbwrap.pending .noimg, .thumbwrap.failed .noimg { animation: floaty 3.4s ease-in-out infinite; }
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
    background-image: var(--grain); display: none; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .overlay.open { display: block; animation: slideup var(--t-3) var(--e-out); }
  @keyframes slideup { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  .overlay.closing { display: block; pointer-events: none;
    animation: slidedown var(--t-2) var(--e-in) both; }
  @keyframes slidedown { to { transform: translateY(18px); opacity: 0; } }
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
  .dinner { padding: 4px 18px calc(46px + env(safe-area-inset-bottom)); max-width: 720px; margin: 0 auto; }
  .embedwrap { position: relative; border-radius: 20px; overflow: hidden; background: var(--sand);
    box-shadow: var(--sh-md); margin-bottom: 20px; }
  .embedwrap iframe { display: block; width: 100%; border: 0; }
  .embedwrap.vertical iframe { height: 640px; }
  .embedwrap.wide { aspect-ratio: 16 / 9; }
  .embedwrap.wide iframe { height: 100%; }
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
  .dtitle.editable { cursor: pointer; }
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
  .specstrip { display: flex; gap: 0; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; overflow: hidden; margin-bottom: 20px; box-shadow: var(--sh-sm); }
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
  .exrow { display: flex; align-items: flex-start; gap: 11px; padding: 11px 0;
    border-top: 1px solid var(--line); }
  .exrow:first-of-type { border-top: none; }
  .exname { flex: 1; min-width: 0; font-size: 14.5px; line-height: 1.35; font-weight: 550; }
  .exnote { font-size: 12px; color: var(--muted); margin-top: 3px; line-height: 1.45; font-weight: 400; }
  .exdose { flex: 0 0 auto; font-family: var(--display); font-size: 13.5px; font-weight: 700;
    color: var(--ember-ink); font-variant-numeric: tabular-nums; padding-top: 1px; }
  .exhelp { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 999px; border: 1px solid var(--line-2);
    background: none; color: var(--muted); font-size: 12px; line-height: 1; display: flex;
    align-items: center; justify-content: center; }
  /* An exercise the user has corrected or added by hand. The card still shows the
     creator's wording everywhere else, so this is the only mark that says which
     lines are theirs — quiet, and it never appears on model output. */
  .exmine { font-size: 11px; font-weight: 600; color: var(--muted); margin-top: 4px; }
  /* Same visual language as .selectrow select — sand fill, hairline, 12px radius —
     one step quieter, because adding a missed exercise is a repair, not an action
     the card is asking for. */
  .addex { width: 100%; border: 1px solid var(--line); border-radius: 12px; background: var(--sand);
    color: var(--ink-2); font-size: 13px; font-weight: 650; padding: 10px; margin: 4px 0 12px;
    transition: transform var(--t-1) var(--e-out); }
  .addex:active { transform: scale(.985); }
  .fieldrow { display: flex; gap: 9px; }
  .fieldrow .field { flex: 1; min-width: 0; }
  .capbox { font-size: 13.5px; line-height: 1.62; color: var(--ink-2); white-space: pre-wrap;
    word-break: break-word; }
  /* Shown only when the extraction could not be traced back to the source text.
     Deliberately quiet: it is a caveat on a card that still works, not an error. */
  .unverified { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px;
    line-height: 1.5; color: var(--ink-2); background: var(--sand); border: 1px solid var(--line);
    border-radius: 12px; padding: 10px 12px; margin-bottom: 14px; }
  .unverified b { color: var(--ink); font-weight: 650; }
  .unverified .ic { width: 17px; height: 17px; margin-top: 1px; color: var(--ember-ink); }
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
  .sheet { position: fixed; left: 0; right: 0; top: var(--vvtop); height: var(--vvh);
    z-index: 85; background: var(--scrim); display: none;
    align-items: flex-end; -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  .sheet.open { display: flex; animation: fadein var(--t-2) var(--e-soft); }
  @keyframes fadein { from { opacity: 0; } }
  /* 88% of the frame, so an eighth of the screen is always scrim you can tap: as
     86vh of a viewport whose own top was off screen, Settings left none. The
     bounce is off because the drag owns what happens at the top edge. */
  .sheetbody { position: relative; width: 100%; max-height: 88%; overflow-y: auto;
    overscroll-behavior: none; background: var(--paper);
    background-image: var(--grain); border-radius: 26px 26px 0 0; box-shadow: var(--sh-up);
    padding: 8px 20px calc(26px + env(safe-area-inset-bottom));
    animation: sheetup .38s var(--e-spring); }
  /* Only on for the settle: the drag itself is 1:1 and must not be timed. */
  .sheetbody.snap { transition: transform var(--t-3) var(--e-spring); }
  /* The tallest sheet leaves the least scrim, so it also says how to leave. The
     app's own icon button, so it is the same 38px control with the same 44px
     reach as every other way out of a screen. */
  /* Scoped to the sheet body so it outranks the reach block further down, which
     makes every .iconbtn position: relative for its hit area and would otherwise
     leave this one sitting in the flow at the top LEFT of the sheet. */
  .sheetbody .sheetx { position: absolute; top: 10px; right: 14px; z-index: 1; }
  @keyframes sheetup { from { transform: translateY(100%); } }
  .sheet.closing { display: flex; pointer-events: none;
    animation: fadeout var(--t-2) var(--e-soft) both; }
  .sheet.closing .sheetbody { animation: sheetdown var(--t-2) var(--e-in) both; }
  @keyframes fadeout { to { opacity: 0; } }
  @keyframes sheetdown { to { transform: translateY(100%); } }
  .grabber { width: 38px; height: 4px; border-radius: 999px; background: var(--line-2);
    margin: 6px auto 16px; }
  .sheetbody h2 { font-family: var(--display); font-size: 20px; font-weight: 700; margin: 0 0 6px;
    letter-spacing: -.015em; }
  .sheetbody p.lede { font-size: 13.5px; line-height: 1.6; color: var(--ink-2); margin: 0 0 18px; }
  .sheetbody .aitext { font-size: 14.5px; line-height: 1.68; color: var(--ink-2); white-space: pre-wrap; }

  /* ---------- how to do this ----------
     The creator's line is the only thing here drawn in full ink: it came out of the
     video the user saved, and everything under it is generic by comparison. */
  .said { margin: 4px 0 16px; padding-left: 13px; border-left: 2px solid var(--ember); }
  .saidlab { font-size: 11.5px; font-weight: 650; color: var(--muted); margin-bottom: 5px;
    line-height: 1.4; }
  .saidq { font-size: 15px; line-height: 1.55; color: var(--ink); word-break: break-word; }
  .said .chip, #watchbody .chip { margin-top: 11px; padding: 11px 15px; }
  /* ---------- the demonstration clip ----------
     One 16:9 slot, a title, a channel, a way out — the shape Hevy, Fitbod and Nike
     Training Club all settled on for the demo inside an exercise screen. Ours is
     somebody else's video rather than one we filmed, so the channel line is not
     decoration: it says whose gym you are standing in.

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
  .ytface { display: block; width: 100%; margin: 0; padding: 0; border: 0; background: none;
    text-align: left; color: inherit; font: inherit;
    transition: transform var(--t-1) var(--e-out); }
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
  .ytt { font-size: 13.5px; line-height: 1.45; color: var(--ink); margin-top: 9px;
    font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; }
  .ytc { font-size: 12px; line-height: 1.4; color: var(--muted); margin-top: 3px; }
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
  @media (prefers-reduced-motion: reduce) {
    .vslot { transition: none; }
    .ytface { transition: none; }
    .ytface:active { transform: none; }
    .ytmore { transition: none; }
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

  /* ---------- upload a video you saved ----------
     A tertiary control under the primary one, never a second primary: the URL
     field is the everyday path and this is its fallback. A hairline is the whole
     separator — an "or" chip would give the two paths equal billing.
     The bar is determinate because we know the byte count, and a 25 MB file on
     mobile data is well past the ten seconds at which a spinner stops being an
     honest answer to "how long". */
  .upblock { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
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

  /* ---------- picker list ---------- */
  .picklist { display: flex; flex-direction: column; gap: 2px; }
  .pickrow { display: flex; align-items: center; gap: 12px; padding: 11px 6px; border: none;
    background: none; text-align: left; border-radius: 13px; width: 100%; }
  .pickrow:active { background: var(--sand); }
  .pickrow img { width: 46px; height: 46px; border-radius: 11px; object-fit: cover; background: var(--sand);
    flex: 0 0 auto; }
  .pickrow .pt { flex: 1; min-width: 0; }
  .pickrow .pt b { display: block; font-size: 14px; font-weight: 600; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pickrow .pt span { font-size: 11.5px; color: var(--muted); }

  /* ---------- toast ---------- */
  /* Hung from the frame's bottom edge, not the layout viewport's — not the same
     edge on an installed iPhone. -100% makes top the line the toast sits ON, so
     the 96px of clearance still means 96px. */
  #toast { position: fixed; left: 50%;
    top: calc(var(--vvtop) + var(--vvh) - 96px - env(safe-area-inset-bottom));
    transform: translate(-50%, calc(-100% + 14px)); z-index: 90; background: var(--ink); color: var(--paper);
    padding: 12px 18px; border-radius: 999px; font-size: 13.5px; font-weight: 600; opacity: 0;
    pointer-events: none; transition: opacity var(--t-2), transform var(--t-2) var(--e-out);
    box-shadow: var(--sh-lg); max-width: 88vw; text-align: center; }
  #toast.show { opacity: 1; transform: translate(-50%, -100%); }
  /* Workout Mode has no tab bar to clear but a rest strip lands where the toast
     does: 76px of bottom bar, 48px of strip, 12px of air. "New best" used to sit
     on +15 s and Skip for three seconds. */
  #workout.open ~ #toast { top: calc(var(--vvtop) + var(--vvh) - 136px - env(safe-area-inset-bottom)); }
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
    border-top: 1px solid var(--line); padding: 8px 6px calc(6px + env(safe-area-inset-bottom)); }
  /* The selected item rides a capsule instead of being announced by colour alone,
     the way the iOS 26 tab bar glides its glass pill between items. The pill box
     is a whole tab wide so translateX(100%) is exactly one tab; the visible
     capsule is the inset pseudo-element. */
  .tabpill { position: absolute; left: 6px; top: 8px; bottom: calc(6px + env(safe-area-inset-bottom));
    width: calc((100% - 12px) / 4); pointer-events: none;
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
  .tab:nth-child(5) { --i: 3; }
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

  /* ---------- plan ---------- */
  /* Plan, Progress and Pumpy are always-mounted pages now; only the side gutter
     is theirs, the vertical padding belongs to .page. */
  .view { padding-left: 18px; padding-right: 18px; }
  .weekbar { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin: 10px 0 16px; }
  .weekbar b { font-family: var(--display); font-size: 16px; font-weight: 700; letter-spacing: -.012em; }
  /* An empty week is seven dashed boxes and no explanation of what they are for.
     One line above them, only while there is nothing planned. */
  .planlede { font-size: 13px; line-height: 1.55; color: var(--ink-2); margin: 0 0 14px; }
  .daycard { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 13px 15px; margin-bottom: 9px; box-shadow: var(--sh-sm); }
  .daycard.today { border-color: var(--ember); }
  .dayhead { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin-bottom: 2px; }
  .dayname { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--muted); }
  .daycard.today .dayname { color: var(--ember-ink); }
  .daydone { color: var(--good); font-size: 12px; font-weight: 700; }
  .planitem { display: flex; align-items: center; gap: 11px; margin-top: 9px; }
  .planitem img { width: 42px; height: 42px; border-radius: 10px; object-fit: cover;
    background: var(--sand); flex: 0 0 auto; }
  .planitem .pt { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; line-height: 1.3;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .planadd { background: none; border: 1px dashed var(--line-2); color: var(--muted); width: 100%;
    border-radius: 12px; padding: 10px; font-size: 13px; font-weight: 600; margin-top: 9px; }
  .planx { background: none; border: none; color: var(--muted); font-size: 15px; padding: 6px; }

  /* ---------- progress / history ---------- */
  .statrow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin: 4px 0 18px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 15px; padding: 14px 10px;
    text-align: center; box-shadow: var(--sh-sm); }
  .stat .v { font-family: var(--display); font-size: 24px; font-weight: 700; letter-spacing: -.018em;
    line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
  .stat .k { font-size: 11px; font-weight: 600; color: var(--muted); margin-top: 6px; }
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
  .prrow .v { font-family: var(--display); font-size: 14px; font-weight: 700; color: var(--ember-ink);
    font-variant-numeric: tabular-nums; }
  .mgrow { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
  .mgrow .lbl { width: 82px; flex: 0 0 auto; font-size: 11.5px; color: var(--ink-2); font-weight: 600;
    text-transform: capitalize; }
  .mgbar { flex: 1; height: 8px; border-radius: 999px; background: var(--sand); overflow: hidden; }
  .mgbar i { display: block; height: 100%; border-radius: 999px; background: var(--ember); }
  .mgrow .num { width: 26px; text-align: right; font-size: 11.5px; color: var(--muted);
    font-variant-numeric: tabular-nums; font-weight: 600; }
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
    padding: 10px 16px calc(14px + env(safe-area-inset-bottom)); }
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
  .sumfigs { margin-top: 20px; }
  .sumfigs .setpill b { font-size: 23px; letter-spacing: -.035em; }
  .sumfigs .setpill, .sumprs .setpill { animation: viewin var(--t-2) var(--e-out) both; }
  .sumfigs .setpill:nth-child(2) { animation-delay: 70ms; }
  .sumfigs .setpill:nth-child(3) { animation-delay: 140ms; }
  .sumprs { margin-top: 4px; }
  .sumprs .setpill { animation-delay: 210ms; }
  .sumprs .setpill b { color: var(--ember-ink); font-size: 12px; }
  .sumdone { margin-top: 24px; animation: viewin var(--t-3) var(--e-out) 260ms both; }
  /* The clip, in a sheet, at the moment it is wanted. Shorter than the detail
     view's embed so the close button stays on screen with it. */
  #watchbody .embedwrap, #watchbody .dphoto { margin-bottom: 14px; }
  #watchbody .embedwrap.vertical iframe { height: 56vh; }
  .stepper { display: flex; align-items: center; gap: 12px; justify-content: center; margin: 14px 0; }
  .stepper button { width: 46px; height: 46px; border-radius: 999px; border: 1px solid var(--line-2);
    background: var(--card); color: var(--ink); font-size: 20px; line-height: 1; }
  .stepper .val { font-family: var(--display); font-size: 30px; font-weight: 700; min-width: 96px;
    text-align: center; font-variant-numeric: tabular-nums; letter-spacing: -.018em; }
  .stepper .val small { display: block; font-size: 11px; font-weight: 600;
    color: var(--muted); margin-top: 4px; }

  /* ---------- Pumpy ----------
     The coach's mark is currentColor everywhere it appears, so it takes the tab's
     muted/ember state and the avatar's ember-on-soft without extra rules. Chat
     bubbles borrow the card and accent surfaces; the proposal card is the one
     place the accent is used as a border, because it is the one thing on the
     screen asking for a decision. */
  .tab .ti svg { width: 21px; height: 21px; display: block; }
  .pmark { width: 28px; height: 28px; border-radius: 999px; background: var(--ember-soft); color: var(--ember-ink);
    display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .pmark svg { width: 17px; height: 17px; display: block; }
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
  .pumpybar { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 2px 0 4px; }
  .pumpybar .chip { padding: 8px 13px; font-size: 12.5px; }
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
  .proposal .btnrow { margin-top: 12px; }
  .proposal .btnrow .btn { padding: 12px; font-size: 14.5px; }
  .proposal .done { color: var(--good); font-weight: 700; font-size: 13px; margin-top: 10px;
    display: flex; align-items: center; gap: 5px;
    animation: donein var(--t-3) var(--e-out); }
  .proposal .done .ic { width: 15px; height: 15px; }
  .proposal .declined { color: var(--muted); font-size: 13px; margin-top: 10px;
    animation: donein var(--t-3) var(--e-out); }
  @keyframes donein { from { opacity: 0; transform: translateY(-5px); } }
  .composer { position: sticky; bottom: var(--ptab, calc(78px + env(safe-area-inset-bottom)));
    margin-bottom: var(--ptab, calc(78px + env(safe-area-inset-bottom)));
    padding: 8px 0 10px;
    background: color-mix(in srgb, var(--paper) 90%, transparent);
    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
  /* Keyboard up: #app follows the visual viewport but .tabbar, fixed to the layout
     one, is behind the keys — so the composer's clearance for the bar is a margin
     below nothing. Sit it on the app's own bottom edge and take the bar out of the
     way, as a native chat app does. */
  body.kb .composer { bottom: 0; margin-bottom: 0; }
  body.kb .page { padding-bottom: 24px; }
  body.kb .tabbar { visibility: hidden; }
  .composerrow { display: flex; gap: 8px; align-items: flex-end; }
  .composer textarea { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px;
    font-size: 16px; line-height: 1.4; background: var(--card); color: var(--ink); outline: none; resize: none;
    max-height: 138px; overflow-y: auto; transition: border-color var(--t-2); }
  .composer textarea:focus { border-color: var(--ember); }
  .composer .addbtn { width: 44px; height: 44px; border-radius: 15px; font-size: 20px; }
  .composer .addbtn[disabled] { opacity: .4; box-shadow: none; }
  .pumpycredits { font-size: 11.5px; color: var(--muted); margin: 0 0 7px 6px; line-height: 1.4; }
  .pumpyctx { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); margin: 0 0 8px 6px; }
  .pumpyctx b { color: var(--ink); font-weight: 650; }
  .pumpyctx button { border: none; background: var(--sand); color: var(--muted); border-radius: 999px;
    width: 22px; height: 22px; font-size: 14px; line-height: 1; }
  .askpumpy { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px;
    border: 1px solid var(--line); border-radius: 16px; background: var(--card); color: var(--ink);
    padding: 12px; font-size: 14px; font-weight: 650; margin: -8px 0 22px; box-shadow: var(--sh-sm);
    transition: transform var(--t-1) var(--e-out); }
  .askpumpy:active { transform: scale(.982); }
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
  .threadrow .tdel { flex: 0 0 auto; border: none; background: none; color: var(--muted);
    font-size: 12px; font-weight: 600; padding: 11px 8px; border-radius: 999px; }
  .threadrow .tdel[data-armed="1"] { color: var(--ember-ink); }
  .threadnone { font-size: 13.5px; color: var(--muted); padding: 10px 0 4px; line-height: 1.6; }
  .setnote { font-size: 12.5px; color: var(--muted); line-height: 1.5; padding: 6px 4px 0; }
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
  button:focus-visible, a:focus-visible, [role="button"]:focus-visible, select:focus-visible {
    outline: 2px solid var(--ember); outline-offset: 2px; }
  /* The body map draws its own: an outline round a muscle's bounding box would be
     a rectangle over the figure. */
  .bodybox .bodymus:focus-visible { outline: none; }

  /* ---------- reach ----------
     Apple asks for 44px; these are drawn smaller because their rows are. Only the
     hit area grows, capped at the gap to the next control so no two overlap.
     Insets come off the padding box: a bordered control needs a pixel more. */
  .iconbtn, .addbtn, .exhelp, .planx, .planadd, .mbtn, .addex, .danger,
  .chips .chip, .said .chip, .pumpyctx button, .threadrow .tdel, .ttitle { position: relative; }
  .iconbtn::after, .addbtn::after, .exhelp::after, .planx::after, .planadd::after,
  .mbtn::after, .addex::after, .danger::after, .chips .chip::after, .said .chip::after,
  .pumpyctx button::after, .threadrow .tdel::after, .ttitle::after { content: ""; position: absolute; }
  .iconbtn::after { inset: -3px; }
  .addbtn::after { inset: -2px; }
  .exhelp::after { inset: -7px -6px; }
  .planx::after { inset: -7px -4px; }
  .planadd::after, .addex::after { inset: -5px 0; }
  .mbtn::after { inset: -6px 0; }
  .danger::after, .threadrow .tdel::after { inset: -3px 0; }
  .chips .chip::after, .said .chip::after { inset: -6px 0; }
  .pumpyctx button::after { inset: -7px; }
  /* Up into the label, which is text and not a control; down to the dose line. */
  .ttitle::after { inset: -14px 0 -5px; }

  /* ---------- install hint ---------- */
  #hint { margin: 12px 18px 0; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; padding: 13px 15px; font-size: 13px; line-height: 1.55; color: var(--ink-2);
    display: none; align-items: flex-start; gap: 11px; box-shadow: var(--sh-sm); }
  #hint.show { display: flex; }
  #hint b { color: var(--ink); }
  #hint button { background: none; border: none; color: var(--muted); font-size: 17px; padding: 0 2px;
    line-height: 1; flex: 0 0 auto; }

  /* ---------- reduced motion, in one place ----------
     Apple's instruction is not "remove the feedback" but "replace transitions in
     x, y and z with fades": entrances keep opacity and lose travel, decorative
     loops stop, informative ones stay. */
  @keyframes fadeonly { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .viewin, .carditem.in, .msgin, .bodyfig, .reststrip, .overlay.open, .sumdone,
    .sumfigs .setpill, .sumprs .setpill,
    .proposal .done, .proposal .declined {
      animation-name: fadeonly; animation-duration: var(--t-2); animation-delay: 0ms; }
    .overlay.closing, .sheet.closing, #workout.closing, .reststrip.gone {
      animation: fadeout var(--t-1) var(--e-soft) both; }
    /* The staggered summary is :nth-child, which outranks the rule above it. */
    .sumfigs .setpill:nth-child(n) { animation-delay: 0ms; }
    .sheetbody.snap { transition: none; }
    .sheetbody, .sheet.closing .sheetbody, .setpill.just, .setpill.just.pr,
    .empty .big, .thumbwrap.pending .noimg, .thumbwrap.failed .noimg,
    .thumbwrap.loading::after, .thumbwrap.pending::after { animation: none; }
    /* The dots stop but stay: they are the only thing saying an answer is coming. */
    .msg.typing i { animation: none; opacity: .6; }
    .thumbwrap img { transition: none; }
    #ptr.back { transition-duration: var(--t-1); }
  }
</style>
`;
