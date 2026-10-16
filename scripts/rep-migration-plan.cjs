const crypto = require('node:crypto');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const projectionFields = new Set(['updatedAt', 'materialityClientCompanyId', 'materialityOperationId', 'materialityStatus', 'materialityMissingTypes', 'materialityUpdatedAt']);
const financialState = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !projectionFields.has(key) && !key.startsWith('iqComplement')));
function stable(value) {
  const plain = JSON.parse(JSON.stringify(value));
  const order = item => Array.isArray(item) ? item.map(order) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, order(item[key])])) : item;
  return JSON.stringify(order(plain));
}
const planDigest = envelope => sha(JSON.stringify(envelope));
function validateEnvelope(envelope, digest, bucket) {
  if (envelope?.revision !== 'ASTRA_REP_MIGRATION_PLAN_V2' || envelope.projectId !== 'pay-0-system' || envelope.bucket !== bucket ||
      !envelope.rootId || typeof envelope.rootId !== 'string' || envelope.rootId.includes('/') || planDigest(envelope) !== digest ||
      !Array.isArray(envelope.plan) || envelope.plan.length !== 4 || !Array.isArray(envelope.backup)) throw Error('REVIEWED_PLAN_REQUIRED');
  const ids = new Set(), originals = new Map();
  for (const row of envelope.backup) {
    if (!/^(?:pagoAplicaciones|pagos|solicitudes|uploads|paymentComplementRequests|paymentComplementJobs)\/[^/]+$/.test(row.path) || !row.data || row.data.rootId !== envelope.rootId)
      throw Error('BACKUP_SCOPE_INVALID');
    if (originals.has(row.path) && stable(originals.get(row.path)) !== stable(row.data)) throw Error('BACKUP_SNAPSHOT_CONFLICT');
    originals.set(row.path, row.data);
  }
  for (const item of envelope.plan) {
    if (!/^[^/]+$/.test(item.applicationId || '') || ids.has(item.applicationId) || !Array.isArray(item.legacyUploadIds) || item.legacyUploadIds.length !== 2 ||
        new Set(item.legacyUploadIds).size !== 2 || item.legacyUploadIds.some(id => typeof id !== 'string' || !id || id.includes('/')) || !Array.isArray(item.revisions)) throw Error('PLAN_COHORT_INVALID');
    ids.add(item.applicationId);
    const app = originals.get(`pagoAplicaciones/${item.applicationId}`);
    if (!app || app.iqComplementXmlUploadId !== item.legacyUploadIds[0] || app.iqComplementPdfUploadId !== item.legacyUploadIds[1] ||
        !originals.has(`solicitudes/${app.solicitudId}`) || !originals.has(`pagos/${app.pagoId}`)) throw Error('PLAN_SOURCE_INVALID');
    for (const revision of item.revisions) if (!originals.has(revision.path) || !Number.isInteger(revision.updateTime?.seconds) ||
        !Number.isInteger(revision.updateTime?.nanoseconds)) throw Error('PLAN_REVISION_INVALID');
  }
  return originals;
}

