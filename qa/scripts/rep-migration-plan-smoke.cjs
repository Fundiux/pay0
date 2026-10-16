const assert = require('node:assert/strict');
const { sha, planDigest, executeReviewedPlan } = require('../../scripts/rep-migration-plan.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const bucket = 'pay-0-system.firebasestorage.app';
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
async function rejected(fn, code) { await assert.rejects(fn, { message: code }); checks++; }
function fixture() {
  const data = new Map(), bytes = new Map(), revisions = new Map(); let revision = 0;
  const rootId = 'synthetic-root', put = (path, row) => { data.set(path, clone(row)); revisions.set(path, { seconds: 1, nanoseconds: ++revision }); };
  put('pagos/shared-payment', { rootId, montoTotal: 400, montoAplicado: 400, status: 'APLICADO_TOTAL', financialPostingStatus: 'POSTED' });
  put('solicitudes/shared-invoice', { rootId, total: 400, saldoPendiente: 0, status: 'COMPLETADA' });
  const plan = [], backup = [];
  for (let i = 1; i <= 4; i++) {
    const id = `app-${i}`, xml = `legacy-${i}-xml`, pdf = `legacy-${i}-pdf`, uuid = `REP-${i}`;
    put(`pagoAplicaciones/${id}`, { rootId, pagoId: 'shared-payment', solicitudId: 'shared-invoice', montoAplicado: 100, status: 'APPLIED',
      iqComplementStatus: 'IMPORTED', iqComplementXmlUploadId: xml, iqComplementPdfUploadId: pdf, iqComplementUuid: uuid });
    put(`paymentComplementRequests/request-${i}`, { rootId, applicationId: id, pagoId: 'shared-payment', solicitudId: 'shared-invoice', status: 'RECEIVED',
      repAttachmentStatus: 'REP_VALIDATED', automationStatus: 'RECEIVED', uuid, xmlUploadId: xml, pdfUploadId: pdf,
      invoiceUuid: 'SYNTHETIC-INVOICE', amountMinor: 10000, installment: i, balanceBefore: 500 - i * 100, balanceAfter: 400 - i * 100 });
    for (const [uploadId, type] of [[xml, 'COMPLEMENTO_PAGO_XML'], [pdf, 'COMPLEMENTO_PAGO_PDF']]) {
      const content = Buffer.from(`synthetic-${uploadId}`); bytes.set(uploadId, content);
      put(`uploads/${uploadId}`, { rootId, pagoId: 'shared-payment', pagoAplicacionId: id, documentType: type,
        entityType: 'solicitudes', entityId: 'shared-invoice', active: true, status: 'READY', storagePath: uploadId, sha256: sha(content) });
    }
    const paths = [`pagoAplicaciones/${id}`, 'pagos/shared-payment', 'solicitudes/shared-invoice', `paymentComplementRequests/request-${i}`, `uploads/${xml}`, `uploads/${pdf}`];
    plan.push({ applicationId: id, legacyUploadIds: [xml, pdf], revisions: paths.map(path => ({ path, updateTime: clone(revisions.get(path)) })) });
    backup.push(...paths.map(path => ({ path, data: clone(data.get(path)) })));
  }
  const envelope = { revision: 'ASTRA_REP_MIGRATION_PLAN_V2', projectId: 'pay-0-system', bucket, rootId, plan, backup };
  const digest = planDigest(envelope);
  const stats = { adoptions: 0, mutations: 0, noops: 0, pauses: 0, checkpoints: [], throwAfterFirst: false, failPauseAt: 0 };
  const adapter = {
    read: async path => ({ data: clone(data.get(path) || null), revision: clone(revisions.get(path) || null) }),
    bytes: async row => bytes.get(row.storagePath),
    assertPaused: async () => { stats.pauses++; if (stats.failPauseAt === stats.pauses) throw Error('REP_DELIVERY_NOT_PAUSED'); },
    checkpoint: async report => stats.checkpoints.push(clone(report)),
    adopt: async id => {
      stats.adoptions++;
      const app = data.get(`pagoAplicaciones/${id}`), index = id.split('-')[1];
      if (app.iqComplementDocumentOwner === 'PAGO_APPLICATION') { stats.noops++; return; }
      const xml = `canonical-${index}-xml`, pdf = `canonical-${index}-pdf`;
      for (const [beforeId, afterId] of [[app.iqComplementXmlUploadId, xml], [app.iqComplementPdfUploadId, pdf]]) {
        const before = data.get(`uploads/${beforeId}`);
        bytes.set(afterId, Buffer.from(bytes.get(beforeId)));
        put(`uploads/${afterId}`, { ...before, entityType: 'pagos', entityId: app.pagoId, applicationId: id,
          storagePath: afterId, integritySealStatus: 'SEALED', complementKey: app.iqComplementUuid });
        put(`uploads/${beforeId}`, { ...before, active: false, status: 'REPLACED' });
      }
      put(`pagoAplicaciones/${id}`, { ...app, iqComplementDocumentOwner: 'PAGO_APPLICATION', iqComplementXmlUploadId: xml, iqComplementPdfUploadId: pdf });
      put(`paymentComplementRequests/request-${index}`, { ...data.get(`paymentComplementRequests/request-${index}`), xmlUploadId: xml, pdfUploadId: pdf });
      put('solicitudes/shared-invoice', { ...data.get('solicitudes/shared-invoice'), materialityStatus: 'COMPLETE', materialityUpdatedAt: { seconds: 9 } });
      stats.mutations++;
      if (stats.throwAfterFirst && stats.mutations === 1) throw Error('SYNTHETIC_REPLY_LOST_AFTER_COMMIT');
    },
  };
  const execute = resume => executeReviewedPlan({ envelope, digest, bucket, resume, adapter });
  return { data, bytes, revisions, put, envelope, digest, adapter, stats, execute };
}
async function main() {
  const happy = fixture(), completed = await happy.execute(false);
  check(completed.migrated === 4 && completed.canonicalActive === 8 && completed.legacyActive === 0, 'Initial exact plan migrates all four');
  check(happy.stats.checkpoints.length === 4 && happy.stats.pauses === 7, 'Checkpoint each item and check pause before each plus final readback');
  const repeated = await happy.execute(true);
  check(repeated.preserved === 4 && repeated.migrated === 0 && happy.stats.mutations === 4 && happy.stats.noops === 4, 'Completed resume calls only idempotent adoption');
  const lost = fixture(); lost.stats.throwAfterFirst = true;
  await rejected(() => lost.execute(false), 'SYNTHETIC_REPLY_LOST_AFTER_COMMIT');
  check(lost.stats.mutations === 1 && lost.stats.checkpoints.length === 0, 'Simulate unknown response after first commit');
  await rejected(() => lost.execute(false), 'PLAN_CHANGED_RUN_DRY_RUN_AGAIN');
  const restored = await lost.execute(true);
  check(restored.preserved === 1 && restored.migrated === 3 && restored.canonicalActive === 8 && lost.stats.mutations === 4, 'Original four reviewed IDs resume after partial completion');
  const changed = fixture(); changed.put('pagos/shared-payment', { ...changed.data.get('pagos/shared-payment'), montoTotal: 999 });
  await rejected(() => changed.execute(true), 'SOURCE_FINANCIAL_STATE_CHANGED');
  check(changed.stats.adoptions === 0, 'Financial drift stops before any adoption');
  const scope = fixture(); scope.put('pagoAplicaciones/app-4', { ...scope.data.get('pagoAplicaciones/app-4'), rootId: 'foreign' });
  await rejected(() => scope.execute(true), 'CURRENT_SOURCE_SCOPE_INVALID');
  check(scope.stats.adoptions === 0, 'All four preflight scopes checked before first adoption');
  const objects = fixture(); objects.bytes.set('legacy-4-pdf', Buffer.from('tampered bytes'));
  await rejected(() => objects.execute(false), 'LEGACY_DOCUMENT_HASH_MISMATCH');
  check(objects.stats.adoptions === 0, 'Legacy object hash bound before writes');
  const review = fixture(); review.put('paymentComplementRequests/request-4', { ...review.data.get('paymentComplementRequests/request-4'), automationStatus: 'REVIEW_REQUIRED' });
  await rejected(() => review.execute(true), 'CURRENT_REQUEST_REQUIRES_REVIEW');
  const paused = fixture(); paused.stats.failPauseAt = 3;
  await rejected(() => paused.execute(false), 'REP_DELIVERY_NOT_PAUSED');
  check(paused.stats.mutations === 1, 'Loss of pause stops before next adoption');
  const altered = fixture(); altered.envelope.plan[3].applicationId = 'unexpected-app';
  await rejected(() => altered.execute(false), 'REVIEWED_PLAN_REQUIRED');
  const canonical = fixture(); await canonical.execute(false); canonical.bytes.set('canonical-2-pdf', Buffer.from('changed canonical'));
  await rejected(() => canonical.execute(true), 'CANONICAL_DOCUMENT_READBACK_FAILED');
  const resealed = fixture(); await resealed.execute(false);
  const replacement = Buffer.from('different bytes resealed after the approved plan');
  resealed.bytes.set('canonical-2-pdf', replacement);
  resealed.put('uploads/canonical-2-pdf', { ...resealed.data.get('uploads/canonical-2-pdf'), sha256: sha(replacement) });
  await rejected(() => resealed.execute(true), 'CANONICAL_DOCUMENT_READBACK_FAILED');
  const reordered = fixture();
  reordered.put('pagos/shared-payment', Object.fromEntries(Object.entries(reordered.data.get('pagos/shared-payment')).reverse()));
  const reorderedReport = await reordered.execute(true);
  check(reorderedReport.canonicalActive === 8, 'Object key order does not invent financial changes');
  const projection = fixture(); projection.put('solicitudes/shared-invoice', { ...projection.data.get('solicitudes/shared-invoice'), materialityUpdatedAt: { seconds: 99 }, materialityStatus: 'COMPLETE' });
  check((await projection.execute(true)).canonicalActive === 8, 'Allowed materiality projection metadata does not block recovery');
  console.log(JSON.stringify({ result: 'PASS', checks, scope: 'reviewed REP migration plan with local adapter', productionCalls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
