import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachGatewayConnection, boundToolData, ConnectionState, classifyRequestError, MAX_TOOL_DATA_BYTES, safeToolFailure, safeVoiceToolFailureOutput } from "../src/gatewayConnection.mjs";
import { createHash } from "node:crypto";

const TOKEN = "test-token-never-log-this", UID = "configured-canary-user", ROOT = "configured-root";
const auth = { type: "authenticate", idToken: TOKEN };
const offer = { type: "offer", sdp: "v=0\r\no=simulated-offer\r\n" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test("tool failures expose only the stable operational taxonomy", () => {
  const tooLong = safeToolFailure(Error("VOICE_CORRECTION_TOO_LONG"));
  assert.equal(tooLong.retryable, false);
  assert.match(safeVoiceToolFailureOutput(tooLong).text, /1.000 caracteres/);
  assert.match(safeVoiceToolFailureOutput(safeToolFailure(Error("VOICE_CORRECTION_NOT_PERSISTED"))).text, /No pude confirmar/);
  assert.deepEqual(safeToolFailure(Object.assign(Error("secret"), { code: "permission-denied" })), { errorCategory: "PERMISSION_DENIED", errorCode: "PERMISSION_DENIED", retryable: false });
  assert.deepEqual(safeToolFailure(Error("DEADLINE_EXCEEDED")), { errorCategory: "TIMEOUT", errorCode: "DEADLINE_EXCEEDED", retryable: true });
  assert.deepEqual(safeToolFailure(Error("UNAVAILABLE")), { errorCategory: "CONNECTOR_ERROR", errorCode: "UNAVAILABLE", retryable: true });
  assert.deepEqual(safeToolFailure(Error("sensitive backend detail")), { errorCategory: "INTERNAL", errorCode: "GATEWAY_REQUEST_FAILED", retryable: true });
});

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  closes = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code = 1000, reason = "") { this.closes.push({ code, reason }); this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
  receive(event) { return this.raw(JSON.stringify(event)); }
  raw(value) { return Promise.all(this.listeners("message").map(listener => listener(Buffer.from(value)))); }
}

function harness(overrides = {}) {
  const browser = new Socket(), logs = [], counts = { realtime: 0, authorize: 0, verify: 0, delegate: 0 }, sidebands = [], signals = {};
  const dependencies = {
    verifyIdToken: async (token, revoked) => { counts.verify += 1; assert.equal(token, TOKEN); assert.equal(revoked, true); return { uid: UID }; },
    authorize: async (token, signal) => { counts.authorize += 1; signals.authorize = signal; assert.equal(token, TOKEN); return { ok: true, uid: UID, rootId: ROOT, role: "superadmin" }; },
    canaryUids: new Set([UID]),
    openRealtime: async (sdp, signal) => { counts.realtime += 1; signals.realtime = signal; assert.equal(sdp, offer.sdp); return { callId: "simulated-call", answer: "simulated-answer" }; },
    createSideband: () => { const socket = new Socket(); socket.readyState = 0; sidebands.push(socket); queueMicrotask(() => { socket.readyState = 1; socket.emit("open"); }); return socket; },
    callable: async () => { counts.delegate += 1; return { route: "DETERMINISTIC_TOOL", text: "Simulated authorized result", sourceSystem: "PAY0" }; },
    log: (type, detail) => logs.push({ type, ...detail }), model: "unchanged-model", voice: "unchanged-voice", authenticationTimeoutMs: 50, sidebandTimeoutMs: 50,
    ...overrides,
  };
  // Wrapping also counts failing/in-flight provider mocks; no test uses a network API.
  if (overrides.openRealtime) dependencies.openRealtime = (...args) => { counts.realtime += 1; return overrides.openRealtime(...args); };
  const connection = attachGatewayConnection(browser, dependencies);
  return { browser, logs, counts, connection, sidebands, signals };
}

function assertCleared(h, expectedRealtime = 0) {
  const snapshot = h.connection.inspect();
  assert.equal(snapshot.state, ConnectionState.CLOSED);
  for (const key of ["hasAuthorizedContext", "hasToken", "hasPendingAuthentication", "hasSession", "hasSideband", "immutableContext"]) assert.equal(snapshot[key], false, key);
  assert.equal(snapshot.pendingTools, 0);
  assert.equal(snapshot.realtimeCreationAttempts, expectedRealtime);
  assert.equal(h.counts.realtime, expectedRealtime);
}