/** Adapter contains local/cloud reads and the already validated, provider-free adoption core. */
async function executeReviewedPlan({ envelope, digest, bucket, resume = false, adapter }) {
  const originals = validateEnvelope(envelope, digest, bucket), rootId = envelope.rootId;
  const read = async path => {
    const row = await adapter.read(path);
    if (!row?.data || row.data.rootId !== rootId) throw Error('CURRENT_SOURCE_SCOPE_INVALID');
    return row;
  };
  const equalFinancial = (path, current) => {
    if (stable(financialState(current)) !== stable(financialState(originals.get(path)))) throw Error('SOURCE_FINANCIAL_STATE_CHANGED');
  };
  async function state(item) {
    const appPath = `pagoAplicaciones/${item.applicationId}`, app = (await read(appPath)).data, original = originals.get(appPath);
    equalFinancial(appPath, app);
    for (const [collection, id] of [['pagos', original.pagoId], ['solicitudes', original.solicitudId]]) equalFinancial(`${collection}/${id}`, (await read(`${collection}/${id}`)).data);
    const requestPath = item.revisions.find(row => row.path.startsWith('paymentComplementRequests/'))?.path;
    if (!requestPath) throw Error('PLAN_REQUEST_MISSING');
    const request = (await read(requestPath)).data;
    const originalRequest = originals.get(requestPath);
    if (request.applicationId !== item.applicationId || request.pagoId !== app.pagoId || request.solicitudId !== app.solicitudId ||
        ['automationJobId', 'invoiceUuid', 'amountMinor', 'installment', 'balanceBefore', 'balanceAfter'].some(key => request[key] !== originalRequest[key]) ||
        request.status !== 'RECEIVED' || request.repAttachmentStatus !== 'REP_VALIDATED' || request.automationStatus === 'REVIEW_REQUIRED' ||
        request.automationError === 'REP_SOURCE_REVERSED') throw Error('CURRENT_REQUEST_REQUIRES_REVIEW');
    if (request.automationJobId) {
      const job = (await read(`paymentComplementJobs/${request.automationJobId}`)).data;
      if (job.status === 'REVIEW_REQUIRED' || job.error === 'REP_SOURCE_REVERSED') throw Error('CURRENT_JOB_REQUIRES_REVIEW');
    }
    return { app, request, completed: app.iqComplementDocumentOwner === 'PAGO_APPLICATION' };
  }
  async function verifyLegacy(item) {
    for (const [index, id] of item.legacyUploadIds.entries()) {
      const path = `uploads/${id}`, row = (await read(path)).data, before = originals.get(path), app = originals.get(`pagoAplicaciones/${item.applicationId}`);
      if (!before || row.pagoId !== app.pagoId || (row.pagoAplicacionId || row.applicationId) !== item.applicationId ||
          row.documentType !== ['COMPLEMENTO_PAGO_XML', 'COMPLEMENTO_PAGO_PDF'][index] || row.status !== 'READY' || row.active !== true ||
          row.storagePath !== before.storagePath || row.sha256 !== before.sha256 || !/^[a-f0-9]{64}$/i.test(row.sha256 || '')) throw Error('LEGACY_DOCUMENT_CHANGED');
      if (sha(await adapter.bytes(row)) !== row.sha256.toLowerCase()) throw Error('LEGACY_DOCUMENT_HASH_MISMATCH');
    }
  }
  async function verifyCanonical(item) {
    const current = await state(item), { app, request } = current;
    if (!current.completed || request.xmlUploadId !== app.iqComplementXmlUploadId || request.pdfUploadId !== app.iqComplementPdfUploadId ||
        request.uuid !== app.iqComplementUuid || request.automationStatus !== 'RECEIVED' || request.automationError) throw Error('MIGRATION_READBACK_FAILED');
    for (const [index, id] of [app.iqComplementXmlUploadId, app.iqComplementPdfUploadId].entries()) {
      const row = (await read(`uploads/${id}`)).data;
      if (row.active !== true || row.status !== 'READY' || row.entityType !== 'pagos' || row.entityId !== app.pagoId || row.pagoId !== app.pagoId ||
          row.applicationId !== item.applicationId || row.documentType !== ['COMPLEMENTO_PAGO_XML', 'COMPLEMENTO_PAGO_PDF'][index] ||
          row.integritySealStatus !== 'SEALED' || row.complementKey !== app.iqComplementUuid || !/^[a-f0-9]{64}$/i.test(row.sha256 || '') ||
          row.sha256.toLowerCase() !== String(originals.get(`uploads/${item.legacyUploadIds[index]}`)?.sha256 || '').toLowerCase() ||
          sha(await adapter.bytes(row)) !== row.sha256.toLowerCase()) throw Error('CANONICAL_DOCUMENT_READBACK_FAILED');
    }
    for (const id of item.legacyUploadIds) if ((await read(`uploads/${id}`)).data.active !== false) throw Error('LEGACY_DOCUMENT_STILL_ACTIVE');
  }
  await adapter.assertPaused();
  // Initial approval pins every document revision before any adoption. Resume
  // retains the same four identities and original financial snapshot instead.
  if (!resume) for (const item of envelope.plan) for (const expected of item.revisions)
    if (stable((await read(expected.path)).revision) !== stable(expected.updateTime)) throw Error('PLAN_CHANGED_RUN_DRY_RUN_AGAIN');
  for (const item of envelope.plan) {
    const current = await state(item);
    if (current.completed) {
      if (!resume) throw Error('ALREADY_ADOPTED_USE_REVIEWED_RESUME');
      await verifyCanonical(item);
    } else {
      if (current.app.iqComplementXmlUploadId !== item.legacyUploadIds[0] || current.app.iqComplementPdfUploadId !== item.legacyUploadIds[1]) throw Error('LEGACY_DOCUMENT_IDS_CHANGED');
      await verifyLegacy(item);
    }
  }
  const report = { checkedAt: '', projectId: envelope.projectId, apply: true, resumed: resume, candidates: 4, roots: 1, planSha256: digest,
    deliveryPaused: true, providerActions: 0, migrated: 0, preserved: 0, canonicalActive: 0, legacyActive: 0, sourceFinancialStateUnchanged: true };
  for (const item of envelope.plan) {
    await adapter.assertPaused();
    const before = await state(item);
    // Call the same idempotent core for completed items; it must perform no
    // writes or provider actions. An incomplete state cannot be skipped.
    await adapter.adopt(item.applicationId);
    await verifyCanonical(item);
    if (before.completed) report.preserved++; else report.migrated++;
    report.canonicalActive += 2;
    report.checkedAt = new Date().toISOString();
    await adapter.checkpoint({ ...report });
  }
  await adapter.assertPaused();
  // Reread all four after the last mutation, including shared source documents.
  for (const item of envelope.plan) await verifyCanonical(item);
  await adapter.assertPaused();
  if (report.canonicalActive !== 8 || report.legacyActive !== 0) throw Error('DOCUMENT_COHORT_READBACK_FAILED');
  return report;
}
module.exports = { sha, stable, financialState, planDigest, validateEnvelope, executeReviewedPlan };
