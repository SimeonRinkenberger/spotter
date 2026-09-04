// Page head (before <style>) and body markup (after it).
// Wrapped in String.raw; never use backticks or "${" inside.

export const MARKUP_HEAD = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Spotter — save any workout video</title>
<meta name="description" content="Save fitness videos from TikTok, Instagram and YouTube. Spotter pulls out the exercises, sets and reps, then walks you through the workout and logs what you lifted.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Spotter">
<link rel="apple-touch-icon" href="icon.png">
<link rel="icon" href="icon.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#F5F6F8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101214" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Two font hosts now, so two preconnects: the display face lives at Fontshare,
     and its file host is only discovered after that stylesheet has parsed. -->
<link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&display=swap" rel="stylesheet">
`;

export const MARKUP_BODY = String.raw`</head>
<body>

<!-- ---------- the icon set ----------
     Lucide's 24px grid and 2px round-cap language (ISC, no attribution needed),
     hand-inlined: only the glyphs this app draws, not the generated sprite, which
     Lucide's own guide warns loads the whole library. Several paths are redrawn
     simpler than Lucide's — the gear, the barbell, the ear — because at 16-21px
     the extra control points are mud, and because they were the expensive ones.
     Before this the app wore 26 emoji: a different picture on every OS, and a
     screen reader saying "clockwise open circle arrow" where a person sees
     Refresh. Everything is stroked in currentColor, so each icon inherits the
     colour rule that dressed the character it replaces. -->
<svg class="sprite" aria-hidden="true" focusable="false">
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></symbol>
<symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
<symbol id="i-star" viewBox="0 0 24 24"><path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></symbol>
<symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></symbol>
<symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></symbol>
<symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></symbol>
<symbol id="i-arrow-up-right" viewBox="0 0 24 24"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></symbol>
<symbol id="i-swap" viewBox="0 0 24 24"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M21 3.5V6h-2.5"/></symbol>
<symbol id="i-settings" viewBox="0 0 24 24"><path d="M13.8 2.5h-3.6l-.5 2.6-2.3 1.3-2.5-.9-1.8 3.1 2 1.7v2.6l-2 1.7 1.8 3.1 2.5-.9 2.3 1.3.5 2.6h3.6l.5-2.6 2.3-1.3 2.5.9 1.8-3.1-2-1.7v-2.6l2-1.7-1.8-3.1-2.5.9-2.3-1.3z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-list" viewBox="0 0 24 24"><path d="M3.5 6h17"/><path d="M3.5 12h17"/><path d="M3.5 18h17"/></symbol>
<symbol id="i-pencil" viewBox="0 0 24 24"><path d="M18.5 2.5a2.8 2.8 0 0 1 4 4L7 22l-5 1 1-5z"/><path d="m15 5 4 4"/></symbol>
<symbol id="i-folder" viewBox="0 0 24 24"><path d="M2 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>
<symbol id="i-upload" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3.5v11"/></symbol>
<symbol id="i-dumbbell" viewBox="0 0 24 24"><path d="M2.5 9.5v5"/><path d="M6 6.5v11"/><path d="M18 6.5v11"/><path d="M21.5 9.5v5"/><path d="M6 12h12"/></symbol>
<symbol id="i-calendar" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></symbol>
<symbol id="i-trend" viewBox="0 0 24 24"><path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M6 3.5 20 12 6 20.5z"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-ear" viewBox="0 0 24 24"><path d="M3 15h2.5a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 5.5 21H4a1 1 0 0 1-1-1v-8a9 9 0 0 1 18 0v8a1 1 0 0 1-1 1h-1.5a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5H21"/></symbol>
<symbol id="i-hourglass" viewBox="0 0 24 24"><path d="M6 2h12"/><path d="M6 22h12"/><path d="M17 2v4.5L12 12l5 5.5V22"/><path d="M7 2v4.5L12 12l-5 5.5V22"/></symbol>
<symbol id="i-share" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 3 2 20.5h20z"/><path d="M12 9.5v4.5"/><path d="M12 17.5h.01"/></symbol>
<symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></symbol>
<symbol id="i-volume-2" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5.2a10 10 0 0 1 0 13.6"/></symbol>
<symbol id="i-volume-x" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></symbol>
<symbol id="i-youtube" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="4.5"/><path d="m10.2 9 4.6 3-4.6 3z"/></symbol>
</svg>

