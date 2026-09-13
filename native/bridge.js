import { signInWithApple } from './apple-auth.js';
import { signInWithGoogle } from './google-auth.js';
import { shareAccess } from './share-access.js';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { streamFetch } from './stream.js';
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
let draftWrites = Promise.resolve();
const configureSharing = shareAccess(registerPlugin('ShareAccess'), () => {
  window.dispatchEvent(new Event('spotter:share-unavailable'));
});
window.SpotterNative = {
  configureSharing,
  signInWithApple: sb => signInWithApple(sb, registerPlugin('AppleAuth')),
  signInWithGoogle: sb => signInWithGoogle(sb, registerPlugin('GoogleAuth')),
  authStorage: {
    getItem: async key => (await Preferences.get({ key })).value,
    setItem: (key, value) => Preferences.set({ key, value }),
    removeItem: key => Preferences.remove({ key })
  },
  saveDraft(value) {
    draftWrites = draftWrites.then(() => value === null
      ? Preferences.remove({ key: 'spotter_draft' })
      : Preferences.set({ key: 'spotter_draft', value })).catch(ignore);
  },
  haptic(kind) {
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
  const saved = await Preferences.get({ key: 'spotter_draft' });
  if (saved.value) localStorage.setItem('spotter_draft', saved.value);
  const appearance = matchMedia('(prefers-color-scheme: dark)');
  const style = () => StatusBar.setStyle({ style: appearance.matches ? Style.Dark : Style.Light }).catch(ignore);
  style(); appearance.addEventListener('change', style);
  await installKeyboard(Keyboard);
  await App.addListener('appStateChange', ({ isActive }) => window.dispatchEvent(new CustomEvent('spotter:native-state', { detail: { isActive } })));
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
  const script = document.createElement('script'); script.src = 'app.js'; document.body.appendChild(script);
}
boot().catch(() => { document.body.textContent = 'Spotter could not open local storage. Close and reopen the app.'; });
