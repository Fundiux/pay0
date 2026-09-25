import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { runAuthOnlyProbe } from "../probes/hugo-auth-only/browser.mjs";
import { validateAuthOnlyConfiguration, createAuthOnlyHandler, buildAuthOnlyBrowserBundle, expectedRevision } from "./serve-hugo-auth-only.mjs";

const testToken = "LOCAL_TEST_VALUE_NOT_A_CREDENTIAL";
const target = "https://local-test---hugo-voice-gateway-canary-o4tesftjlq-uc.a.run.app/voice";
const firebaseEnvironment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "test-public-configuration",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "pay-0-system.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "pay-0-system",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "test-bucket",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123",
  NEXT_PUBLIC_FIREBASE_APP_ID: "test-app",
};
const configuration = validateAuthOnlyConfiguration(firebaseEnvironment, target, expectedRevision);

function socketHarness(reply) {
  const messages = [], closes = [];
  const socket = {
    readyState: 0,
    send(value) { messages.push(JSON.parse(value)); queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify(reply) })); },
    close(code) { closes.push(code); socket.readyState = 3; socket.onclose?.(); },
  };
  return { messages, closes, createSocket: () => { queueMicrotask(() => { socket.readyState = 1; socket.onopen?.(); }); return socket; } };
}

test("auth-only sends one authentication, closes, disposes and returns no token", async () => {
  const h = socketHarness({ type: "authenticated" }); let disposed = 0;
  const result = await runAuthOnlyProbe({ getIdToken: async () => testToken, createSocket: h.createSocket, dispose: async () => { disposed += 1; } });
  assert.equal(result, "AUTHORIZED"); assert.equal(disposed, 1);
  assert.deepEqual(h.messages.map(message => Object.keys(message)), [["type", "idToken"]]);
  assert.equal(h.messages[0].type, "authenticate"); assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].idToken === testToken, true);
  assert.deepEqual(h.closes, [1000]); assert.equal(result.includes(testToken), false);
});

test("gateway error is sanitized and never causes a second outgoing message", async () => {
  const h = socketHarness({ type: "gateway.error", code: testToken }); let disposed = false;
  const result = await runAuthOnlyProbe({ getIdToken: async () => testToken, createSocket: h.createSocket, dispose: async () => { disposed = true; } });
  assert.equal(result, "AUTHORIZATION_REJECTED"); assert.equal(disposed, true); assert.equal(h.messages.length, 1);
});

test("token timeout creates no socket, disposes and ignores late token", async () => {
  let resolveToken, sockets = 0, disposed = false;
  const tokenPromise = new Promise(resolve => { resolveToken = resolve; });
  const result = await runAuthOnlyProbe({ getIdToken: () => tokenPromise, createSocket: () => { sockets += 1; }, dispose: async () => { disposed = true; }, timeoutMs: 5 });
  resolveToken(testToken); await new Promise(resolve => setImmediate(resolve));
  assert.equal(result, "TIMEOUT"); assert.equal(sockets, 0); assert.equal(disposed, true);
});

test("configuration only accepts exact candidate tagged HTTPS endpoint", () => {
  for (const wrong of [target.replace("local-test---", ""), target.replace("https:", "http:"), target + "?token=hidden", target.replace("/voice", "/"), target.replace("local-test---", "user:pass@local-test---")]) {
    assert.throws(() => validateAuthOnlyConfiguration(firebaseEnvironment, wrong, expectedRevision));
  }
  assert.throws(() => validateAuthOnlyConfiguration(firebaseEnvironment, target, "different-revision"));
  assert.throws(() => validateAuthOnlyConfiguration({ ...firebaseEnvironment, NEXT_PUBLIC_FIREBASE_API_KEY: "" }, target, expectedRevision));
});

test("local handler rejects foreign hosts, posts, bodies and queries without logging or listeners", () => {
  const handler = createAuthOnlyHandler({ configuration, bundle: "bundle", html: "html", css: "css", port: 8765 });
  for (const change of [{ method: "POST" }, { url: "/?token=hidden" }, { headers: { host: "evil.test:8765" } }, { headers: { host: "127.0.0.1:8765", "content-length": "10" } }, { headers: { host: "127.0.0.1:8765", origin: "https://evil.test" } }]) {
    let status;
    handler({ method: "GET", url: "/", headers: { host: "127.0.0.1:8765" }, ...change }, { writeHead(code) { status = code; }, end() {} });
    assert.equal(status, 404);
  }
  let status, headers;
  handler({ method: "GET", url: "/", headers: { host: "127.0.0.1:8765" } }, { writeHead(code, value) { status = code; headers = value; }, end() {} });
  assert.equal(status, 200); assert.match(headers["Cache-Control"], /no-store/);
  assert.match(headers["Permissions-Policy"], /microphone=\(\)/);
  assert.equal(headers["Content-Security-Policy"].includes("openai"), false);
  assert.match(headers["Content-Security-Policy"], /form-action 'none'/);
});

test("browser source isolates Firebase memory persistence and omits media, session storage and logging", async () => {
  const source = await fs.readFile(new URL("../probes/hugo-auth-only/browser.mjs", import.meta.url), "utf8");
  assert.match(source, /initializeAuth\(app, \{ persistence: inMemoryPersistence \}\)/);
  assert.match(source, /signInWithEmailAndPassword\(auth, email, password\)/);
  for (const forbidden of [/console\./, /localStorage/, /sessionStorage/, /indexedDB/, /RTCPeerConnection/, /getUserMedia/, /type:\s*["']offer["']/, /\.sdp/, /logAuthEventMutation/]) assert.doesNotMatch(source, forbidden);
});

test("browser bundle compiles in memory without external requests or output files", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error("External requests forbidden in this local test."); };
  try { const bundle = await buildAuthOnlyBrowserBundle(); assert.ok(bundle.byteLength > 0); }
  finally { globalThis.fetch = originalFetch; }
});
