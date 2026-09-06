import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code=fs.readFileSync('docs/sw.js','utf8');
const events={}, bins=new Map(),timers=[];
const key=k=>typeof k==='string'?k:k.url;
const caches={
  async keys(){return [...bins.keys()];},
  async open(k){if(!bins.has(k))bins.set(k,new Map());const b=bins.get(k);return {
    async addAll(paths){paths.forEach(p=>b.set(p,new Response('asset')));},
    async match(k){return b.get(key(k))?.clone();},
    async put(k,v){b.set(key(k),v.clone());}
  };},
  async delete(k){return bins.delete(k);},
  async match(k){for(const b of bins.values()){if(b.has(key(k)))return b.get(key(k)).clone();}}
};
let network=async()=>new Response('fresh'),checks=0;
const c=vm.createContext({Promise,Response,URL,caches,
  fetch:(...args)=>network(...args),setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{t.cancelled=true;},
  self:{addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},location:{origin:'http://localhost:8000'},clients:{claim:async()=>{}}}
});
vm.runInContext(code,c);
async function test(name,fn){await fn();checks++;console.log('PASS',name);}
async function dispatch(name){let p;events[name]({waitUntil:q=>p=q});await p;}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
await test('upgrade copies previous shell before retiring old cache',async()=>{
  await (await caches.open('spotter-shell-v6')).put('index.html',new Response('old-shell'));
  await caches.open('unrelated-app');await dispatch('install');await dispatch('activate');
  assert.equal(await (await (await caches.open(c.CACHE)).match('index.html')).text(),'old-shell');
  assert(!bins.has('spotter-shell-v6'));assert(bins.has('unrelated-app'));
});
await test('fresh navigation returns and stores the new shell',async()=>{
  let lifetime;const r=await c.page({}, {waitUntil:p=>lifetime=p});await lifetime;
  assert.equal(await r.text(),'fresh');assert.equal(await (await (await caches.open(c.CACHE)).match('index.html')).text(),'fresh');
});
await test('offline startup gets the stored shell',async()=>{
  network=async()=>{throw new Error('offline');};assert.equal(await (await c.page({})).text(),'fresh');
});
await test('a 503 never replaces a valid shell',async()=>{
  network=async()=>new Response('unavailable',{status:503});assert.equal(await (await c.page({})).text(),'fresh');
});
await test('slow network falls back and late success updates the next launch',async()=>{
  let resolve,lifetime,finished=false;network=()=>new Promise(r=>resolve=r);
  const p=c.page({}, {waitUntil:q=>{lifetime=q;q.then(()=>finished=true);}});await flush();
  const timer=timers.at(-1);assert.equal(timer.ms,1500);timer.fn();assert.equal(await (await p).text(),'fresh');assert(!finished);
  resolve(new Response('upgrade'));await lifetime;
  assert.equal(await (await (await caches.open(c.CACHE)).match('index.html')).text(),'upgrade');
});
await test('private API responses and unrelated navigations bypass shell cache',async()=>{
  let intercepted=0;
  for(const url of ['https://example.supabase.co/rest/v1/workouts','http://localhost:8000/privacy.html']) {
    events.fetch({request:{method:'GET',url,mode:'navigate'},respondWith(){intercepted++;}});
  }
  assert.equal(intercepted,0);
});
await test('versioned mascot URLs retain distinct cached content',async()=>{
  let n=0;network=async()=>new Response('art-'+(++n));
  async function art(version){let p;events.fetch({request:{method:'GET',url:'http://localhost:8000/assets/pumpy/hello.webp?v='+version},respondWith:q=>p=q});return (await p).text();}
  assert.equal(await art(12),'art-1');assert.equal(await art(12),'art-1');assert.equal(await art(13),'art-2');
});
console.log(checks+' service-worker checks passed');
