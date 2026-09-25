"use strict";

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createServer } = require("node:net");
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

async function main() {
  if (!existsSync(discoveryBinary)) {
    throw new Error("firebase-functions discovery binary is missing; run npm ci in functions first.");
  }
  if (!existsSync(join(functionsDir, "lib", "index.js"))) {
    throw new Error("functions/lib/index.js is missing; run the Functions build first.");
  }

  const port = await availablePort();
  const startedAt = performance.now();
  const child = spawn(process.execPath, [discoveryBinary], {
    cwd: functionsDir,
    env: {
      ...process.env,
      FUNCTIONS_CONTROL_API: "true",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  const remember = (chunk) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-4_000);
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);

  let manifest;
  let discoveryElapsedMs = 0;
  try {
    while (performance.now() - startedAt <= firebaseTimeoutMs) {
      if (child.exitCode !== null) {
        throw new Error(`discovery server exited with ${child.exitCode}: ${diagnostics.trim()}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/__/functions.yaml`, {
          signal: AbortSignal.timeout(500),
        });
        if (!response.ok) {
          throw new Error(`discovery endpoint returned HTTP ${response.status}: ${await response.text()}`);
        }
        manifest = JSON.parse(await response.text());
        discoveryElapsedMs = Math.round(performance.now() - startedAt);
        break;
      } catch (error) {
        if (error instanceof SyntaxError || String(error).includes("HTTP ")) throw error;
        await delay(25);
      }
    }
    if (!manifest) {
      throw new Error(`Firebase-compatible discovery timed out after ${firebaseTimeoutMs} ms: ${diagnostics.trim()}`);
    }
  } finally {
    await fetch(`http://127.0.0.1:${port}/__/quitquitquit`, { method: "POST" }).catch(() => {});
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      delay(1_000),
    ]);
    if (child.exitCode === null) child.kill();
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
  if (discoveryElapsedMs > maximumDiscoveryMs) {
    fail(`startup took ${discoveryElapsedMs} ms; release limit is ${maximumDiscoveryMs} ms.`);
  }

  if (!process.exitCode) {
    console.log(
      `FUNCTIONS_DISCOVERY_GUARD_PASS elapsedMs=${discoveryElapsedMs} endpoints=${endpointNames.length} limitMs=${maximumDiscoveryMs}`,
    );
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
