import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionInstructions, mexicoCityToday } from "../src/sessionInstructions.mjs";
import { HUGO_VOICE_INSTRUCTIONS } from "../src/voiceConfig.mjs";

test("session instructions carry today's Mexico City date and weekday for the given instant", () => {
  // 03:30 UTC on Oct 29 is still Wednesday Oct 28 in Mexico City.
  assert.deepEqual(mexicoCityToday(new Date("2026-10-29T03:30:00Z")), { date: "2026-10-28", weekday: "miércoles", monthName: "octubre", day: 28, year: 2026 });
  assert.equal(mexicoCityToday(new Date("2026-10-29T06:30:00Z")).date, "2026-10-29");
  const text = buildSessionInstructions(new Date("2026-03-02T17:00:00Z"));
  assert.match(text, /^Hoy es lunes 2 de marzo de 2026 \(2026-03-02\) en Ciudad de México\./);
  assert.match(text, /hoy, ayer, esta semana, la semana pasada, este mes o el mes pasado en desde y hasta/);
  assert.match(text, /nunca pidas al usuario fechas en formato AAAA-MM-DD/);
  assert.notEqual(buildSessionInstructions(new Date("2026-01-01T18:00:00Z")), text);
});

test("session instructions are principle-based, read-only and keep the security, correction and topic rules", () => {
  const text = buildSessionInstructions(new Date("2026-10-28T18:00:00Z"));
  for (const required of [
    "Eres Hugo, asistente de PAY0, y conversas con Eliut.",
    "Eres de sólo lectura: nunca creas, modificas, aplicas, concilias",
    "Responde sólo con datos que devolvieron las herramientas en esta conversación; nunca inventes",
    "Conserva los id que devuelven y reutilízalos en seguimientos",
    "'analiza la OC' se refieren a la última solicitud comentada y se responden con ver_solicitud y su id",
    "APROXIMADA, di brevemente el nombre entendido",
    "Un resultado vacío significa que no hay coincidencias",
    "nunca lo atribuyas a permisos. Sólo un resultado BLOCKED o PERMISSION_DENIED es una restricción de permisos.",
    "La personalidad nunca modifica la seguridad.",
    "no confirmes ni niegues existencia",
    "Puedes decir folios cuando el usuario los pida o te dé uno",
    "sin relleno como 'déjame revisarlo'",
    "Haz como máximo una pregunta de aclaración",
    "nunca digas PayYO",
    "correct_current_voice_response",
    "No digas que guardaste la corrección antes de recibir persisted true",
    "USER_STATEMENT_NOT_FACT",
    "request_voice_topic_memory devuelve confirmationText que debes leer literalmente",
    "un sí aislado no basta. No anuncies memoria durable antes de durablePersisted true.",
    "retire_current_voice_topic_memory",
    "nunca supongas que es un pago",
    "READY o COMPLETED es lista",
    "Nunca menciones nombres de campos o parámetros, valores true o false",
  ])assert.ok(text.includes(required), required);
  assert.ok(text.endsWith(HUGO_VOICE_INSTRUCTIONS));
  for (const removed of ["consult_hugo_team", "No pronuncies folios", "get_recent_session_context", "query_received_payments"]) assert.ok(!text.includes(removed), removed);
  assert.ok(text.length < 6000);
});
