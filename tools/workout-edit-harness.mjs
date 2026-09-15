// Offline integration checks for session additions, draft recovery and rest controls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const src=fs.readFileSync('supabase/functions/spotter/app.ts','utf8');
const markup=fs.readFileSync('supabase/functions/spotter/markup.ts','utf8');
const style=fs.readFileSync('supabase/functions/spotter/style.ts','utf8').split('String.raw`')[1].split('`;')[0];
function fn(name){const a=src.indexOf('  function '+name+'(');assert(a>=0,name);return src.slice(a,src.indexOf('\n  }',a)+4);}
const browser=await chromium.launch({channel:'chrome',headless:true});
const p=await browser.newPage({viewport:{width:375,height:812}}),errors=[];
p.on('pageerror',e=>errors.push(e.message));
const html='<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+style+'</style>'+markup.slice(markup.indexOf('<div id="workout">'),markup.indexOf('<!-- Three answers,'));
await p.route('**/*',r=>r.request().url()==='http://spotter.test/'?r.fulfill({body:html,contentType:'text/html'}):r.abort());
await p.goto('http://spotter.test/');
await p.addScriptTag({content:`
var wo=null,woTimer=null,woCloseTimer=null,restTimer=null,restUntil=0,restTotal=0,restHeld=0,restCued=0,restFace=null,restThen=null;
var woPhase='idle',woSlide=0,justSet=-1,REST_FALLBACK=90,native=null,editing=null,hist={},setCtx={},state={user:{id:'fixture'},unit:'kg',sounds:true,workouts:[]};
var closeTimers={},sheetNav=false,sheetBack=0;
function $(id){return document.getElementById(id)}
function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n;}
function toUnit(w,u){return w||0} function wtText(w){return String(w)} function exKey(e){return e.name}
function guideClear(){} function guideStill(){} function guideSheet(){} function guideWake(){} function guideLearn(){}
function startClock(){} function lastWeights(){} function acquireWake(){} function viewIn(){} function haptic(){}
function toast(t){window.lastToast=t} function tellSounds(){} function beep(){} function unlockAudio(){}
function endEdit(){} function prCheck(){return false} function drawStepper(){}
function icon(n,i,t){n.textContent=t||i;return n} function sourceOf(){return null}
function lastLine(){return ''} function doseText(e){return (e.sets||1)+' sets · '+(e.reps||e.duration_seconds)+(e.duration_seconds?'s':' reps')}
function disclosure(t,c){var n=el('details','disclosure '+(c||''));n.appendChild(el('summary',null,t));n.appendChild(el('div','disclosure-body'));return n;}
function invalidateLogs(){} var today={};function renderToday(){} function renderSummary(p,l){window.savedSession=p;}
var sb={from:function(){return {insert:function(p){window.insertedSession=p;return {select:function(){return {single:function(){return Promise.resolve({data:{id:'saved'}})}}}}}}}};
`+['flatten','draftKey','saveDraft','clearDraft','startWorkout','appendSessionExercise','openWorkoutAdd','saveWorkoutAdd','renderWorkout','renderSetPills','setText','openSetSheet','saveSet','startRest','drawRest','tickRest','pauseRest','stopRest','addRest','doneRest','isTimed','isCircuit','roundsOf','roundOf','targetOf','atRoundEnd','restAfter','stopWork','logHold','finishWorkout','timedBody','paintPhase','ringTap','startWork','workDone','nextMove','woGo','openSheet','closeSheet'].map(fn).join('\n')+`
$('waddexercise').onclick=openWorkoutAdd;$('woaddsave').onclick=saveWorkoutAdd;$('wfinish').onclick=finishWorkout;
$('restring').onclick=pauseRest;$('restplus').onclick=function(){addRest(15000)};$('restskip').onclick=function(){var t=restThen;stopRest();if(t)t()};
$('setsave').onclick=saveSet;
document.querySelectorAll('[data-close]').forEach(function(b){b.onclick=function(){closeSheet(b.getAttribute('data-close'))}});
window.fixture={id:'base',title:'Strength day',blocks:[{type:'straight',exercises:[{name:'Goblet squat',canonical_id:'squat',sets:2,reps:'10'}]}]};
state.workouts=[fixture];startWorkout(fixture);
`});
try{
 await p.getByRole('button',{name:'+ Add set',exact:true}).click();
 await p.evaluate(()=>{setCtx.reps=10;setCtx.weight=20});await p.locator('#setsave').click();
 assert(await p.locator('#reststrip').evaluate(n=>n.classList.contains('on')));
 assert.equal(await p.evaluate(()=>wo.entries[0].sets.length),1);
 await p.locator('#restring').click();assert.match(await p.locator('#restword').innerText(),/paused/);
 const held=await p.evaluate(()=>restHeld);await p.locator('#restplus').click();assert.equal(await p.evaluate(()=>restHeld),held+15000);
 await p.locator('#waddexercise').click();await p.locator('#woaddname').fill('Dumbbell row');await p.locator('#woaddsave').click();
 assert.equal(await p.evaluate(()=>wo.screens.length),2);assert.equal(await p.evaluate(()=>fixture.blocks.length),1);
 assert.equal(await p.evaluate(()=>wo.entries[0].sets[0].weight),20);assert.equal(await p.evaluate(()=>wo.i),1);
 assert.equal(await p.evaluate(()=>restHeld),held+15000);
 await p.getByRole('button',{name:'+ Add set',exact:true}).click();await p.evaluate(()=>{setCtx.reps=12;setCtx.weight=15});await p.locator('#setsave').click();
 await p.evaluate(()=>{window.draft=JSON.parse(localStorage.getItem(draftKey()));stopRest();startWorkout(fixture,draft)});
 assert.equal(await p.evaluate(()=>wo.screens[1].ex.name),'Dumbbell row');assert.equal(await p.evaluate(()=>wo.entries[1].sets[0].reps),12);
 assert.equal(await p.evaluate(()=>wo.i),1);
 // Extra sets can exceed the original prescription.
 await p.evaluate(()=>{wo.i=0;wo.entries[0].sets=[{reps:10},{reps:10}];renderWorkout()});
 await p.getByRole('button',{name:'+ Add set',exact:true}).click();assert.equal(await p.evaluate(()=>setCtx.idx),2);await p.locator('#setsave').click();assert.equal(await p.evaluate(()=>wo.entries[0].sets.length),3);
 fs.mkdirSync('design/workout-edit-evidence',{recursive:true});
 for(const scheme of ['light','dark']){
  await p.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});await p.waitForTimeout(300);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const r=await p.locator('#wfinish').boundingBox();assert(r.width>=340&&r.height>=60&&r.y+r.height<=812);
  const ring=await p.locator('#restring').boundingBox();assert(ring.width>=88);
  await p.screenshot({path:'design/workout-edit-evidence/rest-'+scheme+'.png'});
 }
 await p.locator('#waddexercise').click();await p.locator('#woaddname').fill('Plank');await p.locator('#woaddsecs').fill('45');await p.locator('#woaddsave').click();
 assert.equal(await p.evaluate(()=>wo.screens[2].ex.duration_seconds),45);
 await p.getByRole('button',{name:'Log extra hold',exact:true}).click();assert.equal(await p.evaluate(()=>wo.entries[2].sets[0].seconds),45);
 await p.locator('#wfinish').click();assert.equal(await p.evaluate(()=>savedSession.entries.length),3);assert.equal(await p.evaluate(()=>localStorage.getItem(draftKey())),null);
 await p.evaluate(()=>startWorkout({id:'free',title:'Freestyle',blocks:[]}));
 await p.evaluate(()=>{wo.entries[0].sets=[{reps:5}];appendSessionExercise({name:'Push-up',sets:1,reps:'10'})});
 assert.equal(await p.evaluate(()=>wo.screens.length),2);assert.equal(await p.evaluate(()=>wo.entries[0].sets[0].reps),5);
 await p.locator('#waddexercise').click();await p.locator('#woaddname').fill('Invalid');await p.locator('#woaddsets').fill('-1');await p.locator('#woaddsave').click();assert.equal(await p.evaluate(()=>wo.screens.length),2);assert(await p.locator('#woadderror').innerText());
 await p.locator('[data-close=woaddsheet]').click();
 await p.evaluate(()=>{startRest(30);restUntil=Date.now()-1;tickRest()});assert.equal(await p.evaluate(()=>restUntil),0);
 assert.deepEqual(errors,[]);
 console.log('PASS rest pause/extend/expiry, additions during rest, unchanged library, draft recovery, extra sets, timed additions, save payload, freestyle mapping, validation and 375px light/dark controls.');
}finally{await browser.close()}
