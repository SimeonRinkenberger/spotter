// Page head (before <style>) and body markup (after it).
// Wrapped in String.raw; never use backticks or "${" inside.

export const MARKUP_HEAD = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="google-site-verification" content="unLzcq6TBz9Bm6q4KHpbTmZ88dQ_tTnViacVX5BLzS0">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Spotter by Quarterdeck Collective — save any workout video</title>
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
<!-- Every read goes to one host, and the first is fired the moment the session is
     restored — measured at 68ms in, which used to be 68ms before DNS, TCP and TLS
     had started. dns-prefetch is for the browsers that ignore preconnect. -->
<link rel="preconnect" href="https://mtzevoxxpsktmrbbuxva.supabase.co" crossorigin>
<link rel="dns-prefetch" href="https://mtzevoxxpsktmrbbuxva.supabase.co">
<!-- supabase-js is the one blocking script, its tag is at the foot of a 480 KB
     document, and the preload scanner reached it 107ms into a cold load. Nothing
     happens until it has run. The tag is pinned by integrity (SRI), which makes it a
     CORS request, so both lines carry crossorigin as well: a preload in another mode
     is a second download, and a preconnect in another mode is a second connection.
     The preload carries the same integrity so the browser can check the bytes it
     keeps for the tag. -->
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js" integrity="sha384-CLZeq1dk8+Uzrs7TVvBUdlFoV5F0DMqgRoeHa8g5wJcuPe5SkVfEvdxB0ZuzlnBQ" crossorigin="anonymous">
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
<symbol id="i-paperclip" viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></symbol>
<symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
<symbol id="i-more" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></symbol>
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
<symbol id="i-sort" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></symbol>
<symbol id="i-pencil" viewBox="0 0 24 24"><path d="M18.5 2.5a2.8 2.8 0 0 1 4 4L7 22l-5 1 1-5z"/><path d="m15 5 4 4"/></symbol>
<symbol id="i-folder" viewBox="0 0 24 24"><path d="M2 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>
<symbol id="i-upload" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3.5v11"/></symbol>
<symbol id="i-dumbbell" viewBox="0 0 24 24"><path d="M2.5 9.5v5"/><path d="M6 6.5v11"/><path d="M18 6.5v11"/><path d="M21.5 9.5v5"/><path d="M6 12h12"/></symbol>
<symbol id="i-calendar" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></symbol>
<symbol id="i-trend" viewBox="0 0 24 24"><path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/></symbol>
<symbol id="i-train" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M8 15l2.5 2.5L16 13"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M6 3.5 20 12 6 20.5z"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><path d="M8 4v16"/><path d="M16 4v16"/></symbol>
<symbol id="i-flag" viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.7 5.1a10.7 10.7 0 0 1 11.2 6.6 1 1 0 0 1 0 .7 10.7 10.7 0 0 1-1.4 2.5"/><path d="M14.1 14.2a3 3 0 0 1-4.2-4.2"/><path d="M17.5 17.5a10.7 10.7 0 0 1-15.4-5.2 1 1 0 0 1 0-.7 10.7 10.7 0 0 1 4.4-5.1"/><path d="m2 2 20 20"/></symbol>
<symbol id="i-ear" viewBox="0 0 24 24"><path d="M3 15h2.5a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 5.5 21H4a1 1 0 0 1-1-1v-8a9 9 0 0 1 18 0v8a1 1 0 0 1-1 1h-1.5a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5H21"/></symbol>
<symbol id="i-hourglass" viewBox="0 0 24 24"><path d="M6 2h12"/><path d="M6 22h12"/><path d="M17 2v4.5L12 12l5 5.5V22"/><path d="M7 2v4.5L12 12l-5 5.5V22"/></symbol>
<symbol id="i-share" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 3 2 20.5h20z"/><path d="M12 9.5v4.5"/><path d="M12 17.5h.01"/></symbol>
<symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></symbol>
<symbol id="i-volume-2" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5.2a10 10 0 0 1 0 13.6"/></symbol>
<symbol id="i-volume-x" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></symbol>
<symbol id="i-youtube" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="4.5"/><path d="m10.2 9 4.6 3-4.6 3z"/></symbol>
<symbol id="i-thumb-up" viewBox="0 0 24 24"><path d="M7 20v-9l4-8a2.5 2.5 0 0 1 2 3.5L12 11h6a2 2 0 0 1 2 2.5l-1.5 6a2 2 0 0 1-2 .5z"/><rect width="5" height="10" x="2" y="10" rx="1.5"/></symbol>
<symbol id="i-mail" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="3.5"/><path d="m3.2 7.4 7.4 5.1a2.5 2.5 0 0 0 2.8 0l7.4-5.1"/></symbol>
</svg>

