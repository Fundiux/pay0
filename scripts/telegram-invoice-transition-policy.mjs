import assert from 'node:assert/strict';

export const INVOICE_SERVICE='projects/pay-0-system/locations/us-central1/services/finalizesolicituddocumentupload';
export const INVOICE_FUNCTION='finalizeSolicitudDocumentUpload';

export function assertInvoiceDrain(witness, expected, now=Date.now()) {
  assert.equal(witness?.status,'PASS','DRAIN_NOT_PROVEN');
  assert.equal(witness.service,INVOICE_SERVICE,'WRONG_SERVICE');
  for(const k of ['pauseRevision','legacyRevision'])assert.match(expected[k],/^finalizesolicituddocumentupload-[a-z0-9-]+$/,'DRAIN_REVISION_REQUIRED');
  for(const k of ['pauseArchiveSha256','ownedStateSha256'])assert.match(expected[k],/^[a-f0-9]{64}$/,'DRAIN_HASH_REQUIRED');
  for(const k of ['pauseRevision','pauseArchiveSha256','legacyRevision','ownedStateSha256'])assert.equal(witness[k],expected[k],'DRAIN_IDENTITY_CHANGED');
  assert.notEqual(witness.pauseRevision,witness.legacyRevision,'SAME_REVISION');
  for(const k of ['noLegacyTrafficOrTags','legacyRetired','stateUnchanged','telemetryComplete'])assert.equal(witness[k],true,'DRAIN_INCOMPLETE');
  for(const k of ['legacyActiveInstances','legacyIdleInstances','legacyInFlightRequests','activeOperations'])assert.equal(witness[k],0,'DRAIN_NOT_ZERO');
  const barrier=Date.parse(witness.pauseTrafficConfirmedAt),sample=Date.parse(witness.sampledAt),checked=Date.parse(witness.checkedAt);
  assert([barrier,sample,checked].every(Number.isFinite),'DRAIN_TIMES_REQUIRED');
  assert(sample>barrier&&sample<=checked&&checked<=now&&now-checked<=60000,'DRAIN_STALE_OR_PRE_BARRIER');
  // The callable allows 120 seconds. No request that started before the pause
  // may still hold a stale receipt read when activation is admitted.
  assert(checked-barrier>=120000,'OLD_REQUEST_WINDOW_OPEN');
}

export function assertInvoiceRecovery(plan, current) {
  assert.equal(plan?.service,INVOICE_SERVICE,'WRONG_SERVICE');
  assert.equal(plan.function,INVOICE_FUNCTION,'WRONG_FUNCTION');
  assert.match(current.stateSha256,/^[a-f0-9]{64}$/,'CURRENT_STATE_REQUIRED');
  assert.equal(typeof current.resourceVersion,'string','CURRENT_VERSION_REQUIRED');
  assert(current.resourceVersion.length>0,'CURRENT_VERSION_REQUIRED');
  assert.equal(plan.expectedStateSha256,current.stateSha256,'CONCURRENT_CHANGE');
  assert.equal(plan.expectedResourceVersion,current.resourceVersion,'CONCURRENT_CHANGE');
  assert.match(plan.pauseRevision,/^finalizesolicituddocumentupload-[a-z0-9-]+$/,'WRONG_REVISION');
  for(const k of ['pauseArchiveSha256','pauseImageSha256'])assert.match(plan[k],/^[a-f0-9]{64}$/,'EXACT_ARTIFACT_REQUIRED');
  assert.equal(plan.pauseCertified,true,'PAUSE_NOT_CERTIFIED');
  assert.equal(plan.notificationIntentsRecoverable,true,'NOTIFICATION_INTENT_NOT_RECOVERABLE');
  assert.equal(plan.financialBoundaryUnchanged,true,'FINALIZER_CHANGED');
  assert.equal(plan.uncertainReceiptsNotRepeated,true,'UNCERTAIN_REPLAY');
  assert.equal(plan.method,'EXISTING_REVISION_TRAFFIC_ONLY','REDEPLOY_FORBIDDEN');
  return {revision:plan.pauseRevision,percent:100,resourceVersion:current.resourceVersion};
}

export function assertInvoiceRelease(proof) {
  assert.equal(proof?.function,INVOICE_FUNCTION,'WRONG_FUNCTION');
  for(const k of ['exactArchives','finalizerBytesPreserved','permissions','concurrency','duplicates','uncertainDelivery','mixedRevisionTransition','restart','pauseIntentRecovery','recoveryExactImage','freshProductionFence'])assert.equal(proof[k],true,'RELEASE_GATE_'+k);
  assert.equal(proof.financialOperations,0,'FINANCIAL_OPERATIONS_FORBIDDEN');
  assert.equal(proof.realAudio,'PENDING','AUDIO_STATUS_CHANGED');
}