<!-- ---------- signed out ---------- -->
<div id="landing">
  <div class="land">
    <div class="brandrow"><img src="icon.png" alt=""><span>Spotter</span></div>
    <h1 class="hero">Save any workout video. <em>Actually do the workout.</em></h1>
    <p class="sub">You save fitness reels you never come back to. Spotter reads the exercises,
      sets and reps out of the video, then walks you through them one at a time and remembers
      what you lifted.</p>
    <ol class="steps">
      <li><span class="num">1</span><div><b>Paste a link</b> from TikTok, Instagram or YouTube — or share straight from your phone.</div></li>
      <li><span class="num">2</span><div><b>Get a real workout card</b> — every exercise with its sets, reps and rest, not a wall of caption text.</div></li>
      <li><span class="num">3</span><div><b>Train and log it</b> — full-screen, one move at a time, tracking weight and reps as you go.</div></li>
    </ol>

    <div class="authcard">
      <h2 id="authtitle">Create your account</h2>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" type="password" autocomplete="current-password" placeholder="At least 8 characters">
      </div>
      <button class="btn" id="authgo">Create account</button>
      <div class="autherr" id="autherr"></div>
      <!-- Only on the sign-in face. Offering it while somebody is creating an
           account is offering to reset a password that does not exist yet. -->
      <div class="authswap hide" id="forgotwrap"><button id="forgotpw" type="button">Forgot your password?</button></div>
      <!-- Provider sign-in. Both buttons stay in the DOM and are unhidden by
           renderAuthProviders() in app.ts once auth/v1/settings says the provider
           is switched on for this project; with neither enabled this whole block
           is display:none and the card is byte-for-byte the card that shipped
           before. Marks are inline SVG so the buttons paint with the page and
           never wait on a third-party image. -->
      <div class="oauth hide" id="oauthwrap">
        <div class="oauthdiv"><span>or</span></div>
        <div class="oauthbtns" id="oauthbtns">
          <button class="oabtn hide" id="oagoogle" type="button">
            <span class="oamark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 48 48" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.97-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path></svg></span>
            <span class="oalabel">Continue with Google</span>
          </button>
          <button class="oabtn hide" id="oaapple" type="button">
            <span class="oamark" aria-hidden="true"><svg width="17" height="20" viewBox="0 0 814 1000" fill="currentColor" focusable="false"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"></path></svg></span>
            <span class="oalabel">Continue with Apple</span>
          </button>
        </div>
      </div>
      <div class="authswap" id="authswap">Already have an account? <button id="authtoggle">Sign in</button></div>
    </div>
    <!-- Somebody made this. Software with no maker, no version and no way to say
         something is wrong reads as unowned however good it is, and that absence
         was the loudest thing about this page. -->
    <div class="landfoot">Made by Simeon Rinkenberger · Free while in beta ·
      <a href="whats-new.html">What&rsquo;s new</a> · <a href="privacy.html">Privacy</a></div>
  </div>
</div>

<!-- ---------- signed in ---------- -->
<!-- Four pages side by side on one track, not four boxes taking turns at
     display:none. The header and the tab bar sit above the track and are told
     where it is every frame, so the title strips and the tab capsule move with
     the finger instead of jumping when a view swaps. Each page is its own
     vertical scroller, which is what lets a tab remember where it was left. -->
