// Regression target: actual service, fresh module state; no network/provider calls.
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./fixtures/dispersion-notification-harness.cjs');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
test('claim lost before final receipt must not report durable SENT',async()=>{
 const s=setup();s.loseClaimBeforeFinish();const result=await s.call();
 assert.equal(s.posts.length,2);assert.equal(s.event.status,'PENDING');
 assert.equal(s.event.attemptId,'replacement-claim');assert.equal(s.audits,0);
 assert.notEqual(result.reason,'sent');assert.equal(result.notified,false);
});
