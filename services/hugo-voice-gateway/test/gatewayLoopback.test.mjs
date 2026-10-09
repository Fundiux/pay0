import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter, once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { attachGatewayConnection } from "../src/gatewayConnection.mjs";

test("simulated WebSocket E2E: terminal rejects create zero Realtime; approved socket creates one; external actions zero", { timeout: 10000 }, async t => {
  let realtimeCreations = 0, externalActions = 0;
  t.mock.method(globalThis, "fetch", () => { externalActions += 1; throw Error("EXTERNAL_NETWORK_FORBIDDEN_IN_SIMULATION"); });
  const server = http.createServer(), wss = new WebSocketServer({ server, path: "/voice" }), connections = [], serverSockets = [], logs = [];
  wss.on("connection", browser => {
    const control = attachGatewayConnection(browser, {
      verifyIdToken: async token => { if (token !== "simulated-valid-token") throw Object.assign(Error("invalid simulated token"), { code: "auth/argument-error" }); return { uid: "configured-simulated-user" }; },
      authorize: async () => ({ ok: true, uid: "configured-simulated-user", rootId: "simulated-root", role: "superadmin" }),
      canaryUids: new Set(["configured-simulated-user"]),
      openRealtime: async () => { realtimeCreations += 1; return { callId: "simulated-call-id", answer: "simulated-answer-sdp" }; },
      createSideband: () => {
        const sideband = new EventEmitter(); sideband.readyState = 0; sideband.send = () => {};
        sideband.close = () => { sideband.readyState = 3; sideband.emit("close"); }; sideband.terminate = sideband.close;
        queueMicrotask(() => { sideband.readyState = 1; sideband.emit("open"); }); return sideband;
      },
      callable: async () => { throw Error("UNEXPECTED_TOOL_CALL"); },
      log: (type, detail) => logs.push({ type, ...detail }), model: "unchanged-model", voice: "unchanged-voice",
    });
    connections.push(control); serverSockets.push(browser);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  const connect = async () => { const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/voice`); await once(client, "open"); return client; };
  const exchange = (client, event) => { const incoming = once(client, "message"); client.send(JSON.stringify(event)); return incoming.then(([data]) => JSON.parse(data.toString())); };
  for (const event of [{ type: "authenticate" }, { type: "authenticate", idToken: "simulated-invalid-token" }, { type: "offer", sdp: "v=0\r\n" }]) {
    const client = await connect(), closed = once(client, "close"), error = await exchange(client, event);
    assert.equal(error.type, "gateway.error");
    const [code] = await closed; assert.equal(code, 1008);
    assert.equal(realtimeCreations, 0);
    const snapshot = connections.at(-1).inspect(); assert.equal(snapshot.hasAuthorizedContext, false); assert.equal(snapshot.hasToken, false);
    assert.equal(snapshot.realtimeCreationAttempts, 0);
  }
  const client = await connect();
  assert.deepEqual(await exchange(client, { type: "authenticate", idToken: "simulated-valid-token" }), { type: "authenticated" });
  assert.equal(realtimeCreations, 0);
  const answer = await exchange(client, { type: "offer", sdp: "v=0\r\n" });
  assert.equal(answer.type, "answer"); assert.equal(answer.sdp, "simulated-answer-sdp"); assert.equal(realtimeCreations, 1);
  const closed = once(client, "close"), serverClosed = once(serverSockets.at(-1), "close"); client.close(); await Promise.all([closed, serverClosed]);
  assert.equal(connections.at(-1).inspect().hasAuthorizedContext, false);
  assert.equal(externalActions, 0);
  assert.equal(logs.filter(entry => entry.type === "gateway.realtime_create_attempt").length, 1);
  assert.equal(JSON.stringify(logs).includes("simulated-valid-token"), false);
  assert.equal(JSON.stringify(logs).includes("simulated-invalid-token"), false);
});