async function correctionTurn(h) {
  await h.browser.receive(auth); await h.browser.receive(offer);
  const sideband = h.sidebands[0];
  await sideband.receive({ type: "session.created", session: { id: "sess1" } });
  await sideband.receive({ type: "conversation.item.created", item: { id: "turn1", type: "message", role: "user" } });
  await sideband.receive({ type: "response.created", response: { id: "response1" } });
  await sideband.receive({ type: "response.output_audio_transcript.done", response_id: "response1", transcript: "Respuesta anterior" });
  await sideband.receive({ type: "response.done", response: { id: "response1", status: "completed", output: [] } });
  await sideband.receive({ type: "conversation.item.created", item: { id: "turn2", type: "message", role: "user" } });
  await sideband.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "turn2", transcript: "Prefiero el periodo antes del total." });
  await sideband.receive({ type: "response.created", response: { id: "response2" } });
  return sideband;
}

test("gateway real flow waits for history, preserves native session, and never announces durable memory before valid ACK", async () => {
  const historyGate = deferred(), order = [], label = "Estilo personal", correction = "Prefiero el periodo antes del total.";
  const topic = { kind: "TOPIC", id: createHash("sha256").update(JSON.stringify(label.toLocaleLowerCase("es-MX"))).digest("hex"), label };
  let histories = 0, query;
  const h = harness({
    saveHistory: async (_token, input) => { order.push("history"); assert.equal(input.sessionId, "sess1"); assert.equal(input.gatewayCallId, "simulated-call"); histories++;
      return histories === 1 ? historyGate.promise : { ok: true, appendOnly: true, appended: input.turns.length }; },
    callable: async (_token, input) => {
      order.push("delegate");
      if (input.recordResponseCorrection) return { ...input.responseCorrection, persisted: true, scope: "SESSION", correctionId: "session_memory", version: 1,
        correction: { content: correction }, route: "SESSION_CORRECTION", text: "Corrección de sesión guardada" };
      if (input.requestVoiceTopicConfirmation) return { ok: true, delegationId: input.delegationId, route: "VOICE_TOPIC_CONFIRMATION", state: "PENDING", challengeId: "challenge", durablePersisted: false, confirmationText: `Confirmo recordar esta indicación para el tema: ${label}` };
      if (input.confirmVoiceTopic) return { ok: true, delegationId: input.delegationId, route: "VOICE_TOPIC_CONFIRMATION", state: "DURABLE", challengeId: "challenge", durablePersisted: true, created: true, transcriptAuthority: "CLIENT_TRANSCRIPT_NOT_FACT", topic,
        correction: { memoryId: "durable_memory", version: 2, content: correction, status: "CONFIRMED", scope: "USER_TOPIC", expiresAt: null, topic } };
      query = input; return { route: "BRAIN_MODEL", text: "Resultado autorizado" };
    },
  });
  const sideband = await correctionTurn(h);
  const first = sideband.receive({ type: "response.function_call_arguments.done", name: "correct_current_voice_response", call_id: "session_tool", response_id: "response2", arguments: "{}" });
  await flush(); assert.deepEqual(order, ["history"]); historyGate.resolve({ ok: true, appendOnly: true, appended: 2 }); await first;
  async function tool(turn, transcript, name, callId) {
    await sideband.receive({ type: "conversation.item.created", item: { id: turn, type: "message", role: "user" } });
    await sideband.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: turn, transcript });
    await sideband.receive({ type: "response.function_call_arguments.done", name, call_id: callId, response_id: "response2", arguments: JSON.stringify({ confirmed: true, label: "forged" }) });
  }
  await tool("proposal", `Recuerda esta indicación para el tema: ${label}`, "request_voice_topic_memory", "request_tool");
  const pending = JSON.parse(sideband.sent.filter(e => e.type === "conversation.item.create").at(-1).item.output);
  assert.equal(pending.durablePersisted, false); assert.match(pending.text, /^Confirmo recordar/);
  await tool("confirmation", `Confirmo recordar esta indicación para el tema: ${label}`, "confirm_voice_topic_memory", "confirm_tool");
  const saved = JSON.parse(sideband.sent.filter(e => e.type === "conversation.item.create").at(-1).item.output);
  assert.equal(saved.durablePersisted, true); assert.equal(saved.userCorrection.authority, "USER_STATEMENT_NOT_FACT");
  await tool("query", "Responde usando mi tema", "delegate_to_hugo_core", "query_tool");
  assert.equal(query.nativeSessionId, "sess1"); assert.equal(query.sessionId, "simulated-call");
  assert(!JSON.stringify(h.logs).includes(correction)); assert(!JSON.stringify(h.logs).includes(label));
  h.browser.close();
});

