import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { streamFetch } from '../../native/stream.js';

function fixture() {
  let callback, calls = 0, cancels = 0;
  const plugin = {
    start: async (options, cb) => { calls++; callback = cb; },
    cancel: async () => { cancels++; }
  };
  return { plugin, emit: e => callback(e), get calls() { return calls; }, get cancels() { return cancels; } };
}
const options = () => ({ body: '{"stream":true}', headers: { authorization: 'Bearer fixture' } });
const headers = { type: 'headers', status: 200, contentType: 'application/x-ndjson' };
const data = bytes => ({ type: 'data', data: Buffer.from(bytes).toString('base64') });
const f = fixture(), response = streamFetch(f.plugin, options());
f.emit(headers);
const reader = (await response).body.getReader();
const text = '{"t":"delta","text":"Hi 💪"}\n';
const bytes = Buffer.from(text), split = bytes.indexOf(Buffer.from('💪')) + 2;
f.emit(data(bytes.subarray(0, split)));
const decoder = new TextDecoder();
let received = decoder.decode((await reader.read()).value, { stream: true });
assert(received.startsWith('{"t":"delta"'), 'first bytes arrive before completion');
f.emit(data(bytes.subarray(split)));
received += decoder.decode((await reader.read()).value, { stream: true });
assert.equal(received, text, 'split Unicode stays intact');
f.emit({ type: 'end' });
assert.equal((await reader.read()).done, true);

const a = fixture(), abort = new AbortController();
const pending = streamFetch(a.plugin, { ...options(), signal: abort.signal });
abort.abort();
await assert.rejects(pending, { name: 'AbortError' });
await Promise.resolve();
assert.equal(a.cancels, 1, 'abort before headers cancels native task');
const b = fixture(), ac = new AbortController();
const active = streamFetch(b.plugin, { ...options(), signal: ac.signal });
b.emit(headers);
const r = (await active).body.getReader();
ac.abort();
await assert.rejects(r.read(), { name: 'AbortError' });
assert.equal(b.cancels, 1);
b.emit(data(Buffer.from('late packet')));
const c = fixture(), cancelled = streamFetch(c.plugin, options());
c.emit(headers);
await (await cancelled).body.cancel();
assert.equal(c.cancels, 1);
const d = fixture(), failed = streamFetch(d.plugin, options());
d.emit({ type: 'error', message: 'offline' });
await assert.rejects(failed, /offline/);
const e = fixture(), refusal = streamFetch(e.plugin, options());
e.emit({ ...headers, status: 429, contentType: 'application/json' });
e.emit(data(Buffer.from('{"status":"limit"}')));
e.emit({ type: 'end' });
const denied = await refusal;
assert.equal(denied.status, 429);
assert.deepEqual(await denied.json(), { status: 'limit' });

const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const start = src.indexOf('  function pumpyStreamHaptic(');
const end = src.indexOf('\n  }', start) + 4;
let now = 0, pulses = 0, overlay = false;
const ctx = vm.createContext({ native: {}, state: { haptics: true, view: 'pumpy' },
  document: { hidden: false }, performance: { now: () => now },
  overlayShowing: () => overlay, haptic: kind => { assert.equal(kind, 'stream'); pulses++; }, live: {} });
vm.runInContext(src.slice(start, end), ctx);
const pulse = () => vm.runInContext('pumpyStreamHaptic(live, "text")', ctx);
pulse(); now = 40; pulse(); assert.equal(pulses, 1);
now = 100; pulse(); assert.equal(pulses, 2);
now = 200; ctx.state.haptics = false; pulse();
ctx.state.haptics = true; ctx.document.hidden = true; pulse();
ctx.document.hidden = false; ctx.state.view = 'library'; pulse();
ctx.state.view = 'pumpy'; overlay = true; pulse();
assert.equal(pulses, 2, 'muted, hidden, other pages, and sheets are silent');
console.log('PASS streaming before completion, split Unicode, cancellation, network error, JSON refusal, and haptic throttling/preferences/visibility.');
