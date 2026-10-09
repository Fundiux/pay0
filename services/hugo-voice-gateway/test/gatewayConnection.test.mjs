import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachGatewayConnection, ConnectionState, classifyRequestError, safeToolFailure, safeVoiceToolFailureOutput } from "../src/gatewayConnection.mjs";

const TOKEN = "test-token-never-log-this", UID = "configured-canary-user", ROOT = "configured-root";
const auth = { type: "authenticate", idToken: TOKEN };
const offer = { type: "offer", sdp: "v=0\r\no=simulated-offer\r\n" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test("tool failures expose only the stable operational taxonomy", () => {
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