test("voice correction confirms only after matching persisted ACK in the same session", async () => {
  const pending = deferred(); let sent;
  const h = harness({ callable: async (_token, input) => { sent = input; return pending.promise; } });
  const sideband = await correctionTurn(h);
  const running = sideband.receive({ type: "response.function_call_arguments.done", name: "correct_current_voice_response", call_id: "correction_tool", response_id: "response2", arguments: JSON.stringify({ sessionId: "foreign", correction: "invented", rootId: "foreign" }) });
  await flush();
  assert.equal(sideband.sent.filter(event => event.type === "conversation.item.create").length, 0);
  assert.equal(sent.responseCorrection.sessionId, "sess1");
  assert.equal(sent.responseCorrection.responseId, "response1");
  assert.equal(sent.responseCorrection.correction, "Prefiero el periodo antes del total.");
  pending.resolve({ ...sent.responseCorrection, persisted: true, scope: "SESSION", correctionId: "correction1", version: 1,
    correction: { content: sent.responseCorrection.correction }, route: "SESSION_CORRECTION", text: "Guardé tu corrección para esta sesión." });
  await running;
  const output = JSON.parse(sideband.sent.find(event => event.type === "conversation.item.create").item.output);
  assert.equal(output.persisted, true);
  assert.equal(output.userCorrection.authority, "USER_STATEMENT_NOT_FACT");
  assert.equal(output.userCorrection.content, sent.responseCorrection.correction);
  assert(!JSON.stringify(h.logs).includes(sent.responseCorrection.correction));
  await sideband.receive({ type: "response.done", response: { id: "response2", status: "completed", output: [{ type: "function_call", call_id: "correction_tool" }] } });
  assert.equal(sideband.sent.filter(event => event.type === "response.create").length, 1);
  h.browser.close();
});

test("stale voice correction ACK cannot emit a persisted success", async () => {
  const h = harness({ callable: async (_token, input) => ({ ...input.responseCorrection, correctionId: "correction1", version: 2,
    correction: { content: input.responseCorrection.correction }, persisted: true, scope: "SESSION", text: "Guardado" }) });
  const sideband = await correctionTurn(h);
  await sideband.receive({ type: "response.function_call_arguments.done", name: "correct_current_voice_response", call_id: "correction_tool", response_id: "response2", arguments: "{}" });
  const outputs = sideband.sent.filter(event => event.type === "conversation.item.create").map(event => JSON.parse(event.item.output));
  assert.equal(outputs.length, 1);
  assert(outputs.every(output => output.persisted !== true && !output.userCorrection));
  assert(!h.logs.some(event => event.type === "gateway.tool_completed"));
  h.browser.close();
});

async function assertRejectedThenCannotRecover(h) {
  await h.browser.receive(offer);
  await h.browser.receive(auth);
  await h.browser.receive(offer);
  assertCleared(h);
  assert.equal(h.browser.closes[0].code, 1008);
  assert.equal(h.logs.filter(item => item.type === "gateway.realtime_create_attempt").length, 0);
  assert.equal(h.logs.find(item => item.type === "gateway.request_rejected").realtimeCreationAttempts, 0);
}

test("invalid Firebase token: zero Realtime, cleared context, terminal policy close", async () => {
  const h = harness({ verifyIdToken: async () => { throw Object.assign(Error(`sensitive ${TOKEN}`), { code: "auth/argument-error" }); } });
  await h.browser.receive(auth);
  await assertRejectedThenCannotRecover(h);
});

test("missing token: zero verification, authorization and Realtime", async () => {
  const h = harness();
  await h.browser.receive({ type: "authenticate" });
  await assertRejectedThenCannotRecover(h);
  assert.equal(h.counts.verify, 0); assert.equal(h.counts.authorize, 0);
});