<!-- ---------- signed out ---------- -->
<div id="landing">
  <div class="land">
    <div class="brandrow"><img src="icon.png" alt=""><span>Spotter</span></div>
    <h1 class="hero">Save any workout video. <em>Actually do the workout.</em></h1>
    <p class="sub">You save fitness reels you never come back to. Spotter reads the exercises,
      sets and reps out of the video, then walks you through them one at a time and remembers
      what you lifted.</p>

    <div class="authcard" id="authcard">
      <h2 id="authtitle">Create your account</h2>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <div class="pwbox">
          <input id="pw" type="password" autocomplete="current-password" placeholder="At least 8 characters">
          <button type="button" class="pweye" aria-label="Show password" aria-pressed="false"><svg class="ic"><use href="#i-eye"></use></svg></button>
        </div>
      </div>
      <!-- Sign-up face only, and folded: an optional field most people have
           nothing to put in is a field most people should not see. A code that
           came in on the link opens it already filled. -->
      <div id="authcodewrap">
        <button type="button" class="codeask" id="authcodeask">Have a creator code?</button>
        <div class="field hide" id="authcodefield">
          <label for="authcode">Creator code</label>
          <input id="authcode" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Optional" maxlength="20">
        </div>
      </div>
      <!-- App Store 5.1.2(i): nobody's content reaches a third-party model
           without them having read, in so many words, that it will. The sentence
           is on the sign-up face only, and it sits directly above the button,
           because pressing that button IS the agreement. Filled from
           consentFill() in app.ts so this sentence and the one Settings shows an
           older account cannot drift apart. -->
      <p class="consent hide" id="consent"></p>
      <!-- Cloudflare Turnstile mounts here, and only once PUBLIC_CAPTCHA in
           app.ts carries a site key: with none it is display:none and empty, so
           the card is byte-for-byte the card that shipped before. The widget is
           rendered interaction-only, which means a visitor Cloudflare can vouch
           for never sees anything at all and a suspected bot gets a checkbox
           here, above the button it is standing in the way of. -->
      <div class="capgate" id="capgate"></div>
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
      <!-- Confirmation-on state. With enable_confirmations true a signup is a
           mail send and nothing else — no session comes back — and a form left
           sitting there reads as a signup that failed. Apple's own account
           sheets answer three questions at this moment and so does this: what
           was sent, which address it went to, and what to do when it does not
           arrive. While it is up nothing else on the card is shown, because
           nothing else on the card is a choice anybody has. -->
      <div class="mailsent hide" id="mailsent" tabindex="-1">
        <span class="mailmark" aria-hidden="true"><svg class="ic"><use href="#i-mail"></use></svg></span>
        <h2>Check your email</h2>
        <p id="mailbody"></p>
        <!-- One field, not six boxes. WebKit's own guidance for
             autocomplete="one-time-code" is a single input: iOS offers the code
             out of the message above the keyboard and fills it in one go, and a
             row of one-character boxes is exactly where that autofill stops
             working. Instagram's confirmation screen is a single field too. The
             link in the mail still works for anyone reading it on a desktop.
             No maxlength: it counts characters, not digits, so a code pasted as
             "123 456" arrived truncated to "123 45" and stripped down to five,
             which is a Confirm button that will not go for no reason a person
             can see. The input handler slices to six DIGITS instead. -->
        <div class="field">
          <label for="otp">Six-digit code</label>
          <input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" autocapitalize="off" spellcheck="false">
        </div>
        <button class="btn" id="otpgo">Confirm</button>
        <div class="autherr" id="otperr"></div>
        <button class="btn ghost" id="mailresend">Resend the email</button>
        <div class="authswap"><button id="mailback">Use a different email</button></div>
      </div>
    </div>
    <!-- Somebody made this. Software with no maker, no version and no way to say
         something is wrong reads as unowned however good it is, and that absence
         was the loudest thing about this page. -->
    <div class="landfoot">Spotter by Quarterdeck Collective · Free to start ·
      <a href="https://quarterdeckcollective.com/spotter/whats-new/">What&rsquo;s new</a> · <a href="https://quarterdeckcollective.com/spotter/terms/">Terms</a> ·
      <a href="https://quarterdeckcollective.com/spotter/privacy/">Privacy</a></div>
  </div>
</div>

<!-- ---------- signed in ---------- -->
<!-- Three pages side by side on one track, not three boxes taking turns at
     display:none. The header and the tab bar sit above the track and are told
     where it is every frame, so the title strips and the tab capsule move with
     the finger instead of jumping when a view swaps. Each page is its own
     vertical scroller, which is what lets a tab remember where it was left. -->
<div id="app" class="hide">
  <div id="ptr"><svg class="ic"><use href="#i-refresh"></use></svg></div>

  <header>
    <div class="titlerow">
      <div class="tstack">
        <h1 id="apptitle"><span class="ts">Spotter</span><span class="ts" aria-hidden="true">Train</span><span class="ts" aria-hidden="true">Pumpy</span></h1>
        <div class="count" id="count"><span class="ts" id="count0">Reading your library</span><span class="ts" id="count1" aria-hidden="true">This week</span><span class="ts" aria-hidden="true">Your coach</span></div>
      </div>
      <div class="hbtns">
        <button class="addbtn ghost" id="settingsbtn" title="Settings" aria-label="Settings"><svg class="ic"><use href="#i-settings"></use></svg></button>
        <button class="addbtn savebtn" id="addbtn"><svg class="ic"><use href="#i-plus"></use></svg><span>Save workout</span></button>
      </div>
    </div>
  </header>

  <div class="pages" id="pages">
    <div class="track" id="track">
      <div class="page" id="libpage" role="tabpanel" aria-labelledby="tab0">
        <label class="searchwrap" id="searchwrap">
          <span class="searchico"><svg class="ic"><use href="#i-search"></use></svg></span>
          <input class="search" id="search" type="search" placeholder="Search workouts, exercises, muscles" autocapitalize="off" autocomplete="off">
          <button class="searchx" id="searchx" type="button" aria-label="Hide keyboard"><svg class="ic"><use href="#i-x"></use></svg></button>
        </label>

        <div id="hint">
          <div id="hinttext">Spotter works better installed — full screen, and it opens like an app.
            Tap <b>Share</b>, then <b>Add to Home Screen</b>.</div>
          <button id="hintx" aria-label="Dismiss"><svg class="ic"><use href="#i-x"></use></svg></button>
        </div>

        <div class="chips" id="chips"></div>
        <div class="colbar hide" id="colbar"></div>
        <!-- The only paywall that is not a refusal, sitting where the shelf is.
             Hidden outright rather than kept empty, so a paid account and an
             account with billing off get today's page to the pixel. -->
        <button class="libcount hide" id="libcount"></button>
        <div class="grid" id="grid"></div>
        <div class="empty hide" id="empty"></div>
      </div>

      <div class="page view" id="trainview" role="tabpanel" aria-labelledby="tab1"></div>
      <div class="page view" id="pumpyview" role="tabpanel" aria-labelledby="tab2">
        <div class="pumpybar">
          <button id="pumpychats" title="Chats" aria-label="Chats"><svg class="ic"><use href="#i-list"></use></svg></button>
          <button id="pumpynew" title="New chat" aria-label="New chat"><svg class="ic"><use href="#i-plus"></use></svg></button>
        </div>
        <div id="pumpylog"></div>
        <div id="pumpyannounce" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="composer" id="pumpycomposer">
          <div class="pumpyctx hide" id="pumpyctx"></div>
          <div class="pumpycredits hide" id="pumpycredits"></div>
          <div class="composerrow">
            <button class="addbtn ghost" id="pumpyplus" aria-label="Attach workouts to this chat" title="Attach workouts"><svg class="ic"><use href="#i-paperclip"></use></svg></button>
            <textarea id="pumpyinput" rows="1" placeholder="Ask Pumpy…" autocapitalize="sentences"></textarea>
            <button class="addbtn" id="pumpysend" aria-label="Send"><svg class="ic"><use href="#i-arrow-up"></use></svg></button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <nav class="tabbar" role="tablist" aria-label="Sections">
    <div class="tabpill" aria-hidden="true"></div>
    <button class="tab active" id="tab0" role="tab" aria-selected="true" aria-controls="libpage" data-view="library"><span class="ti"><svg class="ic"><use href="#i-dumbbell"></use></svg></span><span class="tl">Workouts</span></button>
    <button class="tab" id="tab1" role="tab" aria-selected="false" aria-controls="trainview" data-view="train"><span class="ti"><svg class="ic"><use href="#i-train"></use></svg></span><span class="tl">Train</span></button>
    <button class="tab" id="tab2" role="tab" aria-selected="false" aria-controls="pumpyview" data-view="pumpy"><span class="ti" id="pumpytab"></span><span class="tl">Pumpy</span></button>
  </nav>
