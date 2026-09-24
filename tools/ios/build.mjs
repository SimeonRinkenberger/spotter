import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('native-dist', { recursive: true });

// RevenueCat's Test Store, for a Debug simulator run and nothing else (brief
// GTMH-PLUS §8). Its test_ key is read from an ignored local file and compiled
// in only when SPOTTER_TEST_STORE=1 asks; every other bundle compiles an empty
// string and purchases.js uses purchases-config.json as always. A bundle that
// carries the key leaves native-dist/TEST-STORE beside it, which
// tools/ios/test-store-guard.mjs (first in ios:check) refuses, so the next
// ios:sync without the variable is what makes an archivable bundle again.
// RevenueCat's own guard is the last line: a Release build configured with a
// Test Store key shows an alert and crashes instead of selling.
const TEST_STORE_FILE = process.env.SPOTTER_TEST_STORE_KEY_FILE || '.native-build/revenuecat-test-store.key';
let testStore = '';
rmSync('native-dist/TEST-STORE', { force: true });
if (process.env.SPOTTER_TEST_STORE === '1') {
  testStore = readFileSync(TEST_STORE_FILE, 'utf8').trim();
  if (!/^test_[A-Za-z0-9]{8,}$/.test(testStore)) throw new Error(TEST_STORE_FILE + ' does not hold a RevenueCat Test Store key (test_...).');
  writeFileSync('native-dist/TEST-STORE', 'This bundle uses RevenueCat Test Store. Debug simulator only; run npm run ios:sync without SPOTTER_TEST_STORE before any archive.\n');
  console.warn('*** TEST STORE BUNDLE: Debug simulator only. Run npm run ios:sync without SPOTTER_TEST_STORE before any archive. ***');
}
for (const path of ['assets', 'icon.png']) cpSync('docs/' + path, 'native-dist/' + path, { recursive: true });
let html = readFileSync('docs/index.html', 'utf8');
const start = html.lastIndexOf('<script>');
const end = html.indexOf('</script>', start);
if (start < 0 || end < 0) throw new Error('App script not found');
writeFileSync('native-dist/app.js', html.slice(start + 8, end));
html = html.slice(0, start) + '<script src="native.js"></script>' + html.slice(end + 9);
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.115\.0\/dist\/umd\/supabase.js"[^>]*><\/script>/, '')
  .replace(/<link[^>]+rel="(?:preload|manifest)"[^>]*>/g, '')
  // The web page's CSP is the web page's: the shell loads native.js and the SDK
  // bundle from its own scheme, and its behaviour is kept exactly as it was.
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, '');
// Retain the web app's typography and font stylesheets. Its existing system-font
// fallbacks still apply when a font host is unavailable.
writeFileSync('native-dist/index.html', html);
await build({ entryPoints: ['native/bridge.js'], bundle: true, outfile: 'native-dist/native.js', format: 'iife', platform: 'browser', target: 'safari15', minify: true,
  define: { __SPOTTER_TEST_STORE__: JSON.stringify(testStore) } });
console.log('Packaged Spotter assets and SDK into native-dist (no server.url).');
