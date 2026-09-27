"use strict";

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createServer } = require("node:net");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { performance } = require("node:perf_hooks");

const rootDir = resolve(__dirname, "../..");
const functionsDir = join(rootDir, "functions");
const discoveryBinary = join(
  functionsDir,
  "node_modules",
  "firebase-functions",
  "lib",
  "bin",
  "firebase-functions.js",
);
const maximumDiscoveryMs = 7_000;
const firebaseTimeoutMs = 10_000;
const warmupTimeoutMs = 60_000;
const expectedEndpointCount = 309;
const requiredEndpoints = [
  "saveClientCallable",
  "parseClientCsfCallable",
  "parsePagoReceiptPdf",
  "getAuthorizedDocumentDownloadUrl",
  "createClientDispersionIq",
  "processIqDispersionCreate",
  "previewPaymentCommissionDistribution",
  "authorizeHugoVoiceGatewaySession",
];

function fail(message) {
  console.error(`FUNCTIONS_DISCOVERY_GUARD_FAIL: ${message}`);
  process.exitCode = 1;
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function discoveryEnvironment(port) {
  const environment = {
    ...process.env,
    NODE_COMPILE_CACHE: join(tmpdir(), `pay0-functions-discovery-node-${process.versions.node}`),
  };
  // Firebase CLI debug logging is inherited by predeploy children and can
  // dominate discovery time. It is not part of the endpoint contract.
  delete environment.DEBUG;
  if (port) {
    environment.FUNCTIONS_CONTROL_API = "true";
    environment.PORT = String(port);
  }
  return environment;
}

const ownedProcesses = new Set();
let interrupted = false;

function startProcess(args, port) {
  if (interrupted) throw new Error("discovery interrupted.");
  const child = spawn(process.execPath, args, {
    cwd: functionsDir,
    env: discoveryEnvironment(port),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const run = { child, diagnostics: "", result: null, error: null, closed: null };
  // Register before any await or shutdown request, so an early exit cannot be
  // missed by a later waiter. Close also confirms the diagnostic pipes ended.
  run.closed = new Promise((resolveClosed) => {
    child.once("error", (error) => { run.error = error; });
    child.once("close", (code, signal) => {
      run.result = { code, signal };
      ownedProcesses.delete(run);
      resolveClosed(run.result);
    });
  });
  const remember = (chunk) => {
    run.diagnostics = `${run.diagnostics}${chunk}`.slice(-4_000);
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  ownedProcesses.add(run);
  return run;
}

async function waitForClose(run, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      run.closed,
      new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopProcess(run, port) {
  if (run.result) return;
  if (port && !run.error && run.child.exitCode === null && run.child.signalCode === null) {
    await fetch(`http://127.0.0.1:${port}/__/quitquitquit`, {
      method: "POST", signal: AbortSignal.timeout(500),
    }).catch(() => {});
    if (await waitForClose(run, 1_000)) return;
  }
  run.child.kill();
  if (await waitForClose(run, 1_000)) return;
  run.child.kill("SIGKILL");
  if (!(await waitForClose(run, 1_000))) {
    throw new Error(`discovery child ${run.child.pid} did not stop.`);
  }
}

async function warmFunctionsCompileCache() {
  const run = startProcess(["-e", "require('./lib/index.js')"]);
  try {
    const result = await waitForClose(run, warmupTimeoutMs);
    if (interrupted) throw new Error("discovery interrupted.");
    if (!result || result.code !== 0 || run.error) {
      throw new Error(`Functions compile-cache warmup failed: ${run.error?.message || run.diagnostics.trim() || (result ? `exit ${result.code}` : `timeout after ${warmupTimeoutMs} ms`)}`);
    }
  } finally {
    await stopProcess(run);
  }
}

async function readDiscoveryManifest({ port, startedAt, deadlineMs, assertRunning = () => {} }) {
  const remainingMs = deadlineMs - (performance.now() - startedAt);
  const timeoutError = new Error(`Firebase-compatible discovery timed out after ${deadlineMs} ms.`);
  timeoutError.name = "TimeoutError";
  if (remainingMs <= 0) throw timeoutError;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError), remainingMs);
  let attempts = 0;
  try {
    while (true) {
      assertRunning();
      if (controller.signal.aborted) throw timeoutError;
      try {
        attempts += 1;
        // A connected request must finish under the original deadline. Aborting
        // it every 500 ms leaves SDK loadStack running and discards its first
        // manifest, whose global API/lifecycle declarations are consumed once.
        const response = await fetch(`http://127.0.0.1:${port}/__/functions.yaml`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`discovery endpoint returned HTTP ${response.status}: ${await response.text()}`);
        }
        const manifest = JSON.parse(await response.text());
        const elapsedMs = Math.round(performance.now() - startedAt);
        if (controller.signal.aborted || performance.now() - startedAt > deadlineMs) throw timeoutError;
        return { manifest, elapsedMs, attempts };
      } catch (error) {
        if (controller.signal.aborted || error === timeoutError) throw timeoutError;
        // Refused connections prove the SDK has not accepted this request.
        // Resets, HTTP failures, parse failures and aborted requests are fatal:
        // retrying them could observe a second, incomplete manifest.
        if (error?.cause?.code !== "ECONNREFUSED" && error?.code !== "ECONNREFUSED") throw error;
        await delay(25);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function discover(phase, discoveryTimeoutMs) {
  const port = await availablePort();
  const startedAt = performance.now();
  const run = startProcess([discoveryBinary], port);

  let manifest;
  let discoveryElapsedMs = 0;
  try {
    const discovered = await readDiscoveryManifest({
      port, startedAt, deadlineMs: discoveryTimeoutMs,
      assertRunning: () => {
        if (interrupted) throw new Error("discovery interrupted.");
        if (run.error || run.result) {
          throw new Error(`discovery server exited: ${run.error?.message || run.result?.signal || run.result?.code}; ${run.diagnostics.trim()}`);
        }
      },
    });
    manifest = discovered.manifest;
    discoveryElapsedMs = discovered.elapsedMs;
  } finally {
    await stopProcess(run, port);
  }

  const endpointNames = Object.keys(manifest.endpoints || {});
  const missingEndpoints = requiredEndpoints.filter((name) => !endpointNames.includes(name));

  if (manifest.specVersion !== "v1alpha1") {
    fail(`unexpected manifest specVersion ${JSON.stringify(manifest.specVersion)}.`);
  }
  if (endpointNames.length !== expectedEndpointCount) {
    fail(`expected ${expectedEndpointCount} endpoints, found ${endpointNames.length}.`);
  }
  if (missingEndpoints.length > 0) {
    fail(`critical endpoints missing: ${missingEndpoints.join(", ")}.`);
  }
  if (phase === "GUARD" && discoveryElapsedMs > maximumDiscoveryMs) {
    fail(`startup took ${discoveryElapsedMs} ms; release limit is ${maximumDiscoveryMs} ms.`);
  }

  if (!process.exitCode) {
    console.log(
      `FUNCTIONS_DISCOVERY_${phase}_PASS elapsedMs=${discoveryElapsedMs} endpoints=${endpointNames.length} ${phase === "GUARD" ? `limitMs=${maximumDiscoveryMs}` : `timeoutMs=${discoveryTimeoutMs}`}`,
    );
  }
}

function interrupt() {
  interrupted = true;
  process.exitCode = 1;
  for (const run of ownedProcesses) run.child.kill();
}

async function main() {
  if (!existsSync(discoveryBinary)) {
    throw new Error("firebase-functions discovery binary is missing; run npm ci in functions first.");
  }
  if (!existsSync(join(functionsDir, "lib", "index.js"))) {
    throw new Error("functions/lib/index.js is missing; run the Functions build first.");
  }
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await warmFunctionsCompileCache();
    await discover("WARMUP", warmupTimeoutMs);
    if (process.exitCode || interrupted) return;
    // Always run the same strict gate after warming the cache. No environment
    // variable or Firebase predeploy mode can skip its timing requirement.
    await discover("GUARD", firebaseTimeoutMs);
    if (!process.exitCode) console.log("FUNCTIONS_DISCOVERY_STABILITY_PASS warmup=1 strictTimedRuns=1");
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

module.exports = { readDiscoveryManifest, availablePort, startProcess, stopProcess };
if (require.main === module) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
