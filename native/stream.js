// Adapt the native byte callbacks to the existing fetch/NDJSON reader.
export function streamFetch(plugin, init) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), signal = init.signal;
    let controller, finished = false, started = false, cancelPending = false;
    const cancelNative = () => {
      if (started) plugin.cancel({ id }).catch(() => {});
      else cancelPending = true;
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = error => {
      if (finished) return;
      finished = true;
      cleanup();
      if (controller) controller.error(error);
      else reject(error);
    };
    const abort = () => {
      if (finished) return;
      cancelNative();
      fail(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    plugin.start({ id, body: init.body, authorization: new Headers(init.headers).get('authorization') || '' }, (event, error) => {
      if (finished) return;
      if (error) { fail(new Error(error.message || 'Stream failed')); return; }
      if (event.type === 'headers') {
        const body = new ReadableStream({
          start(c) { controller = c; },
          cancel() { finished = true; cleanup(); cancelNative(); }
        });
        resolve(new Response(body, { status: event.status, headers: { 'content-type': event.contentType } }));
      } else if (event.type === 'data') {
        controller.enqueue(Uint8Array.from(atob(event.data), c => c.charCodeAt(0)));
      } else if (event.type === 'end') {
        finished = true; cleanup(); controller.close();
      } else if (event.type === 'error') {
        fail(new Error(event.message));
      }
    }).then(() => {
      started = true;
      if (cancelPending) cancelNative();
    }).catch(fail);
  });
}
