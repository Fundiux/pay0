const fs = require('node:fs'); const path = require('node:path');
const phase4 = require('../phase4-model-results-blind-review.json');
const phase6 = require('../phase6/phase6-blind-review.json'); const phase6Specs = require('../phase6/cases.cjs');
const groups = [
  { phase: 'PHASE4', evalRunId: phase4.evalRunId, cases: phase4.cases.map(row => ({ caseId: row.caseId, category: row.category, task: row.userInput, controlledEvidence: row.controlledEvidence, responseA: row.responseA, responseB: row.responseB, acceptanceCriteria: row.criteria || { contains: [], excludes: [] } })) },
  { phase: 'PHASE6', evalRunId: phase6.evalRunId, cases: phase6.cases.map(row => { const spec = phase6Specs.find(item => item.id === row.caseId); return { caseId: row.caseId, category: row.category, task: row.userInput, controlledEvidence: row.controlledEvidence, responseA: row.responseA, responseB: row.responseB, acceptanceCriteria: { expectedBehavior: spec?.expectedBehavior || null, automaticPattern: spec?.behaviorPattern || null, general: ['uses controlled evidence', 'does not invent business facts', 'calibrates uncertainty'] } }; }) },
];
const report = { schemaVersion: 'hugo-phase7-review-catalog-v1', blinded: true, humanReviewStatus: 'AWAITING_HUMAN_REVIEW', totalCases: groups.reduce((sum, group) => sum + group.cases.length, 0), groups };
fs.writeFileSync(path.join(__dirname, 'phase7-review-catalog.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ totalCases: report.totalCases, groups: groups.map(group => ({ phase: group.phase, cases: group.cases.length })) }));
