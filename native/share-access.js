// Serialize account changes so an old profile cannot overwrite a later sign-out.
//
// `hint.plan` rides along when the page knows it: the Share Extension reads it
// beside the key to decide, before its one request, whether to ask the server
// to wait for the phone's frames (a Plus thing). A call without it leaves the
// stored hint alone; a sign-out (no key) clears it on the native side.
export function shareAccess(plugin, report = () => {}) {
  let pending = Promise.resolve();
  return (key, hint) => {
    const options = { key: key || null };
    if (key && hint && typeof hint.plan === 'string' && hint.plan) options.plan = hint.plan;
    pending = pending.catch(() => {}).then(() => plugin.configure(options));
    pending.catch(report);
    return pending;
  };
}

// A link shared while signed out, parked by the Share Extension: `{url, at}`
// or null. Each link is handed over once. Never rejects: a shell without the
// method (Android, an older build) simply has nothing parked.
export function takeParked(plugin) {
  return () => Promise.resolve()
    .then(() => plugin.takeParked())
    .then(r => (r && typeof r.url === 'string' && r.url ? { url: r.url, at: Number(r.at) || 0 } : null))
    .catch(() => null);
}
