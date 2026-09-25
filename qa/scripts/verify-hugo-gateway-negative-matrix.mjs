import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
const require = createRequire(new URL("../../services/hugo-voice-gateway/package.json", import.meta.url));
const { WebSocket, WebSocketServer } = require("ws");

// No real token, valid SDP, audio or offer capable of starting Realtime enters this probe.
const selfTest = process.argv[2] === "--self-test";
let mockServer, mockSockets, controls = [], simulatedRealtimeAttempts = 0;
if (selfTest) {
  const { attachGatewayConnection } = await import("../../services/hugo-voice-gateway/src/gatewayConnection.mjs");
  globalThis.fetch = () => { throw Error("EXTERNAL_NETWORK_FORBIDDEN"); };
  mockServer = http.createServer();
  mockSockets = new WebSocketServer({ server: mockServer, path: "/voice" });
  mockSockets.on("connection", socket => controls.push(attachGatewayConnection(socket, {
    verifyIdToken: async () => { await new Promise(resolve => setImmediate(resolve)); throw Object.assign(Error("invalid simulated token"), { code: "auth/argument-error" }); },
    authorize: async () => { throw Error("UNEXPECTED_AUTHORIZATION"); },
    canaryUids: new Set(["simulated-allowed-user"]),
    openRealtime: async () => { simulatedRealtimeAttempts++; throw Error("UNEXPECTED_REALTIME"); },
    createSideband: () => { throw Error("UNEXPECTED_SIDEBAND"); },
    callable: async () => { throw Error("UNEXPECTED_TOOL"); }, log: () => {}, model: "unchanged", voice: "unchanged",
  })));
  await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
}
const target = new URL(selfTest ? `ws://127.0.0.1:${mockServer.address().port}/voice` : process.argv[2] || "");
if (!selfTest) {
  assert.equal(target.protocol, "https:");
  assert.ok(target.hostname === "hugo-voice-gateway-canary-o4tesftjlq-uc.a.run.app" || target.hostname.endsWith("---hugo-voice-gateway-canary-o4tesftjlq-uc.a.run.app"));
}
assert.equal(target.pathname, "/voice");
assert.ok(!target.username && !target.password && !target.search && !target.hash);
const runId = `pay0-negative-${randomUUID()}`;
const invalidAuth = { type: "authenticate", idToken: "invalid-smoke-token" };
const emptyOffer = { type: "offer", sdp: "" };
// Fabricated JWT with impossible signature, never a real Firebase identity or credential.
const encode = data => Buffer.from(JSON.stringify(data)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const invalidAsyncToken = `${encode({ alg: "RS256", kid: "pay0-negative-not-a-signing-key", typ: "JWT" })}.${encode({ aud: "pay-0-system", iss: "https://securetoken.google.com/pay-0-system", sub: "pay0-negative-not-a-user", iat: now, exp: now + 60, auth_time: now })}.${Buffer.alloc(256).toString("base64url")}`;
const cases = [
  { name: "connection-without-auth", idle: true, expectedClose: 1000 },
  { name: "missing-token", initial: [{ type: "authenticate" }], error: "UNAUTHENTICATED", expectedClose: 1008 },
  { name: "invalid-token", initial: [invalidAuth], error: "GATEWAY_REQUEST_REJECTED", expectedClose: 1008 },
  { name: "offer-before-auth", initial: [emptyOffer], error: "UNAUTHENTICATED", expectedClose: 1008 },
  { name: "invalid-auth-then-offer", initial: [invalidAuth], afterReject: [emptyOffer], error: "GATEWAY_REQUEST_REJECTED", expectedClose: 1008 },
  { name: "second-auth-after-rejection", initial: [invalidAuth], afterReject: [invalidAuth, emptyOffer], error: "GATEWAY_REQUEST_REJECTED", expectedClose: 1008 },
  { name: "messages-after-close", initial: [invalidAuth], afterClose: [invalidAuth, emptyOffer], error: "GATEWAY_REQUEST_REJECTED", expectedClose: 1008 },
  { name: "concurrent-authenticating-offer", initial: [{ type: "authenticate", idToken: invalidAsyncToken }, emptyOffer], error: "UNAUTHENTICATED", expectedClose: 1008 },
];
try {
  for (const test of cases) {
    await new Promise((resolve, reject) => {
      const probeId = `${runId}-${test.name}`;
      const socket = new WebSocket(target, { headers: { "User-Agent": probeId } });
      let errorCode = null, unexpected = false, afterRejectAttempts = 0;
      const startedAt = new Date().toISOString();
      const timer = setTimeout(() => { socket.terminate(); reject(Error(`${test.name}: timeout`)); }, 12000);
      const send = event => socket.send(JSON.stringify(event), () => {});
      socket.on("open", () => {
        if (test.idle) { setTimeout(() => socket.close(1000, "Probe finished without authentication"), 150); return; }
        for (const event of test.initial) send(event);
      });
      socket.on("message", raw => {
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === "authenticated" || event.type === "answer") { unexpected = true; socket.close(); }
          if (event.type === "gateway.error" && errorCode === null) {
            errorCode = event.code;
            for (const attempt of test.afterReject || []) { afterRejectAttempts++; send(attempt); }
          }
        } catch { socket.terminate(); reject(Error(`${test.name}: malformed response`)); }
      });
      socket.on("error", () => { clearTimeout(timer); reject(Error(`${test.name}: transport failed`)); });
      socket.on("close", async code => {
        clearTimeout(timer);
        try {
          assert.equal(errorCode, test.error || null, `${test.name}: incorrect rejection`);
          // A client-initiated idle close can lose its close-frame echo through Cloud Run.
          // This exception never applies to a server rejection or an authorized response.
          assert.ok(code === test.expectedClose || (!selfTest && test.idle && code === 1006), `${test.name}: incorrect terminal close ${code}`);
          assert.equal(unexpected, false, `${test.name}: unexpectedly authorized`);
          assert.equal(socket.readyState, WebSocket.CLOSED);
          let closedSocketMessagesBlocked = 0;
          for (const attempt of test.afterClose || []) {
            const blocked = await new Promise(done => socket.send(JSON.stringify(attempt), error => done(Boolean(error))));
            assert.equal(blocked, true, "Closed socket accepted a message");
            closedSocketMessagesBlocked++;
          }
          console.log(JSON.stringify({ case: test.name, probeId, startedAt, completedAt: new Date().toISOString(), errorCode, closeCode: code, authenticated: false, realtimeAnswer: false, afterRejectAttempts, closedSocketMessagesBlocked, terminal: true }));
          resolve();
        } catch (error) { reject(error); }
      });
    });
  }
  if (selfTest) {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(simulatedRealtimeAttempts, 0);
    assert.equal(controls.length, cases.length);
    for (const control of controls) {
      const snapshot = control.inspect();
      assert.equal(snapshot.realtimeCreationAttempts, 0);
      assert.equal(snapshot.hasAuthorizedContext, false);
      assert.equal(snapshot.hasToken, false);
      assert.equal(snapshot.state, "CLOSED");
    }
  }
  console.log(JSON.stringify({ ok: true, runId, mode: selfTest ? "loopback-simulation" : "live-negative-only", negativeCases: cases.length, validTokensSent: 0, validOffersSent: 0, audioSent: 0, ...(selfTest ? { realtimeCreationAttempts: simulatedRealtimeAttempts, clearedContexts: controls.length, externalActions: 0 } : { serverCounterVerification: "required-in-correlated-cloud-logs" }) }));
} finally {
  if (mockSockets) { for (const client of mockSockets.clients) client.terminate(); await new Promise(resolve => mockSockets.close(resolve)); }
  if (mockServer) await new Promise(resolve => mockServer.close(resolve));
}
