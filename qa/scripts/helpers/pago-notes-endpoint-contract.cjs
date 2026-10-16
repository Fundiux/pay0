const assert=require('node:assert/strict');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
function assertPagoEndpointTransition(previous,current){
 assert.equal(Object.keys(previous.endpoints).length,351,'PREVIOUS_MANIFEST_351');
 assert.equal(Object.keys(current.endpoints).length,352,'CANDIDATE_MANIFEST_352');
 assert.ok(!Object.hasOwn(previous.endpoints,'listPagoNotes'));
 assert.ok(Object.hasOwn(current.endpoints,'listPagoNotes'));
 const expected={...previous.endpoints.listSolicitudNotes,entryPoint:'listPagoNotes'};
 assert.equal(expected.platform,'gcfv2');assert.equal(expected.availableMemoryMb,256);assert.equal(expected.timeoutSeconds,60);assert.equal(expected.concurrency,1);assert.ok(expected.callableTrigger);
 assert.deepEqual(canonical(current.endpoints.listPagoNotes),canonical(expected),'NEW_ENDPOINT_CONFIG');
 const remainder={...current,endpoints:{...current.endpoints}};delete remainder.endpoints.listPagoNotes;
 assert.deepEqual(canonical(remainder),canonical(previous),'PREVIOUS_351_COMPLETE_MANIFEST_CHANGED');
 return 352;
}
module.exports={assertPagoEndpointTransition};
