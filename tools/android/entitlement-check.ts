import { verifiedEntitlement } from '../../supabase/functions/spotter-purchases/entitlement.ts';
const now = Date.parse('2026-09-13T00:00:00Z');
const fixture = (store='play_store', extra={}) => ({entitlements:{plus:{product_identifier:'plus_monthly',expires_date:'2026-10-13T00:00:00Z'}},subscriptions:{plus_monthly:{store,is_sandbox:false,...extra}}});
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
check(verifiedEntitlement(fixture(),now).active,'Google subscription');
check(verifiedEntitlement(fixture('app_store'),now).source==='apple','Apple cross-platform subscription');
check(!verifiedEntitlement(fixture('test_store'),now,true).active,'test store cannot unlock paid production features');
check(!verifiedEntitlement(fixture('play_store',{is_sandbox:true}),now).active,'sandbox disabled by default');
check(verifiedEntitlement(fixture('play_store',{is_sandbox:true}),now,true).active,'explicit sandbox testing');
check(!verifiedEntitlement(fixture('play_store',{refunded_at:'2026-09-12'}),now).active,'refund revokes');
check(!verifiedEntitlement(fixture(),Date.parse('2026-11-01')).active,'expiry revokes');
check(!verifiedEntitlement({},now).active,'missing entitlement');
const invalid=fixture(); invalid.entitlements.plus.expires_date='bad';
check(!verifiedEntitlement(invalid,now).active,'malformed expiry cannot grant');
const grace:any=fixture(); grace.entitlements.plus.expires_date='2026-09-12T00:00:00Z';
grace.entitlements.plus.grace_period_expires_date='2026-09-15T00:00:00Z';
check(verifiedEntitlement(grace,now).active,'store grace period preserves access');
check(!verifiedEntitlement(grace,Date.parse('2026-09-16')).active,'grace expiry revokes access');
console.log('PASS verified store entitlements: Google, Apple, sandbox isolation, refunds, expiry, absent and malformed claims.');
