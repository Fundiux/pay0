const fs = require('node:fs'); const path = require('node:path');
const { validateStructuredCandidate } = require('../../../functions/lib/modules/agent007/hugoCore/claimValidation');
const source = require('../phase6/phase6-structured-response.json');
const structured = source.results.find(row => row.structured), candidate = JSON.parse(structured.response);
const scope = { evidenceIds: ['current_s61003'], entityFacts: [{ id: 'S61003', status: 'PENDIENTE' }], experienceIds: ['learning_duplicate-document'], allowedActions: [], rootAggregateComplete: false };
const original = validateStructuredCandidate(candidate, scope);
const withCanonicalAlias = validateStructuredCandidate(candidate, { ...scope, evidenceAliases: { 'solicitudes[0]': 'current_s61003' } });
const unknownAliasStillRejected = validateStructuredCandidate({ ...candidate, claims: [{ text: 'Dato inventado', evidenceIds: ['solicitudes[99]'] }] }, { ...scope, evidenceAliases: { 'solicitudes[0]': 'current_s61003' } });
const report = { schemaVersion: 'hugo-phase7-structured-reanalysis-v1', syntheticOnly: true, newProviderCalls: 0,
  diagnosis: ['CONTEXT_ID_MISMATCH', 'SCHEMA_ALLOWED_UNCONSTRAINED_EVIDENCE_STRING'], modelHallucinatedEvidenceId: false,
  explanation: 'solicitudes[0] was a real context location but not a canonical evidence ID. The validator now accepts only explicitly declared aliases and continues rejecting unknown aliases.',
  original, withCanonicalAlias, unknownAliasStillRejected, conclusion: 'MECHANICAL_ATTRIBUTION_IMPROVED_NOT_CLAIM_CORRECTNESS', productionStructuredOutputEnabled: false };
fs.writeFileSync(path.join(__dirname, 'phase7-structured-reanalysis.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
