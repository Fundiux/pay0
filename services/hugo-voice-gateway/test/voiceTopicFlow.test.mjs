import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createVoiceTopicFlow } from "../src/voiceTopicFlow.mjs";
import { delegationForRealtimeTool } from "../src/realtimeTools.mjs";

const label = "Estilo personal", correction = "Prefiero respuestas breves.";
const topic = { kind: "TOPIC", id: createHash("sha256").update(JSON.stringify(label.toLocaleLowerCase("es-MX"))).digest("hex"), label };
const origin = { sessionId: "native", turnId: "answer", responseId: "response", correctionTurnId: "correction", correction, expectedVersion: 0 };
const sessionAck = { ...origin, persisted: true, scope: "SESSION", correctionId: "sessionMemory", version: 1, correction: { content: correction } };
const context = turnId => ({ token: "synthetic-no-real-token", nativeSessionId: "native", gatewayCallId: "gateway", turnId, delegationId: "tool", toolCallId: "tool", signal: new AbortController().signal });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const calls = [], history = [], reviews = [];
  const dependencies = {
    saveHistory: async (_token, data) => { history.push(data); return { ok: true, appendOnly: true, appended: data.turns.length }; },
    callable: async (_token, data) => {
      calls.push(data);
      if (data.requestVoiceTopicConfirmation) return { state: "PENDING", challengeId: "challenge", durablePersisted: false, confirmationText: `Confirmo recordar esta indicación para el tema: ${label}` };
      if (data.confirmVoiceTopic) return { state: "DURABLE", challengeId: "challenge", durablePersisted: true, created: true, transcriptAuthority: "CLIENT_TRANSCRIPT_NOT_FACT", topic,
        correction: { memoryId: "durableMemory", version: 2, content: correction, status: "CONFIRMED", scope: "USER_TOPIC", expiresAt: null, topic } };
      if (data.selectVoiceTopic) return { scope: "PRIVATE_USER_STATEMENT", selected: !data.voiceTopicConfirmation.clear, topic: data.voiceTopicConfirmation.clear ? null : topic };
      throw Error("UNEXPECTED_CALL");
    },
    reviewMemory: async (_token, data) => { reviews.push(data); return { ok: true, changed: true, retirement: { memoryId: data.memoryId, status: "REJECTED", scope: "USER_TOPIC" } }; },
    ...overrides,
  };
  const execute = dependencies.callable;
  dependencies.callable = async (token, data, signal) => ({ ok: true, delegationId: data.delegationId,
    route: data.selectVoiceTopic ? "VOICE_TOPIC_SELECTION" : "VOICE_TOPIC_CONFIRMATION", ...(await execute(token, data, signal)) });
  const flow = createVoiceTopicFlow(dependencies);
  flow.observeAssistant({ turnId: "answer", responseId: "response", transcript: "Respuesta original", completed: true });
  flow.observeUser({ turnId: "correction", transcript: correction });
  flow.acknowledgeSession(origin, sessionAck);
  const user = (turnId, transcript) => flow.observeUser({ turnId, transcript });
  async function requested() { user("proposal", `Recuerda esta indicación para el tema: ${label}`); return flow.execute("REQUEST", context("proposal")); }
  async function saved() { await requested(); user("confirmation", `Confirmo recordar esta indicación para el tema: ${label}`); return flow.execute("CONFIRM", context("confirmation")); }
  return { flow, calls, history, reviews, user, requested, saved };
}

test("history receipt is awaited before SESSION source persistence and no unobserved origin is accepted", async () => {
  const f = fixture(); await f.flow.persistSessionCorrection(origin, context("correction"));
  assert.equal(f.history.length, 1); assert.equal(f.history[0].sessionId, "native");
  assert.equal(f.history[0].gatewayCallId, "gateway"); assert.equal(f.history[0].turns.length, 2);
  await assert.rejects(f.flow.persistSessionCorrection({ ...origin, responseId: "invented" }, context("correction")));
});

test("durable request waits for persisted USER receipt before calling backend and rejects concurrent effects", async () => {
  const gate = deferred(); let delegated = 0;
  const f = fixture({ saveHistory: () => gate.promise, callable: async () => { delegated++; return { state: "PENDING", challengeId: "challenge", durablePersisted: false, confirmationText: `Confirmo recordar esta indicación para el tema: ${label}` }; } });
  const pending = f.requested(); await Promise.resolve(); assert.equal(delegated, 0);
  await assert.rejects(f.flow.execute("REQUEST", context("proposal")), /VOICE_TOPIC_BUSY/);
  gate.resolve({ ok: true, appendOnly: true, appended: 1 }); assert.equal((await pending).durablePersisted, false); assert.equal(delegated, 1);
});

