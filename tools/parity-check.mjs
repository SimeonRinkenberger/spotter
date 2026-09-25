import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Compare the complete application, not a list of feature names that can pass
// while one platform silently ships an older implementation. The web copy is
// build.mjs's unpublished output now (the web app is retired); it is still the
// page both native shells are cut from and the one the browser harnesses test.
const read = path => readFileSync(path, 'utf8');
const web = read('web-dist/index.html');
const start = web.lastIndexOf('<script>');
const end = web.indexOf('</script>', start);
assert(start >= 0 && end > start, 'Missing shared application script');
assert.equal(read('native-dist/app.js'), web.slice(start + 8, end),
  'Native application differs from the web application; run npm run ios:assets');
const shell = (web.slice(0, start) + '<script src="native.js"></script>' + web.slice(end + 9))
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.115\.0\/dist\/umd\/supabase.js"[^>]*><\/script>/, '')
  .replace(/<link[^>]+rel="(?:preload|manifest)"[^>]*>/g, '')
  // The web page's CSP is the web page's: the shell loads native.js and the SDK
  // bundle from its own scheme, and its behaviour is kept exactly as it was.
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, '');
assert.equal(read('native-dist/index.html'), shell,
  'Native markup or styling differs from the shared web shell');
console.log('PASS web/native complete application, markup and styling parity.');