<div id="app" class="hide">
  <div id="ptr"><svg class="ic"><use href="#i-refresh"></use></svg></div>

  <header>
    <div class="titlerow">
      <div class="tstack">
        <h1 id="apptitle"><span class="ts">Spotter</span><span class="ts" aria-hidden="true">Plan</span><span class="ts" aria-hidden="true">Progress</span><span class="ts" aria-hidden="true">Pumpy</span></h1>
        <div class="count" id="count"><span class="ts" id="count0">Reading your library</span><span class="ts" aria-hidden="true">This week</span><span class="ts" aria-hidden="true">Your numbers</span><span class="ts" aria-hidden="true">Your coach</span></div>
      </div>
      <div class="hbtns">
        <button class="addbtn ghost" id="settingsbtn" title="Settings" aria-label="Settings"><svg class="ic"><use href="#i-settings"></use></svg></button>
        <button class="addbtn ghost" id="refreshbtn" title="Refresh" aria-label="Refresh"><svg class="ic"><use href="#i-refresh"></use></svg></button>
        <button class="addbtn" id="addbtn" title="Add a workout" aria-label="Add a workout"><svg class="ic"><use href="#i-plus"></use></svg></button>
      </div>
    </div>
  </header>

  <div class="pages" id="pages">
    <div class="track" id="track">
      <div class="page" id="libpage" role="tabpanel" aria-labelledby="tab0">
        <label class="searchwrap" id="searchwrap">
          <span class="searchico"><svg class="ic"><use href="#i-search"></use></svg></span>
          <input class="search" id="search" type="search" placeholder="Search workouts, exercises, muscles" autocapitalize="off" autocomplete="off">
        </label>

        <div id="hint">
          <div id="hinttext">Spotter works better installed — full screen, and it opens like an app.
            Tap <b>Share</b>, then <b>Add to Home Screen</b>.</div>
          <button id="hintx" aria-label="Dismiss"><svg class="ic"><use href="#i-x"></use></svg></button>
        </div>

        <div class="chips" id="chips"></div>
        <div class="colbar hide" id="colbar"></div>
        <div class="grid" id="grid"></div>
        <div class="empty hide" id="empty"></div>
      </div>

      <div class="page view" id="planview" role="tabpanel" aria-labelledby="tab1"></div>
      <div class="page view" id="progressview" role="tabpanel" aria-labelledby="tab2"></div>
      <div class="page view" id="pumpyview" role="tabpanel" aria-labelledby="tab3">
        <div class="pumpybar">
          <button class="chip" id="pumpychats"><svg class="ic"><use href="#i-list"></use></svg>Chats</button>
          <button class="chip" id="pumpynew"><svg class="ic"><use href="#i-plus"></use></svg>New chat</button>
        </div>
        <div id="pumpylog"></div>
        <div class="composer" id="pumpycomposer">
          <div class="pumpyctx hide" id="pumpyctx"></div>
          <div class="pumpycredits hide" id="pumpycredits"></div>
          <div class="composerrow">
            <textarea id="pumpyinput" rows="1" placeholder="Ask Pumpy…" autocapitalize="sentences"></textarea>
            <button class="addbtn" id="pumpysend" aria-label="Send"><svg class="ic"><use href="#i-arrow-up"></use></svg></button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <nav class="tabbar" role="tablist" aria-label="Sections">
    <div class="tabpill" aria-hidden="true"></div>
    <button class="tab active" id="tab0" role="tab" aria-selected="true" aria-controls="libpage" data-view="library"><span class="ti"><svg class="ic"><use href="#i-dumbbell"></use></svg></span><span class="tl">Library</span></button>
    <button class="tab" id="tab1" role="tab" aria-selected="false" aria-controls="planview" data-view="plan"><span class="ti"><svg class="ic"><use href="#i-calendar"></use></svg></span><span class="tl">Plan</span></button>
    <button class="tab" id="tab2" role="tab" aria-selected="false" aria-controls="progressview" data-view="progress"><span class="ti"><svg class="ic"><use href="#i-trend"></use></svg></span><span class="tl">Progress</span></button>
    <button class="tab" id="tab3" role="tab" aria-selected="false" aria-controls="pumpyview" data-view="pumpy"><span class="ti" id="pumpytab"></span><span class="tl">Pumpy</span></button>
  </nav>