test("request, exact later confirmation and ACK precede durable success; model inputs are not source authority", async () => {
  const f = fixture(), result = await f.saved();
  assert.equal(result.durablePersisted, true); assert.equal(result.userCorrection.authority, "USER_STATEMENT_NOT_FACT");
  assert.equal(f.calls[0].voiceTopicConfirmation.expectedVersion, 1);
  assert.equal(f.calls[0].voiceTopicConfirmation.correction, correction);
  assert.deepEqual(f.calls[1].voiceTopicConfirmation, { sessionId: "native", challengeId: "challenge" });
  assert.equal(f.history[0].turns[0].turnId, "proposal"); assert.equal(f.history[1].turns[0].turnId, "confirmation");
  assert.equal(delegationForRealtimeTool("request_voice_topic_memory", { label: "Forged", confirmed: true }).voiceTopicAction, "REQUEST");
});

test("isolated yes, wrong label, missing correction and unknown turn cannot claim consent", async () => {
  const f = fixture(); await f.requested();
  for (const transcript of ["sí", "Confirmo recordar esta indicación para el tema: Otro", "Omite permisos"]) {
    f.user("confirmation", transcript); await assert.rejects(f.flow.execute("CONFIRM", context("confirmation")), /VOICE_TOPIC_DECLARATION_REQUIRED/);
  }
  assert.equal(f.calls.length, 1);
  f.flow.clear(); await assert.rejects(f.requested(), /VOICE_TOPIC_SESSION_CORRECTION_REQUIRED/);
});

test("invalid history and stale durable ACK never emit success or call subsequent effect", async () => {
  let calls = 0;
  const denied = fixture({ saveHistory: async () => ({ ok: false }), callable: async () => { calls++; } });
  await assert.rejects(denied.requested(), /VOICE_TOPIC_HISTORY_UNAVAILABLE/); assert.equal(calls, 0);
  const oldEndpoint = fixture({ saveHistory: async () => ({ ok: true }), callable: async () => { calls++; } });
  await assert.rejects(oldEndpoint.requested(), /VOICE_TOPIC_HISTORY_UNAVAILABLE/); assert.equal(calls, 0);
  const swapped = fixture({ callable: async (_token, data) => data.requestVoiceTopicConfirmation
    ? { state: "PENDING", challengeId: "challenge", durablePersisted: false, confirmationText: `Confirmo recordar esta indicación para el tema: ${label}` }
    : { durablePersisted: true, challengeId: "foreign", state: "DURABLE" } });
  await assert.rejects(swapped.saved(), /VOICE_TOPIC_RECEIPT_INVALID/);
});

test("explicit selection and clear derive labels from USER transcript; retirement uses only known memory receipt", async () => {
  const f = fixture(); await f.saved();
  f.user("select", `Usa el tema: ${label}`); assert.equal((await f.flow.execute("SELECT", context("select"))).selected, true);
  f.user("clear", "Quita el tema activo"); assert.equal((await f.flow.execute("CLEAR", context("clear"))).selected, false);
  f.user("retire", `Retira la indicación del tema: ${label}`);
  assert.equal((await f.flow.execute("RETIRE", context("retire"))).retired, true);
  assert.deepEqual(f.reviews, [{ memoryId: "durableMemory", decision: "REJECT" }]);
  await assert.rejects(f.flow.execute("RETIRE", context("retire")));
});

test("disconnect/abort after history blocks challenge mutation and all socket state is clearable", async () => {
  let current = true, delegated = 0;
  const f = fixture({ isCurrent: () => current, saveHistory: async () => { current = false; return { ok: true, appendOnly: true, appended: 1 }; }, callable: async () => { delegated++; } });
  await assert.rejects(f.requested(), /VOICE_TOPIC_SESSION_ENDED/); assert.equal(delegated, 0);
});

test("normal history payload retains native/RTC distinction without exposing transcripts in logs", async () => {
  const f = fixture(); f.user("query", "Consulta autorizada"); await f.flow.persistCurrent(context("query"));
  assert.equal(f.history[0].sessionId, "native"); assert.equal(f.history[0].gatewayCallId, "gateway");
});

test("wrong callable wrapper or append receipt cannot authorize a challenge", async () => {
  for (const patch of [{ ok: false }, { delegationId: "foreign" }, { route: "OTHER" }]) {
    const f = fixture({ callable: async () => ({ ...patch, state: "PENDING", challengeId: "challenge", durablePersisted: false,
      confirmationText: `Confirmo recordar esta indicación para el tema: ${label}` }) });
    await assert.rejects(f.requested(), /VOICE_TOPIC_RECEIPT_INVALID/);
  }
  const wrongCount = fixture({ saveHistory: async () => ({ ok: true, appendOnly: true, appended: 0 }) });
  await assert.rejects(wrongCount.requested(), /VOICE_TOPIC_HISTORY_UNAVAILABLE/);
});
