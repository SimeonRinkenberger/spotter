import { createPurchases } from './purchases.js';
import { signInWithApple } from './apple-auth.js';
import { signInWithGoogle } from './google-auth.js';
import { shareAccess } from './share-access.js';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { streamFetch } from './stream.js';
import { createSecureSession } from './secure-session.js';
import { createLiveState } from './live-state.js';
import { createPush } from './push.js';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Browser } from '@capacitor/browser';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { installKeyboard } from './keyboard.js';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import * as supabase from '@supabase/supabase-js';

window.supabase = supabase;
const ignore = () => {};
const android = Capacitor.getPlatform() === "android";
const AndroidHost = registerPlugin("SpotterAndroid");
const ShareAccessHost = registerPlugin('ShareAccess');
let draftWrites = Promise.resolve();
const configureSharing = shareAccess(android ? { configure: async () => {} } : ShareAccessHost, () => {
  window.dispatchEvent(new Event('spotter:share-unavailable'));
});

// ---------- frames from the phone ----------
//
// The native shells cut stills out of the video and send them with the save, so
// the reader sees the workout instead of only hearing it. The JPEGs never cross
// this bridge: the plugin uploads them itself and hands back the `frames` block
// to put in the ingest body, which is a few hundred bytes however heavy the
// video was.
//
// For a link that is all it takes. For a video picked out of the photo library
// there is no path to give the plugin — a File in a WKWebView is a handle, not a
// file — so the bytes are streamed to a cache file four megabytes at a time.
// Chunked because base64 inflates by a third and a 25 MB video read whole would
// mean a 33 MB string in the page's heap; the native side deletes the file when
// it is done with it, and so does the `finally` below if it never got that far.
const frameHost = android ? AndroidHost : ShareAccessHost;
const SHEET_CHUNK = 4 * 1024 * 1024;

const base64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result.split(',')[1]);
  reader.onerror = () => reject(reader.error || new Error('read failed'));
  reader.readAsDataURL(blob);
});

async function spillToCache(file) {
  const path = 'spotter-frames-' + crypto.randomUUID() + '.mp4';
  for (let at = 0; at < file.size; at += SHEET_CHUNK) {
    const data = await base64(file.slice(at, at + SHEET_CHUNK));
    await (at === 0
      ? Filesystem.writeFile({ path, data, directory: Directory.Cache })
      : Filesystem.appendFile({ path, data, directory: Directory.Cache }));
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  return { path, native: decodeURIComponent(uri.replace(/^file:\/\//, '')) };
}

async function contactSheet({ file, ...options }) {
  if (!file) return frameHost.contactSheet(options);
  let spilled = null;
  try {
    spilled = await spillToCache(file);
    return await frameHost.contactSheet({ ...options, path: spilled.native });
  } finally {
    if (spilled) Filesystem.deleteFile({ path: spilled.path, directory: Directory.Cache }).catch(ignore);
  }
}
// Tokens live in the Keychain on iOS and under an Android Keystore key on
// Android; only the non-secret draft stays in Preferences below.
const session = createSecureSession(registerPlugin('SecureSession'), Preferences);
window.SpotterNative = {
  platform: Capacitor.getPlatform(),
  purchases: createPurchases(Capacitor.getPlatform()),
  // The running session and the week summary, on the Lock Screen, the Home
  // Screen and the wrist. Both plugins are registered unconditionally: a shell
  // built before their Swift half exists simply rejects every call, which is
  // what the modules behind these two already treat as "not available".
  live: createLiveState(registerPlugin('LiveState')),
  push: createPush(registerPlugin('SpotterPush')),
  configureSharing,
  contactSheet,
  signInWithApple: sb => signInWithApple(sb, registerPlugin('AppleAuth')),
  signInWithGoogle: sb => signInWithGoogle(sb, registerPlugin('GoogleAuth')),
  authStorage: session.storage,
  saveDraft(value) {
    draftWrites = draftWrites.then(() => value === null
      ? Preferences.remove({ key: 'spotter_draft' })
      : Preferences.set({ key: 'spotter_draft', value })).catch(ignore);
  },
  haptic(kind) {
    // A segmented control is not a knock. selectionChanged is the tick UIKit gives
    // a UISegmentedControl, and on Android it plays the plugin's selection
    // waveform; the plugin re-prepares the generator after each one.
    if (kind === 'select') { Haptics.selectionChanged().catch(ignore); return; }
    const request = kind === 'pr' || kind === 'done'
      ? Haptics.notification({ type: NotificationType.Success })
      : Haptics.impact({ style: kind === 'tap' || kind === 'stream' ? ImpactStyle.Light : ImpactStyle.Medium });
    request.catch(ignore);
  },
  open(url) {
    const parsed = new URL(url, location.href);
    if (parsed.protocol !== 'https:') return Promise.resolve();
    return Browser.open({ url: parsed.href }).catch(ignore);
  }
};

// Only the existing HTTPS Edge Function uses native transport. Database/auth,
// uploads, and media retain browser fetch, cancellation, and streaming semantics.
// Pumpy uses a dedicated byte stream; other Edge Function requests stay buffered.
const PumpyStream = registerPlugin('PumpyStream');
const webFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url?.startsWith('https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter/api/')) return webFetch(input, init);
  if (url === 'https://mtzevoxxpsktmrbbuxva.supabase.co/functions/v1/spotter/api/pumpy/chat' && init.method === 'POST') {
    return streamFetch(PumpyStream, init);
  }
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const request = CapacitorHttp.request({
    url, method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers)),
    data: init.body, responseType: 'text', connectTimeout: 15000, readTimeout: 180000
  }).then(r => new Response(r.status === 204 ? null : (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)), { status: r.status, headers: r.headers }));
  if (!init.signal) return request;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    init.signal.addEventListener('abort', abort, { once: true });
    request.then(resolve, reject).finally(() => init.signal.removeEventListener('abort', abort));
  });
};