test("valid token outside configured allowlist: zero authorization and Realtime", async () => {
  const h = harness({ canaryUids: new Set(["another-configured-user"]) });
  await h.browser.receive(auth);
  await assertRejectedThenCannotRecover(h);
  assert.equal(h.counts.authorize, 0);
  assert.deepEqual(Object.fromEntries(Object.entries(h.logs.find(item => item.type === "gateway.authorization_blocked")).filter(([key]) => !["type", "gatewaySessionId"].includes(key))), { restrictionType: "CANONICAL_AUTHORIZATION", tool: "VOICE_SESSION", reason: "CANARY_NOT_ALLOWED", sensitiveResourceStored: false });
});

test("empty allowlist fails closed: zero Realtime", async () => {
  const h = harness({ canaryUids: new Set() });
  await h.browser.receive(auth);
  await assertRejectedThenCannotRecover(h);
});

for (const code of ["PERMISSION_DENIED", "UNAVAILABLE"]) {
  test(`backend ${code}: zero Realtime and no rehabilitation`, async () => {
    const h = harness({ authorize: async () => { throw Error(code); } });
    await h.browser.receive(auth);
    await assertRejectedThenCannotRecover(h);
  });
}

test("authorization timeout aborts request, clears context, ignores late approval: zero Realtime", async () => {
  const approval = deferred(); let signal;
  const h = harness({ authorize: (_token, currentSignal) => { signal = currentSignal; return approval.promise; }, authenticationTimeoutMs: 15 });
  await h.browser.receive(auth);
  assert.equal(signal.aborted, true);
  approval.resolve({ ok: true, uid: UID, rootId: ROOT, role: "superadmin" });
  await flush(); await assertRejectedThenCannotRecover(h);
});

test("token verification timeout ignores later decoded identity: zero Realtime", async () => {
  const verification = deferred();
  const h = harness({ verifyIdToken: () => verification.promise, authenticationTimeoutMs: 15 });
  await h.browser.receive(auth);
  verification.resolve({ uid: UID });
  await flush(); await assertRejectedThenCannotRecover(h);
  assert.equal(h.counts.authorize, 0);
});

test("offer before auth is terminal: zero Realtime", async () => { await assertRejectedThenCannotRecover(harness()); });

test("offer during token verification: zero Realtime and no late authorization", async () => {
  const verification = deferred(), h = harness({ verifyIdToken: () => verification.promise });
  const authenticating = h.browser.receive(auth); await flush();
  assert.equal(h.connection.inspect().state, ConnectionState.AUTHENTICATING);
  assert.equal(h.connection.inspect().hasToken, false); assert.equal(h.connection.inspect().hasAuthorizedContext, false);
  await h.browser.receive(offer);
  verification.resolve({ uid: UID }); await authenticating;
  await assertRejectedThenCannotRecover(h);
  assert.equal(h.counts.authorize, 0);
});

test("offer during backend authorization: zero Realtime and backend request aborted", async () => {
  const approval = deferred(); let signal;
  const h = harness({ authorize: (_token, currentSignal) => { signal = currentSignal; return approval.promise; } });
  const authenticating = h.browser.receive(auth); await flush();
  await h.browser.receive(offer);
  assert.equal(signal.aborted, true);
  approval.resolve({ ok: true, uid: UID, rootId: ROOT, role: "superadmin" }); await authenticating;
  await assertRejectedThenCannotRecover(h);
});

test("duplicate auth while pending cannot replace socket identity: zero Realtime", async () => {
  const verification = deferred(), h = harness({ verifyIdToken: () => verification.promise });
  const authenticating = h.browser.receive(auth); await flush();
  await h.browser.receive({ type: "authenticate", idToken: "replacement-token" });
  verification.resolve({ uid: UID }); await authenticating;
  await assertRejectedThenCannotRecover(h);
});

test("duplicate auth after authorization is terminal before offer: zero Realtime", async () => {
  const h = harness(); await h.browser.receive(auth); await h.browser.receive(auth);
  await assertRejectedThenCannotRecover(h);
});

for (const invalidScope of [null, { ok: false }, { ok: true, uid: "wrong-user", rootId: ROOT, role: "superadmin" }, { ok: true, uid: UID, rootId: "", role: "superadmin" }, { ok: true, uid: UID, rootId: ROOT, role: "" }]) {
  test(`invalid canonical scope ${JSON.stringify(invalidScope)}: zero Realtime`, async () => {
    const h = harness({ authorize: async () => invalidScope }); await h.browser.receive(auth);
    await assertRejectedThenCannotRecover(h);
  });
}

