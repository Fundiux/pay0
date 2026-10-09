"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createServer } = require("node:net");
const { performance } = require("node:perf_hooks");
const { readDiscoveryManifest, availablePort, startProcess, stopProcess } = require("./verify-functions-discovery-startup.cjs");

async function portIsFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function fakeDiscovery(t, { responseDelayMs = 0, listenDelayMs = 0, mode = "manifest" } = {}) {
  const port = await availablePort();
  const startedAt = performance.now();
  const source = `
    const { createServer } = require("node:http");
    let requests = 0;
    const timers = new Set();
    const server = createServer((req, res) => {
      if (req.url === "/__/quitquitquit") {
        for (const timer of timers) clearTimeout(timer);
        res.end("ok");
        server.close();
        return;
      }
      const requestNumber = ++requests;
      console.log("MANIFEST_REQUEST " + requestNumber);
      if (${JSON.stringify(mode)} === "reset") { req.socket.destroy(); return; }
      if (${JSON.stringify(mode)} === "invalid") { res.end("not json"); return; }
      const timer = setTimeout(() => {
        timers.delete(timer);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          specVersion: "v1alpha1", endpoints: { fixture: { entryPoint: "fixture" } }, requestNumber,
          requiredAPIs: requestNumber === 1 ? [{ api: "fixture.googleapis.com", reason: "first load" }] : [],
          lifecycleHooks: requestNumber === 1 ? { onInit: "fixture-init" } : {}
        }));
      }, ${responseDelayMs});
      timers.add(timer);
    });
    setTimeout(() => server.listen(process.env.PORT, "127.0.0.1"), ${listenDelayMs});
  `;
  const run = startProcess(["-e", source], port);
  t.after(async () => {
    await stopProcess(run, port);
    assert.ok(run.result, "the owned child must close");
    await portIsFree(port);
  });
  return { port, startedAt, run };
}

test("one accepted request preserves first-load metadata after a response slower than 500 ms", async (t) => {
  const fixture = await fakeDiscovery(t, { responseDelayMs: 900, listenDelayMs: 100 });
  const { manifest, elapsedMs } = await readDiscoveryManifest({ ...fixture, deadlineMs: 5_000 });
  assert.ok(elapsedMs >= 900, "elapsed time includes SDK startup and its first response");
  assert.equal(manifest.requestNumber, 1);
  assert.deepEqual(manifest.requiredAPIs, [{ api: "fixture.googleapis.com", reason: "first load" }]);
  assert.deepEqual(manifest.lifecycleHooks, { onInit: "fixture-init" });
  assert.equal((fixture.run.diagnostics.match(/MANIFEST_REQUEST/g) || []).length, 1);
});

test("global deadline is fatal, never retries an accepted slow request, and closes its owned process", async (t) => {
  const fixture = await fakeDiscovery(t, { responseDelayMs: 10_000 });
  await assert.rejects(readDiscoveryManifest({ ...fixture, deadlineMs: 1_200 }), { name: "TimeoutError" });
  assert.equal((fixture.run.diagnostics.match(/MANIFEST_REQUEST/g) || []).length, 1);
});

test("elapsed startup consumes the same deadline before any HTTP attempt", async () => {
  const port = await availablePort();
  await assert.rejects(readDiscoveryManifest({ port, startedAt: performance.now() - 2_000, deadlineMs: 1_000 }), { name: "TimeoutError" });
  await portIsFree(port);
});

test("an accepted connection reset is fatal rather than reloading SDK metadata", async (t) => {
  const fixture = await fakeDiscovery(t, { mode: "reset" });
  await assert.rejects(readDiscoveryManifest({ ...fixture, deadlineMs: 5_000 }));
  assert.equal((fixture.run.diagnostics.match(/MANIFEST_REQUEST/g) || []).length, 1);
});

test("invalid manifest fails without a second accepted request", async (t) => {
  const fixture = await fakeDiscovery(t, { mode: "invalid" });
  await assert.rejects(readDiscoveryManifest({ ...fixture, deadlineMs: 5_000 }), SyntaxError);
  assert.equal((fixture.run.diagnostics.match(/MANIFEST_REQUEST/g) || []).length, 1);
});
