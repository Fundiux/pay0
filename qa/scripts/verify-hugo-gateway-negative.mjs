import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../services/hugo-voice-gateway/package.json", import.meta.url));
const { WebSocket } = require("ws");

// Only negative messages, no valid identity or offer SDP can enter this probe.
const target = new URL(process.argv[2] || "");
assert.equal(target.protocol, "https:");
assert.equal(target.pathname, "/voice");
assert.ok(target.hostname.endsWith(".run.app"));
assert.ok(!target.username && !target.password && !target.search && !target.hash);
const cases = [
  { name: "anonymous", message: { type: "authenticate" }, error: "UNAUTHENTICATED" },
  { name: "invalid-token", message: { type: "authenticate", idToken: "invalid-smoke-token" }, error: "GATEWAY_REQUEST_REJECTED" },
  { name: "offer-before-auth", message: { type: "offer", sdp: "" }, error: "UNAUTHENTICATED" },
];
for (const test of cases) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(target);
    let errorCode = null;
    let unexpected = false;
    const timer = setTimeout(() => { socket.terminate(); reject(new Error(`${test.name}: timeout`)); }, 12000);
    socket.on("open", () => socket.send(JSON.stringify(test.message)));
    socket.on("message", raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === "gateway.error") errorCode = event.code;
      if (event.type === "authenticated" || event.type === "answer") unexpected = true;
    });
    socket.on("error", () => { clearTimeout(timer); reject(new Error(`${test.name}: transport failed`)); });
    socket.on("close", code => {
      clearTimeout(timer);
      try {
        assert.equal(errorCode, test.error, `${test.name}: incorrect rejection`);
        assert.equal(code, 1008, `${test.name}: policy close required`);
        assert.equal(unexpected, false, `${test.name}: unexpectedly authorized`);
        console.log(JSON.stringify({ case: test.name, errorCode, closeCode: code, authenticated: false, realtimeAnswer: false }));
        resolve();
      } catch (error) { reject(error); }
    });
  });
}
console.log(JSON.stringify({ ok: true, negativeCases: cases.length, validTokensSent: 0, validOffersSent: 0, audioSent: 0 }));
