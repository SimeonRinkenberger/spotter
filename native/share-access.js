// Serialize account changes so an old profile cannot overwrite a later sign-out.
// The plan rides beside the key as a hint for the Share Extension (whether a
// save could want frames at all); it is cleared whenever the key is.
export function shareAccess(plugin, report = () => {}) {
  let pending = Promise.resolve();
  return (key, plan) => {
    pending = pending.catch(() => {}).then(() =>
      plugin.configure({ key: key || null, plan: key && plan ? String(plan) : null }));
    pending.catch(report);
    return pending;
  };
}
