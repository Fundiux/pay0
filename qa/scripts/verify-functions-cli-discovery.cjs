"use strict";
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { performance } = require("node:perf_hooks");
const { expectedEndpointCount, requiredEndpoints } = require("./verify-functions-discovery-startup.cjs");
const limitMs = 7000;
let discoveryStartedAt = null;

function diagnosticCode(error) {
  const code = error instanceof Error ? error.message : "";
  if (["STARTUP_LIMIT", "INVALID_BUILD", "ENDPOINT_CONTRACT", "CLI_UNAVAILABLE", "STATIC_MANIFEST_FORBIDDEN", "INTERRUPTED", "CHILD_STOP_FAILED"].includes(code)) return code;
  if (code === "User code failed to load. Cannot determine backend specification. Timeout after 10000ms") return "CLI_TIMEOUT_10000";
  if (code === "Failed to parse build specification") return "CLI_MANIFEST_PARSE";
  if (code.startsWith("User code failed to load. Cannot determine backend specification.")) return "CLI_SDK_LOAD";
  return "CLI_OTHER_REDACTED";
}

async function discoverOwned(Delegate, constructorArgs, config, env) {
  const children = [];
  let interrupted = false;
  class OwnedDelegate extends Delegate {
    spawnFunctionsProcess(...args) {
      if (interrupted) throw Error("INTERRUPTED");
      const child = super.spawnFunctionsProcess(...args);
      const run = { child, closed: false, done: null };
      run.done = new Promise(resolve => child.once("close", () => { run.closed = true; resolve(); }));
      children.push(run);
      return child;
    }
  }
  const stop = async () => {
    for (const run of children) {
      if (run.closed) continue;
      run.child.kill("SIGKILL");
      let timer;
      try {
        await Promise.race([run.done, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("CHILD_STOP_FAILED")), 2000);
        })]);
      } finally { clearTimeout(timer); }
    }
  };
  const interrupt = () => { interrupted = true; for (const run of children) if (!run.closed) run.child.kill("SIGKILL"); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const build = await new OwnedDelegate(...constructorArgs).discoverBuild(config, env);
    if (interrupted) throw Error("INTERRUPTED");
    return build;
  }
  finally {
    try { await stop(); }
    finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
  }
}

function validateCliBuild(build, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > limitMs) throw Error("STARTUP_LIMIT");
  if (!build?.endpoints || Array.isArray(build.endpoints) || typeof build.endpoints !== "object") throw Error("INVALID_BUILD");
  const names = Object.keys(build.endpoints);
  if (names.length !== expectedEndpointCount || requiredEndpoints.some(name => !names.includes(name))) throw Error("ENDPOINT_CONTRACT");
  return names.length;
}

async function main() {
  // Do not inherit a timeout extension, a stale manifest path, or debug output.
  delete process.env.DEBUG;
  delete process.env.FUNCTIONS_DISCOVERY_TIMEOUT;
  process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH = "true";
  const candidates = [
    process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules/firebase-tools/lib"),
    process.env.npm_config_prefix && join(process.env.npm_config_prefix, "node_modules/firebase-tools/lib"),
  ].filter(Boolean);
  const cli = candidates.find(base => existsSync(join(base, "deploy/functions/runtimes/node/index.js")));
  if (!cli) throw Error("CLI_UNAVAILABLE");
  const { Delegate } = require(join(cli, "deploy/functions/runtimes/node/index.js"));
  const root = resolve(__dirname, "../..");
  if (existsSync(join(root, "functions/functions.yaml"))) throw Error("STATIC_MANIFEST_FORBIDDEN");
  // Actual CLI spawn, environment whitelist and output parser, with its unchanged
  // default 10s timeout. No SDK cache is injected; no handlers are invoked.
  const startedAt = performance.now();
  discoveryStartedAt = startedAt;
  const build = await discoverOwned(Delegate, ["demo-pay0-discovery", root, join(root, "functions"), "nodejs22"], {}, {
    GCLOUD_PROJECT: "demo-pay0-discovery",
    FIREBASE_CONFIG: JSON.stringify({ projectId: "demo-pay0-discovery", storageBucket: "demo-pay0-discovery.appspot.com" }),
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const count = validateCliBuild(build, elapsedMs);
  console.log(`FUNCTIONS_CLI_DISCOVERY_PASS elapsedMs=${elapsedMs} endpoints=${count} limitMs=${limitMs} transport=temporary-file remoteActions=0`);
}

module.exports = { validateCliBuild, discoverOwned, diagnosticCode };
if (require.main === module) main().catch(error => {
  const elapsedMs = discoveryStartedAt === null ? null : Math.round(performance.now() - discoveryStartedAt);
  console.error(`FUNCTIONS_CLI_DISCOVERY_FAIL code=${diagnosticCode(error)} elapsedMs=${elapsedMs} limitMs=${limitMs} detailsRedacted=true`);
  process.exitCode = 1;
});
