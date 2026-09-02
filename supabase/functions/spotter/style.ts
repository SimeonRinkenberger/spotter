// Spotter design system. Wrapped in String.raw; never use backticks or "${" inside.
export const STYLE = String.raw`<style>
  :root {
    color-scheme: light dark;
    /* surfaces — cool graphite, never pure white */
    --paper: #F5F6F8; --card: #FFFFFF; --sand: #E9ECF1;
    /* ink — cool near-black, never pure black */
    --ink: #14171A; --ink-2: #58626E; --muted: #8B95A1;
    --line: rgba(20,23,26,.09); --line-2: rgba(20,23,26,.18);
    /* one accent, capped at ~10% of any screen */
    --ember: #E8551F; --ember-ink: #C9430F; --ember-soft: #FDEDE6; --on-ember: #FFF8F5;
    --good: #1E9E6A; --warn: #C98A00;
    /* body map: the silhouette, then the muscles that sit on it untargeted */
    --body-skin: #DCE1E8; --body-mus: #AEB7C3;
    --scrim: rgba(12,16,22,.55);
    --glow: rgba(232,85,31,.28);
    --sh-sm: 0 1px 2px rgba(16,22,32,.06), 0 2px 6px rgba(16,22,32,.05);
    --sh-md: 0 1px 2px rgba(16,22,32,.05), 0 6px 14px rgba(16,22,32,.07), 0 16px 30px rgba(16,22,32,.05);
    --sh-lg: 0 2px 6px rgba(16,22,32,.07), 0 12px 28px rgba(16,22,32,.11), 0 30px 56px rgba(16,22,32,.08);
    --sh-up: 0 -6px 34px rgba(12,18,28,.18);
    --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E");
    --display: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --sans: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    --e-out: cubic-bezier(.22,.9,.3,1);
    --e-spring: cubic-bezier(.32,.72,0,1);
    --e-soft: cubic-bezier(.4,0,.2,1);
    --t-1: 150ms; --t-2: 220ms; --t-3: 320ms; --t-4: 420ms;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #101214; --card: #191D21; --sand: #232931;
      --ink: #EEF2F6; --ink-2: #AFBAC6; --muted: #7C8794;
      --line: rgba(238,242,246,.10); --line-2: rgba(238,242,246,.19);
      --ember: #FF7A45; --ember-ink: #FF9166; --ember-soft: #33190F; --on-ember: #17100C;
      --good: #3FD096; --warn: #E8B54A;
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
  body { background-image: var(--grain); }
  body.app { padding-bottom: calc(78px + env(safe-area-inset-bottom)); }
  button, input, select, textarea { font-family: var(--sans); }
  button { cursor: pointer; }
  .hide { display: none !important; }

  /* ---------- landing (signed out) ---------- */
  #landing { display: none; min-height: 100vh; min-height: 100dvh; }
  #landing.open { display: block; }
  .land { max-width: 460px; margin: 0 auto; padding: calc(38px + env(safe-area-inset-top)) 24px 60px; }
  .brandrow { display: flex; align-items: center; gap: 11px; margin-bottom: 40px; }
  .brandrow img { width: 40px; height: 40px; border-radius: 11px; box-shadow: var(--sh-sm); }
  .brandrow span { font-family: var(--display); font-size: 21px; font-weight: 700; letter-spacing: -.02em; }
  .hero { font-family: var(--display); font-size: 38px; line-height: 1.08; font-weight: 700;
    letter-spacing: -.033em; margin: 0 0 16px; }
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
    letter-spacing: -.02em; }
  .field { margin-bottom: 12px; }
  .field label { display: block; font-size: 11px; font-weight: 700; letter-spacing: .1em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
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
  .landfoot { text-align: center; margin-top: 30px; font-size: 12px; color: var(--muted); }
  .landfoot a { color: var(--muted); }

  /* ---------- header ---------- */
  header { position: sticky; top: 0; z-index: 20;
    background: color-mix(in srgb, var(--paper) 84%, transparent);
    -webkit-backdrop-filter: blur(20px) saturate(1.5); backdrop-filter: blur(20px) saturate(1.5);
    padding: calc(12px + env(safe-area-inset-top)) 18px 12px; border-bottom: 1px solid var(--line); }
  .titlerow { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  h1 { font-family: var(--display); font-size: 27px; margin: 0; font-weight: 700;
    letter-spacing: -.03em; line-height: 1; }
  .count { color: var(--muted); font-size: 10.5px; margin-top: 7px; font-weight: 700;
    letter-spacing: .15em; text-transform: uppercase; }
  .hbtns { display: flex; gap: 8px; }
  .addbtn { width: 40px; height: 40px; border-radius: 14px; border: none; background: var(--ember);
    color: var(--on-ember); font-size: 23px; line-height: 1; font-weight: 600;
    box-shadow: 0 3px 12px var(--glow); transition: transform var(--t-1) var(--e-out); }
  .addbtn:active { transform: scale(.92); }
  .addbtn.ghost { background: var(--sand); color: var(--ink-2); font-size: 16px; box-shadow: none; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .searchwrap { margin-top: 14px; position: relative; display: block; }
  .searchico { position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
    color: var(--muted); pointer-events: none; display: flex; }
  .search { width: 100%; border: 1px solid var(--line); border-radius: 14px;
    padding: 11px 14px 11px 40px; font-size: 16px; background: var(--sand); color: var(--ink);
    outline: none; transition: border-color var(--t-2), background-color var(--t-2); }
  .search:focus { border-color: var(--ember); background: var(--card); }
  .search::placeholder { color: var(--muted); }

  /* ---------- filter chips ---------- */
  .chips { display: flex; gap: 7px; overflow-x: auto; padding: 14px 18px 6px; scrollbar-width: none;
    -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent 100%);
    mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent 100%); }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: 0 0 auto; border: none; background: var(--sand); color: var(--ink-2);
    border-radius: 999px; padding: 9px 14px; font-size: 13px; font-weight: 600; line-height: 1;
    letter-spacing: -.005em;
    transition: background-color var(--t-2) var(--e-soft), color var(--t-2) var(--e-soft),
      transform var(--t-1) var(--e-out), box-shadow var(--t-2) var(--e-soft); }
  .chip:active { transform: scale(.94); }
  .chip.active { background: var(--ember); color: var(--on-ember); box-shadow: 0 3px 12px var(--glow); }
  .chip .n { opacity: .5; font-weight: 700; margin-left: 5px; font-size: 11px; font-variant-numeric: tabular-nums; }
  .chip.active .n { opacity: .75; }

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
  .colrow .ce { width: 26px; text-align: center; font-size: 18px; flex: 0 0 auto; }
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
    letter-spacing: .02em; color: #fff; background: rgba(10,14,20,.56); padding: 4px 8px;
    border-radius: 999px; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
  .cardbody { padding: 11px 3px 0; min-width: 0; }
  .cardkick { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    margin-bottom: 5px; min-width: 0; }
  .catpill { font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
    color: var(--ember-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .diffpill { font-size: 10px; font-weight: 700; color: var(--muted); white-space: nowrap; flex: 0 0 auto;
    text-transform: uppercase; letter-spacing: .08em; }
  .cardtitle { font-family: var(--display); font-size: 15px; font-weight: 650; line-height: 1.25;
    letter-spacing: -.018em; color: var(--ink); display: -webkit-box;
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
  .retryline { color: var(--ember-ink); font-weight: 650; }
  .retrybtn { width: 100%; margin: 0 0 14px; padding: 14px; border-radius: 16px; border: none;
    font: inherit; font-weight: 700; cursor: pointer; color: #fff; background: var(--ember);
    box-shadow: var(--sh-md); }
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
    font-size: 38px; animation: floaty 5.5s ease-in-out infinite; }
  .empty .big::after { content: ""; position: absolute; inset: -11px;
    border-radius: 999px; border: 1px dashed var(--line-2); }
  @keyframes floaty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  .empty h2 { color: var(--ink); font-family: var(--display); font-size: 21px; font-weight: 700;
    margin: 0 0 10px; letter-spacing: -.025em; }
  .empty p { font-size: 13.5px; line-height: 1.65; margin: 5px auto; max-width: 300px; }
  .empty b { color: var(--ember-ink); font-weight: 700; }

  /* ---------- detail overlay ---------- */
  .overlay { position: fixed; inset: 0; z-index: 50; background-color: var(--paper);
    background-image: var(--grain); display: none; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .overlay.open { display: block; animation: slideup .34s var(--e-out); }
  @keyframes slideup { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
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
  .dkick { font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
    color: var(--ember-ink); margin-bottom: 8px; }
  .dtitle { font-family: var(--display); font-size: 28px; font-weight: 700; line-height: 1.14;
    letter-spacing: -.032em; margin: 0 0 10px; }
  .dauthor { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
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
  .spec { flex: 1; padding: 13px 8px; text-align: center; border-right: 1px solid var(--line); min-width: 0; }
  .spec:last-child { border-right: none; }
  .spec .v { font-family: var(--display); font-size: 17px; font-weight: 700; letter-spacing: -.02em;
    color: var(--ink); }
  .spec .k { font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--muted); margin-top: 4px; }
  .startbtn { width: 100%; border: none; border-radius: 16px; padding: 16px; font-size: 16px;
    font-weight: 700; background: var(--ember); color: var(--on-ember); box-shadow: 0 4px 18px var(--glow);
    margin-bottom: 22px; letter-spacing: -.01em; transition: transform var(--t-1) var(--e-out); }
  .startbtn:active { transform: scale(.982); }
  .sect { background: var(--card); border: 1px solid var(--line); border-radius: 18px;
    padding: 16px 16px 6px; margin-bottom: 14px; box-shadow: var(--sh-sm); }
  .sect h3 { font-family: var(--display); font-size: 12px; font-weight: 700; letter-spacing: .11em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 12px; }
  .blocktitle { font-family: var(--display); font-size: 15px; font-weight: 700; letter-spacing: -.02em;
    margin: 0 0 3px; }
  .blockmeta { font-size: 11.5px; color: var(--muted); margin-bottom: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .07em; }
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
  .exmine { font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--muted); margin-top: 4px; }
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
  .sheet { position: fixed; inset: 0; z-index: 70; background: var(--scrim); display: none;
    align-items: flex-end; -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  .sheet.open { display: flex; animation: fadein var(--t-2) var(--e-soft); }
  @keyframes fadein { from { opacity: 0; } }
  .sheetbody { width: 100%; max-height: 86vh; overflow-y: auto; background: var(--paper);
    background-image: var(--grain); border-radius: 26px 26px 0 0; box-shadow: var(--sh-up);
    padding: 8px 20px calc(26px + env(safe-area-inset-bottom));
    animation: sheetup .38s var(--e-spring); }
  @keyframes sheetup { from { transform: translateY(100%); } }
  .grabber { width: 38px; height: 4px; border-radius: 999px; background: var(--line-2);
    margin: 6px auto 16px; }
  .sheetbody h2 { font-family: var(--display); font-size: 20px; font-weight: 700; margin: 0 0 6px;
    letter-spacing: -.025em; }
  .sheetbody p.lede { font-size: 13.5px; line-height: 1.6; color: var(--ink-2); margin: 0 0 18px; }
  .sheetbody .aitext { font-size: 14.5px; line-height: 1.68; color: var(--ink-2); white-space: pre-wrap; }
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
  .swapitem .tag { font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
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
  #toast { position: fixed; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom));
    transform: translate(-50%, 14px); z-index: 90; background: var(--ink); color: var(--paper);
    padding: 12px 18px; border-radius: 999px; font-size: 13.5px; font-weight: 600; opacity: 0;
    pointer-events: none; transition: opacity var(--t-2), transform var(--t-2) var(--e-out);
    box-shadow: var(--sh-lg); max-width: 88vw; text-align: center; }
  #toast.show { opacity: 1; transform: translate(-50%, 0); }

  /* ---------- tab bar ---------- */
  .tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: flex;
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    -webkit-backdrop-filter: blur(22px) saturate(1.6); backdrop-filter: blur(22px) saturate(1.6);
    border-top: 1px solid var(--line); padding: 8px 6px calc(6px + env(safe-area-inset-bottom)); }
  .tab { flex: 1; border: none; background: none; display: flex; flex-direction: column;
    align-items: center; gap: 4px; padding: 5px 2px; color: var(--muted); font-size: 10px;
    font-weight: 650; letter-spacing: .02em; transition: color var(--t-2); }
  .tab .ti { font-size: 19px; line-height: 1; filter: grayscale(1); opacity: .55;
    transition: filter var(--t-2), opacity var(--t-2), transform var(--t-2) var(--e-out); }
  .tab.active { color: var(--ember-ink); }
  .tab.active .ti { filter: none; opacity: 1; transform: translateY(-1px) scale(1.08); }

  /* ---------- pull to refresh ---------- */
  #ptr { position: fixed; top: calc(env(safe-area-inset-top) + 6px); left: 50%; z-index: 30;
    width: 30px; height: 30px; margin-left: -15px; border-radius: 999px; background: var(--card);
    box-shadow: var(--sh-md); display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; color: var(--ember); font-size: 15px; }

  /* ---------- plan ---------- */
  .view { display: none; padding: 4px 18px 30px; }
  .view.open { display: block; }
  .weekbar { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin: 10px 0 16px; }
  .weekbar b { font-family: var(--display); font-size: 16px; font-weight: 700; letter-spacing: -.02em; }
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
  .stat .v { font-family: var(--display); font-size: 24px; font-weight: 700; letter-spacing: -.03em;
    line-height: 1; color: var(--ink); }
  .stat .k { font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--muted); margin-top: 6px; }
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
      opacity var(--t-3) var(--e-out); }
  .bodybox .lit { fill: var(--ember); background-color: var(--ember); }
  .bodybox.s2 .lv1 { opacity: .45; }
  .bodybox.s2 .lv2 { opacity: 1; }
  /* Primary carries a rim as well as its weight, so the split survives a colour-blind
     eye and a bad screen. MuscleWiki hatches its primaries for the same reason; a rim
     is the version of that which does not turn ten regions into texture. */
  .bodybox.s2 .bodymus.lv2, .bodybox.s2 .sw.lv2 { stroke: var(--ember-ink);
    stroke-width: 1px; vector-effect: non-scaling-stroke;
    box-shadow: inset 0 0 0 1px var(--ember-ink); }
  .bodybox.s4 .lv1 { opacity: .26; }
  .bodybox.s4 .lv2 { opacity: .5; }
  .bodybox.s4 .lv3 { opacity: .74; }
  .bodybox.s4 .lv4 { opacity: 1; }
  .bodybox .bodymus { cursor: pointer; outline: none; }
  .bodybox .bodymus.sel, .bodybox .bodymus:focus-visible { stroke: var(--ink);
    stroke-width: 1.6px; vector-effect: non-scaling-stroke; }
  .bodylbl { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--muted); margin-top: 7px; }
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
    .bodyfig { animation: none; }
    .bodybox .bodymus, .bodybox .sw, .bodypick { transition: none; }
  }

  /* ---------- workout mode ---------- */
  #workout { position: fixed; inset: 0; z-index: 80; background-color: var(--paper);
    background-image: radial-gradient(140% 90% at 50% -10%, var(--ember-soft), transparent 62%), var(--grain);
    display: none; flex-direction: column; }
  #workout.open { display: flex; animation: fadein var(--t-3) var(--e-soft); }
  .wtop { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: calc(10px + env(safe-area-inset-top)) 16px 6px; }
  .wclock { font-family: var(--display); font-size: 14px; font-weight: 700; color: var(--muted);
    font-variant-numeric: tabular-nums; }
  .wdots { display: flex; gap: 5px; justify-content: center; flex-wrap: wrap; padding: 8px 20px 0; }
  .wdot { width: 6px; height: 6px; border-radius: 999px; background: var(--line-2);
    transition: background-color var(--t-2), transform var(--t-2) var(--e-out); }
  .wdot.on { background: var(--ember); transform: scale(1.4); }
  .wdot.done { background: var(--good); }
  .wmain { flex: 1; display: flex; flex-direction: column; justify-content: center;
    padding: 10px 26px; text-align: center; overflow-y: auto; }
  .wblock { font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
    color: var(--ember-ink); margin-bottom: 12px; }
  .wname { font-family: var(--display); font-size: 32px; font-weight: 700; line-height: 1.12;
    letter-spacing: -.035em; margin: 0 0 12px; }
  .wdose { font-size: 16px; color: var(--ink-2); font-weight: 600; margin-bottom: 4px; }
  .wnote { font-size: 13.5px; color: var(--muted); line-height: 1.55; margin-top: 10px; }
  .setpills { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 22px 0 6px; }
  .setpill { border: 1px solid var(--line-2); background: var(--card); border-radius: 14px;
    padding: 10px 13px; min-width: 74px; font-size: 12px; color: var(--muted); font-weight: 600;
    line-height: 1.3; transition: transform var(--t-1) var(--e-out); }
  .setpill:active { transform: scale(.94); }
  .setpill b { display: block; font-family: var(--display); font-size: 15px; color: var(--ink);
    font-weight: 700; margin-bottom: 2px; font-variant-numeric: tabular-nums; }
  .setpill.done { background: var(--ember); border-color: var(--ember); color: var(--on-ember); }
  .setpill.done b { color: var(--on-ember); }
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
  .resttimer { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 16px;
    font-size: 13px; font-weight: 650; color: var(--ember-ink); }
  .resttimer .ring { width: 34px; height: 34px; border-radius: 999px; border: 3px solid var(--ember-soft);
    border-top-color: var(--ember); animation: spin 1s linear infinite; }
  .stepper { display: flex; align-items: center; gap: 12px; justify-content: center; margin: 14px 0; }
  .stepper button { width: 46px; height: 46px; border-radius: 999px; border: 1px solid var(--line-2);
    background: var(--card); color: var(--ink); font-size: 20px; line-height: 1; }
  .stepper .val { font-family: var(--display); font-size: 30px; font-weight: 700; min-width: 96px;
    text-align: center; font-variant-numeric: tabular-nums; letter-spacing: -.03em; }
  .stepper .val small { display: block; font-size: 10px; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: var(--muted); margin-top: 4px; }

  /* ---------- Pumpy ----------
     The coach's mark is currentColor everywhere it appears, so it takes the tab's
     muted/ember state and the avatar's ember-on-soft without extra rules. Chat
     bubbles borrow the card and accent surfaces; the proposal card is the one
     place the accent is used as a border, because it is the one thing on the
     screen asking for a decision. */
  .tab .ti svg { width: 21px; height: 21px; display: block; }
  .tab .ti#pumpytab { filter: none; opacity: .55; }
  .tab.active .ti#pumpytab { opacity: 1; }
  .pmark { width: 28px; height: 28px; border-radius: 999px; background: var(--ember-soft); color: var(--ember-ink);
    display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .pmark svg { width: 17px; height: 17px; display: block; }
  .noimg.pumpyimg { color: var(--ember); opacity: .9; }
  .noimg.pumpyimg svg { width: 46px; height: 46px; }
  /* The Pumpy tab is a column as tall as what is left of the screen once the
     sticky header and the fixed tab bar have taken their share, so the composer
     lands on the tab bar whether the thread is empty or endless. Both numbers are
     measured once by sizePumpy() and written here as custom properties; the
     fallbacks are only ever used for the first paint. The page keeps scrolling on
     the body — the log is not its own scroller, which is what makes the iOS
     keyboard behave. */
  #pumpyview { padding-bottom: 0; }
  #pumpyview.open { display: flex; flex-direction: column;
    min-height: calc(100vh - var(--pumpytop, 130px) - var(--ptab, 78px));
    min-height: calc(100dvh - var(--pumpytop, 130px) - var(--ptab, 78px)); }
  body.app.pumpy { padding-bottom: var(--ptab, calc(78px + env(safe-area-inset-bottom))); }
  #pumpylog { display: flex; flex-direction: column; gap: 10px; padding: 6px 0 14px; flex: 1 1 auto;
    min-height: 0; }
  #pumpylog.hello { justify-content: center; }
  .pumpybar { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 2px 0 4px; }
  .pumpybar .chip { padding: 8px 13px; font-size: 12.5px; }
  .pumpyhello { text-align: center; padding: 22px 12px 8px; color: var(--ink-2); font-size: 14px; line-height: 1.6; }
  .pumpyhello .pmark { width: 60px; height: 60px; margin: 0 auto 12px; box-shadow: var(--sh-md); }
  .pumpyhello .pmark svg { width: 34px; height: 34px; }
  .pumpyhello h2 { font-family: var(--display); font-size: 22px; font-weight: 700; margin: 0 0 6px; color: var(--ink);
    letter-spacing: -.025em; }
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
  .msg.typing { color: var(--muted); letter-spacing: .2em; }
  .proposal { background: var(--card); border: 1.5px solid var(--ember); border-radius: 18px; padding: 14px 16px 12px;
    box-shadow: var(--sh-md); }
  .proposal h4 { font-family: var(--display); font-size: 11px; font-weight: 700; letter-spacing: .13em;
    text-transform: uppercase; color: var(--ember-ink); margin: 0 0 8px; }
  .proposal .ptitle { font-family: var(--display); font-size: 18px; font-weight: 700; letter-spacing: -.02em;
    margin: 0 0 4px; line-height: 1.2; }
  .proposal .pmeta { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .proposal .pblock { font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--muted); margin: 10px 0 2px; }
  .proposal .pline { font-size: 13.5px; line-height: 1.5; color: var(--ink-2); padding: 6px 0;
    border-top: 1px solid var(--line); }
  .proposal .pline b { color: var(--ink); font-weight: 650; }
  .proposal .btnrow { margin-top: 12px; }
  .proposal .btnrow .btn { padding: 12px; font-size: 14.5px; }
  .proposal .done { color: var(--good); font-weight: 700; font-size: 13px; margin-top: 10px; }
  .proposal .declined { color: var(--muted); font-size: 13px; margin-top: 10px; }
  .composer { position: sticky; bottom: var(--ptab, calc(78px + env(safe-area-inset-bottom)));
    padding: 8px 0 10px;
    background: color-mix(in srgb, var(--paper) 90%, transparent);
    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
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
  .setnote { font-size: 12.5px; color: var(--muted); line-height: 1.5; padding: 0 0 12px; margin-top: -4px; }

  /* ---------- install hint ---------- */
  #hint { margin: 12px 18px 0; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; padding: 13px 15px; font-size: 13px; line-height: 1.55; color: var(--ink-2);
    display: none; align-items: flex-start; gap: 11px; box-shadow: var(--sh-sm); }
  #hint.show { display: flex; }
  #hint b { color: var(--ink); }
  #hint button { background: none; border: none; color: var(--muted); font-size: 17px; padding: 0 2px;
    line-height: 1; flex: 0 0 auto; }
</style>
`;
