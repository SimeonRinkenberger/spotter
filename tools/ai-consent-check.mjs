import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const src = fs.readFileSync('supabase/functions/spotter/app.ts', 'utf8');
const fn = name => {
  const start = src.indexOf('  function ' + name + '(');
  assert(start >= 0, name);
  return src.slice(start, src.indexOf('\n  }', start) + 4);
};
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(settings = {}) {
  const nodes = new Map(); const requests = []; const writes = [];
  let finishWrite;
  const state = { user: { id: 'alice' }, profile: { settings } };
  const c = vm.createContext({
    state, AI_CONSENT_VERSION: '2026-09-19', aiConsentPending: null, accountEpoch: 1,
    Promise, Object, Error, Date, AbortController, JSON,
    $: id => { if (!nodes.has(id)) nodes.set(id, { textContent: '', disabled: false, classList: { add() {}, toggle() {}, remove() {} } }); return nodes.get(id); },
    accountNow: (epoch, uid) => epoch === c.accountEpoch && state.user?.id === uid,
    loadProfile: () => Promise.resolve(), openSheet: id => { c.open = id; },
    closeSheet: () => { vm.runInContext('dismissAiConsent()', c); },
    sb: { from: () => ({ update: body => ({ eq: (column, id) => { writes.push({body,id}); return new Promise(resolve => { finishWrite = resolve; }); } }) }),
      auth: { getSession: () => Promise.resolve({data:{session:{access_token:'fixture'}}}) } },
    SHARED: {}, inFlight: {}, API: 'https://api.invalid/', toast() {},
    // api() retires the minute-old /api/limits copy on a write (the speed cycle's C3).
    retireLimits() {},
    deadline: work => work(new AbortController().signal),
    fetch: async (url, opts) => { requests.push({url,opts}); return {status:200,json:async()=>({status:'ok'})}; },
  });
  vm.runInContext(['needsAiConsent','consentAt','paintConsent','requireAiConsent','dismissAiConsent','noteConsent','api','apiStream'].map(fn).join('\n'), c);
  return {c, state, requests, writes, nodes, finish: value => finishWrite(value)};
}
for (const settings of [{}, {ai_consent_at:'2026-09-01'}]) {
  const t = fixture(settings);
  const request = vm.runInContext('api("ingest", {method:"POST",body:"{}"})', t.c);
  await turn();
  assert.equal(t.c.open, 'aiconsentsheet'); assert.equal(t.requests.length,0);
  vm.runInContext('noteConsent()', t.c); await turn();
  assert.equal(t.requests.length,0, 'consent is not effective until stored');
  assert.equal(t.writes[0].id,'alice');
  t.finish({error:null}); await request;
  assert.equal(t.requests.length,1); assert.equal(t.state.profile.settings.ai_consent_version,'2026-09-19');
}
{
  const t=fixture();
  const p=vm.runInContext('apiStream("pumpy/chat",{},function(){})',t.c);
  const checked=assert.rejects(p,/not enabled/); await turn();
  vm.runInContext('dismissAiConsent()',t.c); await checked;
  assert.equal(t.requests.length,0); assert.equal(t.writes.length,0);
  await vm.runInContext('api("account/delete",{method:"POST",body:"{}"})',t.c);
  assert.equal(t.requests.length,1,'account operations available without AI');
}
{
  const t=fixture();
  const p=vm.runInContext('api("ingest",{method:"POST"})',t.c);
  const checked=assert.rejects(p,/not enabled/); await turn();
  vm.runInContext('noteConsent()',t.c); await turn();
  vm.runInContext('dismissAiConsent(); accountEpoch++',t.c);
  t.state.user={id:'bob'}; t.state.profile={settings:{}}; t.finish({error:null});
  await checked; await turn();
  assert.equal(t.requests.length,0,'account switch cannot release old content');
  assert.equal(t.state.profile.settings.ai_consent_version,undefined,'new account inherits no permission');
}
{
  const t=fixture();
  const p=vm.runInContext('api("ingest",{method:"POST"})',t.c);
  const checked=assert.rejects(p,/not enabled/); await turn();
  vm.runInContext('noteConsent()',t.c); t.finish({error:new Error('offline')}); await turn();
  assert.equal(t.requests.length,0); assert.match(t.nodes.get('aiconsenterror').textContent,/Could not save/);
  vm.runInContext('dismissAiConsent()',t.c); await checked;
}
assert(!src.includes('consentGiven'), 'account creation is never AI permission');
{
  const t=fixture({ai_consent_at:'2026-09-19',ai_consent_version:'2026-09-19',unit:'kg'});
  const review=vm.runInContext('requireAiConsent(true)',t.c); await turn();
  assert.equal(t.c.open,'aiconsentsheet','permission remains reviewable after acceptance');
  vm.runInContext('noteConsent(false)',t.c); await turn();
  assert.equal(t.state.profile.settings.ai_consent_version,'2026-09-19','revocation waits for storage');
  t.finish({error:null}); await review;
  assert.equal(t.state.profile.settings.ai_consent_at,null);
  assert.equal(t.state.profile.settings.ai_consent_version,null);
  assert.equal(t.state.profile.settings.unit,'kg','other settings preserved');
  const request=vm.runInContext('api("ingest",{method:"POST"})',t.c);
  const checked=assert.rejects(request,/not enabled/); await turn();
  assert.equal(t.requests.length,0,'next AI request requires fresh permission');
  vm.runInContext('dismissAiConsent()',t.c); await checked;
}

