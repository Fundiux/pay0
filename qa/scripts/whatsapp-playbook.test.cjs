const assert = require('node:assert/strict');
const lib = '../../functions/lib/modules/whatsappAutoReply/';
const { proposeEntries, validateGuidance, suggestGuidance, signatureOf, proposalId, PROPOSAL_THRESHOLD } = require(lib + 'playbook.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

const lesson = (over = {}) => ({ type: 'MISSED_QUESTION', kind: 'STATUS_INQUIRY', subject: 'TRANSFER', category: null, phrase: 'ya salió mi transferencia?', reason: null, chatId: 'g1', groupName: 'Oil', ...over });
eq(PROPOSAL_THRESHOLD, 3);

// Three of the same kind in the same group make one proposal; two do not; other groups and kinds do not mix.
eq(proposeEntries('r', [lesson(), lesson()]).length, 0);
let [proposal] = proposeEntries('r', [lesson(), lesson({ phrase: 'hay avance?' }), lesson()]);
ok(proposal); eq(proposal.evidenceCount, 3); eq(proposal.chatId, 'g1'); eq(proposal.examples.length, 2, 'distinct examples only');
eq(proposal.id, proposalId('r', 'g1', signatureOf(lesson())));
eq(proposeEntries('r', [lesson(), lesson(), lesson({ chatId: 'g2' })]).length, 0, 'per group');
eq(proposeEntries('r', [lesson(), lesson(), lesson({ subject: 'INVOICE' })]).length, 0, 'per subject');
eq(proposeEntries('r', [...Array(3).fill(0).map(() => lesson()), ...Array(3).fill(0).map(() => lesson({ chatId: 'g2', groupName: 'Otro' }))]).length, 2);
[proposal] = proposeEntries('r', Array(3).fill(0).map(() => lesson({ type: 'CORRECTION', kind: 'PROCESSING', subject: null, category: 'WRONG_FACT', phrase: null, reason: 'dijo que estaba en proceso' })));
eq(proposal.examples, ['dijo que estaba en proceso']);
ok(validateGuidance(proposal.suggestedGuidance) === null, 'suggestions pass the validator');
for (const [type, kind, subject, category] of [['MISSED_QUESTION', 'STATUS_INQUIRY', 'TRANSFER', null], ['MISSED_QUESTION', 'STATUS_INQUIRY', 'INVOICE', null], ['MISSED_QUESTION', 'QUESTION', null, null], ...['WRONG_FACT', 'TONE', 'NOT_NEEDED', 'TOO_LATE', 'OTHER'].map(c => ['CORRECTION', 'PROCESSING', null, c])])
  ok(validateGuidance(suggestGuidance(type, kind, subject, category)) === null, `${type} ${category || subject} suggestion is valid`);

// Guardrails: no numbers while the calculator does not exist, nothing internal, no third-party validation, no promises.
ok(validateGuidance('Responder con amabilidad y avisar al equipo.') === null);
for (const bad of ['corto', 'x'.repeat(401), 'Decir que son $540,000 de retorno', 'Informar que el honorario es de 7 por ciento 7%', 'Responder en 2 horas', 'Mencionar que es de PAY0 al cliente',
  'Decir que lo validamos con IQ primero', 'Avisar que el despacho lo revisa', 'Decir que lo consultamos con alguien más para confirmar', 'Prometemos entregarlo hoy mismo al cliente', 'Citar el folio interno al cliente', 'Decir que lo valida un tercero antes'])
  ok(typeof validateGuidance(bad) === 'string', `rejects: ${bad}`);

console.log(`whatsapp-playbook: ${checks} checks passed`);
