// Page head (before <style>) and body markup (after it).
// Wrapped in String.raw; never use backticks or "${" inside.

export const MARKUP_HEAD = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, interactive-widget=resizes-content">
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
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
`;

export const MARKUP_BODY = String.raw`</head>
<body>

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
    <div class="landfoot">Free while in beta · <a href="privacy.html">Privacy</a></div>
  </div>
</div>

<!-- ---------- signed in ---------- -->
<!-- Four pages side by side on one track, not four boxes taking turns at
     display:none. The header and the tab bar sit above the track and are told
     where it is every frame, so the title strips and the tab capsule move with
     the finger instead of jumping when a view swaps. Each page is its own
     vertical scroller, which is what lets a tab remember where it was left. -->
<div id="app" class="hide">
  <div id="ptr">↻</div>

  <header>
    <div class="titlerow">
      <div class="tstack">
        <h1 id="apptitle"><span class="ts">Spotter</span><span class="ts" aria-hidden="true">Plan</span><span class="ts" aria-hidden="true">Progress</span><span class="ts" aria-hidden="true">Pumpy</span></h1>
        <div class="count" id="count"><span class="ts" id="count0">Loading</span><span class="ts" aria-hidden="true">This week</span><span class="ts" aria-hidden="true">Your numbers</span><span class="ts" aria-hidden="true">Your coach</span></div>
      </div>
      <div class="hbtns">
        <button class="addbtn ghost" id="settingsbtn" title="Settings" aria-label="Settings">⚙</button>
        <button class="addbtn ghost" id="refreshbtn" title="Refresh" aria-label="Refresh">↻</button>
        <button class="addbtn" id="addbtn" title="Add a workout" aria-label="Add a workout">+</button>
      </div>
    </div>
  </header>

  <div class="pages" id="pages">
    <div class="track" id="track">
      <div class="page" id="libpage" role="tabpanel" aria-labelledby="tab0">
        <label class="searchwrap" id="searchwrap">
          <span class="searchico">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.2-3.2"></path></svg>
          </span>
          <input class="search" id="search" type="search" placeholder="Search workouts, exercises, muscles" autocapitalize="off" autocomplete="off">
        </label>

        <div id="hint">
          <div id="hinttext">Add Spotter to your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.</div>
          <button id="hintx" aria-label="Dismiss">×</button>
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
          <button class="chip" id="pumpychats">☰ Chats</button>
          <button class="chip" id="pumpynew">＋ New chat</button>
        </div>
        <div id="pumpylog"></div>
        <div class="composer" id="pumpycomposer">
          <div class="pumpyctx hide" id="pumpyctx"></div>
          <div class="pumpycredits hide" id="pumpycredits"></div>
          <div class="composerrow">
            <textarea id="pumpyinput" rows="1" placeholder="Ask Pumpy…" autocapitalize="sentences"></textarea>
            <button class="addbtn" id="pumpysend" aria-label="Send">↑</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <nav class="tabbar" role="tablist" aria-label="Sections">
    <div class="tabpill" aria-hidden="true"></div>
    <button class="tab active" id="tab0" role="tab" aria-selected="true" aria-controls="libpage" data-view="library"><span class="ti">🏋️</span>Library</button>
    <button class="tab" id="tab1" role="tab" aria-selected="false" aria-controls="planview" data-view="plan"><span class="ti">📅</span>Plan</button>
    <button class="tab" id="tab2" role="tab" aria-selected="false" aria-controls="progressview" data-view="progress"><span class="ti">📈</span>Progress</button>
    <button class="tab" id="tab3" role="tab" aria-selected="false" aria-controls="pumpyview" data-view="pumpy"><span class="ti" id="pumpytab"></span>Pumpy</button>
  </nav>
</div>