</div>

<!-- ---------- detail ---------- -->
<div class="overlay" id="detail">
  <div class="dtop">
    <button class="iconbtn" id="dclose" aria-label="Back"><svg class="ic"><use href="#i-arrow-left"></use></svg></button>
    <div class="hbtns">
      <button class="iconbtn" id="dfav" title="Favourite" aria-label="Favourite" aria-pressed="false"><svg class="ic"><use href="#i-star"></use></svg></button>
      <button class="iconbtn" id="dshare" title="Share" aria-label="Share"><svg class="ic"><use href="#i-share"></use></svg></button>
      <button class="iconbtn" id="dreproc" title="Read it again" aria-label="Read it again"><svg class="ic"><use href="#i-refresh"></use></svg></button>
    </div>
  </div>
  <div class="dinner" id="dinner"></div>
</div>

<!-- ---------- workout mode ---------- -->
<div id="workout">
  <div class="wtop">
    <button class="iconbtn" id="wclose" aria-label="Exit workout"><svg class="ic"><use href="#i-x"></use></svg></button>
    <div class="wclock" id="wclock">0:00</div>
    <!-- Sounds start themselves, so the switch for them belongs where they play,
         not three taps away in Settings. aria-pressed carries the state that the
         icon carries for everyone else. -->
    <div class="wtools">
      <button class="iconbtn" id="wsound" aria-label="Timer sounds" aria-pressed="true"><svg class="ic"><use href="#i-volume-2"></use></svg></button>
      <button class="iconbtn" id="wlist" aria-label="All exercises"><svg class="ic"><use href="#i-list"></use></svg></button>
    </div>
  </div>
  <div class="wdots" id="wdots"></div>
  <div class="wmain" id="wmain"></div>
  <!-- Out here rather than inside .wmain: a rest belongs to the lifter, not to the
       screen they happen to be looking at. Swiping on used to throw it away. -->
  <div class="reststrip" id="reststrip">
    <button class="ring" id="restring" aria-label="Pause or resume the rest"><span id="restnum">0</span></button>
    <span class="restword" id="restword">Rest</span>
    <!-- A clock that used to chime and now does not should say why, right here,
         rather than leave the silence to be read as a bug. -->
    <svg class="ic wmute" aria-hidden="true"><use href="#i-volume-x"></use></svg>
    <button class="chip" id="restplus">+15 s</button>
    <button class="chip" id="restskip">Skip</button>
  </div>
  <div class="wbottom">
    <button class="wnav" id="wprev" aria-label="Previous exercise"><svg class="ic"><use href="#i-arrow-left"></use></svg></button>
    <button class="wfinish" id="wfinish">Finish workout</button>
    <button class="wnav" id="wnext" aria-label="Next exercise"><svg class="ic"><use href="#i-arrow-right"></use></svg></button>
  </div>
</div>

<!-- ---------- sheets ---------- -->
<div class="sheet" id="addsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>Add a workout</h2>
  <p class="lede">Paste a link to a TikTok, Instagram reel, YouTube video, or any workout page.</p>
  <div class="field"><input id="addurl" type="url" placeholder="https://..." autocapitalize="off" autocomplete="off" spellcheck="false"></div>
  <button class="btn" id="addgo">Save workout</button>

  <!-- The last rung of the ingest ladder, and deliberately the quiet one: pasting a
       link is the everyday path, and this is for the video nobody wrote a caption
       for. The size limit is stated here rather than only in the error, so being
       told the file is too big confirms a rule the user already read. -->
  <div class="upblock">
    <button class="uploadrow" id="uploadrow" type="button">
      <span class="upmark" aria-hidden="true"><svg class="ic"><use href="#i-upload"></use></svg></span>
      <span class="uptext">
        <b>Upload a video you saved</b>
        <small>For creators who say the workout instead of writing it. MP4, M4A, MP3, WAV or WebM, up to 25 MB.</small>
      </span>
    </button>
    <input id="addfile" type="file" accept="video/*,audio/*" hidden>
    <div class="uperr" id="uperr" hidden></div>
    <div class="upprog" id="upprog" hidden>
      <div class="upbar"><i id="upfill"></i></div>
      <div class="upnote" id="upnote">Uploading&hellip;</div>
    </div>
  </div>