// ---------- OU-6: "Not now" is an answer, not a network failure ----------
//
// Declining the permission sheet used to reach every AI caller's catch as if the
// network had failed: Pumpy wrote "I couldn't reach Spotter" under the question
// and toasted "The connection ended", and a save said "Could not reach Spotter —
// check your connection". Run through the real api/apiStream and consent code.
const oneLine = (name) => { const a = src.indexOf('  function ' + name + '('); return a < 0 ? '' : src.slice(a, src.indexOf('\n', a)); };
function pumpyFixture(settings) {
  const t = fixture(settings);
  const toasts = [], box = { value: 'Build me a push day', style: {}, scrollHeight: 60, focus() {} };
  t.nodes.set('pumpyinput', box);
  t.nodes.set('pumpyview', { scrollTop: 0 });
  Object.assign(t.c, {
    toast: (m) => toasts.push(m), renderPumpy() {}, guideLearn() {}, isFree: () => false, openPlans() {},
    absorbMeter() {}, liveEvent() {}, NO_TOUCH: false, MAX_REFS: 6,
    pumpy: { thread: null, messages: [], busy: false, refs: [], live: null, stick: true },
  });
  vm.runInContext(oneLine('aiDeclined') + '\n' + fn('sendPumpy'), t.c);
  return { ...t, toasts, box };
}
{
  const t = pumpyFixture();
  vm.runInContext('sendPumpy()', t.c); await turn();
  assert.equal(t.c.open, 'aiconsentsheet');
  assert.equal(t.box.value, '', 'the box empties as the question is asked');
  vm.runInContext('closeSheet("aiconsentsheet")', t.c); await turn(); await turn();
  assert.equal(t.requests.length, 0);
  assert.deepEqual(t.toasts, [], 'Pumpy: no toast after Not now');
  assert.deepEqual(JSON.parse(JSON.stringify(t.c.pumpy.messages)), [], 'Pumpy: no question left as sent, no error bubble');
  assert.equal(t.c.pumpy.busy, false, 'Pumpy: can ask again');
  assert.equal(t.box.value, 'Build me a push day', 'Pumpy: the question goes back in the box');
}
{
  // A real failure still says so.
  const t = pumpyFixture({ ai_consent_at: '2026-09-19', ai_consent_version: '2026-09-19' });
  t.c.fetch = async () => { throw new Error('offline'); };
  vm.runInContext('sendPumpy()', t.c); await turn(); await turn(); await turn();
  assert.match(t.c.pumpy.messages.map((m) => m.content).join(' '), /couldn.t reach Spotter/);
  assert.equal(t.toasts.length, 1);
}
function saveFixture(settings) {
  const t = fixture(settings);
  const toasts = [], opened = [];
  t.nodes.set('addurl', { value: 'https://www.tiktok.com/@a/video/1' });
  t.nodes.set('addgo', { disabled: false, textContent: 'Add video' });
  Object.assign(t.c, {
    toast: (m) => toasts.push(m), sharing: true, cuttingFrames: () => false, deviceFrames: () => Promise.resolve(null),
    isFree: () => false, withShelf: (m) => m, placePending() {}, limitHit: () => false, load: () => Promise.resolve(),
    openDetail() {}, resetUpload() {}, addMode() {},
  });
  t.c.openSheet = (id) => { t.c.open = id; opened.push(id); };
  vm.runInContext(oneLine('aiDeclined') + '\n' + fn('doAdd'), t.c);
  return { ...t, toasts, opened };
}
{
  const t = saveFixture();
  const saved = vm.runInContext('doAdd(true)', t.c); await turn(); await turn();
  assert.equal(t.c.open, 'aiconsentsheet');
  vm.runInContext('closeSheet("aiconsentsheet")', t.c);
  assert.equal(await saved, false, 'save: nothing saved');
  assert.deepEqual(t.toasts, [], 'save: no "Could not reach Spotter" after Not now');
  assert.equal(t.nodes.get('addgo').disabled, false);
  assert.equal(t.nodes.get('addgo').textContent, 'Add video');
  assert.equal(t.nodes.get('addurl').value, 'https://www.tiktok.com/@a/video/1', 'save: the link stays in the box');
  assert.equal(t.opened.pop(), 'addsheet', 'save: a shared link is put back in the add sheet');
  assert.equal(t.c.sharing, false);
}
{
  const t = saveFixture({ ai_consent_at: '2026-09-19', ai_consent_version: '2026-09-19' });
  t.c.fetch = async () => { throw new Error('offline'); };
  assert.equal(await vm.runInContext('doAdd(true)', t.c), false);
  assert.deepEqual(t.toasts, ['Could not reach Spotter — check your connection.'], 'a real failure still says so');
}
{
  // Every AI-gated call in app.ts reaches a catch that either says nothing or asks
  // aiDeclined first, so no later caller can bring the wrong message back.
  const gated = /return \/\^\(([^)]*)\)\$\//.exec(fn('needsAiConsent'))[1].replace(/\\\//g, '/').split('|');
  assert(gated.includes('pumpy/chat') && gated.includes('ingest'));
  const call = new RegExp('\\b(api|apiStream)\\("(' + gated.map((g) => g.replace('/', '\\/')).join('|') + ')"' +
    '|\\bapi\\("workouts/" \\+ [\\w.]+ \\+ "/(reprocess|media)"', 'g');
  let m, sites = 0;
  while ((m = call.exec(src))) {
    const at = src.indexOf('.catch(function', m.index);
    const open = src.indexOf('{', at);
    let depth = 0, end = open;
    for (; end < src.length; end++) { if (src[end] === '{') depth++; else if (src[end] === '}' && --depth === 0) break; }
    const body = src.slice(open + 1, end).trim();
    const line = src.slice(0, m.index).split('\n').length;
    assert(body === '' || body.includes('aiDeclined('), 'app.ts:' + line + ' ' + m[0] + ' reaches a catch that ignores a declined permission');
    sites++;
  }
  assert(sites >= 12, 'found only ' + sites + ' AI-gated calls');
  assert(fn('dismissAiConsent').includes('no.declined = true;'));
}
console.log('PASS explicit AI consent before normal and streamed requests, legacy accounts, declined choice, durable acknowledgement, save failure, account switching, and manual account operations; Not now closes Pumpy, the save and every other AI caller without a network error.');