</div>

<!-- ---------- detail ---------- -->
<div class="overlay" id="detail">
  <div class="dtop">
    <button class="iconbtn" id="dclose" aria-label="Back"><svg class="ic"><use href="#i-arrow-left"></use></svg></button>
    <div class="hbtns">
      <button class="iconbtn" id="dfav" title="Favourite" aria-label="Favourite" aria-pressed="false"><svg class="ic"><use href="#i-star"></use></svg></button>
      <button class="chip" id="dmore" aria-haspopup="dialog">Options</button>
    </div>
  </div>
  <div class="dinner" id="dinner"></div>
</div>


<div class="sheet" id="workoptions" role="dialog" aria-modal="true" aria-labelledby="workoptiontitle"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="workoptiontitle">Workout options</h2>
  <div id="workmanage"></div>
  <button class="pickrow" id="dshare">Share workout</button>
  <button class="pickrow" id="dreproc">Read it again</button>
  <button class="btn ghost" data-close="workoptions">Done</button>
</div></div>
<!-- The way out of a live session. Two doors, neither of which loses a set: pause
     keeps the session for later (the Library offers it back), end saves what was
     logged. The X used to throw the session away without a word. -->
<div class="sheet" id="wleavesheet" role="dialog" aria-modal="true" aria-labelledby="wleavetitle"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="wleavetitle">Leave this workout?</h2>
  <p class="lede" id="wleavelede">Nothing is lost either way.</p>
  <button class="pickrow leaverow" id="wpause"><svg class="ic"><use href="#i-pause"></use></svg><span class="pt"><b>Pause workout</b><span>Pick it up later from the Library. The clock stops.</span></span></button>
  <button class="pickrow leaverow" id="wend"><svg class="ic"><use href="#i-flag"></use></svg><span class="pt"><b>End workout</b><span id="wendsub">Saves what you logged.</span></span></button>
  <button class="btn ghost" data-close="wleavesheet">Keep going</button>
</div></div>
<div class="sheet" id="filtersheet" role="dialog" aria-modal="true" aria-labelledby="filtertitle"><div class="sheetbody">
  <div class="grabber"></div><h2 id="filtertitle">Filters</h2>
  <div id="filterlist"></div>
  <button class="btn ghost" data-close="filtersheet">Done</button>
</div></div>
<div class="sheet" id="schedulesheet" role="dialog" aria-modal="true" aria-labelledby="scheduletitle"><div class="sheetbody">
  <div class="grabber"></div><h2 id="scheduletitle">Schedule workout</h2>
  <p class="lede" id="schedulename"></p>
  <div class="field"><label for="scheduledate">Choose a day</label><div class="schedule-date-control"><input id="scheduledate" type="date" required></div></div>
  <p class="autherr" id="scheduleerror" role="status"></p>
  <div class="btnrow"><button class="btn ghost" data-close="schedulesheet">Cancel</button><button class="btn" id="schedulego">Add to plan</button></div>
