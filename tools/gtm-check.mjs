// Launch-specific regressions. No external network, deployment, or paid inference.
import { spawnSync } from 'node:child_process';
const checks = [
  ['AI attempt accounting metadata', 'node', ['tools/ai-attempt-db-check.mjs']],
  ['AI transport accounting', 'deno', ['run','--allow-read','tools/ai-guard-check.ts']],
  ['Pumpy complete context', 'node', ['tools/pumpy-context-check.mjs']],
  ['Deterministic complete combines', 'deno', ['run','--allow-read','tools/pumpy-combine-test.ts']],
  ['Complete combine route', 'node', ['tools/pumpy-combine-route-check.mjs']],
  ['Billing account races', 'node', ['tools/billing-account-check.mjs']],
  ['Reader account races', 'node', ['tools/reader-account-check.mjs']],
  ['Reread interactions', 'node', ['tools/reread-harness.mjs']],
  ['Purchase SDK races', 'node', ['tools/ios/purchases-check.mjs']],
  ['Reader transactional completion', 'node', ['tools/reader-completion-db-check.mjs']],
  ['Pumpy transactional confirmation', 'node', ['tools/pumpy-confirm-db-check.mjs']],
  ['Operational scorecard and alerts', 'node', ['tools/ops-check.mjs']],
  ['Extraction source and sampling fidelity', 'deno', ['run','--allow-read','tools/pack-eval/fidelity-test.ts']],
  ['Complete reader pipeline fixtures', 'deno', ['run','--allow-read','--allow-env','tools/pack-harness.ts']],
  ['Pumpy source context fixtures', 'deno', ['run','--allow-read','tools/pumpy-pack-harness.ts']],
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
