import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const app=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
let html=fs.readFileSync('docs/index.html','utf8');
html=html.replace(/<script src="https:\/\/cdn.jsdelivr.net[^>]+><\/script>/g,'');
const start=app.indexOf('(function () {'),end=app.lastIndexOf('})();');
let script=app.slice(start,end)+`
window.readerTest={state,openDetail,startWorkout,renderWorkout,renderPumpy,sendPumpy,watchBit,embedNode,
  setSets(n){wo.entries[wo.i].sets=Array.from({length:n},()=>({reps:10}));renderWorkout();},
  setup(w,plan){state.user={id:'fixture'};state.profile={plan};state.workouts=[w];state.collections=[];state.colItems=[];pumpy.loaded=true;showApp();render();},
  current(){return current},showCoach(){setView('pumpy');renderPumpy();},stop(){stopRest();stopWork();}
};
})();`;
html=html.replace(/<script>[\s\S]*?<\/script>/g,'');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>{
 const url=r.request().url();
 if(url==='http://spotter.test/')return r.fulfill({contentType:'text/html',body:html});
 if(url.includes('/assets/')){const path='docs/'+new URL(url).pathname.replace(/^\//,'');if(fs.existsSync(path))return r.fulfill({path});}
 return r.fulfill({contentType:'application/json',body:JSON.stringify(url.includes('/limits')?{video_previews:{cap:4,used:1}}:url.includes('/catalog')?{exercises:[]}:{data:[],external:{google:true}})});
});
await page.addInitScript(()=>{
 const query=()=>{const q=new Proxy({}, {get(_,key){if(key==='then')return (ok,bad)=>Promise.resolve({data:[],error:null}).then(ok,bad);return ()=>q;}});return q;};
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({})},from:query,channel:query,removeChannel:()=>Promise.resolve()})};
 window.SpotterNative={platform:'ios',authStorage:{},haptic:()=>{},saveDraft:()=>{},configureSharing:async()=>{},open:()=>{},purchases:null};
});
try{
 await page.goto('http://spotter.test/');await page.addScriptTag({content:script});await page.waitForTimeout(150);
 await page.evaluate(()=>{window.fixture={id:'fixture',shortcode:'tt-12345',url:'https://www.tiktok.com/@fixture/video/12345',platform:'tiktok',kind:'video',title:'Leg Day',category:'Legs',ingest_status:'ready',read_quality:'basic',has_full_workout:true,equipment:[],muscle_groups:[],tags:[],blocks:[{title:'Main',type:'straight',exercises:[{name:'Goblet Squat',sets:2,reps:'10',t0:15,t1:25},{name:'Reverse Lunge',sets:2,reps:'8'}]}]};readerTest.setup(fixture,'free');readerTest.openDetail(fixture);});
 await page.getByRole('button',{name:'Try a Plus read · 3 left this month'}).waitFor();
 assert.equal(await page.locator('.delete-swipe:not(.block-swipe)').count(),2);
 // Real touch-axis code: a leftward gesture reveals Delete without deleting.
 await page.locator('.delete-swipe:not(.block-swipe)').first().scrollIntoViewIfNeeded();
 await page.evaluate(()=>{const row=document.querySelector('.delete-swipe:not(.block-swipe)'),t=row.querySelector('.exname'),r=t.getBoundingClientRect();const opts={bubbles:true,pointerType:'touch',pointerId:2,isPrimary:true,clientY:r.y+10};t.dispatchEvent(new PointerEvent('pointerdown',{...opts,clientX:280}));t.dispatchEvent(new PointerEvent('pointermove',{...opts,clientX:260}));t.dispatchEvent(new PointerEvent('pointermove',{...opts,clientX:140}));t.dispatchEvent(new PointerEvent('pointerup',{...opts,clientX:140}));});
 assert(await page.locator('.delete-swipe:not(.block-swipe)').first().evaluate(n=>n.classList.contains('open')));
 assert.equal(await page.locator('.delete-swipe:not(.block-swipe)').count(),2);
 await page.getByRole('button',{name:'Remove Goblet Squat',exact:true}).click();
 assert.equal(await page.locator('.delete-swipe:not(.block-swipe)').count(),1);
 await page.locator('#toast').click();assert.equal(await page.locator('.delete-swipe:not(.block-swipe)').count(),2);
 await page.getByRole('button',{name:'Remove Main',exact:true}).click();
 assert.equal(await page.locator('.workout-block').count(),0);
 await page.locator('#toast').click();assert.equal(await page.locator('.workout-block').count(),1);
 for(const scheme of ['light','dark']){
  await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
  await page.evaluate(()=>{readerTest.openDetail(fixture,true);document.querySelector('#detail').scrollTop=0;});
  await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fs.mkdirSync('design/reader-fixes',{recursive:true});await page.screenshot({path:'design/reader-fixes/detail-'+scheme+'.png'});
 }
 await page.evaluate(()=>{document.querySelector('#detail').classList.remove('open');readerTest.startWorkout(fixture);});
 assert.match(await page.locator('.set-goal').innerText(),/0 \/ 2 sets/);
 await page.evaluate(()=>readerTest.setSets(2));assert(await page.locator('.set-goal').evaluate(n=>n.classList.contains('reached')));
 await page.evaluate(()=>readerTest.setSets(3));assert.match(await page.locator('.set-goal').innerText(),/3 \/ 2.*Extras welcome/);
 await page.screenshot({path:'design/reader-fixes/goal-dark.png'});
 await page.evaluate(()=>{readerTest.stop();document.querySelector('#workout').classList.remove('open');readerTest.showCoach();});
 assert.match(await page.locator('#pumpylog').innerText(),/Included with Spotter Plus/);
 await page.screenshot({path:'design/reader-fixes/pumpy-free.png'});
 await page.evaluate(()=>readerTest.watchBit(fixture,15,fixture.blocks[0].exercises[0]));
 assert.match(await page.locator('#watchbody iframe').getAttribute('src'),/tiktok.com\/player\/v1/);
 assert.equal(await page.locator('#watchbody iframe').getAttribute('data-seek'),'15');
 assert.match(await page.locator('.segment-label').innerText(),/0:15–0:25/);
 await page.evaluate(()=>{var frame=document.querySelector('#watchbody iframe');window.dispatchEvent(new MessageEvent('message',{origin:'https://www.tiktok.com',source:frame.contentWindow,data:{'x-tiktok-player':true,type:'onPlayerError',value:{errorCode:2001}}}));});
 assert.match(await page.locator('.player-fallback').innerText(),/Open the original/);
 assert(await page.locator('.player-fallback a').getAttribute('href'));
 assert.deepEqual(errors,[]);
 console.log('PASS native-shell 375px light/dark, preview quota, swipe Delete/Undo, set goal before/after/extra, Plus disclosure and TikTok segment selection.');
}finally{await browser.close();}
