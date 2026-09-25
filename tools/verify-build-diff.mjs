// CI's build step: build the app page, and prove the published landing page is
// what build.mjs leaves it as.
//
// build.mjs writes the app page to web-dist/ (unpublished, not committed; the
// harnesses after this step read it) and refreshes the Content-Security-Policy of
// docs/index.html, the landing page GitHub Pages serves, from that page's own inline
// script and style. A landing-page edit committed without running the build would
// ship a hash that no longer matches, and the browser would refuse the script that
// clears an old Spotter session off the shared origin. That is the diff below.
//
// One script rather than a shell one-liner in package.json so that `verify:local`
// can report it like every other step, and so the failure says what to do.
import { spawnSync } from 'node:child_process';

const built = spawnSync('node', ['build.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const files = ['docs/index.html'];
const diff = spawnSync('git', ['diff', '--exit-code', '--', ...files], { stdio: 'inherit' });
if (diff.status !== 0) {
  console.error('\nThe published landing page does not match what build.mjs makes of it. build.mjs has just ' +
    'rewritten ' + files.join(' and ') + ' (its Content-Security-Policy hashes) — commit it.');
  process.exit(1);
}
console.log('web-dist/index.html built; docs/index.html matches a fresh build.');