</div></div>

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
      <!-- Only on a past session, where it is the one place Delete lives. -->
      <button class="iconbtn" id="wmore" aria-label="Session options" aria-haspopup="dialog"><svg class="ic"><use href="#i-more"></use></svg></button>
    </div>
  </div>
  <div class="wdots" id="wdots"></div>
  <div class="wmain" id="wmain"></div>
  <!-- Out here rather than inside .wmain: a rest belongs to the lifter, not to the
       screen they happen to be looking at. Swiping on used to throw it away. -->
  <div class="reststrip" id="reststrip">
    <button class="ring" id="restring" aria-label="Pause or resume the rest"><span id="restnum">0</span></button>
    <div class="restinfo">
      <div class="restheading"><span class="restword" id="restword">Rest period</span>
        <svg class="ic wmute" aria-hidden="true"><use href="#i-volume-x"></use></svg></div>
      <div class="resthint" id="resthint">Breathe. Next set soon.</div>
      <div class="restcontrols"><button class="chip" id="restplus">+15 s</button>
        <button class="chip" id="restskip">Skip rest</button></div>
    </div>
  </div>
  <div class="wbottom">
    <button class="wnav" id="wprev" aria-label="Previous exercise"><svg class="ic"><use href="#i-arrow-left"></use></svg></button>
    <button class="btn ghost" id="waddexercise">+ Add exercise</button>
    <button class="wfinish" id="wfinish">Save workout</button>
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

  <!-- The last rung of the ingest ladder, and deliberately the quiet one: pasting
       a link is the everyday path, this is for the video that lives only on the
       phone. It says "watches" because that is what changed, and the size limit
       is stated here rather than only in the error. -->
  <div class="upblock">
    <button class="uploadrow" id="uploadrow" type="button">
      <span class="upmark" aria-hidden="true"><svg class="ic"><use href="#i-upload"></use></svg></span>
      <span class="uptext">
        <b>Upload a video from your phone</b>
        <small>Spotter watches and listens to it, so it works when nothing is written down. MP4, MOV, M4A, MP3, WAV or WebM, up to 25 MB.</small>
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
  <!-- data-noswipe on the row: a thumb pressing "+" fifteen times rolls, and past
       24px of roll the sheet's own dismissal drag took the gesture, slid under the
       finger and swallowed that press. The grabber still throws the sheet away.
       The number is a button because it is one — it swaps in the field beside it. -->
  <div class="stepper" data-noswipe>
    <button id="repsdown" aria-label="Fewer reps"><svg class="ic"><use href="#i-minus"></use></svg></button>
    <div class="val" id="repsbox"><button class="num" id="repsval" aria-label="Reps — tap to type a number">10</button><input class="numin" id="repsin" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" aria-label="Reps"><small>reps</small></div>
    <button id="repsup" aria-label="More reps"><svg class="ic"><use href="#i-plus"></use></svg></button>
  </div>
  <div class="stepper" data-noswipe>
    <button id="wtdown" aria-label="Less weight"><svg class="ic"><use href="#i-minus"></use></svg></button>
    <div class="val" id="wtbox"><button class="num" id="wtval" aria-label="Weight — tap to type a number">0</button><input class="numin" id="wtin" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="Weight"><small><span id="wtunit">lb</span><button class="eachtag" id="wteach" type="button" hidden>each</button></small></div>
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
<!-- Two panes, one sheet: pick the movement, then say how much of it. Splitting
     them is what lets the first pane be a list you scan rather than a form you
     fill in — Hevy, Strong and Fitbod all put the picker first and the dose
     second, and the dose is the step that already knows your last set. -->
<div class="sheet" id="woaddsheet" role="dialog" aria-modal="true" aria-labelledby="woaddtitle"><div class="sheetbody">
  <div class="grabber"></div>
  <button class="chip woaback hide" id="woaback"><svg class="ic"><use href="#i-arrow-left"></use></svg>All exercises</button>
  <h2 id="woaddtitle">Add an exercise</h2>
  <div id="woapick">
    <label class="woasearch"><span class="searchico"><svg class="ic"><use href="#i-search"></use></svg></span>
      <input class="search" id="woaq" type="search" enterkeyhint="done" placeholder="Search exercises" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="Search exercises"></label>
    <!-- Two chip rows behind one word. Muscle chips OR together, equipment chips OR
         together, the rows AND; Bodyweight is an empty equipment list. woaChips
         paints them and the state lives on woa, so it goes when the picker does. -->
    <details class="disclosure woafilt" id="woafilt" data-noswipe>
      <summary id="woafiltsum">Filter</summary>
      <div class="disclosure-body">
        <div class="woahead">Muscle</div>
        <div class="pillrow" id="woamus"></div>
        <div class="woahead">Equipment</div>
        <div class="pillrow" id="woaeq"></div>
      </div>
    </details>
    <div class="picklist" id="woalist"></div>
  </div>
  <div id="woadose" class="hide">
    <div class="wnote" id="woalast"></div>
    <!-- Reps or Time, the way Hevy and Strong type an exercise. Time is minutes
         and seconds, one value in two fields, never "1200 seconds". doseFurnish
         in app.ts puts the segment above this row and the pair inside it, and
         doseMode swaps the fields under the segment. Same shape as #exeditsheet. -->
    <div class="fieldrow dosefields" id="woaddfields">
      <div class="field"><label for="woaddsets">Sets</label><input id="woaddsets" type="number" inputmode="numeric" min="1" max="99" value="3"></div>
      <div class="field"><label for="woaddreps">Reps</label><input id="woaddreps" type="number" inputmode="numeric" min="1" max="999" value="10"></div>
    </div>
    <div class="field"><label>Rest after each set</label><div class="restpick short" id="woarest"></div></div>
    <div class="pillrow" id="woawhere"></div>
    <button class="pickrow woakeep hide" id="woakeep" aria-pressed="false"><div class="pt"><b>Keep on this workout</b><span id="woakeepnote">Off — today’s session only.</span></div><span class="ck"><svg class="ic"><use href="#i-check"></use></svg></span></button>
    <div class="btnrow"><button class="btn ghost" data-close="woaddsheet">Cancel</button><button class="btn" id="woaddsave">Add exercise</button></div>
  </div>
</div></div>

<div class="sheet" id="recapsheet" role="dialog" aria-modal="true" aria-labelledby="recaptitle"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="recaptitle">Session options</h2>
  <div id="recapopts"></div>
  <button class="btn ghost" data-close="recapsheet">Done</button>
