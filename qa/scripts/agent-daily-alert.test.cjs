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
  for (const part of ['2026-11-04', 'corte 20:00', 'Incidentes abiertos: 2', '75%', '8 de 10', '1.5 min', 'gemini: 7 llamadas', 'Sin cotización (2)', 'apagado']) assert(text.includes(part), part);
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
test('open-incidents-are-detailed-by-cause-and-type', () => {
  const data = base();
  data.incidents = [
    { status: 'OPEN', cause: 'REP_SIN_XML', entityType: 'paymentComplementJob' }, { status: 'OPEN', cause: 'REP_SIN_XML', entityType: 'paymentComplementJob' },
    { status: 'OPEN', cause: 'Sin cotización', entityType: 'solicitud' }, { status: 'RESOLVED', cause: 'Resuelta antes', entityType: 'solicitud' },
  ];
  const text = buildDailyAlertMessage(data);
  assert(text.includes('Incidentes abiertos: 3') && text.includes('REP_SIN_XML [paymentComplementJob] (2)') && text.includes('Sin cotización [solicitud]'));
  assert(!text.includes('Resuelta antes'), 'resolved incidents are not detailed');
});
test('incident-detail-is-capped', () => {
  const data = base();
  data.incidents = Array.from({ length: 9 }, (_, i) => ({ status: 'OPEN', cause: `causa ${i}`, entityType: 'solicitud' }));
  const text = buildDailyAlertMessage(data);
  assert(text.includes('y 4 tipos más') && !text.includes('causa 8'));
});
test('pending-items-are-reported-and-zero-or-unreadable-are-omitted', () => {
  const text = buildDailyAlertMessage(base(), { a: 1, b: 2 }, { complementsHeld: 4, complementsLate: 1, cashUnsigned: 0, cancellationReview: undefined });
  for (const part of ['Pagos sin solicitud: 1', 'Complementos de pago detenidos en IQ: 4', 'más de 5 días sin llegar: 1']) assert(text.includes(part), part);
  assert(!text.includes('efectivo') && !text.includes('cancelación en revisión'));
  const all = buildDailyAlertMessage(base(), undefined, { cashUnsigned: 2, cancellationReview: 3 });
  assert(all.includes('Dispersiones en efectivo sin recibo firmado: 2') && all.includes('Solicitudes con cancelación en revisión: 3'));
  assert(!buildDailyAlertMessage(base(), undefined, undefined).includes('Complementos'));
});
test('full-message-stays-under-limit-with-everything', () => {
  const data = base();
  data.incidents = Array.from({ length: 30 }, (_, i) => ({ status: 'OPEN', cause: 'y'.repeat(500) + i, entityType: 'z'.repeat(200) }));
  data.report.causes = Array.from({ length: 5 }, (_, i) => ({ cause: 'x'.repeat(2000), count: i }));
  const text = buildDailyAlertMessage(data, { a: 3, b: 4 }, { complementsHeld: 4, complementsLate: 1, cashUnsigned: 2, cancellationReview: 3 });
  assert(text.length <= 3900 && text.includes('Complementos de pago detenidos en IQ: 4'));
});
test('autonomy-without-data-reads-clearly', () => {
  const data = base(); data.report.autonomy = { ...data.report.autonomy, agentResolutionRate: null, resolvedByAgent: 0, resolvedByPerson: 0 };
  const text = buildDailyAlertMessage(data);
  assert(text.includes('Autonomía: sin datos (0 resueltas por agentes, 0 por personas)') && !text.includes('sin datos resuelto'));
});
console.log(JSON.stringify({ status: 'PASS', checks: cases.length, cases }));
