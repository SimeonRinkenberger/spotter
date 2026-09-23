// The native frame never moves for the keyboard (SpotterViewController.swift).
// This bridge turns UIKit's report — how much of the page the keyboard covers,
// over what duration, on what curve — into CSS variables and one DOM event, so
// the page can lift the surface that owns the field in step with the keys.

// UIKeyboardAnimationCurveUserInfoKey is 7 for the keyboard: UIKit's private
// curve, which no named CSS easing resembles and the old ['ease-in-out', …][curve]
// lookup silently turned into ease-in-out. Read off the live animation in the iOS 26
// Simulator, it is a critically damped spring (mass 1, stiffness 555, damping 47.1:
// 1 - (1 + wt)e^-wt, w = 23.6/s) cut at the 0.383s UIKit reports. This cubic is the
// closest one to it (1% of travel on average, 3.4% at worst; the widely quoted
// (0.38, 0.7, 0.125, 1) is 2.5% and 7%), and a cubic is what WebKit can hand to Core
// Animation: a linear() spring ran on the main thread in the same test. 0-3 keep
// their UIKit meaning.
export const KEYBOARD_EASE = 'cubic-bezier(0.325, 0.661, 0.115, 1)';
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
  // elapsed: how long the keys have already been moving (the shell reports it),
  // so every animation here starts that far in and shares the keys' timeline.
  const update = (visible, height, duration = 0.25, curve = 7, instant = false, elapsed = 0) => {
    duration = instant ? 0 : Number.isFinite(duration) ? Math.max(0, Math.min(1, duration)) : 0.25;
    elapsed = Number.isFinite(elapsed) ? Math.max(0, Math.min(duration, elapsed)) : 0;
    height = visible && Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0;
    const easing = keyboardEasing(curve);
    Object.assign(kb, { visible, height, duration, easing });
    // Inherited from the root, a changed value restyles all 1,300 elements of
    // the page (6ms in the Simulator) in the very task that starts the motion.
    // The lifted surfaces carry their own timing (app.ts); these two serve the
    // tab bar's fade and Android, and rarely change at all.
    const put = (name, value) => { if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value); };
    put('--keyboard-duration', duration + 's');
    put('--keyboard-curve', easing);
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
    win.dispatchEvent(new CustomEvent('spotter:keyboard', { detail: { visible, height, duration, easing, instant, elapsed } }));
    settling = win.setTimeout(() => {
      root.classList.remove('keyboard-moving');
      win.SpotterNative.keyboardMoving = false;
      win.dispatchEvent(new Event('spotter:keyboard-settled'));
    }, (duration - elapsed) * 1000 + 50);
  };
  win.addEventListener('spotter:keyboard-transition', event => {
    hasNativeTiming = true;
    const info = event.detail || event;
    update(!!info.visible, info.height, info.duration, info.curve, false, info.elapsed);
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