</div></div>

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
  <h2>Fix this exercise</h2>
  <p class="lede">Spotter read this off the video. If it got it wrong, put it right — the change stays on your copy.</p>
  <div class="field">
    <div class="fieldhead"><label for="exeditname">Exercise</label><button type="button" class="fieldlink" id="exeditpick">Change</button></div>
    <input id="exeditname" type="text" placeholder="Goblet squat" autocapitalize="words" autocomplete="off" spellcheck="false">
  </div>
  <!-- Sets and Reps; doseFurnish adds the Reps | Time segment and the minutes/seconds pair. -->
  <div class="fieldrow dosefields" id="exeditfields">
    <div class="field"><label for="exeditsets">Sets</label><input id="exeditsets" type="number" inputmode="numeric" min="1" max="99" placeholder="—"></div>
    <div class="field"><label for="exeditreps">Reps</label><input id="exeditreps" type="text" inputmode="numeric" placeholder="—" autocomplete="off"></div>
  </div>
  <div class="field"><label>Rest after each set</label><div class="restpick short" id="exeditrest"></div></div>
  <div class="btnrow">
    <button class="btn ghost" id="exeditcancel">Cancel</button>
    <button class="btn" id="exeditsave">Save change</button>
  </div>
  <button class="danger" id="exeditdelete">Not a real exercise — remove it</button>
</div></div>

<!-- The rest, from the card. One job: the number Workout Mode will run after a
     set of this exercise, on the minutes and seconds wheel restWheel in app.ts
     builds — the same wheel the dose panes and the section sheet use, three rows
     tall there and five here. Save commits, since a wheel passes a dozen values
     on its way to one. -->
<div class="sheet" id="restsheet" role="dialog" aria-modal="true" aria-labelledby="resttitle"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="resttitle"></h2>
  <p class="lede">Workout Mode starts this timer after each set.</p>
  <div class="restpick" id="restwheel"></div>
  <div class="btnrow"><button class="btn ghost" data-close="restsheet">Cancel</button><button class="btn" id="restsave">Save</button></div>
</div></div>

<!-- A section of the workout — a warm-up, a circuit, ten minutes of cardio, a
     cool-down — added or edited whole. The kind chips fill the fields with a
     preset; only the fields that kind uses are shown. Adding goes on to the
     exercise bank (a section is stored with its first exercise, never empty);
     editing saves through edit_block. Remove is last and red, per the HIG. -->
<div class="sheet" id="sectionsheet" role="dialog" aria-modal="true" aria-labelledby="sectiontitle"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="sectiontitle">Add a section</h2>
  <div class="pillrow" id="sectionkinds"></div>
  <div class="field"><label for="sectionname">Name</label><input id="sectionname" type="text" placeholder="Finisher" maxlength="60" autocapitalize="words" autocomplete="off" spellcheck="false"></div>
  <div class="hide" id="sectionroundsf">
    <div class="field"><label for="sectionrounds">Rounds</label><input id="sectionrounds" type="number" inputmode="numeric" min="1" max="50"></div>
    <div class="field"><label>Rest between rounds</label><div class="restpick short" id="sectionrest"></div></div>
  </div>
  <div class="fieldrow hide" id="sectioncapf">
    <div class="field"><label for="sectioncapmin">Time cap · minutes</label><input id="sectioncapmin" type="number" inputmode="numeric" placeholder="10"></div>
    <div class="field"><label for="sectioncapsecs">Seconds</label><input id="sectioncapsecs" type="number" inputmode="numeric" placeholder="0"></div>
  </div>
  <div class="btnrow"><button class="btn ghost" data-close="sectionsheet">Cancel</button><button class="btn" id="sectionsave">Choose the first exercise</button></div>
  <button class="danger hide" id="sectionremove">Remove section</button>
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
  <!-- What the camera saw, between what the creator SAID and the stranger's
       demonstration: it is the second most specific thing on the sheet and the only
       one that can contradict the clip below it. Empty and hidden on a card saved
       before the pack existed. -->
  <div id="explainperf"></div>
  <div class="vslot" id="explainvid"><div id="explainvidin"></div></div>
  <button class="setlink" id="explainask">Explain this exercise with Pumpy</button>
  <div class="aitext hide" id="explaintext" role="status"></div>
  <!-- Thumbs and a way out. Every AI surface that people trust has both: a verdict
       that costs one tap, and somewhere for a reader who knows better to put what
       they know. The edit sheet is that somewhere — it already exists and it already
       writes to the user's own copy of the card. -->
  <div class="votes hide" id="explainvotes">
    <button class="chip vote" id="explainup" aria-label="This explanation looks right" aria-pressed="false"><svg class="ic"><use href="#i-thumb-up"></use></svg></button>
    <button class="chip vote down" id="explaindown" aria-label="This explanation looks wrong" aria-pressed="false"><svg class="ic"><use href="#i-thumb-up"></use></svg></button>
    <button class="chip votefix" id="explainfix">Not quite right?</button>
  </div>
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
  <!-- The way round the model: the picker in replace mode, on the exercise this
       sheet was opened for. Hidden when the sheet has nowhere to write. -->
  <div class="swapbank" id="swapbank"><span>Or pick one yourself</span><button class="chip" id="swapbankgo"><svg class="ic"><use href="#i-search"></use></svg>Choose from the exercise bank</button></div>
  <div id="swapresult"></div>
</div></div>

<div class="sheet" id="picksheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="picktitle">Pick a workout</h2>
  <div class="picklist" id="picklist"></div>
</div></div>

<!-- How the library is ordered, and once it has sections a way to reach the twelfth
     without dragging past eleven. Both in one sheet because whoever wants to jump is
     already steering the order. The choice writes both headings, hence the ids. -->
