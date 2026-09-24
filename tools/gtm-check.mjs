// Launch-specific regressions. No external network, deployment, or paid inference.
import { spawnSync } from 'node:child_process';
const checks = [
  ['Apple grant database permissions and erasure', 'node', ['tools/apple-grants-db-check.mjs']],
  ['Explicit AI permission and account isolation', 'node', ['tools/ai-consent-check.mjs']],
  ['Apple grant lifetime and account binding', 'deno', ['run','--allow-read','tools/apple-grants-check.ts']],
  ['AI attempt accounting metadata', 'node', ['tools/ai-attempt-db-check.mjs']],
  ['AI transport accounting', 'deno', ['run','--allow-read','tools/ai-guard-check.ts']],
  ['Pumpy complete context', 'node', ['tools/pumpy-context-check.mjs']],
  ['Deterministic complete combines', 'deno', ['run','--allow-read','tools/pumpy-combine-test.ts']],
  ['Complete combine route', 'node', ['tools/pumpy-combine-route-check.mjs']],
  ['Pumpy never ships a claim without the workout', 'deno', ['run','--allow-env','--allow-read','tools/pumpy-truncation-harness.ts']],
  ['Billing account races', 'node', ['tools/billing-account-check.mjs']],
  ['Founding offer switch', 'node', ['tools/billing-founding-check.mjs']],
  ['Account erasure reaches every third party', 'node', ['tools/account-delete-check.mjs']],
  ['Reader account races', 'node', ['tools/reader-account-check.mjs']],
  ['Cache version cutover', 'node', ['tools/cache-version-check.mjs']],
  ['Reread interactions', 'node', ['tools/reread-harness.mjs']],
  ['Purchase SDK races', 'node', ['tools/ios/purchases-check.mjs']],
  ['Reader transactional completion', 'node', ['tools/reader-completion-db-check.mjs']],
  ['Pumpy transactional confirmation', 'node', ['tools/pumpy-confirm-db-check.mjs']],
  ['Operational scorecard and alerts', 'node', ['tools/ops-check.mjs']],
  ['Operational alert delivery', 'deno', ['run','--allow-read','--allow-env','tools/ops-notify-check.ts']],
  ['Extraction source and sampling fidelity', 'deno', ['run','--allow-read','tools/pack-eval/fidelity-test.ts']],
  ['Complete reader pipeline fixtures', 'deno', ['run','--allow-read','--allow-env','tools/pack-harness.ts']],
  ['Pumpy source context fixtures', 'deno', ['run','--allow-read','tools/pumpy-pack-harness.ts']],
  ['Monthly allowance table and refusals', 'deno', ['run','--allow-read','tools/allowance-table-check.ts']],
  ['Exercise bank picker, swap and corrections', 'node', ['tools/midadd-harness.mjs']],
  ['Supersets: one screen, ping-pong, rests, remote sets', 'node', ['tools/superset-harness.mjs']],
  ['Dumbbell each: the rule, the ×2 volume, bests per dumbbell', 'node', ['tools/each-harness.mjs']],
  ['Rest wheel: notches, settle vs Save, spinbutton, no chips left', 'node', ['tools/rest-wheel-harness.mjs']],
  ['One declaration per name in app.ts', 'node', ['tools/unique-decls.mjs']],
  ['Creator codes on the client', 'node', ['tools/creator-client-harness.mjs']],
  ['Creator codes SQL', 'node', ['tools/creator-db-check.mjs']],
  ['Creator ledger in the store webhook', 'node', ['tools/creator-purchases-check.mjs']],
  ['Save flow: Instagram slides, dose words, link shapes, holds, admission', 'deno', ['run','--allow-read','tools/share-harness.ts']],
];
const failures=[];
for(const [label,cmd,args] of checks) {
  const result=spawnSync(cmd,args,{encoding:'utf8',timeout:120000,env:process.env,maxBuffer:4*1024*1024});
  if(result.status!==0) {
    failures.push(label);console.error('FAIL '+label+'\n'+(result.error?.message??'')+'\n'+result.stdout+'\n'+result.stderr);
  } else console.log('PASS '+label);
}
if(failures.length){console.error('Launch regressions failed: '+failures.join(', '));process.exitCode=1;}
else console.log('All '+checks.length+' GTM regression groups passed. Store/device/paid-model gates are separate.');
