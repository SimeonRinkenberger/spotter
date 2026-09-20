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
console.log('PASS explicit AI consent before normal and streamed requests, legacy accounts, declined choice, durable acknowledgement, save failure, account switching, and manual account operations.');
