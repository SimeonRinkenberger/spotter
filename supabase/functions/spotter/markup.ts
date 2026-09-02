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
      <div class="authswap" id="authswap">Already have an account? <button id="authtoggle">Sign in</button></div>
    </div>
    <div class="landfoot">Free while in beta · <a href="privacy.html">Privacy</a></div>
  </div>
</div>

<!-- ---------- signed in ---------- -->
<div id="app" class="hide">
  <div id="ptr">↻</div>

  <header>
    <div class="titlerow">
      <div>
        <h1 id="apptitle">Spotter</h1>
        <div class="count" id="count">Loading</div>
      </div>
      <div class="hbtns">
        <button class="addbtn ghost" id="settingsbtn" title="Settings" aria-label="Settings">⚙</button>
        <button class="addbtn ghost" id="refreshbtn" title="Refresh" aria-label="Refresh">↻</button>
        <button class="addbtn" id="addbtn" title="Add a workout" aria-label="Add a workout">+</button>
      </div>
    </div>
    <label class="searchwrap" id="searchwrap">
      <span class="searchico">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.2-3.2"></path></svg>
      </span>
      <input class="search" id="search" type="search" placeholder="Search workouts, exercises, muscles" autocapitalize="off" autocomplete="off">
    </label>
  </header>

  <div id="hint">
    <div>Add Spotter to your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.</div>
    <button id="hintx" aria-label="Dismiss">×</button>
  </div>

  <div class="chips" id="chips"></div>
  <div class="colbar hide" id="colbar"></div>
  <div class="grid" id="grid"></div>
  <div class="empty hide" id="empty"></div>

  <div class="view" id="planview"></div>
  <div class="view" id="progressview"></div>
  <div class="view" id="pumpyview">
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

  <nav class="tabbar">
    <button class="tab active" data-view="library"><span class="ti">🏋️</span>Library</button>
    <button class="tab" data-view="plan"><span class="ti">📅</span>Plan</button>
    <button class="tab" data-view="progress"><span class="ti">📈</span>Progress</button>
    <button class="tab" data-view="pumpy"><span class="ti" id="pumpytab"></span>Pumpy</button>
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
</div></div>

<div class="sheet" id="setsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="settitle">Log set</h2>
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
  <div class="kv"><span class="k">Saved today</span><span class="v" id="setsaves">—</span></div>
  <div class="setnote hide" id="setpumpy"></div>
  <div class="kv"><span class="k">Weight unit</span>
    <span class="v"><button class="chip" id="unittoggle">lb</button></span></div>
  <h2 style="margin-top:22px;font-size:16px">Save from your phone</h2>
  <p class="lede">Make an iOS Shortcut that POSTs a shared link to this address, and you can save
    straight from the share sheet. Keep it private — it works without your password.</p>
  <div class="keybox" id="setkey">—</div>
  <div class="btnrow">
    <button class="btn ghost" id="copykey">Copy address</button>
    <button class="btn ghost" id="rotatekey">New key</button>
  </div>
  <button class="danger" id="signout">Sign out</button>
</div></div>

<div id="toast"></div>
`;
