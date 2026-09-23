// The native frame never moves for the keyboard (SpotterViewController.swift).
// This bridge turns UIKit's report — how much of the page the keyboard covers,
// over what duration, on what curve — into CSS variables and one DOM event, so
// the page can lift the surface that owns the field in step with the keys.

// UIKeyboardAnimationCurveUserInfoKey is 7 for the keyboard: UIKit's private
// curve, which no named CSS easing resembles and the old ['ease-in-out', …][curve]
// lookup silently turned into ease-in-out. Tracked frame by frame in an iPhone 16e
// (iOS 26) Simulator recording, the keys follow a critically damped spring,
// 1 - (1 + wt)e^-wt with w = 24/s, settled within the 0.383s UIKit reports. This
// cubic is the closest one to that spring (1% of travel), and a cubic is what Core
// Animation can run off the main thread; it is the widely quoted
// (0.38, 0.7, 0.125, 1) refined against the recording. 0-3 keep their UIKit meaning.
export const KEYBOARD_EASE = 'cubic-bezier(0.33, 0.7, 0.12, 1)';
const CURVES = ['ease-in-out', 'ease-in', 'ease-out', 'linear'];

export function keyboardEasing(curve) {
  return CURVES[curve] || KEYBOARD_EASE;
}

// stillFrame: the host keeps the web view's frame while the keys move over it
// (the iOS shell). Android resizes its frame (adjustResize) and keeps the older,
// resize-following CSS.
export async function installKeyboard(Keyboard, win = window, doc = document, { stillFrame = false } = {}) {
  const root = doc.documentElement;
  root.classList.add('native');
  if (stillFrame) root.classList.add('kb-over');
  let settling, hasNativeTiming = false;
  const kb = win.SpotterNative.keyboard = { visible: false, height: 0, duration: 0, easing: KEYBOARD_EASE };
  const update = (visible, height, duration = 0.25, curve = 7, instant = false) => {
    duration = instant ? 0 : Number.isFinite(duration) ? Math.max(0, Math.min(1, duration)) : 0.25;
    height = visible && Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0;
    const easing = keyboardEasing(curve);
    Object.assign(kb, { visible, height, duration, easing });
    root.style.setProperty('--keyboard-duration', duration + 's');
    root.style.setProperty('--keyboard-curve', easing);
    root.style.setProperty('--kb', height + 'px');
    win.clearTimeout(settling);
    root.classList.add('keyboard-moving');
    win.SpotterNative.keyboardMoving = true;
    win.SpotterNative.keyboardVisible = visible;
    doc.body.classList.toggle('kb', visible);
    // Hidden navigation must not remain in the keyboard/accessibility order.
    const tabs = doc.querySelector('.tabbar');
    if (tabs) tabs.inert = visible;
    // The page moves its surfaces from here, in the same task, so the first
    // frame of their animation is the first frame of the keyboard's.
    win.dispatchEvent(new CustomEvent('spotter:keyboard', { detail: { visible, height, duration, easing, instant } }));
    settling = win.setTimeout(() => {
      root.classList.remove('keyboard-moving');
      win.SpotterNative.keyboardMoving = false;
      win.dispatchEvent(new Event('spotter:keyboard-settled'));
    }, duration * 1000 + 50);
  };
  win.addEventListener('spotter:keyboard-transition', event => {
    hasNativeTiming = true;
    const info = event.detail || event;
    update(!!info.visible, info.height, info.duration, info.curve);
  });
  // A finger dragging the keyboard down (interactive dismissal): no animation,
  // the surfaces take each sampled height as it comes.
  win.addEventListener('spotter:keyboard-track', event => {
    const info = event.detail || event;
    if (!kb.visible) return;
    update(true, info.height, 0, 7, true);
  });
  // Fallback for hosts without frame timing. Once UIKit reports a frame, late
  // didHide/didShow callbacks cannot undo a rapid focus or keyboard-type change.
  const fallback = (visible, height) => { if (!hasNativeTiming) update(visible, height); };
  await Keyboard.addListener('keyboardWillShow', info => fallback(info.keyboardHeight > 0, info.keyboardHeight));
  await Keyboard.addListener('keyboardDidShow', info => fallback(info.keyboardHeight > 0, info.keyboardHeight));
  await Keyboard.addListener('keyboardWillHide', () => fallback(false, 0));
  await Keyboard.addListener('keyboardDidHide', () => fallback(false, 0));
  // Ordinary text/search/email/URL/password fields get the regular system
  // keyboard. Keep Done for number pads, pickers and multiline forms.
  await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  let accessoryVisible = false;
  const prepare = target => {
    if (!target || !/^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
    const visible = /^(numeric|decimal)$/.test(target.inputMode || '')
      || /^(number|date|time|datetime-local|month|week)$/.test(target.type || '')
      || (target.tagName === 'TEXTAREA' && target.id !== 'pumpyinput');
    if (visible !== accessoryVisible) {
      accessoryVisible = visible;
      Keyboard.setAccessoryBarVisible({ isVisible: visible }).catch(() => {});
    }
    // iOS zooms small editable text on focus. Apply the minimum before focus,
    // including dynamically created edit fields, while preserving larger text.
    if (parseFloat(win.getComputedStyle(target).fontSize) < 16) target.style.fontSize = '16px';
  };
  doc.addEventListener('focusin', event => prepare(event.target));
  doc.addEventListener('pointerdown', event => {
    const field = event.target.closest('input, textarea');
    if (field) prepare(field);
    if (event.target.closest('#pumpysend') && doc.activeElement?.closest('#pumpycomposer textarea')) {
      event.preventDefault();
    }
  });
}