test("mismatched token root and canonical root: zero Realtime", async () => {
  const h = harness({ verifyIdToken: async () => ({ uid: UID, rootId: "different-root" }) });
  await h.browser.receive(auth); await assertRejectedThenCannotRecover(h);
});

test("cross-socket copied context/session cannot authorize second socket: zero Realtime", async () => {
  const owner = harness(), attacker = harness(); await owner.browser.receive(auth);
  assert.equal(owner.connection.inspect().immutableContext, true);
  await attacker.browser.receive({ ...offer, identity: { uid: UID, rootId: ROOT }, authorizedContext: { uid: UID, rootId: ROOT, authorization: { ok: true } }, sessionId: "copied-session" });
  await assertRejectedThenCannotRecover(attacker);
  assert.equal(owner.connection.inspect().state, ConnectionState.AUTHORIZED);
  assert.equal(owner.counts.realtime, 0);
  owner.browser.close(); assertCleared(owner);
});

test("authorized socket cannot replace its context through offer payload: zero Realtime", async () => {
  const h = harness(); await h.browser.receive(auth); await h.browser.receive({ ...offer, rootId: "another-root" });
  await assertRejectedThenCannotRecover(h);
});

test("close during authorization clears immediately and cannot resurrect: zero Realtime", async () => {
  const approval = deferred(), h = harness({ authorize: () => approval.promise });
  const authenticating = h.browser.receive(auth); await flush(); h.browser.close(); assertCleared(h);
  approval.resolve({ ok: true, uid: UID, rootId: ROOT, role: "superadmin" }); await authenticating;
  await h.browser.receive(auth); await h.browser.receive(offer); assertCleared(h);
});

test("valid configured identity plus canonical approval plus offer creates exactly one Realtime", async () => {
  const h = harness(); await h.browser.receive(auth);
  assert.equal(h.connection.inspect().state, ConnectionState.AUTHORIZED);
  assert.equal(h.connection.inspect().immutableContext, true); assert.equal(h.counts.realtime, 0);
  assert.deepEqual(h.browser.sent, [{ type: "authenticated" }]);
  await h.browser.receive(offer);
  assert.equal(h.connection.inspect().state, ConnectionState.REALTIME_ACTIVE);
  assert.equal(h.counts.realtime, 1); assert.equal(h.connection.inspect().realtimeCreationAttempts, 1);
  assert.equal(h.browser.sent.at(-1).type, "answer"); assert.equal(h.browser.sent.at(-1).model, "unchanged-model"); assert.equal(h.browser.sent.at(-1).voice, "unchanged-voice");
  h.browser.close(); assertCleared(h, 1); assert.equal(h.signals.realtime.aborted, true); assert.equal(h.sidebands[0].readyState, 3);
});

test("concurrent and repeated offers never create a second Realtime", async () => {
  const realtime = deferred(); let signal;
  const h = harness({ openRealtime: (_sdp, currentSignal) => { signal = currentSignal; return realtime.promise; } });
  await h.browser.receive(auth); const starting = h.browser.receive(offer);
  assert.equal(h.connection.inspect().state, ConnectionState.REALTIME_STARTING);
  await h.browser.receive(offer); assert.equal(signal.aborted, true);
  realtime.resolve({ callId: "simulated-call", answer: "simulated-answer" }); await starting;
  await h.browser.receive(offer); assertCleared(h, 1); assert.equal(h.sidebands.length, 0);
});

test("disconnect while opening Realtime aborts and prevents sideband creation", async () => {
  const realtime = deferred(), h = harness({ openRealtime: () => realtime.promise });
  await h.browser.receive(auth); const starting = h.browser.receive(offer); h.browser.close();
  realtime.resolve({ callId: "simulated-call", answer: "simulated-answer" }); await starting;
  assertCleared(h, 1); assert.equal(h.sidebands.length, 0);
});

test("disconnect while sideband is connecting handles late error and clears context", async () => {
  const connecting = new Socket(); connecting.readyState = 0;
  const h = harness({ createSideband: () => connecting });
  await h.browser.receive(auth); const starting = h.browser.receive(offer); await flush();
  h.browser.close();
  assert.doesNotThrow(() => connecting.emit("error", Error("simulated connect aborted")));
  await starting; assertCleared(h, 1); assert.equal(connecting.readyState, 3);
});