<div class="sheet" id="sortsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="sorttitle">Sort by</h2>
  <div class="picklist" id="sortlist"></div>
  <div class="jumpwrap hide" id="jumpwrap">
    <h3 id="jumphead">Jump to</h3>
    <div class="picklist" id="jumplist"></div>
  </div>
</div></div>

<div class="sheet" id="refsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>Work on these together</h2>
  <p class="lede">Pumpy knows all your workouts by name — pick the ones you’re thinking about and work on them together.</p>
  <div class="newcol">
    <input class="nm" id="refsearch" type="search" placeholder="Search your workouts" autocapitalize="off" autocomplete="off" aria-label="Search your workouts">
  </div>
  <div class="picklist" id="reflist"></div>
  <div class="btnrow"><button class="btn" id="refdone">Done</button></div>
</div></div>

<!-- The today card's overflow: what you do TO a week, one tap off the card that
     already answers what you are doing today. -->
<div class="sheet" id="trainmore"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>This week</h2>
  <button class="pickrow" id="tmcopy">Copy week</button>
  <button class="pickrow" id="tmpumpy">Build with Pumpy</button>
  <button class="pickrow" id="tmcount">What counts</button>
  <button class="btn ghost" data-close="trainmore">Done</button>
</div></div>

<div class="sheet" id="daysheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="daytitle">Day</h2>
  <div id="daylist"></div>
  <button class="planadd" id="dayadd">+ Add a workout</button>
</div></div>

<!-- What the ring counts, one tap under the dots: a goal whose rules are hidden
     is a goal people quietly stop believing. -->
<div class="sheet" id="countsheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>What counts</h2>
  <p class="lede">A session is a workout you finished with at least one set logged. Two in one
    day count as two. Rest days are free &mdash; the week only asks for the number you set, and it
    starts again on Monday.</p>
  <p class="lede">Come up one session short and a freeze covers the week, automatically and once
    every four weeks. It costs nothing, and you are told afterwards.</p>
  <div class="btnrow"><button class="btn" id="countdone">Done</button></div>
</div></div>