async function share(data) {
  const paths = [], files = [];
  try {
    for (const file of data.files || []) {
      if (file.size > 25 * 1024 * 1024) throw new Error('Share files must be smaller than 25 MB');
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject; reader.readAsDataURL(file);
      });
      const path = 'spotter-share-' + crypto.randomUUID() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const result = await Filesystem.writeFile({ path, data: encoded, directory: Directory.Cache });
      paths.push(path); files.push(result.uri);
    }
    await Share.share({ title: data.title, text: data.text, url: data.url, files: files.length ? files : undefined });
  } catch (error) {
    if (/cancel/i.test(error?.message || '')) throw new DOMException('Sharing cancelled', 'AbortError');
    throw error;
  } finally {
    await Promise.all(paths.map(path => Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(ignore)));
  }
}

async function boot() {
  if (!Capacitor.isNativePlatform()) throw new Error('Native bundle requires Capacitor');
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => !data.files || data.files.every(f => f instanceof File && f.size <= 25 * 1024 * 1024) });
  // Clear any Keychain item surviving uninstall before restoring this account.
  await configureSharing(null).catch(ignore);
  // Before app.js exists, so the Supabase client it builds reads the session
  // from its new home: moves a pre-upgrade session out of Preferences, or
  // clears one that outlived the install that owned it.
  await session.prepare();
  const saved = await Preferences.get({ key: 'spotter_draft' });
  if (saved.value) localStorage.setItem('spotter_draft', saved.value);
  const appearance = matchMedia('(prefers-color-scheme: dark)');
  const style = () => StatusBar.setStyle({ style: appearance.matches ? Style.Dark : Style.Light }).catch(ignore);
  style(); appearance.addEventListener('change', style);
  await installKeyboard(Keyboard);
  // Once, at boot: on iOS this keeps a prepared UISelectionFeedbackGenerator so
  // the first segment tap of a session ticks as fast as the tenth, and on Android
  // it arms the selection waveform. selectionEnd is never called — ending it would
  // throw the generator away and put the warm-up cost back on the next tap.
  await Haptics.selectionStart().catch(ignore);
  await App.addListener('appStateChange', ({ isActive }) => window.dispatchEvent(new CustomEvent('spotter:native-state', { detail: { isActive } })));
  // spotter:// arrives from a widget tap, a notification action or a Live
  // Activity while the app is already up. The page decides what each route
  // means; the shell only forwards what it was handed.
  await App.addListener('appUrlOpen', ({ url }) => window.dispatchEvent(new CustomEvent('spotter:open-url', { detail: { url } })));
  await Browser.addListener('browserFinished', () => window.dispatchEvent(new Event('focus')));
  document.addEventListener('click', event => {
    const a = event.target.closest('a[href]');
    if (!a || a.download) return;
    const url = new URL(a.href);
    if (url.protocol === 'https:') { event.preventDefault(); window.SpotterNative.open(url.href); }
    else if (url.origin === location.origin && /\.html$/.test(url.pathname) && !url.pathname.endsWith('/index.html')) {
      event.preventDefault(); window.SpotterNative.open('https://simeonrinkenberger.github.io/spotter/' + url.pathname.split('/').pop());
    }
  }, true);
  if (android) {
    document.documentElement.classList.add('android');
    await App.addListener('backButton', () => {
      const field = document.activeElement;
      if (window.SpotterNative.keyboardVisible && field?.matches('input, textarea, [contenteditable="true"]') && field.getClientRects().length) {
        field.blur();
        window.SpotterNative.keyboardVisible = false;
        Keyboard.hide().catch(ignore);
        return;
      }
      if (document.querySelector('.sheet.open, #detail.open, #workout.open')) history.back();
      else AndroidHost.background().catch(ignore);
    });
    await AndroidHost.addListener('sharedUrl', ({ url }) => window.dispatchEvent(new CustomEvent('spotter:shared-url', { detail: { url } })));
    const pending = await AndroidHost.takeShare();
    if (pending.url) sessionStorage.setItem('spotter_share_pending', pending.url);
  }
  // A cold launch from a widget or a notification has its URL waiting before any
  // listener could exist, so it is parked the way an Android share is and spent
  // by app.ts once there is a signed-in library to open something in.
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch && typeof launch.url === 'string' && launch.url.startsWith('spotter://')) {
    sessionStorage.setItem('spotter_open_pending', launch.url);
  }
  const script = document.createElement('script'); script.src = 'app.js'; document.body.appendChild(script);
}
boot().catch(() => { document.body.textContent = 'Spotter could not open local storage. Close and reopen the app.'; });
