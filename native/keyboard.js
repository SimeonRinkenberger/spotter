// UIKit owns the outer frame for every input. This bridge synchronizes internal
// spacing, accessories and focus without another viewport resize or scroll reset.
export async function installKeyboard(Keyboard, win = window, doc = document) {
  const root = doc.documentElement;
  root.classList.add('native');
  let settling, hasNativeTiming = false;
  const update = (visible, duration = 0.25, curve = 0) => {
    duration = Number.isFinite(duration) ? Math.max(0, Math.min(1, duration)) : 0.25;
    root.style.setProperty('--keyboard-duration', duration + 's');
    root.style.setProperty('--keyboard-curve', ['ease-in-out', 'ease-in', 'ease-out', 'linear'][curve] || 'ease-in-out');
    win.clearTimeout(settling);
    root.classList.add('keyboard-moving');
    win.SpotterNative.keyboardMoving = true;
    win.SpotterNative.keyboardVisible = visible;
    doc.body.classList.toggle('kb', visible);
    // Hidden navigation must not remain in the keyboard/accessibility order.
    const tabs = doc.querySelector('.tabbar');
    if (tabs) tabs.inert = visible;
    settling = win.setTimeout(() => {
      root.classList.remove('keyboard-moving');
      win.SpotterNative.keyboardMoving = false;
      win.dispatchEvent(new Event('spotter:keyboard-settled'));
    }, duration * 1000 + 50);
  };
  win.addEventListener('spotter:keyboard-transition', event => {
    hasNativeTiming = true;
    const info = event.detail || event;
    update(!!info.visible, info.duration, info.curve);
  });
  // Fallback for hosts without frame timing. Once UIKit reports a frame, late
  // didHide/didShow callbacks cannot undo a rapid focus or keyboard-type change.
  const fallback = visible => { if (!hasNativeTiming) update(visible); };
  await Keyboard.addListener('keyboardWillShow', info => fallback(info.keyboardHeight > 0));
  await Keyboard.addListener('keyboardDidShow', info => fallback(info.keyboardHeight > 0));
  await Keyboard.addListener('keyboardWillHide', () => fallback(false));
  await Keyboard.addListener('keyboardDidHide', () => fallback(false));
  // Ordinary text/search/email/URL/password fields get the regular system
  // keyboard. Keep Done for number pads, pickers and multiline forms.
  await Keyboard.setAccessoryBarVisible({ isVisible: false });
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