</div></div>

<div class="sheet" id="setsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="settitle">Log set</h2>
  <div class="wnote setlast" id="setlast"></div>
  <div class="stepper">
    <button id="repsdown" aria-label="Fewer reps"><svg class="ic"><use href="#i-minus"></use></svg></button>
    <div class="val"><span id="repsval">10</span><small>reps</small></div>
    <button id="repsup" aria-label="More reps"><svg class="ic"><use href="#i-plus"></use></svg></button>
  </div>
  <div class="stepper">
    <button id="wtdown" aria-label="Less weight"><svg class="ic"><use href="#i-minus"></use></svg></button>
    <div class="val"><span id="wtval">0</span><small id="wtunit">lb</small></div>
    <button id="wtup" aria-label="More weight"><svg class="ic"><use href="#i-plus"></use></svg></button>
  </div>
  <div class="btnrow">
    <button class="btn ghost" id="setclear">Clear</button>
    <button class="btn" id="setsave">Save set</button>
  </div>
</div></div>

<!-- The premise of the app at the moment it is needed: the clip, three feet from the
     barbell. #watchbody is filled on open and emptied on close — an Instagram or
     TikTok iframe left alive behind Workout Mode keeps loading, and takes the audio
     with it. -->
<div class="sheet" id="watchsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>Watch the clip</h2>
  <div id="watchbody"></div>
  <button class="btn ghost" id="watchclose">Close</button>
</div></div>

<div class="sheet" id="exsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>All exercises</h2>
  <div id="exlist"></div>
</div></div>

<div class="sheet" id="exeditsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="exedittitle">Fix this exercise</h2>
  <p class="lede" id="exeditlede">Spotter read this off the video. If it got it wrong, put it right — your change stays on your copy.</p>
  <div class="field">
    <label for="exeditname">Exercise</label>
    <input id="exeditname" type="text" placeholder="Goblet squat" autocapitalize="words" autocomplete="off" spellcheck="false">
  </div>
  <div class="fieldrow">
    <div class="field">
      <label for="exeditsets">Sets</label>
      <input id="exeditsets" type="number" inputmode="numeric" min="1" max="99" placeholder="—">
    </div>
    <div class="field">
      <label for="exeditreps">Reps</label>
      <input id="exeditreps" type="text" inputmode="numeric" placeholder="—" autocomplete="off">
    </div>
    <div class="field">
      <label for="exeditsecs">Seconds</label>
      <input id="exeditsecs" type="number" inputmode="numeric" min="1" max="3600" placeholder="—">
    </div>
  </div>
  <div class="btnrow">
    <button class="btn ghost" id="exeditcancel">Cancel</button>
    <button class="btn" id="exeditsave">Save change</button>
  </div>
  <button class="danger" id="exeditdelete">Not a real exercise — remove it</button>
</div></div>

<!-- Three answers, in the order they earn: what the creator said, somebody filming
     the movement properly, then the AI. #explainpre holds the quote and stays empty
     when there is nothing honest to put in it. #explainvid is a collapsed slot that
     grows to whatever the clip lookup turned out to need, so the explanation glides
     down instead of jumping when the answer arrives late. -->
<div class="sheet" id="explainsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="explaintitle">How to do it</h2>
  <div id="explainpre"></div>
  <div class="vslot" id="explainvid"><div id="explainvidin"></div></div>
  <div class="aitext" id="explaintext">Reading up on it&hellip;</div>
  <div class="btnrow"><button class="btn ghost" id="swapgo"><svg class="ic"><use href="#i-swap"></use></svg>Swap or modify</button></div>
</div></div>

