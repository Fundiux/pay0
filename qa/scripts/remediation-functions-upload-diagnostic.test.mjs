import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadWorkerDiagnostic, createUploadProgressWriter } from './verify-functions-upload-artifact.mjs';

test('timeout and signal remain distinguishable from worker rejection', () => {
  assert.deepEqual(uploadWorkerDiagnostic({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'PRIVATE' } }, 120005),
    { status: null, signal: 'SIGTERM', errorCode: 'ETIMEDOUT', workerCode: null, elapsedMs: 120005 });
});
test('recognized worker protocol exposes only its fixed code', () => {
  const row = uploadWorkerDiagnostic({ status: 1, stderr: JSON.stringify({ result: 'UPLOAD_VERIFICATION_FAILED', code: 'ZIP_CONTENT_MISMATCH', private: 'PRIVATE' }) }, 7);
  assert.equal(row.workerCode, 'ZIP_CONTENT_MISMATCH');
  assert.ok(!JSON.stringify(row).includes('PRIVATE'));
});
test('unknown error fields and malformed output cannot leak content', () => {
  const row = uploadWorkerDiagnostic({ status: 'PRIVATE', signal: 'PRIVATE', error: { code: 'PRIVATE' }, stderr: 'PRIVATE', stdout: 'PRIVATE' }, NaN);
  assert.deepEqual(row, { status: null, signal: null, errorCode: 'REDACTED', workerCode: null, elapsedMs: null });
});
test('unrecognized protocol codes and oversized stderr stay redacted', () => {
  for (const stderr of [JSON.stringify({ result: 'UPLOAD_VERIFICATION_FAILED', code: 'PRIVATE_TOKEN' }), JSON.stringify({ result: 'UPLOAD_VERIFICATION_FAILED', code: 'ZIP_PRIVATE_SCOPE', extra: 'x'.repeat(513) })]) {
    assert.equal(uploadWorkerDiagnostic({ status: 1, stderr }, 1).workerCode, null);
  }
});
test('progress exposes only a known stage and safe duration', () => {
  const valid = uploadWorkerDiagnostic({ status: null }, 120000, { stage: 'PACK_BEGIN', elapsedMs: 15, private: 'PRIVATE' });
  assert.equal(valid.stage, 'PACK_BEGIN');
  assert.equal(valid.stageElapsedMs, 15);
  assert.ok(!JSON.stringify(valid).includes('PRIVATE'));
  for (const progress of [{ stage: 'PRIVATE', elapsedMs: 1 }, { stage: 'PACK_BEGIN', elapsedMs: -1 }]) {
    assert.equal(uploadWorkerDiagnostic({}, 1, progress).stage, undefined);
  }
});
test('optional journal failure cannot replace success or the original error', () => {
  const progress = createUploadProgressWriter('unused', () => { throw Object.assign(Error('PRIVATE'), { code: 'EACCES' }); }, () => 1);
  const success = () => { try { return 'VERIFIED'; } finally { assert.equal(progress('ZIP_REMOVED'), false); } };
  assert.equal(success(), 'VERIFIED');
  const original = Error('ZIP_CONTENT_MISMATCH');
  assert.throws(() => { try { throw original; } finally { progress('ZIP_REMOVED'); } }, error => error === original);
});

test('exact fileset rejection remains a bounded diagnostic', () => {
  const row = uploadWorkerDiagnostic({ status: 1, stderr: JSON.stringify({ result: 'UPLOAD_VERIFICATION_FAILED', code: 'ZIP_FILESET_MISMATCH', files: ['PRIVATE'] }) }, 1);
  assert.equal(row.workerCode, 'ZIP_FILESET_MISMATCH');
  assert.ok(!JSON.stringify(row).includes('PRIVATE'));
});
