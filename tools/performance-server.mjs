// Local-only browser laboratory. No credentials or production writes; never build into docs.
// node tools/performance-server.mjs [baseline html] serves real app at / and lab at /lab.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('docs');
const baseline = process.argv[2];
const out = path.resolve('/private/tmp/spotter-performance');
fs.mkdirSync(out, {recursive:true});
http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/lab-result') {
    let body = ''; req.on('data', b => { body += b; });
    req.on('end', () => {
      try { const d = JSON.parse(body); const name = d.kind === 'startup' ? 'startup-'+(d.version==='before'?'before':'after')+'-'+(d.mode==='cached'?'cached':'uncached')+'-'+Number(d.run||0)+'.json' : (d.version === 'before' ? 'before.json' : 'after.json'); fs.writeFileSync(path.join(out,name), JSON.stringify(d,null,2)); res.end('saved'); }
      catch { res.writeHead(400); res.end(); }
    }); return;
  }
  if (url.pathname === '/lab' || url.pathname === '/profile.html') {
    let html = fs.readFileSync(url.searchParams.get('version') === 'before' && baseline ? baseline : path.join(root,'index.html'), 'utf8');
    const code = fs.readFileSync(url.pathname==='/lab'?'tools/performance-browser.js':'tools/startup-browser.js','utf8');
    const end = html.lastIndexOf('})();');
    html = html.slice(0,end) + code + html.slice(end);
    // Synthetic reads have no auth persistence or service worker. Public SDK/font
    // and auth-settings initialization can begin before the lab injects its fixtures.
    if(url.pathname==='/lab') html = html.replace(/persistSession: (true|!0)/, 'storageKey: "spotter-performance-lab", persistSession: false').replace(/detectSessionInUrl: (true|!0)/, 'detectSessionInUrl: false').replace('spotter-lib-v1','spotter-lab-lib');
    html = html.replace('register("sw.js")', 'getRegistration()');
    if(url.searchParams.get('theme')==='light') html = html.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g,'@media not all').replace('</head>','<style>:root{color-scheme:light}</style></head>');
    if(url.searchParams.has('reduce')) html = html.replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g,'@media all').replace('<head>','<head><script>var originalMatch=window.matchMedia;window.matchMedia=function(q){return q.indexOf("prefers-reduced-motion")>=0?{matches:true,media:q,addEventListener:function(){},removeEventListener:function(){},addListener:function(){}}:originalMatch.call(window,q);};</script>');
    res.setHeader('content-type','text/html'); res.setHeader('cache-control','no-store'); res.end(html); return;
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const types = {'.html':'text/html','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.webmanifest':'application/manifest+json'};
  res.setHeader('content-type',types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(8000,'127.0.0.1',()=>console.log('Spotter QA: http://localhost:8000/lab?version=before'));
