// The seam for native push, not the feature.
//
// The two reminders the web app already sends over Web Push — plan-day and
// week-at-risk — have no route to a native install: APNs needs an
// aps-environment entitlement, which needs the paid Developer Program, which
// Spotter does not have yet. So the plugin behind this answers `configured:
// false` today and the reminders section says so in plain words rather than
// offering a switch that does nothing.
//
// status() is the one call the page makes unprompted, so it is the one call that
// must never reject: a shell built before the plugin existed simply has no
// device registration, which is the same answer as a shell that has one and
// cannot use it.

export function createPush(plugin) {
  return {
    status() { return plugin.status().catch(() => ({ configured: false })); },
    register() { return plugin.register(); },
    unregister() { return plugin.unregister(); }
  };
}
