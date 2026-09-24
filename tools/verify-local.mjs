// Every step of the CI `verify` job, in CI's order, stopping on the first failure.
//
// Why this exists: `npm run gtm:check` is 16 launch regressions and none of them
// is reader-access-check, reader-db-check, ai-guard-db-check, `deno check`,
// ai-admission-check, source-trust-check, merge-harness,
// ingest-coverage-harness, the two pack-eval runs or the build.mjs byte diff. A
// green gtm:check therefore sat next to a red PR for an afternoon: the `verify`
// job died at reader-access-check on `aiActor.getStore is not a function`, which
// nothing runnable in one command would have caught first.
//
// The list below is the same list as .github/workflows/release-checks.yml's
// `verify` job and has to be kept beside it — the one step that is NOT here is
// `npm ci`, because this runs against the worktree you are already working in.
// The macos-14 `native-parity` job (`npm run parity:check`) is separate and needs
// Xcode; run it yourself on a Mac before asking for a merge.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// CI installs PGlite into a temp dir and passes it by environment. Locally that
// is /tmp/spotter-reader-db, which every DB check already defaults to.
const PGLITE_MODULE = process.env.PGLITE_MODULE ||
  '/tmp/spotter-reader-db/node_modules/@electric-sql/pglite/dist/index.js';
if (!fs.existsSync(PGLITE_MODULE)) {
  console.error('PGlite is not installed at ' + PGLITE_MODULE + '\n' +
    'Install it once with:\n' +
    '  npm install --prefix /tmp/spotter-reader-db --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8\n' +
    'or point PGLITE_MODULE at an existing copy.');
  process.exit(1);
}

const steps = [
  ['npm audit', 'npm', ['audit', '--omit=dev', '--audit-level=high']],
  ['AI guard database', 'node', ['tools/ai-guard-db-check.mjs']],
  ['Reader access', 'node', ['tools/reader-access-check.mjs']],
  ['Reader database', 'node', ['tools/reader-db-check.mjs']],
  ['Schema security (all migrations replayed)', 'node', ['tools/security-db-check.mjs']],
  ['Erasure outbox (account deletion at third parties)', 'node', ['tools/erasure-outbox-check.mjs']],
  ['GTM launch regressions', 'npm', ['run', 'gtm:check']],
  ['Type check the edge function', 'deno', ['check', 'supabase/functions/spotter/index.ts']],
  ['AI transport accounting', 'deno', ['run', '--allow-env', 'tools/ai-guard-check.ts']],
  ['AI admission', 'deno', ['run', '--allow-read', '--allow-env', 'tools/ai-admission-check.ts']],
  ['Source trust', 'deno', ['run', '--allow-read', 'tools/source-trust-check.ts']],
  ['Outbound guard policy', 'deno', ['run', '--allow-read', 'tools/ssrf-policy-check.ts']],
  ['Push endpoint guard', 'deno', ['run', '--allow-env', '--allow-read', 'tools/push-ssrf-check.ts']],
  ['Merge harness', 'deno', ['run', '--allow-read', 'tools/merge-harness.ts']],
  ['Ingest coverage', 'deno', ['run', '--allow-read', '--allow-env', 'tools/ingest-coverage-harness.ts']],
  ['Pack eval offline', 'deno', ['run', '--allow-read', 'tools/pack-eval/offline.ts']],
  ['Pack eval scoring', 'deno', ['run', '--allow-read', 'tools/pack-eval/score-test.ts']],
  ['Built page matches its source', 'node', ['tools/verify-build-diff.mjs']],
];

const env = { ...process.env, PGLITE_MODULE };
const started = Date.now();
for (const [label, cmd, args] of steps) {
  const at = Date.now();
  process.stdout.write('· ' + label + '\n');
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, timeout: 600_000 });
  if (r.status !== 0) {
    console.error('\nFAIL ' + label + ' — ' + cmd + ' ' + args.join(' ') +
      (r.error ? '\n' + r.error.message : '') +
      '\nStopped here; the remaining ' + (steps.length - steps.findIndex((s) => s[0] === label) - 1) +
      ' step(s) did not run.');
    process.exit(1);
  }
  console.log('  PASS ' + label + ' (' + Math.round((Date.now() - at) / 100) / 10 + 's)');
}
console.log('\nAll ' + steps.length + ' verify steps passed in ' +
  Math.round((Date.now() - started) / 1000) + 's. The macos-14 native-parity job (npm run parity:check) is separate.');
