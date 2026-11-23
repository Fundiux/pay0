const assert = require('node:assert/strict');
const lib = '../../functions/lib/modules/whatsappAutoReply/';
const { guardDraft, buildDraftPrompt, findSimulationCandidates, simulatedReplyId, DRAFT_MAX, SIM_DAILY_CAP_PER_GROUP, DRAFT_SYSTEM } = require(lib + 'simulation.js');
const { validateGuidance } = require(lib + 'playbook.js');
const { OWNER_WORKING_HOURS } = require(lib + 'domain.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

// Guardrails: the same hard rules as the owner's guidance, plus facts only from the system.
ok(guardDraft('Con gusto, permítanos validarlo y le confirmamos en cuanto lo tengamos.', 'UNKNOWN').ok);
ok(guardDraft('Gracias por avisarnos. Su transferencia se encuentra en proceso.', 'FOUND').ok, 'progress is allowed when the system confirmed it');
const bad = (text, lookup, why) => { const r = guardDraft(text, lookup); ok(!r.ok && r.reasons.length > 0, why || `rejects: ${text}`); };
bad('Su transferencia se encuentra en proceso.', 'UNKNOWN', 'progress without confirmation');
bad('Su transferencia se encuentra en proceso.', 'NOT_FOUND');
bad('Ya está listo su pago, gracias.', 'UNKNOWN');
bad('Le depositamos 5,000 pesos el día de hoy.', 'FOUND');
bad('Son $540,000 de retorno.', 'FOUND');
bad('El honorario es del 7% del total.', 'FOUND');
bad('Lo validamos con IQ y le avisamos.', 'FOUND');
bad('Estamos validando con otra empresa su transferencia.', 'FOUND');
bad('Su folio interno ya salió.', 'FOUND');
bad('PAY0 ya lo está revisando para usted.', 'FOUND');
bad('Se lo mandamos hoy mismo, se lo prometemos.', 'FOUND');
bad('Lo tendrá mañana sin falta, por favor espere.', 'FOUND');
bad('Revise https://ejemplo.com para más detalle.', 'FOUND');
bad('Escríbame por whatsapp para ayudarle.', 'FOUND');
bad('ok', 'FOUND', 'too short');
bad('a'.repeat(DRAFT_MAX + 1), 'FOUND', 'too long');
eq(validateGuidance('Responder con amabilidad y avisar al equipo.'), null, 'owner guidance still validates');

// The prompt: guidance, a masked message and one fact. No digits, names, group or other clients.
const prompt = buildDraftPrompt(['Responder con amabilidad.'], 'Hola, soy Juan Pérez, mi pago de $45,000 folio 12345 ya salió?', 'NOT_FOUND');
ok(prompt.includes('Responder con amabilidad.') && prompt.includes('no encontró'));
ok(!/\d/.test(prompt) && !/juan|pérez/i.test(prompt), 'masked');
ok(!/pay0|despacho|\biq\b/i.test(DRAFT_SYSTEM.replace(/no menciones[^.]*\./i, '')), 'system prompt names nothing internal as a topic');

// Candidates: acting group with a running playbook, past the human wait, fresh, unanswered, inside hours.
const NOW = Date.UTC(2026, 10, 24, 18, 0), MIN = 60000;
const row = (id, over = {}) => ({ id, chatId: 'g1', authorHash: 'client', fromMe: false, timestampMs: NOW - 5 * MIN, type: 'chat', body: '¿Ya salió mi transferencia?', ...over });
const base = { simulatedChats: new Set(['g1']), operatorHashes: new Set(['op']), handledIds: new Set(), knownIds: new Set(), nowMs: NOW, workingHours: OWNER_WORKING_HOURS };
const find = (messages, over = {}) => findSimulationCandidates({ ...base, messages, ...over });
eq(find([row('a')]).length, 1);
eq(find([row('a', { timestampMs: NOW - 2 * MIN })]).length, 0, 'inside the human wait');
eq(find([row('a', { timestampMs: NOW - 31 * MIN })]).length, 0, 'too old');
eq(find([row('a')], { handledIds: new Set(['a']) }).length, 0, 'already answered for real');
eq(find([row('a')], { knownIds: new Set(['a']) }).length, 0, 'already simulated');
eq(find([row('a'), row('b', { authorHash: 'op', timestampMs: NOW - 4 * MIN })]).length, 0, 'a person answered');
eq(find([row('a', { authorHash: 'op' })]).length, 0);
eq(find([row('a', { body: 'Gracias, ya quedó' })]).length, 0);
eq(find([row('a')], { simulatedChats: new Set() }).length, 0);
eq(find([row('a', { timestampMs: Date.UTC(2026, 10, 24, 5, 0) })], { nowMs: Date.UTC(2026, 10, 24, 5, 10) }).length, 0, 'off hours');
eq(simulatedReplyId('r', 'm'), simulatedReplyId('r', 'm'));
eq(SIM_DAILY_CAP_PER_GROUP, 10);

console.log(`whatsapp-simulation: ${checks} checks passed`);
