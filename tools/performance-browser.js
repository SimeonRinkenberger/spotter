// Injected into the app's IIFE ONLY by performance-server.mjs; synthetic, disposable data.
window.addEventListener('load', function () { setTimeout(async function () {
  var report = { version:new URLSearchParams(location.search).get('version') || 'after',
    browser:navigator.userAgent, viewport:[innerWidth,innerHeight], samples:5, measurements:[], checks:[] };
  report.longTasks=[];report.layoutShifts=[];report.frameTrace=[];
  var observing=true,previousFrame=0;
  function trace(t){if(previousFrame)report.frameTrace.push(t-previousFrame);previousFrame=t;if(observing)requestAnimationFrame(trace);}
  requestAnimationFrame(trace);
  try { new PerformanceObserver(list=>list.getEntries().forEach(e=>report.longTasks.push({start:e.startTime,duration:e.duration}))).observe({type:'longtask',buffered:true}); } catch(e){}
  try { new PerformanceObserver(list=>list.getEntries().forEach(e=>report.layoutShifts.push({value:e.value,recentInput:e.hadRecentInput}))).observe({type:'layout-shift',buffered:true}); } catch(e){}
  var output = document.createElement('pre'); output.id='lab-results';
  output.style.cssText='position:fixed;z-index:99999;right:0;top:0;max-width:70vw;max-height:35vh;overflow:auto;background:white;color:black;font-size:11px;padding:8px';
  document.body.appendChild(output);
  function wait(ms) { return new Promise(r=>setTimeout(r,ms)); }
  function frame() { return new Promise(r=>requestAnimationFrame(r)); }
  function check(name,pass,detail) { report.checks.push({name,pass:!!pass,detail}); }
  function fixture(i) { return {id:'lab-'+i,user_id:'lab',title:'Fixture '+i,category:i%2?'Legs':'Push',author:'fixture'+i%5,
    platform:'web',url:'https://example.com/fixture',shortcode:'lab-'+i,ingest_status:'ready',has_full_workout:true,
    created_at:new Date(Date.now()-i*60000).toISOString(),equipment:['Dumbbell'],muscle_groups:['quads'],
    blocks:[{name:'Main',exercises:Array.from({length:i===0?40:8},(_,j)=>({name:'Goblet Squat '+j,sets:3,reps:'10'}))}]}; }
  var rows = Array.from({length:200},(_,i)=>fixture(i));
  var calls=[], delay=0, collectionDelay=0;
  var fake = { from:function(table) {
    var q={}, builder={};
    ['select','eq','in','order','limit','gte','lte','maybeSingle','upsert'].forEach(function(k){builder[k]=function(a,b){q[k]=[a,b];return builder;};});
    builder.then=function(ok,bad){calls.push({table,q});return wait(table==='collections'||table==='collection_items'?collectionDelay:delay).then(function(){return {data:table==='workouts'?rows:[],error:null};}).then(ok,bad);};
    return builder;
  }};
  try {
    // Stop real initialization before mounting any signed-in state.
    sb = fake; state.user={id:'lab'}; state.profile={plan:'free',settings:{pumpyWelcome:true}};
    state.collections=[];state.colItems=[];state.logs=[];today.at=Date.now();today.day=ymd(new Date());
    guide.off=true; drawn={plan:true,progress:true,pumpy:true}; showApp();
    for (var count of [0,20,200]) {
      state.workouts=rows.slice(0,count);state.q='';sortMode='new'; renderGrid(); await frame();
      var samples=[], retained=[];
      for(var n=0;n<5;n++) {
        var old=$('grid').querySelector('.carditem'),start=performance.now();
        renderGrid(); var sync=performance.now()-start; void $('grid').offsetHeight;
        await frame(); samples.push({syncMs:sync,presentationMs:performance.now()-start});
        retained.push(old ? old===$('grid').querySelector('.carditem') : true);
      }
      report.measurements.push({name:'unchanged-grid-'+count,samples,retained});
    }
    state.workouts=rows; state.q=''; renderGrid();
    var search=[];
    for(var n=0;n<5;n++){var start=performance.now();state.q=n%2?'Fixture':'Fixture 1';renderGrid();void $('grid').offsetHeight;await frame();search.push(performance.now()-start);}
    report.measurements.push({name:'search-200',samples:search});state.q='';renderGrid();
    sortMode='by';renderGrid();var groupCard=$('grid').querySelector('.carditem'),groupParent=groupCard.parentNode;
    renderGrid();check('grouped refresh keeps cards and their parent mounted',groupCard===$('grid').querySelector('.carditem')&&groupCard.parentNode===groupParent);
    sortMode='new';renderGrid();
    delay=40;collectionDelay=240;
    var originalRender=render, first=0;
    render=function(){if(!first)first=performance.now();return originalRender();};
    var reads=[];
    for(var n=0;n<5;n++){calls=[];first=0;var start=performance.now();await Promise.all([load(),load()]);reads.push({firstRenderMs:first-start,totalMs:performance.now()-start,requests:calls.length});}
    render=originalRender;report.measurements.push({name:'overlapping-library-delayed-collections',samples:reads});
    calls=[];state.logs=null;await Promise.all([loadLogs(),loadLogs()]);check('history reads share an in-flight request',calls.filter(c=>c.table==='workout_logs').length===1,calls.length);
    // Live detail refresh should preserve the actual mounted body for identical data.
    openDetail(rows[0]);var detail=$('dinner').firstChild;await load();
    check('unchanged open detail survives revalidation',detail===$('dinner').firstChild);
    closeDetail();
    // A dense incoming network chunk with a substantial history. These are local
    // synthetic words; no AI calls, chat text logging, or production writes.
    pumpy.loaded=true;pumpy.meterAsked=true;pumpy.messages=Array.from({length:80},(_,i)=>({id:'history-'+i,role:i%2?'assistant':'user',content:'Synthetic history '.repeat(10)}));
    state.view='pumpy';setView('pumpy');renderPumpy();await wait(500);
    var bursts=[];
    for(var n=0;n<5;n++){
      pumpy.live=null;pumpy.busy=true;startLive();var start=performance.now();
      for(var j=0;j<200;j++)liveEvent({t:'delta',text:'word '});
      var sync=performance.now()-start;await frame();bursts.push({syncMs:sync,presentationMs:performance.now()-start});
    }
    report.measurements.push({name:'stream-200-deltas-80-history',samples:bursts});
    pumpy.busy=false;pumpy.live=null;
    var savedStream=apiStream,streamed;
    apiStream=function(path,payload,onEvent){
      onEvent({t:'delta',text:'Synthetic streamed reply'});streamed=pumpy.live.row;
      onEvent({t:'final',status:'ok',thread_id:'lab-thread',user_message:{id:'sent',role:'user',content:'Synthetic request'},messages:[{id:'reply',role:'assistant',content:'Synthetic streamed reply'}]});
      return Promise.resolve();
    };
    sendPumpy('Synthetic request');await flushLab();apiStream=savedStream;
    check('final streamed bubble keeps its DOM identity',streamed.isConnected);
    check('composer recovers after final answer',!$('pumpysend').disabled);
    // Measure the existing interruptible sheet transition, preserving its motion.
    var geometry=[];openSheet('refsheet');
    for(var j=0;j<35;j++){await frame();var r=$('refsheet').querySelector('.sheetbody').getBoundingClientRect();geometry.push({top:r.top,height:r.height});}
    closeSheet('refsheet');report.sheetTrace=geometry;
    state.logs=Array.from({length:400},(_,i)=>({id:'log-'+i,started_at:new Date(Date.now()-i*36000000).toISOString(),completed_at:new Date(Date.now()-i*36000000+600000).toISOString(),title:'Synthetic workout',entries:[{name:'Goblet Squat',canonical_id:'goblet-squat',sets:[{reps:10,weight:20,unit:'lb'}]}]}));
    state.awards=[];var progress=[];
    for(var n=0;n<5;n++){var start=performance.now();renderProgress();void $('progressview').offsetHeight;await frame();progress.push(performance.now()-start);}
    report.measurements.push({name:'progress-400-logs',samples:progress});
    report.documentOverflow=document.documentElement.scrollWidth>innerWidth;
    report.resources=performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).origin+new URL(r.name).pathname,duration:r.duration,transferSize:r.transferSize}));
  } catch(e) { report.error=e.stack; }
  observing=false;
  clearTimeout(pendTimer);output.textContent=JSON.stringify(report,null,2);
  await fetch('/lab-result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
},250); });
function flushLab(){return Promise.resolve().then(function(){return Promise.resolve();});}