<div class="sheet" id="copysheet"><div class="sheetbody">
  <div class="grabber"></div>
  <h2>Copy a week</h2>
  <div class="copyhead" id="copyhead"></div>
  <p class="lede">Where should it go?</p>
  <div class="copyweeks" id="copyweeks"></div>
  <div class="copyrep"><span>Repeat for</span><div class="copychips" id="copyreps"></div></div>
  <div class="btnrow"><button class="btn" id="copygo">Copy</button></div>
  <button class="planbtn wide" id="copypumpy"></button>
  <button class="danger" id="copyclear">Clear this week</button>
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

  <!-- The same sentence, once, for an account that was made before there was one
       to read — consentFill() gives it an opening clause that fits an account
       that already exists, and the body is the body shown at sign-up. Dismissing
       it is the agreement; it is recorded and never asked again. First thing in
       the sheet because it is the one thing here that is not a preference. -->
  <div class="consentrow hide" id="consentrow">
    <p class="consent" id="consentset"></p>
    <button class="btn ghost" id="consentok">Review AI permission</button>
  </div>

  <h3 class="seth">Account</h3>
  <div class="setgroup">
    <button class="kv row" id="setmailrow"><span class="k">Email</span><span class="v" id="setemail">&mdash;</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <div class="kv hide" id="setprovrow"><span class="k">Sign-in method</span><span class="v" id="setprov">&mdash;</span></div>
    <button class="kv row" id="setnamerow"><span class="k">Name</span><span class="v" id="setname">&mdash;</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <button class="kv row hide" id="setpwrow"><span class="k">Password</span><span class="v">Change</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
  </div>
  <div class="setnote hide" id="setpumpy"></div>
  <button class="btn ghost setout" id="signout">Sign out</button>

  <!-- Under Account, where Hevy and Fitbod both put theirs and where Apple's
       guideline expects a subscriber to look for the way out; below Sign out only
       because Sign out is deliberately the end of the Account section. With
       billing switched off the row reads Free and no button appears at all —
       Settings is not the place to advertise a plan nobody can buy yet. -->
  <h3 class="seth">Plan</h3>
  <div class="setgroup">
    <div class="kv" id="setplanrow"><span class="k">Plan</span><span class="v" id="setplan">Free</span></div>
    <!-- One per account and never edited once on: the row goes disabled and
         reads the code, or opens the account sheet to type one. -->
    <button class="kv row" id="setcoderow"><span class="k">Creator code</span><span class="v" id="setcode">Enter a code</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
  </div>
  <div class="setnote hide" id="setplanuse"></div>
  <div class="setnote warn hide" id="setplanwarn"></div>
  <div class="btnrow hide" id="setplanbtns">
    <button class="btn hide" id="setpay">Update payment</button>
    <button class="btn ghost hide" id="setmanage">Manage subscription</button>
    <button class="btn hide" id="setupgrade">Upgrade to Plus</button>
  </div>
  <button class="setlink hide" id="setrefresh">Refresh</button>

  <!-- Only for an account that owns a code. The numbers are the server's
       creator_stats row, and the last line names who pays and on what terms,
       because a number with no promise under it is a number nobody trusts. -->
  <div class="hide" id="setcreator">
    <h3 class="seth">Your creator code</h3>
    <div class="setgroup">
      <div class="kv"><span class="k">Code</span><span class="v" id="setcreatorcode">&mdash;</span></div>
      <button class="kv row" id="setcreatorshare"><span class="k">Share your code</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    </div>
    <div class="setnote" id="setcreatoruse"></div>
  </div>

  <!-- Connections, hidden whole until the owner has set the Strava secrets: an
       integration nobody can switch on is not a Settings row, it is noise. Under
       Plan and above Preferences because it is account-shaped rather than a
       preference, which is where Hevy and Strong file theirs too.
       The button is Strava's own asset and nothing else: their brand rules make
       the official image the required entry to the consent screen and forbid
       redrawing or recolouring it, so it is a fixed 48px img from our own origin
       and app.ts falls back to words if the file is not there. -->
  <div class="hide" id="setconn">
    <h3 class="seth">Connections</h3>
    <div class="setgroup">
      <div class="kv"><span class="k">Strava</span><span class="v" id="setstrava">Not connected</span></div>
    </div>
    <div class="setnote" id="setstravanote"></div>
    <div class="btnrow hide" id="setstravaoffrow">
      <button class="btn ghost" id="stravaoff">Disconnect</button>
    </div>
    <button class="hide" id="stravaon" aria-label="Connect with Strava"
      style="width:100%;background:none;border:0;padding:12px 0 2px;cursor:pointer;-webkit-tap-highlight-color:transparent">
      <img id="stravaonimg" src="strava-connect.svg" alt="Connect with Strava"
        style="height:48px;width:auto;display:block;margin:0 auto">
    </button>
  </div>

  <h3 class="seth">Pumpy</h3>
  <div class="setgroup">
    <div class="kv"><span class="k">Helpful tips</span><span class="v"><button class="chip" id="pumpytips" aria-label="Pumpy helpful tips" aria-pressed="true">On</button></span></div>
    <div class="kv"><span class="k">Little animations</span><span class="v"><button class="chip" id="pumpymotion" aria-label="Pumpy little animations" aria-pressed="true">On</button></span></div>
    <button class="kv setrow" id="pumpyhelp"><span class="k">Quick guide</span><svg class="ic"><use href="#i-chev"></use></svg></button>
  </div>
  <div class="setnote">Short tips when you need them. These choices apply to this account on this device. Reduce Motion is always respected.</div>

  <h3 class="seth">Preferences</h3>
  <div class="setgroup">
    <!-- What the week ring is measured against: the user's own number, prefilled
         from the plan, and never raised by this app. -->
    <div class="kv"><span class="k">Sessions a week</span>
      <span class="v goalset"><button class="chip" id="goalless" aria-label="One session a week fewer">&minus;</button><b id="goalnum">3</b><button class="chip" id="goalmore" aria-label="One session a week more">+</button></span></div>
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

  <!-- A group of their own rather than two more rows under Preferences, which is
       where iOS Settings files Notifications for every app on the phone: they are
       the one thing here that reaches a person when Spotter is closed, they are
       gated on a permission the rest of the sheet is not, and the first of them
       carries a time. Both start Off and nothing is asked for until a switch is
       tapped. -->
  <h3 class="seth">Reminders</h3>
  <div class="setgroup">
    <div class="kv"><span class="k">Plan-day reminder</span>
      <span class="v remset"><input class="remtime" id="remtime" type="time" value="17:30" aria-label="Time of the plan-day reminder"><button class="chip" id="remplan">Off</button></span></div>
    <div class="kv"><span class="k">Week at risk</span>
      <span class="v"><button class="chip" id="remrisk">Off</button></span></div>
  </div>
  <!-- Written by paintRemind, which runs before the sheet can be seen: the note
       has three things to say and only one of them is about reminders arriving. -->
  <div class="setnote" id="setremnote"></div>

  <details class="disclosure" id="phonesave"><summary>Save from your phone</summary><div class="disclosure-body">
    <p class="lede"><b>On any phone</b> — copy a video link, then tap <b>Save workout</b> in Spotter.</p>
    <p class="lede"><b>Android</b> — install Spotter, then choose it in the video app’s share sheet.</p>
    <p id="nativesharehelp" class="lede hide">In TikTok, YouTube, Instagram or another app, share the post’s link and choose Spotter. If needed, open More to find Spotter in the iPhone share menu.</p>
    <details id="shortcutsetup" class="disclosure"><summary>iPhone Shortcut setup (advanced)</summary><div class="disclosure-body">
      <p class="lede">For direct sharing on iPhone, create a Shortcut that sends the shared URL as a POST to this address. Keep it private — it works without your password.</p>
      <div class="keybox" id="setkey">&mdash;</div>
      <div class="btnrow"><button class="btn ghost" id="copykey">Copy address</button><button class="btn ghost" id="rotatekey">New key</button></div>
    </div></details>
  </div></details>

  <h3 class="seth">Data &amp; privacy</h3>
  <div class="setgroup">
    <!-- The switch itself, where a privacy setting is looked for. The row at the
         top of the sheet says the same thing in a sentence; this is the one the
         share sheet and the server's refusal point at by name. -->
    <button class="kv row" id="setairow"><span class="k">AI processing</span><span class="v" id="setai">&mdash;</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <button class="kv row" id="setexport"><span class="k">Export my data</span><span class="v" id="setexportv">JSON</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <a class="kv row" href="https://quarterdeckcollective.com/spotter/terms/"><span class="k">Terms of use</span><svg class="ic chev"><use href="#i-chev"></use></svg></a>
    <a class="kv row" href="https://quarterdeckcollective.com/spotter/privacy/"><span class="k">Privacy policy</span><svg class="ic chev"><use href="#i-chev"></use></svg></a>
    <button class="kv row del" id="setdelete"><span class="k">Delete account</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
  </div>

  <h3 class="seth">About</h3>
  <div class="setgroup">
    <button class="kv row" id="refreshbtn"><span class="k">Refresh workouts</span><svg class="ic"><use href="#i-refresh"></use></svg></button>
    <a class="kv row" href="https://quarterdeckcollective.com/spotter/whats-new/"><span class="k">What&rsquo;s new</span><span class="v" id="setver">&mdash;</span><svg class="ic chev"><use href="#i-chev"></use></svg></a>
    <button class="kv row" id="settell"><span class="k">Tell a friend</span><svg class="ic chev"><use href="#i-chev"></use></svg></button>
    <a class="kv row" href="https://github.com/SimeonRinkenberger/spotter/issues" target="_blank" rel="noopener"><span class="k">Something wrong? Tell me</span><svg class="ic chev"><use href="#i-chev"></use></svg></a>
  </div>
  <!-- What this phone believes about its own screen. Staff only, and there so the
       one person holding an affected device can photograph the numbers. -->
  <div class="setnote foot hide" id="setdiag"></div>
  <!-- The last line of the app, and the one that says a person is behind it. The
       report goes to the public issue tracker rather than an address, because an
       address in a public page is an address that gets harvested. -->
  <div class="setnote foot">Made by Simeon Rinkenberger</div>
