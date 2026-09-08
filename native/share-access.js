// Serialize account changes so an old profile cannot overwrite a later sign-out.
export function shareAccess(plugin, report = () => {}) {
  let pending = Promise.resolve();
  return key => {
    pending = pending.catch(() => {}).then(() => plugin.configure({ key: key || null }));
    pending.catch(report);
    return pending;
  };
}