<!-- ---------- detail ---------- -->
<div class="overlay" id="detail">
  <div class="dtop">
    <button class="iconbtn" id="dclose" aria-label="Back">←</button>
    <div class="hbtns">
      <button class="iconbtn" id="dfav" aria-label="Favorite">☆</button>
      <button class="iconbtn" id="dshare" aria-label="Share">↗</button>
      <button class="iconbtn" id="dreproc" aria-label="Re-read this video">↻</button>
    </div>
  </div>
  <div class="dinner" id="dinner"></div>
</div>

<!-- ---------- workout mode ---------- -->
<div id="workout">
  <div class="wtop">
    <button class="iconbtn" id="wclose" aria-label="Exit workout">✕</button>
    <div class="wclock" id="wclock">0:00</div>
    <button class="iconbtn" id="wlist" aria-label="All exercises">☰</button>
  </div>
  <div class="wdots" id="wdots"></div>
  <div class="wmain" id="wmain"></div>
  <!-- Out here rather than inside .wmain: a rest belongs to the lifter, not to the
       screen they happen to be looking at. Swiping on used to throw it away. -->
  <div class="reststrip" id="reststrip">
    <button class="ring" id="restring" aria-label="Pause or resume the rest"><span id="restnum">0</span></button>
    <span class="restword" id="restword">Rest</span>
    <button class="chip" id="restplus">+15 s</button>
    <button class="chip" id="restskip">Skip</button>
  </div>
  <div class="wbottom">
    <button class="wnav" id="wprev" aria-label="Previous">←</button>
    <button class="wfinish" id="wfinish">Finish workout</button>
    <button class="wnav" id="wnext" aria-label="Next">→</button>
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
      <span class="upmark" aria-hidden="true">&#8593;</span>
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
    <button id="repsdown" aria-label="Fewer reps">−</button>
    <div class="val"><span id="repsval">10</span><small>reps</small></div>
    <button id="repsup" aria-label="More reps">+</button>
  </div>
  <div class="stepper">
    <button id="wtdown" aria-label="Less weight">−</button>
    <div class="val"><span id="wtval">0</span><small id="wtunit">lb</small></div>
    <button id="wtup" aria-label="More weight">+</button>
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

<div class="sheet" id="explainsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="explaintitle">How to do it</h2>
  <div class="aitext" id="explaintext">Thinking…</div>
  <div class="btnrow"><button class="btn ghost" id="swapgo">⇄ Swap or modify</button></div>
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

<div class="sheet" id="settingssheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>Settings</h2>
  <div class="kv"><span class="k">Signed in as</span><span class="v" id="setemail">—</span></div>
  <div class="kv hide" id="setprovrow"><span class="k">Sign-in method</span><span class="v" id="setprov">—</span></div>
  <div class="kv"><span class="k">Saved today</span><span class="v" id="setsaves">—</span></div>
  <div class="setnote hide" id="setpumpy"></div>
  <div class="kv"><span class="k">Weight unit</span>
    <span class="v"><button class="chip" id="unittoggle">lb</button></span></div>
  <div class="kv"><span class="k">Rest between sets</span>
    <span class="v"><button class="chip" id="resttoggle">90 s</button></span></div>
  <div class="kv"><span class="k">Timer sounds</span>
    <span class="v"><button class="chip" id="soundtoggle">On</button></span></div>
  <div class="setnote">The rest is used when the video does not say. The sounds are three
    ticks and a chime, and only play while Spotter is open.</div>
  <h2 style="margin-top:22px;font-size:16px">Save from your phone</h2>
  <p class="lede"><b>Android</b> — install Spotter, then share any video to it from the share
    sheet. Nothing below is needed.</p>
  <p class="lede"><b>iPhone</b> — for now, make a Shortcut that POSTs the shared link to this
    address. A native share option is coming with the App Store version. Keep the address
    private — it works without your password.</p>
  <div class="keybox" id="setkey">—</div>
  <div class="btnrow">
    <button class="btn ghost" id="copykey">Copy address</button>
    <button class="btn ghost" id="rotatekey">New key</button>
  </div>
  <button class="danger" id="signout">Sign out</button>
</div></div>

<div id="toast"></div>
`;