test("sideband connection timeout terminates authorization and clears context", async () => {
  const connecting = new Socket(); connecting.readyState = 0;
  const h = harness({ createSideband: () => connecting, sidebandTimeoutMs: 10 });
  await h.browser.receive(auth); await h.browser.receive(offer);
  assertCleared(h, 1); assert.equal(h.browser.closes[0].code, 1008);
});

test("simulated E2E confirms sustained interruption before cancelling playback", async () => {
  const h = harness({ interruptionConfirmationMs: 5 }); await h.browser.receive(auth); await h.browser.receive(offer);
  const sideband = h.sidebands[0];
  await sideband.receive({ type: "conversation.item.created", item: { id: "turn-1", type: "message", role: "user" } });
  await sideband.receive({ type: "response.created", response: { id: "response-1" } });
  const tool = { type: "response.function_call_arguments.done", name: "get_authorized_capabilities", call_id: "tool-1", response_id: "response-1", arguments: "{}" };
  await sideband.receive(tool); await sideband.receive(tool);
  await sideband.receive({ type: "response.done", response: { id: "response-1", output: [{ type: "function_call", call_id: "tool-1" }] } });
  await sideband.receive({ type: "response.done", response: { id: "response-1", output: [{ type: "function_call", call_id: "tool-1" }] } });
  await sideband.receive({ type: "response.created", response: { id: "response-2" } });
  await sideband.receive({ type: "input_audio_buffer.speech_started", item_id: "turn-2" });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.counts.realtime, 1); assert.equal(h.counts.delegate, 1);
  assert.equal(sideband.sent.filter(event => event.type === "conversation.item.create").length, 1);
  assert.equal(sideband.sent.filter(event => event.type === "response.create").length, 1);
  assert.deepEqual(sideband.sent.slice(-2).map(event => event.type), ["response.cancel", "output_audio_buffer.clear"]);
  const interruption = h.browser.sent.find(event => event.type === "gateway.interruption_confirmed");
  assert.equal(interruption.turnId, "turn-1"); assert.equal(interruption.retained[0].status, "COMPLETED");
  h.browser.close(); assertCleared(h, 1);
});

test("voice tool failures never expose codes, identifiers or protected existence", () => {
  const denied = safeVoiceToolFailureOutput({ errorCategory: "PERMISSION_DENIED", errorCode: "SECRET_ID_123", retryable: false });
  assert.deepEqual(denied, { status: "BLOCKED", text: "Esta consulta está fuera del alcance autorizado de tu sesión." });
  assert.doesNotMatch(JSON.stringify(denied), /SECRET|UUID|FIRESTORE|PAYMENT/i);
  const missing = safeVoiceToolFailureOutput({ errorCategory: "ENTITY_NOT_FOUND", errorCode: "PAY0_PAYMENT_REFERENCE_NOT_FOUND", retryable: false });
  assert.deepEqual(missing, { status: "NOT_FOUND", text: "No encontré información que coincida con esa consulta." });
  assert.notEqual(denied.text, missing.text);
});

test("Cloud Run runtime without immutable build metadata fails closed before Realtime", async () => {
  const h = harness({ runtimeMetadata: { revision: "candidate-00001", commit: "UNSET", branch: "UNSET" } });
  await h.browser.receive(auth); await h.browser.receive(offer);
  assertCleared(h, 0);
  assert.equal(h.logs.find(item => item.type === "gateway.request_rejected")?.code, "GATEWAY_BUILD_METADATA_MISSING");
});

test("short VAD activation is rejected without cancelling response or playback", async () => {
  const h = harness({ interruptionConfirmationMs: 20 }); await h.browser.receive(auth); await h.browser.receive(offer);
  const sideband = h.sidebands[0];
  await sideband.receive({ type: "conversation.item.created", item: { id: "turn-1", type: "message", role: "user" } });
  await sideband.receive({ type: "response.created", response: { id: "response-1" } });
  await sideband.receive({ type: "input_audio_buffer.speech_started", item_id: "turn-noise" });
  await sideband.receive({ type: "input_audio_buffer.speech_stopped", item_id: "turn-noise" });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(sideband.sent.some(event => ["response.cancel", "output_audio_buffer.clear"].includes(event.type)), false);
  assert.ok(h.browser.sent.some(event => event.type === "gateway.interruption_rejected"));
  assert.equal(h.logs.filter(event => event.type === "gateway.interruption_rejected").length, 1);
  h.browser.close(); assertCleared(h, 1);
});

