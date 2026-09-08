import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { installKeyboard } from '../../native/keyboard.js';

const listeners = {}, domListeners = {}, nativeListeners = {}, classes = new Set(), properties = new Map(), timers = new Map();
let timerID = 0;
const tabs = { inert: false };
const win = { SpotterNative: {}, visualViewport: { height: 500 }, innerHeight: 500,
  setTimeout: fn => { timers.set(++timerID, fn); return timerID; }, clearTimeout: id => timers.delete(id),
  addEventListener: (name, fn) => { nativeListeners[name] = fn; },
  dispatchEvent: event => { nativeListeners[event.type]?.(event); },
  getComputedStyle: field => ({ fontSize: field.style.fontSize || '14px' }),
  scrollY: 12, scrollTo() { throw new Error('Native focus scrolling must not be reset'); } };
const removed = [];
const doc = {
  documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => removed.push(name) } },
  body: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
  querySelector: () => tabs,
  addEventListener: (name, fn) => { domListeners[name] = fn; }, activeElement: null
};
let accessory;
await installKeyboard({
  addListener: async (name, fn) => { listeners[name] = fn; },
  setAccessoryBarVisible: async value => { accessory = value.isVisible; }
}, win, doc);
assert.equal(accessory, false);
assert(classes.has('native'));
const field = (id, tagName = 'INPUT', type = 'text', inputMode = '') => ({ id, tagName, type, inputMode, style: {} });
const chat = field('pumpyinput', 'TEXTAREA');
const weight = field('wtin', 'INPUT', 'text', 'decimal');
domListeners.focusin({ target: chat });
assert.equal(accessory, false, 'chat does not show web-form navigation');
assert.equal(chat.style.fontSize, '16px', 'small text does not trigger focus zoom');
domListeners.focusin({ target: weight });
assert.equal(accessory, true, 'number pads retain Done');
for (const type of ['text', 'email', 'password', 'url', 'search']) {
  const input = field('dynamic-' + type, 'INPUT', type);
  input.style.fontSize = '20px';
  domListeners.focusin({ target: input });
  assert.equal(accessory, false, type + ' uses the normal system keyboard');
  assert.equal(input.style.fontSize, '20px', 'larger input typography is preserved');
}
domListeners.focusin({ target: field('notes', 'TEXTAREA') });
assert.equal(accessory, true, 'multiline forms keep a way to finish typing');
domListeners.pointerdown({ target: { closest: selector => selector === 'input, textarea' ? chat : null } });
assert.equal(accessory, false, 'chat toolbar is configured before focus');
const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const start = src.indexOf('  function fitViewport()');
const end = src.indexOf('\n  }', start) + 4;
const ctx = vm.createContext({ window: win, document: doc, native: win.SpotterNative });
vm.runInContext(src.slice(start, end), ctx);
listeners.keyboardWillShow({ keyboardHeight: 346 });
vm.runInContext('fitViewport()', ctx);
assert(classes.has('kb'), 'equal visual/layout heights still mean keyboard open in native mode');
assert.deepEqual(removed, ['--vvh', '--vvtop']);
listeners.keyboardDidShow({ keyboardHeight: 346 });
vm.runInContext('fitViewport(); fitViewport()', ctx);
assert(classes.has('kb'), 'viewport events must not clear native keyboard state');
listeners.keyboardWillHide();
assert(!classes.has('kb'));
listeners.keyboardDidHide();
assert.equal(win.SpotterNative.keyboardVisible, false);
listeners.keyboardWillShow({ keyboardHeight: 0 });
assert(!classes.has('kb'), 'hardware keyboard must not hide navigation');
nativeListeners['spotter:keyboard-transition']({ visible: true, duration: 0.4, curve: 2 });
assert.equal(properties.get('--keyboard-duration'), '0.4s');
assert.equal(properties.get('--keyboard-curve'), 'ease-out');
assert.equal(tabs.inert, true, 'hidden navigation cannot receive focus');
listeners.keyboardDidHide();
assert(classes.has('kb'), 'a late callback cannot reopen navigation during refocus');
nativeListeners['spotter:keyboard-transition']({ detail: { visible: false, duration: 0.2, curve: 0 } });
assert.equal(timers.size, 1, 'rapid transitions cancel the previous cleanup');
assert.equal(tabs.inert, false);
assert.equal(win.SpotterNative.keyboardMoving, true, 'dismissal retains its transition state');
assert(!classes.has('kb'));
{ const [id, fn] = [...timers.entries()][0]; timers.delete(id); fn(); }
assert(!classes.has('keyboard-moving'));
assert.equal(win.SpotterNative.keyboardMoving, false);
let prevented = 0;
const pointer = { target: { closest: () => true }, preventDefault: () => { prevented++; } };
domListeners.pointerdown(pointer);
assert.equal(prevented, 0);
doc.activeElement = { closest: () => true };
domListeners.pointerdown(pointer);
assert.equal(prevented, 1, 'Send keeps an already focused composer open');
pointer.target.closest = () => false;
domListeners.pointerdown(pointer);
assert.equal(prevented, 1, 'other controls keep normal focus');
const config = JSON.parse(fs.readFileSync('capacitor.config.json'));
assert.equal(config.plugins.Keyboard.resize, 'none', 'disable delayed Capacitor resizing while UIKit owns the frame');
console.log('PASS keyboard timing/refocus, all input types, focus-zoom prevention, accessible navigation, viewport ownership, and Send focus.');

// The nav loses its safe-area padding while the native frame expands. Do not
// retarget the composer to this transient measurement, even though visible=false.
let barHeight = 112;
const chrome = vm.createContext({ document: doc, native: win.SpotterNative,
  hdrEl: { getBoundingClientRect: () => ({height: 92}) },
  tabbar: { getBoundingClientRect: () => ({height: barHeight}) },
  pagesEl: { clientWidth: 390 }, pageW: 390, paint: () => {} });
const chromeStart = src.indexOf('  function measureChrome()');
vm.runInContext(src.slice(chromeStart, src.indexOf('\n  }', chromeStart) + 4), chrome);
const measure = () => vm.runInContext('measureChrome()', chrome);
measure(); assert.equal(properties.get('--ptab'), '112px');
nativeListeners['spotter:keyboard-transition']({ visible: true, duration: 0.25 });
barHeight = 78; measure(); assert.equal(properties.get('--ptab'), '112px');
nativeListeners['spotter:keyboard-transition']({ visible: false, duration: 0.25 });
measure(); assert.equal(properties.get('--ptab'), '112px', 'closing keyboard must not shorten resting clearance');
let settled = 0;
nativeListeners['spotter:keyboard-settled'] = () => { settled++; measure(); };
// Refocus before dismissal completes: old cleanup must not remeasure a hidden bar.
nativeListeners['spotter:keyboard-transition']({ visible: true, duration: 0.25 });
assert.equal(timers.size, 1);
const finish = () => { const [id, fn] = [...timers.entries()][0]; timers.delete(id); fn(); };
finish(); assert.equal(settled, 1);
assert.equal(properties.get('--ptab'), '112px');
nativeListeners['spotter:keyboard-transition']({ visible: false, duration: 0.25 });
barHeight = 116; measure(); assert.equal(properties.get('--ptab'), '112px');
finish(); assert.equal(properties.get('--ptab'), '116px', 'resting layout is measured once dismissal settles');
console.log('PASS stable composer clearance during keyboard dismissal, rapid refocus and final safe-area reconciliation.');
