// Local disposable-account profiling only; never included in a production build.
var params=new URLSearchParams(location.search), startup={kind:'startup',version:params.get('version'),mode:params.get('mode'),run:Number(params.get('run')),browser:navigator.userAgent,viewport:[innerWidth,innerHeight],longTasks:[]};
if(startup.mode==='uncached')localStorage.removeItem(CACHE_KEY);
var originalRender=render;
render=function(){var start=performance.now();var r=originalRender();if(!startup.firstLibrary&&state.workouts.length){startup.firstLibrary=start;startup.renderMs=performance.now()-start;requestAnimationFrame(function(){startup.firstLibraryFrame=performance.now();});}return r;};
try{new PerformanceObserver(function(list){list.getEntries().forEach(function(e){startup.longTasks.push({start:e.startTime,duration:e.duration});});}).observe({type:'longtask',buffered:true});}catch(e){}
setTimeout(function(){
  var nav=performance.getEntriesByType('navigation')[0];
  startup.navigation=nav?{ttfb:nav.responseStart,domContentLoaded:nav.domContentLoadedEventEnd,encoded:nav.encodedBodySize,decoded:nav.decodedBodySize}:null;
  startup.resources=performance.getEntriesByType('resource').map(function(r){var u=new URL(r.name);return {path:u.origin+u.pathname,duration:r.duration,transfer:r.transferSize,encoded:r.encodedBodySize};});
  var n=document.createElement('pre');n.id='startup-result';n.hidden=true;n.textContent=JSON.stringify(startup);document.body.appendChild(n);
  fetch('/lab-result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(startup)});
},2500);