test("first-audio telemetry is measured independently for each response", async () => {
  const h = harness(); await h.browser.receive(auth); await h.browser.receive(offer);
  const sideband = h.sidebands[0];
  await sideband.receive({ type: "conversation.item.created", item: { id: "turn-1", type: "message", role: "user" } });
  await sideband.receive({ type: "input_audio_buffer.speech_stopped", item_id: "turn-1" });
  await sideband.receive({ type: "response.created", response: { id: "response-1" } });
  await sideband.receive({ type: "response.output_audio.delta", response_id: "response-1", delta: "simulated" });
  await sideband.receive({ type: "response.output_audio.done", response_id: "response-1" });
  await sideband.receive({ type: "response.done", response: { id: "response-1", output: [] } });
  await sideband.receive({ type: "conversation.item.created", item: { id: "turn-2", type: "message", role: "user" } });
  await sideband.receive({ type: "input_audio_buffer.speech_stopped", item_id: "turn-2" });
  await sideband.receive({ type: "response.created", response: { id: "response-2" } });
  await sideband.receive({ type: "response.output_audio.delta", response_id: "response-2", delta: "simulated" });
  assert.deepEqual(h.logs.filter(event => event.type === "gateway.first_audio").map(event => event.responseId), ["response-1", "response-2"]);
  assert.equal(h.logs.filter(event => event.type === "gateway.response_created").length, 2);
  h.browser.close(); assertCleared(h, 1);
});

test("disconnect aborts delegated work and suppresses late result delivery", async () => {
  const toolResult = deferred(); let signal;
  const h = harness({ callable: (_token, _data, currentSignal) => { signal = currentSignal; return toolResult.promise; } });
  await h.browser.receive(auth); await h.browser.receive(offer);
  const sideband = h.sidebands[0], running = sideband.receive({ type: "response.function_call_arguments.done", name: "get_authorized_capabilities", call_id: "tool-1", arguments: "{}" });
  assert.equal(h.connection.inspect().pendingTools, 1); h.browser.close(); assert.equal(signal.aborted, true);
  toolResult.resolve({ route: "DETERMINISTIC_TOOL", text: "must-not-be-delivered" }); await running;
  assert.equal(sideband.sent.length, 0); assertCleared(h, 1);
});

test("unexpected sideband disconnect clears authorization and aborts pending tools", async () => {
  const toolResult = deferred(); let signal;
  const h = harness({ callable: (_token, _data, currentSignal) => { signal = currentSignal; return toolResult.promise; } });
  await h.browser.receive(auth); await h.browser.receive(offer);
  const sideband = h.sidebands[0], running = sideband.receive({ type: "response.function_call_arguments.done", name: "get_authorized_capabilities", call_id: "tool-1", arguments: "{}" });
  sideband.close(); assert.equal(signal.aborted, true); assertCleared(h, 1);
  toolResult.resolve({ route: "DETERMINISTIC_TOOL", text: "must-not-be-delivered" }); await running;
  assert.equal(sideband.sent.length, 0); assert.equal(h.browser.closes[0].code, 1008);
});

test("malformed messages and arbitrary error payloads are rejected with sanitized logs", async () => {
  const h = harness({ authorize: async () => { throw Error(`TOKEN_${TOKEN.toUpperCase()}_ROOT_${ROOT}`); } });
  await h.browser.receive(auth); await assertRejectedThenCannotRecover(h);
  const output = JSON.stringify({ logs: h.logs, messages: h.browser.sent, closes: h.browser.closes });
  for (const sensitive of [TOKEN, TOKEN.toUpperCase(), UID, ROOT, "Bearer", offer.sdp]) assert.equal(output.includes(sensitive), false);
  assert.equal(classifyRequestError(Error("ARBITRARY_SECRET_VALUE")), "GATEWAY_REQUEST_FAILED");
  const malformed = harness(); await malformed.browser.raw("not-json-sensitive-payload"); await assertRejectedThenCannotRecover(malformed);
});

async function readToolOutput(result, name = "buscar_solicitudes", args = {}) {
  let sent;
  const h = harness({ callable: async (_token, input) => { sent = input; return result; } });
  await h.browser.receive(auth); await h.browser.receive(offer);
  const sideband = h.sidebands[0];
  await sideband.receive({ type: "response.function_call_arguments.done", name, call_id: "read-1", response_id: "response1", arguments: JSON.stringify(args) });
  const event = sideband.sent.find(item => item.type === "conversation.item.create");
  h.browser.close();
  return { sent, output: event && JSON.parse(event.item.output) };
}

