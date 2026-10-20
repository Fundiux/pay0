import test from 'node:test';
import assert from 'node:assert/strict';
import { assertArtifactProof, deploymentScope, validateSourceIdentity } from '../../scripts/deploy-scoped-functions.mjs';
const commit='a'.repeat(40),archive='b'.repeat(64);
const identity={mode:'PRODUCTION_OVERLAY_V1',baseArchiveSha256:'c'.repeat(64),patchCommit:commit,patchSha256:'d'.repeat(64)};
const input={group:'payment-create-overlay',functions:['createPago'],buildMode:'NORMAL',sourceCommit:commit,sourceTree:null,archiveSha256:archive,sourceIdentity:identity,safeRecoveryArchiveSha256:'f'.repeat(64)};
const behavior={status:'PASS',archiveSha256:archive,rollbackArchiveSha256:'f'.repeat(64),automaticReceiptRecoveryClosed:true,concurrency:true,duplicates:true,permissions:true,atomicFailure:true,sequence:true,manualPath:true,rollbackCompatibility:true};
const proof={status:'PASS',sourceCommit:commit,archiveSha256:archive,functions:['createPago'],buildMode:'NORMAL',unauthenticatedDenied:1,sourceIdentity:identity,behaviorVerification:behavior};
test('financial overlay pins one existing endpoint and requires explicit composite provenance',()=>{
  assert.deepEqual([...deploymentScope(input).names],['createPago']);
  assert.throws(()=>deploymentScope({...input,functions:['createPago','changePagoStatus']}),/FUNCTION_SCOPE/);
  assert.throws(()=>validateSourceIdentity(undefined,input.group,commit),/OVERLAY_IDENTITY_REQUIRED/);
  assertArtifactProof(input,proof);
});
test('financial deployment rejects auth-only or different-artifact behavior evidence',()=>{
  assert.throws(()=>assertArtifactProof(input,{...proof,behaviorVerification:undefined}),/PAYMENT_BEHAVIOR_NOT_VERIFIED/);
  assert.throws(()=>assertArtifactProof(input,{...proof,behaviorVerification:{...behavior,archiveSha256:'e'.repeat(64)}}),/PAYMENT_BEHAVIOR_ARTIFACT_MISMATCH/);
});
test('every financial boundary must be explicitly certified',()=>{
  for(const key of ['concurrency','duplicates','permissions','atomicFailure','sequence','manualPath','rollbackCompatibility'])
    assert.throws(()=>assertArtifactProof(input,{...proof,behaviorVerification:{...behavior,[key]:false}}),/PAYMENT_BEHAVIOR_INCOMPLETE/);
});

test('a tested safe recovery archive is mandatory and hash-bound',()=>{
  assert.throws(()=>assertArtifactProof({...input,safeRecoveryArchiveSha256:undefined},proof),/PAYMENT_SAFE_RECOVERY_HASH_REQUIRED/);
  assert.throws(()=>assertArtifactProof(input,{...proof,behaviorVerification:{...behavior,rollbackArchiveSha256:'e'.repeat(64)}}),/PAYMENT_SAFE_RECOVERY_MISMATCH/);
  assert.throws(()=>assertArtifactProof(input,{...proof,behaviorVerification:{...behavior,automaticReceiptRecoveryClosed:false}}),/PAYMENT_SAFE_RECOVERY_NOT_TESTED/);
});
