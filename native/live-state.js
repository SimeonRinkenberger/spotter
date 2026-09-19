// The running session, on the surfaces the web page cannot draw.
//
// A Live Activity, a Home Screen widget and a watch face are all mirrors of the
// same session, and a mirror that fails must never be able to stall the set the
// lifter is actually logging. So everything outbound here is fire-and-forget and
// swallows its rejection; only the two permission questions — which a person is
// standing there waiting on an answer to — hand their promise back.
//
// The payload of each call IS the contract object (LiveState / LiveSummary /
// WidgetSummary, camelCase, `v: 1` at the top), so the Swift side decodes the
// call's own data straight into its Codable struct with no wrapper key to agree
// on. That is the whole interface between this file and the plugin.

const ignore = () => {};

export function createLiveState(plugin) {
  // The engine calls saveDraft() on every state change, and one tap makes three
  // of them: the set lands, the rest starts, the screen advances. Only the last
  // is true, so a burst inside one turn of the event loop collapses to one send
  // — the IPC hop and the ActivityKit update are both far dearer than the object.
  let queued = null;

  const flush = () => {
    const state = queued;
    queued = null;
    if (state) plugin.update(state).catch(ignore);
  };

  // Registered at creation rather than on demand: an action can arrive from the
  // Lock Screen the instant the app is resumed, before any page code has asked
  // for it, and the window event is what app.ts is listening for either way.
  plugin.addListener('action', a => {
    // A retained action is handed over the moment this listener attaches, which
    // on a cold launch from a notification is before app.js has even parsed —
    // and a CustomEvent nobody is listening for is simply gone. That is why a
    // tapped reminder opened the Library instead of Progress. A link-shaped one
    // is parked under the same key a launch URL uses, so the page spends it once
    // its library is up; app.ts clears the key when it handles the event itself,
    // so the link is opened exactly once either way.
    if (a && typeof a.id === 'string' && a.id.startsWith('spotter://')) {
      try { sessionStorage.setItem('spotter_open_pending', a.id); } catch (e) { /* ignore */ }
    }
    window.dispatchEvent(new CustomEvent('spotter:live-action', { detail: a }));
  });

  return {
    update(state) {
      const idle = !queued;
      queued = state;
      if (idle) queueMicrotask(flush);
    },
    // A queued update belongs to a session that has just ended; sending it after
    // the end would put the activity back on the Lock Screen a frame later.
    end(summary) {
      queued = null;
      plugin.end(summary).catch(ignore);
    },
    publish(summary) {
      plugin.publish(summary).catch(ignore);
    },
    notifications: {
      status() { return plugin.notifyStatus(); },
      request() { return plugin.notifyRequest(); }
    }
  };
}
