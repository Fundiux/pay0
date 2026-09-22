const fs = require('node:fs'); const path = require('node:path');
const ablation = require('./phase7-ablation.json').results, tokens = require('./phase7-token-matrix.json').results, analysis = require('./phase7-analysis.json');
const avg = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const median = values => { const rows = values.filter(Number.isFinite).sort((a,b)=>a-b); return rows.length ? rows[Math.floor((rows.length-1)/2)] : null; };
const variants = [...new Set(ablation.map(row => row.variant))].map(variant => { const rows = ablation.filter(row => row.variant === variant); return { variant, cases: rows.length,
  behaviorPresent: rows.filter(row => row.behaviorPresent).length, providerErrors: rows.filter(row => row.modelError).length,
  averageContextChars: Math.round(avg(rows.map(row => row.contextChars))), averageInputTokens: Number(avg(rows.map(row => row.tokenUsage?.input).filter(Number.isFinite)).toFixed(1)),
  averageReasoningTokens: Number(avg(rows.map(row => row.tokenUsage?.reasoning).filter(Number.isFinite)).toFixed(1)) }; });
const compact = variants.find(row => row.variant === 'COMPACT'), full = variants.find(row => row.variant === 'FULL');
const tokenConfigs = [...new Set(tokens.map(row => row.id))].map(id => { const rows = tokens.filter(row => row.id === id); return { id, runs: rows.length, stop: rows.filter(row => row.finishReason === 'STOP').length,
  maxTokens: rows.filter(row => row.finishReason === 'MAX_TOKENS').length, providerErrors: rows.filter(row => row.error).length, behaviorPresent: rows.filter(row => row.behaviorPresent).length,
  medianInputTokens: median(rows.map(row => row.inputTokens)), medianReasoningTokens: median(rows.map(row => row.reasoningTokens)), medianLatencyMs: median(rows.map(row => row.latencyMs)), contextChars: rows[0].contextChars }; });
const report = { schemaVersion: 'hugo-phase7-experiment-summary-v1', ablation: { cases: 4, variants,
  interpretation: 'All no-effect cases already produced the expected behavior with NONE. Representation changes therefore could not create a beneficial behavioral difference in this set.',
  compactVsFull: { behavior: compact.behaviorPresent === full.behaviorPresent ? 'EQUIVALENT_ON_FOUR_CASES' : 'DIFFERENT',
    averageInputTokenReductionPercent: Number((100*(full.averageInputTokens-compact.averageInputTokens)/full.averageInputTokens).toFixed(1)),
    averageContextCharReductionPercent: Number((100*(full.averageContextChars-compact.averageContextChars)/full.averageContextChars).toFixed(1)) } },
  tokenInvestigation: { configs: tokenConfigs, controlledMatrixMaxTokens: tokenConfigs.reduce((sum,row)=>sum+row.maxTokens,0), fullFlowMaxTokens: analysis.tokenAndLatency.maxTokensIncidence,
    outcome: 'UNDERSTOOD_NOT_MITIGATED', explanation: 'Reasoning-token variability remains the observed immediate mechanism. All 18 matrix calls completed and bounded budgets retained the required behavior, but the unchanged production full-flow suite still had MAX_TOKENS failures. Wider quality validation is required before changing production.' } };
fs.writeFileSync(path.join(__dirname, 'phase7-experiment-summary.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ compression: report.ablation.compactVsFull, tokenOutcome: report.tokenInvestigation.outcome }));