<div class="sheet" id="swapsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="swaptitle">Swap or modify</h2>
  <p class="lede" id="swaplede">Why do you need something different?</p>
  <div class="pillrow" id="swapreasons"></div>
  <div class="pillrow hide" id="swapareas"></div>
  <div class="newcol hide" id="swaphave">
    <input class="nm" id="swaphaveinput" type="text" placeholder="Have anything? e.g. dumbbells, bands" autocomplete="off" autocapitalize="off" aria-label="Available equipment">
    <button class="btn" id="swaphavego">Find swaps</button>
  </div>
  <div id="swapresult"></div>
</div></div>

<div class="sheet" id="picksheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="picktitle">Pick a workout</h2>
  <div class="picklist" id="picklist"></div>
</div></div>

<div class="sheet" id="colsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="coltitle">Collections</h2>
  <p class="lede" id="collede">A workout can live in several — tap to add or remove.</p>
  <div class="picklist" id="collist"></div>
  <div class="newcol">
    <input class="emo" id="colemoji" type="text" placeholder="🏷" maxlength="4" autocomplete="off" aria-label="Emoji">
    <input class="nm" id="colname" type="text" placeholder="New collection" maxlength="60" autocapitalize="sentences" autocomplete="off" aria-label="Collection name">
    <button class="btn" id="colcreate">Create</button>
  </div>
</div></div>

<div class="sheet" id="capsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>Paste the caption</h2>
  <p class="lede" id="caplede">Copy the workout text from the post and paste it here.</p>
  <div class="field">
    <label for="capinput">Caption</label>
    <textarea id="capinput" rows="8" placeholder="3 rounds&#10;10 goblet squats&#10;12 push ups&#10;15 kettlebell swings" autocapitalize="sentences" autocomplete="off" spellcheck="false"></textarea>
  </div>
  <div class="btnrow">
    <button class="btn ghost" id="capcancel">Cancel</button>
    <button class="btn" id="capgo">Read it</button>
  </div>
</div></div>

<div class="sheet" id="renamesheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="renametitle">Rename</h2>
  <div class="field">
    <label for="renameinput">Name</label>
    <input id="renameinput" type="text" maxlength="160" autocapitalize="sentences" autocomplete="off">
  </div>
  <div class="btnrow">
    <button class="btn ghost" id="renamecancel">Cancel</button>
    <button class="btn" id="renamesave">Save</button>
  </div>
</div></div>

<div class="sheet" id="pumpysheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>Your chats</h2>
  <p class="lede">Every conversation you have had with Pumpy. Tap one to pick it up.</p>
  <div id="pumpythreads"></div>
</div></div>

<!-- Settings is a grouped list now, five sections deep, in the order a person
     asks the questions: who am I, how should it behave, how do I get videos in,
     what do you hold on me, what is this. Apple's rule for a settings screen and
     the shape every fitness app looked at (Hevy, Strong, Fitbod) already uses.
     Sign out breaks with those three, which all park it at the very foot: here it
     ends the FIRST section, because at the foot it sat under a Shortcut how-to
     nobody could scroll past, and a control that cannot be found is not shipped.
     Delete account stays last, which is where destructive belongs. -->
