// The seam for native push. Thin on purpose.
//
// The two reminders the web app already sends over Web Push — plan-day and
// week-at-risk — reach a native install through APNs instead. The Swift plugin
// behind this answers three questions about the phone (what the user allowed,
// which APNs environment this build talks to, what the device token is) and
// nothing about the deployment: whether there is an APNs signing key to push
// with comes from GET /api/push/config, which the page already fetches for the
// VAPID key.
//
// status() is the one call the page makes unprompted, so it is the one call that
// must never reject. A shell built before the plugin existed has no `status` to
// call and rejects; that is the same answer as a shell that has one and cannot
// use it, and both arrive here as `available: false`.

const UNAVAILABLE = {
  available: false,
  permission: 'unsupported',
  environment: null,
  bundle: '',
  registered: false
};

export function createPush(plugin) {
  return {
    status() { return plugin.status().then(s => s || UNAVAILABLE, () => UNAVAILABLE); },
    // register() is allowed to reject: it only ever runs from a tap, so there is
    // somebody there to be told, and the page has a toast for it. Swallowing the
    // failure here would leave a switch that flips on and quietly does nothing.
    register() { return plugin.register(); },
    // Off costs nothing and must not be able to fail: the row is already gone by
    // the time this runs, and a rejection would only strand the UI.
    unregister() { return plugin.unregister().catch(() => ({ registered: false })); }
  };
}
