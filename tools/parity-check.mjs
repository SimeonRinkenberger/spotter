import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Compare the complete application, not a list of feature names that can pass
// while one platform silently ships an older implementation.
const read = path => readFileSync(path, 'utf8');
const web = read('docs/index.html');
const start = web.lastIndexOf('<script>');
const end = web.indexOf('</script>', start);
assert(start >= 0 && end > start, 'Missing shared application script');
assert.equal(read('native-dist/app.js'), web.slice(start + 8, end),
  'Native application differs from the web application; run npm run ios:assets');
const shell = (web.slice(0, start) + '<script src="native.js"></script>' + web.slice(end + 9))
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.115\.0\/dist\/umd\/supabase.js"><\/script>/, '')
  .replace(/<link[^>]+rel="(?:preload|manifest)"[^>]*>/g, '');
assert.equal(read('native-dist/index.html'), shell,
  'Native markup or styling differs from the shared web shell');
const generated = read('supabase/functions/spotter/page.gen.ts');
assert(generated.includes(JSON.stringify(web)), 'Edge-function page differs from the web build');
console.log('PASS web/native complete application, markup and styling parity; edge-function page parity.');
