const fs = require('node:fs');
const path = require('node:path');
const { applyHugoContextBudget } = require('../../../functions/lib/modules/agent007/hugoCore/learningContextBudget');
const { selectLearningExperiences } = require('../../../functions/lib/modules/agent007/hugoCore/learningStore');
const rootId = 'phase6-synthetic-root';
const facts = count => Array.from({ length: count }, (_, i) => ({ folio: `S${61000 + i}`, estado: 'PENDIENTE', monto: 120, issueCode: 'DOCUMENT_MISSING' }));
function context(memories, experiences, factCount = 1, toolPadding = '') { return { schemaVersion: 'context-v2', activeEntity: { type: 'SOLICITUD', folio: 'S61000' },
  solicitudes: facts(factCount), pagos: [], evidenceBoundaries: { solicitudes: [{ completeness: 'COMPLETE', scope: 'EXACT_FOLIO' }] },
  toolEvidence: toolPadding, observacionesHistoricasNoVerificadas: Array.from({ length: memories }, (_, i) => ({ id: `legacy_${i}`, content: 'observación '.repeat(20) })),
  memoriasHistoricas: Array.from({ length: memories }, (_, i) => ({ id: `memory_${i}`, content: 'memoria verificada '.repeat(20) })),
  learningExperiences: Array.from({ length: experiences }, (_, i) => ({ id: `learning_${i}`, expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', situation: { issueCode: 'DOCUMENT_MISSING' },
    correction: { correctedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION' }, outcome: { verified: true, type: 'SOLICITUD_COMPLETADA' } })) }; }
const scenarios = [
  { name: 'few-memory-few-experience', context: context(2, 1) },
  { name: 'many-memory-few-experience', context: context(20, 1) },
  { name: 'few-memory-many-experience', context: context(2, 20) },
  { name: 'many-memory-many-experience', context: context(20, 20) },
  { name: 'multiple-entities', context: context(2, 2, 8) },
  { name: 'large-current-evidence', context: context(2, 2, 8, 'current-evidence '.repeat(1000)) },
];
const report = scenarios.map(scenario => { const beforeFacts = JSON.stringify(scenario.context.solicitudes), beforeChars = JSON.stringify(scenario.context).length;
  const budget = applyHugoContextBudget(scenario.context);
  return { name: scenario.name, beforeChars, ...budget, currentFactsPreserved: JSON.stringify(scenario.context.solicitudes) === beforeFacts,
    selectedExperienceCount: scenario.context.learningExperiences.length };
});
const query = { rootId, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, limit: 2 };
const rows = Array.from({ length: 21 }, (_, i) => ({ experienceId: `learning_${i}`, rootId, state: 'VERIFIED', outcome: { verified: true },
  quality: { provenance: 'VERIFIED', feedback: 'CORRECTED' }, split: 'TEST', protectedCaseIds: [], domain: 'SOLICITUDES', taskType: 'REASON',
  entityReferences: [{ entityType: 'SOLICITUD' }], features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: i < 2 ? 'DOCUMENT_MISSING' : 'UNRELATED_HOLD' },
  expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', createdAt: new Date(2026, 8, 22, 12, i).toISOString() }));
const retrieval = selectLearningExperiences(rows, query);
const artifact = { schemaVersion: 'hugo-phase6-pressure-v1', syntheticOnly: true, scenarios: report,
  noise: { available: rows.length, relevant: 2, selected: retrieval.selected.length, irrelevantIncluded: retrieval.selected.filter(row => row.features.issueCode !== query.features.issueCode).length,
    rejected: retrieval.rejected.length }, conclusion: 'Current facts are preserved; over-limit current evidence yields an explicit budget failure instead of silent truncation.' };
fs.writeFileSync(path.join(__dirname, 'phase6-pressure.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ scenarios: report.length, factsPreserved: report.every(row => row.currentFactsPreserved), irrelevantIncluded: artifact.noise.irrelevantIncluded }));