<div class="sheet" id="settingssheet"><div class="sheetbody">
  <div class="grabber"></div>
  <button class="iconbtn sheetx" id="setclose" aria-label="Close settings"><svg class="ic"><use href="#i-x"></use></svg></button>
  <h2>Settings</h2>

  <h3 class="seth">Account</h3>
  <div class="setgroup">
    <button class="kv row" id="setmailrow"><span class="k">Email</span><span class="v" id="setemail">&mdash;</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <div class="kv hide" id="setprovrow"><span class="k">Sign-in method</span><span class="v" id="setprov">&mdash;</span></div>
    <button class="kv row" id="setnamerow"><span class="k">Name</span><span class="v" id="setname">&mdash;</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <button class="kv row hide" id="setpwrow"><span class="k">Password</span><span class="v">Change</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <div class="kv"><span class="k">Saved today</span><span class="v" id="setsaves">&mdash;</span></div>
  </div>
  <div class="setnote hide" id="setpumpy"></div>
  <button class="btn ghost setout" id="signout">Sign out</button>

  <h3 class="seth">Preferences</h3>
  <div class="setgroup">
    <div class="kv"><span class="k">Weight unit</span>
      <span class="v"><button class="chip" id="unittoggle">lb</button></span></div>
    <div class="kv"><span class="k">Timer sounds</span>
      <span class="v"><button class="chip" id="soundtoggle">On</button></span></div>
    <!-- Unhidden only where the browser will actually buzz. iOS Safari has no
         navigator.vibrate at all, and a switch over nothing is a lie. -->
    <div class="kv hide" id="sethapticrow"><span class="k">Vibration</span>
      <span class="v"><button class="chip" id="haptictoggle">On</button></span></div>
  </div>
  <div class="setnote">The sounds are three ticks and a chime, and only play while Spotter is
    open &mdash; also switchable from Workout Mode's top bar. How long you rest comes from the
    card the video made, not from here.</div>

  <h3 class="seth">Save from your phone</h3>
  <p class="lede"><b>Android</b> &mdash; install Spotter, then share any video to it from the share
    sheet. Nothing below is needed.</p>
  <p class="lede"><b>iPhone</b> &mdash; for now, make a Shortcut that POSTs the shared link to this
    address. A native share option is coming with the App Store version. Keep the address
    private &mdash; it works without your password.</p>
  <div class="keybox" id="setkey">&mdash;</div>
  <div class="btnrow">
    <button class="btn ghost" id="copykey">Copy address</button>
    <button class="btn ghost" id="rotatekey">New key</button>
  </div>

  <h3 class="seth">Data &amp; privacy</h3>
  <div class="setgroup">
    <button class="kv row" id="setexport"><span class="k">Export my data</span><span class="v" id="setexportv">JSON</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <a class="kv row" href="privacy.html"><span class="k">Privacy policy</span><svg class="ic chev"><use href="#i-chev"></use></svg></a>
    <button class="kv row del" id="setdelete"><span class="k">Delete account</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
  </div>

  <h3 class="seth">About</h3>
  <div class="setgroup">
    <a class="kv row" href="whats-new.html"><span class="k">What&rsquo;s new</span><span class="v" id="setver">&mdash;</span><svg class="ic chev"><use href="#i-chev"></use></svg></a>
    <button class="kv row" id="settell"><span class="k">Tell a friend</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <a class="kv row" href="https://github.com/SimeonRinkenberger/spotter/issues" target="_blank" rel="noopener"><span class="k">Something wrong? Tell me</span><svg class="ic chev"><use href="#i-chev"></use></svg></a>
  </div>
  <!-- What this phone believes about its own screen. Staff only, and there so the
       one person holding an affected device can photograph the numbers. -->
  <div class="setnote foot hide" id="setdiag"></div>
  <!-- The last line of the app, and the one that says a person is behind it. The
       report goes to the public issue tracker rather than an address, because an
       address in a public page is an address that gets harvested. -->
  <div class="setnote foot">Made by Simeon Rinkenberger &middot; Free while in beta</div>
</div></div>

<!-- One sheet for every account question, dressed by JS. Rename, change password,
     change email, ask for a reset link, choose a new one after following it, and
     confirm a deletion are the same object: a title, a sentence, some fields, one
     button that does the thing. Six sheets of markup would have been six copies of
     the same twenty lines and six more things to keep in step. -->
<div class="sheet" id="accountsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="acctitle">Account</h2>
  <p class="lede" id="acclede"></p>
  <div id="accfields"></div>
  <div class="autherr" id="accerr"></div>
  <div class="btnrow">
    <button class="btn ghost" id="acccancel">Cancel</button>
    <button class="btn" id="accgo">Save</button>
  </div>
</div></div>

<div id="toast"></div>
`;
