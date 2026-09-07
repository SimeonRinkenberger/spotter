// Real-browser regression checks for native details motion. No account or network.
// PLAYWRIGHT_MODULE may point to an installed Playwright ESM entry; default: package.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const engines=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
const page=fs.readFileSync('docs/index.html','utf8');
const motion=source.slice(source.indexOf('  var movingDisclosures ='),source.indexOf('  function disclosure('));
assert(motion.includes('function animateDisclosure('));
const engine=process.env.SPOTTER_BROWSER==='webkit'?'webkit':'chromium';
const browser=await engines[engine].launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
const p=await browser.newPage({viewport:{width:375,height:812}});
const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',r=>r.abort());
const section=(id,cls='disclosure',body='<p style="height:160px">Supporting details</p><button>Action</button>')=>`<details id="${id}" class="${cls}"><summary>${id}</summary><div class="disclosure-body">${body}</div></details>`;
const toolbar=(id,classes='exercise-actions',count=2)=>`<div class="${classes}">${section(id,'disclosure exercise-options',Array.from({length:count},(_,i)=>`<button class="pickrow">${i?'Demo':'Review / Edit'}</button>`).join('')+'<button class="pickrow">Swap or modify</button>')}</div>`;
await p.setContent('<meta name="viewport" content="width=device-width, initial-scale=1">'+page.match(/<style>[\s\S]*?<\/style>/)[0]+`<main style="padding:16px">${section('basic')}${section('source')}${section('parent','disclosure',section('nested'))}${section('history','chartcard history-card')}${section('guide','guide-topic')}${section('options','disclosure exercise-options')}<div class="sect workout-block"><div class="exercise-card"><div class="exercise-main">Goblet squat</div>${toolbar('toolbar')}</div><div id="next-exercise" class="exercise-card">Next exercise</div></div>${toolbar('workout-toolbar','wactions exercise-actions')}${toolbar('two-toolbar','wactions exercise-actions two-actions',1)}<div id="following">Following content</div></main>`);
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
 await test('real action rows never shift or resize horizontally throughout opening and closing',async()=>{
  for(const width of [320,375,393,430,1280]){
   await p.setViewportSize({width,height:812});
   for(const id of ['toolbar','workout-toolbar','two-toolbar'])for(const open of [true,false]){
    const frames=await p.locator('#'+id).evaluate(async n=>{
     const controls=[...n.parentElement.children].filter(x=>x.tagName==='BUTTON').concat(n.firstElementChild);
     const read=()=>controls.map(x=>{const r=x.getBoundingClientRect();return {x:r.x,width:r.width,y:r.y};});
     const frames=[read()];n.firstElementChild.click();
     await new Promise(resolve=>{function tick(){frames.push(read());if(n._disclosureRun)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});return frames;
    });
    for(const frame of frames)for(let i=0;i<frame.length;i++){
     assert(Math.abs(frame[i].x-frames[0][i].x)<.5,`${id} shifted at ${width}px`);
     assert(Math.abs(frame[i].width-frames[0][i].width)<.5,`${id} resized at ${width}px`);
    }
    assert.equal((await state(id)).open,open);
   }
  }
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
 await test('workout name and sets remain vertically anchored while the menu grows',async()=>{
  await p.locator('body').evaluate((n,html)=>n.insertAdjacentHTML('beforeend',html),`<div id="workout" class="open"><div class="wtop">Workout</div><div class="wmain"><div class="wblock">Main workout</div><h2 class="wname">Goblet Squat</h2><div class="wdose">3 × 10</div><div class="setpills"><button class="setpill">Set 1</button></div>${toolbar('anchored-toolbar','wactions exercise-actions')}</div><div class="wbottom"><button class="wfinish">Finish workout</button></div></div>`);
  for(const height of [667,812]){
   await p.setViewportSize({width:375,height});
   for(const open of [true,false]){
    const frames=await p.locator('#anchored-toolbar').evaluate(async n=>{
     const read=()=>['.wname','.setpills'].map(s=>document.querySelector('#workout '+s).getBoundingClientRect().y);
     const frames=[read()];n.firstElementChild.click();await new Promise(resolve=>{function tick(){frames.push(read());if(n._disclosureRun)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});return frames;
    });
    for(const frame of frames)for(let i=0;i<frame.length;i++)assert(Math.abs(frame[i]-frames[0][i])<.5,'logging controls moved during expansion');
    assert.equal((await state('anchored-toolbar')).open,open);
   }
  }
  await p.locator('#workout').evaluate(n=>n.remove());
 });
 await test('375px light and dark layouts do not overflow',async()=>{
  await p.setViewportSize({width:375,height:812});
  for(const colorScheme of ['light','dark']){await p.emulateMedia({colorScheme});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=375));}
  assert.deepEqual(errors,[]);
 });
 console.log(count+' disclosure browser checks passed in '+engine);
} finally {await browser.close();}
