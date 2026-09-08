import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('native-dist', { recursive: true });
for (const path of ['assets', 'icon.png']) cpSync('docs/' + path, 'native-dist/' + path, { recursive: true });
let html = readFileSync('docs/index.html', 'utf8');
const start = html.lastIndexOf('<script>');
const end = html.indexOf('</script>', start);
if (start < 0 || end < 0) throw new Error('App script not found');
writeFileSync('native-dist/app.js', html.slice(start + 8, end));
html = html.slice(0, start) + '<script src="native.js"></script>' + html.slice(end + 9);
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.115\.0\/dist\/umd\/supabase.js"><\/script>/, '')
  .replace(/<link[^>]+rel="(?:preload|manifest)"[^>]*>/g, '');
// Retain the web app's typography and font stylesheets. Its existing system-font
// fallbacks still apply when a font host is unavailable.
writeFileSync('native-dist/index.html', html);
await build({ entryPoints: ['native/bridge.js'], bundle: true, outfile: 'native-dist/native.js', format: 'iife', platform: 'browser', target: 'safari15', minify: true });
console.log('Packaged Spotter assets and SDK into native-dist (no server.url).');
