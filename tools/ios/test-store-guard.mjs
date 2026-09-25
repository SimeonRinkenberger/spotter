// Refuses a native bundle that carries RevenueCat's Test Store key.
//
// tools/ios/build.mjs compiles the key in only when SPOTTER_TEST_STORE=1, for a
// Debug simulator run, and leaves a TEST-STORE marker beside that bundle. This
// runs first in `npm run ios:check`, so a Test Store bundle cannot pass the
// parity check a release is cut after; `npm run ios:sync` without the variable
// rebuilds a clean one. It also looks for the key's own shape in the compiled
// script, in case a marker was lost on the way to ios/App/App/public.
import { existsSync, readFileSync } from 'node:fs';
const places = ['native-dist', 'ios/App/App/public', 'android/app/src/main/assets/public'];
const found = [];
for (const dir of places) {
  if (existsSync(dir + '/TEST-STORE')) found.push(dir + '/TEST-STORE');
  const js = dir + '/native.js';
  if (existsSync(js) && /["']test_[A-Za-z0-9]{8,}["']/.test(readFileSync(js, 'utf8'))) found.push(js + ' (a test_ key)');
}
if (found.length) {
  console.error('FAIL a RevenueCat Test Store bundle is on disk: ' + found.join(', ') +
    '. It is for a Debug simulator run only. Run `npm run ios:sync` (without SPOTTER_TEST_STORE) before any archive.');
  process.exit(1);
}
console.log('PASS no RevenueCat Test Store key in the native bundles (' + places.filter((d) => existsSync(d)).join(', ') + ').');
