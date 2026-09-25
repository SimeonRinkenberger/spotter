// Offline browser checks using the actual session journal, recap and canvas share
// code. The journal lives on Train's Progress segment now, behind its "All" link,
// so the harness calls journalInto directly — the same function that link calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const src=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
const built=fs.readFileSync('web-dist/index.html','utf8');
const markup=fs.readFileSync('supabase/functions/spotter/markup.ts','utf8');
function fn(name){const a=src.indexOf('  function '+name+'(');assert(a>=0,name);return src.slice(a,src.indexOf('\n  }',a)+4);}
const browser=await chromium.launch({channel:'chrome',headless:true});
const p=await browser.newPage({viewport:{width:375,height:812},acceptDownloads:true});
const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',r=>r.abort());
await p.setContent('<meta name="viewport" content="width=device-width, initial-scale=1">'+built.match(/<style>[\s\S]*?<\/style>/)[0]+'<main style="padding:16px;max-width:600px;margin:auto"><div id="trainbody"></div></main><div id="workout"></div>'+markup.slice(markup.indexOf('<div class="sheet" id="sessionsheet"'),markup.indexOf('<div class="sheet" id="watchsheet"')));
await p.addScriptTag({content:`
var state={user:{id:'fixture'},unit:'kg',workouts:[],plan:[],logs:[]},wo=null,native=false,closeTimers={},sheetNav=false,sheetBack=0;
function $(id){return document.getElementById(id)}
function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n;}
function toUnit(w,u){return u==='lb'?w/2.2046226218:w} function wtText(w,u){return String(Math.round(toUnit(w,u)*10)/10)}
function haptic(){} function toast(t){window.lastToast=t} function icon(n,i,t){n.textContent=t||i;return n;}
function guideClear(){} function guideStill(){} function guideSheet(){} function guideWake(){} function guidePage(){} function viewIn(){} function countStats(){}
function weekStats(){return {}} function goalSetting(){return 3} function renderTrain(){}
function loadAwards(){return new Promise(function(){})} function loadCatalog(){return new Promise(function(){})} function exKey(e){return e.name}
function pumpyArt(){return el('div')} function offerUndo(t,commit,undo){window.undoSession=undo;} function lessMotion(){return true;}
`+['setText','volumeOf','ymd','mondayOf','weekKey','journalInto','emptyLogs','openSession','renderHistoryInto','openSheet','closeSheet'].map(fn).join('\n')+src.slice(src.indexOf('  var SC_W ='),src.indexOf('  // ---------- train · calendar arithmetic ----------'))+`
scMime=function(){return ''};
$('sessionclose').onclick=function(){closeSheet('sessionsheet')};
state.logs=Array.from({length:23},function(_,i){return {id:'l'+i,workout_id:'deleted',workout_title:i===1?'Bodyweight flow':'Strength session '+i,started_at:new Date(2026,8,12-i*12).toISOString(),duration_seconds:1800,entries:i===1?[{name:'Plank',sets:[null,{seconds:45}]}]:[{name:'Goblet squat',sets:[{reps:10,weight:20,unit:'kg'},null,{reps:8,weight:44.092452436,unit:'lb'}]}]};});journalInto($('trainbody'));
`});
try{
 assert.equal(await p.locator('.session-link').count(),10);
 await p.getByRole('button',{name:'Show more sessions'}).click();assert.equal(await p.locator('.session-link').count(),20);
 await p.screenshot({path:'/tmp/spotter-progress.png'});
 await p.locator('.session-search').fill('Plank');assert.equal(await p.locator('.session-link').count(),1);
 await p.locator('.session-link').click();await p.waitForFunction(()=>sc.file&&sc.img.naturalWidth===1080);
 assert.match(await p.locator('#sessioncontent').innerText(),/45s/);assert.equal(await p.evaluate(()=>sc.card.figs[1][0]),'1');
 await p.getByRole('button',{name:'Back to Train'}).click();assert.equal(await p.evaluate(()=>sc.card),null);
 await p.locator('.session-search').fill('no-such-session');assert.match(await p.locator('[role=status]').innerText(),/No matching/);
 await p.locator('.session-search').fill('');await p.locator('.session-link').first().click();await p.waitForFunction(()=>sc.file&&sc.img.naturalWidth===1080);
 assert.equal(await p.evaluate(()=>sc.card.figs[2][0]),'360');assert.equal(await p.locator('.session-set').count(),2);
 await p.getByRole('button',{name:'Light',exact:true}).click();await p.waitForFunction(()=>sc.card.bg==='light'&&sc.file);
 await p.getByRole('button',{name:'Clear',exact:true}).click();await p.waitForFunction(()=>sc.img.naturalHeight===1200);
 await p.getByRole('button',{name:'Dark',exact:true}).click();await p.waitForFunction(()=>sc.img.naturalHeight===1920);
 const download=p.waitForEvent('download');await p.getByRole('button',{name:'Download',exact:true}).click();assert.equal((await download).suggestedFilename(),'spotter-workout.png');
 fs.mkdirSync('design/progress-evidence',{recursive:true});
 for(const scheme of ['light','dark']){
  await p.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await p.locator('#sessionsheet .sheetbody').evaluate(n=>n.scrollWidth<=n.clientWidth));
  await p.locator('#sessionsheet .sheetbody').evaluate(n=>n.scrollTop=0);
  await p.waitForTimeout(500);
  await p.screenshot({path:'design/progress-evidence/recap-'+scheme+'.png'});
 }
 await p.evaluate(()=>{
  window.originalBitmap=window.createImageBitmap;
  window.createImageBitmap=function(){return new Promise(function(resolve){window.finishPhoto=resolve})};
  scPhoto(new Blob(['fixture'],{type:'image/png'}));
  closeSheet('sessionsheet');openSession(state.logs[1]);
  window.finishPhoto({close:function(){window.stalePhotoClosed=true}});
 });
 await p.waitForFunction(()=>window.stalePhotoClosed);
 assert.equal(await p.evaluate(()=>sc.photo),null);
 await p.evaluate(()=>{window.createImageBitmap=window.originalBitmap;closeSheet('sessionsheet');openSession(state.logs[0]);});
 await p.getByRole('button',{name:'Delete session',exact:true}).click();assert.equal(await p.evaluate(()=>state.logs.length),22);
 await p.evaluate(()=>undoSession());assert.equal(await p.evaluate(()=>state.logs.length),23);
 await p.evaluate(()=>{wo={finished:false};openSession(state.logs[0]);});assert(!(await p.locator('#sessionsheet').evaluate(n=>n.classList.contains('open'))));
 await p.evaluate(()=>{wo=null;state.logs=[];var b=$('trainbody');b.innerHTML='';b.appendChild(emptyLogs());});assert.match(await p.locator('#trainbody').innerText(),/No sessions yet/);
 assert.deepEqual(errors,[]);
 console.log('PASS search, pagination, empty states, deleted workout recap, null sets, timed sets, mixed units, PNG rendering, themes, download, cleanup, delete/undo, active workout protection, 375px light/dark layout.');
}finally{await browser.close()}