</div></div>

<!-- The one place Spotter asks for money. Written by openPlans() out of the live
     prices and caps, so no number here can drift from the number the server is
     enforcing: the only copy in the markup is the half with no number in it. -->
<div class="sheet" id="plansheet"><div class="sheetbody">
  <div class="grabber"></div>
  <div class="planctx hide" id="planctx"></div>
  <h2>Spotter Plus</h2>
  <p class="lede">Room to save what you find, and a coach who does not run out mid-week.</p>
  <div class="plangood" id="plangood"></div>
  <div class="plancards" id="plancards" role="radiogroup" aria-label="Billing period"></div>
  <div class="plantrial hide" id="plantrial"></div>
  <div class="plansoon hide" id="plansoon">Plans are coming soon.</div>
  <!-- A creator's code, typed here or already on the account. The app never
       prices the discount: the store does, when the code is redeemed there, so
       the cards above stay the store's own numbers. -->
  <div class="plancode">
    <button type="button" class="codeask" id="plancodeask">Have a creator code?</button>
    <div class="codeform hide" id="plancodeform">
      <div class="field"><input id="plancodein" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code" aria-label="Creator code" maxlength="20"></div>
      <button class="btn" id="plancodego">Apply</button>
    </div>
    <div class="plancodeline hide" id="plancodeline"></div>
  </div>
  <button class="btn planbuy hide" id="planbuy"><b></b></button>
  <button class="btn ghost planredeem hide" id="planredeem">Redeem in the App Store</button>
  <button class="plannot" id="plannot">Not now</button>
  <div class="planfine" id="planfine"></div>
  <div class="planlegal">
    <a href="https://quarterdeckcollective.com/spotter/terms/">Terms</a><span aria-hidden="true">&middot;</span>
    <a href="https://quarterdeckcollective.com/spotter/privacy/">Privacy</a><span aria-hidden="true" id="plandot2">&middot;</span>
    <button id="planrestore">Restore purchase</button>
  </div>
</div></div>

<!-- One sheet for every account question, dressed by JS. Rename, change password,
     change email, ask for a reset link, choose a new one after following it, and
     confirm a deletion are the same object: a title, a sentence, some fields, one
     button that does the thing. Six sheets of markup would have been six copies of
     the same twenty lines and six more things to keep in step. -->
<div class="sheet" id="aiconsentsheet" role="dialog" aria-modal="true" aria-labelledby="aiconsenttitle"><div class="sheetbody">
  <div class="grabber"></div>
  <h2 id="aiconsenttitle">Allow AI processing?</h2>
  <p class="lede">To read workouts, Spotter sends the links, captions, images, text and audio or video you choose to OpenAI or Google. Pumpy also sends your messages and relevant workout, plan and training history to help answer your questions.</p>
  <p>AI can make mistakes. Review exercises and instructions before training. You can choose Not now and continue logging workouts and planning manually.</p>
  <p>You can turn AI processing off here at any time. This stops future AI requests after your choice is saved; it does not recall requests already sent or delete existing workouts and conversations.</p>
  <p><a href="https://quarterdeckcollective.com/spotter/privacy/">Read the privacy policy</a></p>
  <p id="aiconsenterror" role="alert"></p>
  <div class="btnrow"><button class="btn ghost" id="aiconsentdecline">Not now</button><button class="btn" id="aiconsentallow">Allow AI processing</button></div>
  <button class="setlink revoke hide" id="aiconsentrevoke">Turn off AI processing</button>
</div></div>

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

<div class="sheet" id="guidesheet"><div class="sheetbody">
  <div class="grabber"></div>
  <button class="sheetx" id="guideclose" aria-label="Close quick guide"><svg class="ic"><use href="#i-x"></use></svg></button>
  <h2>A little help from Pumpy</h2>
  <p class="lede">Pick what you’re working on.</p>
  <div id="guidebody"></div>
  <button class="setlink" id="welcomereplay">How to save a workout</button>
  <button class="setlink" id="guidereset">Show tips again as I go</button>
</div></div>

<div class="sheet" id="welcomesheet" role="dialog" aria-modal="true" aria-label="Welcome to Spotter"><div class="sheetbody">
  <div class="grabber"></div>
  <div class="welcome-top"><span id="welcomecount" aria-live="polite"></span><button id="welcomeskip">Close</button></div>
  <div id="welcomestage"></div>
  <div class="welcome-actions"><button class="btn" id="welcomenext">Next</button></div>
</div></div>

<!-- The chrome-free card, at the top of the stack: nothing of the app may appear
     in a screenshot whose whole job is to be the proof. aria-hidden while closed,
     because a picture nobody can see is still read out otherwise. -->
<div id="proof" aria-hidden="true">
  <img id="proofimg" alt="Your session as one card">
  <div class="proofhint" id="proofhint">Tap anywhere to close</div>
</div>

<div id="toast"></div>
`;
