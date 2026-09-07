// Real-browser regression checks for native details motion. No account or network.
// PLAYWRIGHT_MODULE may point to an installed Playwright ESM entry; default: package.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
const page=fs.readFileSync('docs/index.html','utf8');
const motion=source.slice(source.indexOf('  var movingDisclosures ='),source.indexOf('  function disclosure('));
assert(motion.includes('function animateDisclosure('));
const browser=await chromium.launch({channel:'chrome',headless:true});
const p=await browser.newPage({viewport:{width:375,height:812}});
const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',r=>r.abort());
const section=(id,cls='disclosure',body='<p style="height:160px">Supporting details</p><button>Action</button>')=>`<details id="${id}" class="${cls}"><summary>${id}</summary><div class="disclosure-body">${body}</div></details>`;
await p.setContent(page.match(/<style>[\s\S]*?<\/style>/)[0]+`<main style="padding:16px">${section('basic')}${section('source')}${section('parent','disclosure',section('nested'))}${section('history','chartcard history-card')}${section('guide','guide-topic')}${section('options','disclosure exercise-options')}<div id="following">Following content</div></main>`);
await p.addScriptTag({content:'function lessMotion(){return matchMedia("(prefers-reduced-motion: reduce)").matches;}\n'+motion});
let count=0;
async function test(name,body){await body();count++;console.log('PASS',name);}
const state=id=>p.locator('#'+id).evaluate(n=>({height:n.getBoundingClientRect().height,open:n.open,moving:!!n._disclosureRun,animations:n.getAnimations().length,inert:n.lastElementChild.inert}));
const toggle=id=>p.locator('#'+id+' > summary').evaluate(n=>n.click());
const settle=()=>p.waitForFunction(()=>!movingDisclosures.length);
try {
 for(const id of ['basic','history','guide','options'])await test(id+' moves through intermediate heights in both directions',async()=>{
  const closed=await state(id);await toggle(id);await p.waitForTimeout(70);const middle=await state(id);await settle();const open=await state(id);
  assert(middle.height>closed.height+2&&middle.height<open.height-2,JSON.stringify({closed,middle,open}));
  await toggle(id);await p.waitForTimeout(45);const closing=await state(id);assert(closing.height<open.height-2&&closing.height>closed.height+2);assert(closing.inert);await settle();
  const end=await state(id);assert(!end.open&&!end.inert&&!end.animations);assert(Math.abs(end.height-closed.height)<1);
 });
 await test('rapid reversal begins at the displayed height and ignores stale completion',async()=>{
  await toggle('basic');await p.waitForTimeout(55);
  const delta=await p.locator('#basic').evaluate(n=>{const before=n.getBoundingClientRect().height;n.firstElementChild.click();return Math.abs(before-n.getBoundingClientRect().height);});assert(delta<2);
  await p.waitForTimeout(35);await toggle('basic');await settle();assert((await state('basic')).open);
  await p.waitForTimeout(480);assert((await state('basic')).open);
 });
 await test('source mounts before measurement and unloads only after closing',async()=>{
  await p.locator('#source').evaluate(n=>{n.lastElementChild.innerHTML='';n._prepareDisclosure=function(){if(!n.open){n.lastElementChild.innerHTML='';return;}if(!n.querySelector('iframe')){const f=document.createElement('iframe');f.height='250';f.title='Source';n.lastElementChild.appendChild(f);}};n.addEventListener('toggle',n._prepareDisclosure);});
  await toggle('source');await p.waitForTimeout(70);const middle=await state('source');await settle();assert((await state('source')).height>middle.height+2);assert.equal(await p.locator('#source iframe').count(),1);
  await toggle('source');assert.equal(await p.locator('#source iframe').count(),1);await settle();await p.waitForFunction(()=>!document.querySelector('#source iframe'));
 });
 await test('nested sections animate without toggling their parent or trapping height',async()=>{
  await toggle('parent');await settle();const before=await state('parent');await toggle('nested');await p.waitForTimeout(70);const middle=await state('parent');await settle();const after=await state('parent');assert(before.open&&after.open&&middle.height>before.height&&middle.height<after.height);
  await toggle('parent');await settle();await toggle('parent');await settle();assert((await state('nested')).open);assert.equal((await state('parent')).animations,0);
 });
 await test('keyboard activation and child buttons preserve native behavior',async()=>{
  await p.locator('#guide > summary').focus();await p.keyboard.press('Enter');await settle();assert((await state('guide')).open);
  await p.locator('#guide button').click();assert((await state('guide')).open);
  await p.locator('#guide > summary').focus();await p.keyboard.press('Space');await settle();assert(!(await state('guide')).open);
 });
 await test('closing moves child focus to the summary and restores interactivity',async()=>{
  await p.locator('#basic button').focus();await toggle('basic');assert(await p.locator('#basic > summary').evaluate(n=>n===document.activeElement));await settle();assert(!(await state('basic')).inert);
 });
 await test('resize and canceled animations release transient state',async()=>{
  await toggle('basic');await p.setViewportSize({width:390,height:812});await settle();assert((await state('basic')).open);
  await toggle('basic');await p.locator('#basic').evaluate(n=>n._disclosureRun.animation.cancel());await settle();assert(!(await state('basic')).open);assert(!(await state('basic')).inert);
 });
 await test('reduced motion settles in-flight motion and future toggles are immediate',async()=>{
  await toggle('basic');await p.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});await settle();assert((await state('basic')).open);await toggle('basic');assert(!(await state('basic')).open&&!(await state('basic')).moving);
  await toggle('parent');assert(!(await state('parent')).moving);
 });
 await test('missing animation support and withheld finish events still settle',async()=>{
  await p.emulateMedia({reducedMotion:'no-preference'});
  await p.locator('#basic').evaluate(n=>{n.animate=null;});await toggle('basic');assert((await state('basic')).open&&!(await state('basic')).moving);
  await p.locator('#basic').evaluate(n=>{delete n.animate;});await toggle('basic');await p.locator('#basic').evaluate(n=>{n._disclosureRun.animation.onfinish=null;});await settle();assert(!(await state('basic')).open&&!(await state('basic')).inert);
 });
 await test('375px light and dark layouts do not overflow',async()=>{
  await p.setViewportSize({width:375,height:812});
  for(const colorScheme of ['light','dark']){await p.emulateMedia({colorScheme});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=375));}
  assert.deepEqual(errors,[]);
 });
 console.log(count+' disclosure browser checks passed');
} finally {await browser.close();}
