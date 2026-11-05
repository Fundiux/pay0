const assert = require('node:assert/strict');
const { buildDailyAlertMessage } = require('../../functions/lib/modules/agentOperations/dailyAlert.js');

const base = () => ({
  killSwitch: false,
  incidents: [{ status: 'OPEN' }, { status: 'RESOLVED' }, { status: 'OPEN' }],
  report: {
    day: '2026-11-04', reviewed: 10, detected: 4, corrected: 3, escalated: 1, retryable: 0,
    causes: [{ cause: 'Sin cotización', count: 2 }],
    tokens: [{ provider: 'gemini', requests: 7, input: 1, output: 1, reasoning: 0 }],
    autonomy: { resolvedByAgent: 3, resolvedByPerson: 1, agentResolutionRate: 75, runsSucceeded: 8, runsFinished: 10, avgRunMs: 90000, humanInterventionsToday: 2 },
  },
});

const cases = [];
const test = (name, fn) => { fn(); cases.push(name); };

test('summary-includes-counts-autonomy-and-providers', () => {
  const text = buildDailyAlertMessage(base());
  for (const part of ['2026-11-04', 'Incidentes abiertos: 2', '75%', '8 de 10', '1.5 min', 'gemini: 7 llamadas', 'Sin cotización (2)', 'apagado']) assert(text.includes(part), part);
});
test('kill-switch-is-flagged', () => {
  assert(buildDailyAlertMessage({ ...base(), killSwitch: true }).includes('ACTIVADO'));
});
test('works-against-reports-without-autonomy-or-tokens', () => {
  const data = base(); delete data.report.autonomy; delete data.report.tokens;
  const text = buildDailyAlertMessage(data);
  assert(text.includes('sin llamadas a IA') && !text.includes('Autonomía'));
});
test('message-stays-under-telegram-limit', () => {
  const data = base(); data.report.causes = Array.from({ length: 5 }, (_, i) => ({ cause: 'x'.repeat(2000), count: i }));
  assert(buildDailyAlertMessage(data).length <= 3900);
});
console.log(JSON.stringify({ status: 'PASS', checks: cases.length, cases }));