test("general read tools deliver structured data to the model without model-supplied identity", async () => {
  const data = { total: 2, montoTotal: 15080, mostrados: 1, items: [{ id: "sol-1", folio: "S1C4U3E1", cliente: "ACIER", monto: 7540 }], filtros: { cliente: "ACIER" },
    interpretacion: [{ campo: "cliente", dicho: "asier", entendido: "ACIER", confianza: "APROXIMADA" }] };
  const { sent, output } = await readToolOutput({ ok: true, route: "DETERMINISTIC_TOOL", tool: "findSolicitudes", sourceSystem: "PAY0", text: "Hay 2 solicitudes.", data,
    trace: { secret: "internal" }, uid: "leak-uid", rootId: "leak-root", cost: 3 }, "buscar_solicitudes", { cliente: "asier", rootId: "foreign", uid: "foreign" });
  assert.equal(sent.toolName, "findSolicitudes");
  assert.deepEqual(sent.toolInput, { cliente: "asier" });
  assert.equal(JSON.stringify(sent).includes("foreign"), false);
  assert.deepEqual(output, { route: "DETERMINISTIC_TOOL", text: "Hay 2 solicitudes.", data });
});

test("results without data keep the previous output shape", async () => {
  const { output } = await readToolOutput({ route: "DETERMINISTIC_TOOL", text: "Tienes acceso a PAY0.", sourceSystem: "PAY0" }, "get_authorized_capabilities");
  assert.deepEqual(output, { route: "DETERMINISTIC_TOOL", text: "Tienes acceso a PAY0." });
});

test("structured data is bounded: items are trimmed and marked truncado", async () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ id: `sol-${index}`, cliente: "C".repeat(1500), monto: index }));
  const { output } = await readToolOutput({ route: "DETERMINISTIC_TOOL", text: "Hay 40.", data: { total: 40, montoTotal: 1, mostrados: 20, items, filtros: {}, interpretacion: [] } });
  assert.ok(Buffer.byteLength(JSON.stringify(output.data)) <= MAX_TOOL_DATA_BYTES);
  assert.equal(output.data.truncado, true);
  assert.equal(output.data.total, 40);
  assert.ok(output.data.items.length > 0 && output.data.items.length < 20);
  assert.equal(output.data.mostrados, output.data.items.length);
  assert.deepEqual(output.data.items[0], items[0]);
});

test("bounding trims nested detail arrays, leaves small data intact and never throws", () => {
  const small = { encontrada: true, solicitud: { id: "s", documentos: [] } };
  assert.deepEqual(boundToolData(small), small);
  assert.equal(boundToolData(undefined), undefined);
  assert.equal(boundToolData(null), undefined);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(boundToolData(cyclic), undefined);
  const detail = { encontrada: true, solicitud: { id: "s", oc: { partidas: Array.from({ length: 400 }, () => ({ cantidad: 1, descripcion: "x".repeat(80), importe: 1 })) }, documentos: [{ tipo: "OC" }] } };
  const bounded = boundToolData(detail);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= MAX_TOOL_DATA_BYTES);
  assert.equal(bounded.truncado, true);
  assert.equal(bounded.solicitud.id, "s");
  assert.deepEqual(bounded.solicitud.documentos, [{ tipo: "OC" }]);
  assert.ok(bounded.solicitud.oc.partidas.length > 0 && bounded.solicitud.oc.partidas.length < 400);
  assert.deepEqual(boundToolData({ blob: "z".repeat(20000) }), { truncado: true });
  assert.equal(detail.solicitud.oc.partidas.length, 400, "input is not mutated");
});

test("invalid general read input fails as a non-retryable validation without calling the backend", async () => {
  const { sent, output } = await readToolOutput({ route: "X", text: "must-not-run" }, "ver_solicitud", { rootId: "foreign" });
  assert.equal(sent, undefined);
  assert.deepEqual(output, { status: "INVALID_INPUT", text: "Falta el dato a consultar: un id, folio o nombre." });
  assert.deepEqual(safeToolFailure(Error("INVALID_TOOL_INPUT")), { errorCategory: "VALIDATION", errorCode: "INVALID_TOOL_INPUT", retryable: false });
});
