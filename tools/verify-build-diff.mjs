// CI's last verify step: the committed page must be what build.mjs produces.
//
// One script rather than a shell one-liner in package.json so that `verify:local`
// can report it like every other step, and so the failure says what to do.
import { spawnSync } from 'node:child_process';

const built = spawnSync('node', ['build.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const files = ['docs/index.html', 'supabase/functions/spotter/page.gen.ts'];
const diff = spawnSync('git', ['diff', '--exit-code', '--', ...files], { stdio: 'inherit' });
if (diff.status !== 0) {
  console.error('\nThe generated page does not match its source. build.mjs has just rewritten ' +
    files.join(' and ') + ' — commit them together with the markup.ts/style.ts/app.ts change that ' +
    'produced them, which is what CI diffs.');
  process.exit(1);
}
console.log('docs/index.html and page.gen.ts match a fresh build.');
