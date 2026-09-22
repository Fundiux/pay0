// Eval-only representation ablation through the canonical Gemini adapter. Synthetic facts only.
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../../../functions/node_modules/firebase-admin');
const { VertexGeminiAdapter } = require('../../../functions/lib/modules/agent007/vertexGeminiAdapter');
const selected = [
  { id: 'document-review', folio: 'S71001', issueCode: 'DOCUMENT_MISSING', behavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', pattern: 'verificar.*documento|comprobar.*documento' },
  { id: 'invoice-mismatch', folio: 'S71002', issueCode: 'INVOICE_MISMATCH', behavior: 'COMPARE_INVOICE_WITH_REQUEST_BEFORE_APPROVAL', pattern: 'factura.*solicitud|solicitud.*factura' },
  { id: 'supplier-ack', folio: 'S71003', issueCode: 'PROVIDER_ACK_PENDING', behavior: 'VERIFY_PROVIDER_ACK_BEFORE_RETRY', pattern: 'confirmaci[oó]n.*proveedor|proveedor.*confirmaci[oó]n' },
  { id: 'amount-mismatch', folio: 'P71004', issueCode: 'AMOUNT_MISMATCH', behavior: 'RECONCILE_AMOUNT_BEFORE_APPLICATION', pattern: 'concili|monto correcto' },
];
const variants = ['NONE','COMPACT','FULL','EXPLICIT_RELEVANCE','POSITION_FIRST'];
const baseExperience = row => ({ id: `phase7_ablation_${row.id}`, scope: { rootId: 'phase7-synthetic-root', domain: row.folio[0] === 'S' ? 'SOLICITUDES' : 'PAGOS', taskType: 'REASON', entityType: row.folio[0] === 'S' ? 'SOLICITUD' : 'PAGO' }, situation: { status: 'EN_REVISION', issueCode: row.issueCode }, expectedBehavior: row.behavior, correction: { originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: row.behavior, reasonCode: 'OUTCOME_SUPPORTED_CORRECTION' }, outcome: { type: 'VERIFIED_SUCCESS', verified: true, occurredAt: '2026-09-22T17:00:00.000Z' }, quality: { provenance: 'VERIFIED', outcome: 'VERIFIED', feedback: 'CORRECTED' }, historical: true });
function context(row, variant) {
  const current = { folio: row.folio, estado: 'EN_REVISION', monto: 120, issueCode: row.issueCode }, experience = baseExperience(row);
  const facts = row.folio[0] === 'S' ? { solicitudes: [current], pagos: [] } : { solicitudes: [], pagos: [current] };
  const common = { schemaVersion: 'hugo-context-v2', questionIntent: 'REASON', folioConsultado: row.folio, ...facts, memoriasHistoricas: [], observacionesHistoricasNoVerificadas: [], evidenceBoundaries: { currentEntity: { completeness: 'COMPLETE', scope: row.folio } } };
  if (variant === 'NONE') return { ...common, learningExperiences: [] };
  if (variant === 'COMPACT') return { ...common, learningExperiences: [experience] };
  if (variant === 'FULL') return { ...common, learningExperiences: [{ ...experience, revision: 3, state: 'VERIFIED', createdFrom: { memoryId: 'synthetic-memory', observationId: 'synthetic-observation', decisionId: 'synthetic-decision', outcomeId: 'synthetic-outcome', traceId: null }, entityReferences: [{ sourceSystem: 'PAY0', entityType: experience.scope.entityType, entityId: `prior_${row.id}` }], corrections: [experience.correction], audit: { createdBy: 'synthetic-reviewer', revisionsPreserved: true }, trainingEligibility: { eligible: false, reasons: ['EVAL_ONLY'] } }] };
  if (variant === 'EXPLICIT_RELEVANCE') return { ...common, learningExperiences: [{ ...experience, relevance: { matchedFeatures: ['entityType','status','issueCode'], instruction: `This verified outcome is directly relevant to ${row.issueCode}.` } }] };
  return { priorityLearningExperience: experience, ...common, learningExperiences: [] };
}
async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pay-0-system' }); await admin.app().options.credential.getAccessToken();
  const adapter = new VertexGeminiAdapter(), results = [];
  for (const row of selected) for (const variant of variants) {
    const ctx = context(row, variant), output = await adapter.generate({ message: `Por que ${row.folio} esta en revision? Indica que comprobar antes de actuar.`, name: 'Evaluador', context: ctx, history: [], promptVersion: 'hugo-v2' });
    results.push({ caseId: row.id, variant, pattern: row.pattern, contextChars: JSON.stringify(ctx).length, modelError: output.error || null, text: output.text, tokenUsage: output.tokenUsage, attempts: output.attempts || [], behaviorPresent: new RegExp(row.pattern, 'i').test(output.text || '') });
    process.stdout.write(`${row.id} ${variant}: ${output.error || 'COMPLETE'}\n`);
  }
  fs.writeFileSync(path.join(__dirname, 'phase7-ablation.json'), JSON.stringify({ schemaVersion: 'hugo-phase7-ablation-v1', syntheticOnly: true, controlledVariables: 'Same model, prompt, current facts and output limit within case; only experience representation changes.', results }, null, 2) + '\n');
}
main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });
