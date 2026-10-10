"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const { validateCliBuild, discoverOwned, diagnosticCode } = require("./verify-functions-cli-discovery.cjs");
const { expectedEndpointCount, requiredEndpoints } = require("./verify-functions-discovery-startup.cjs");

test("failure diagnostics distinguish deadlines without exposing SDK details", () => {
  assert.equal(diagnosticCode(Error("STARTUP_LIMIT")), "STARTUP_LIMIT");
  assert.equal(diagnosticCode(Error("User code failed to load. Cannot determine backend specification. Timeout after 10000ms")), "CLI_TIMEOUT_10000");
  assert.equal(diagnosticCode(Error("User code failed to load. Cannot determine backend specification.\nprivate SDK detail")), "CLI_SDK_LOAD");
  assert.equal(diagnosticCode(Error("Failed to parse build specification")), "CLI_MANIFEST_PARSE");
  assert.equal(diagnosticCode(Error("private SDK detail")), "CLI_OTHER_REDACTED");
  assert.equal(diagnosticCode({ message: "private SDK detail" }), "CLI_OTHER_REDACTED");
});

test("actual CLI build contract rejects timing, malformed manifests and missing critical exports", () => {
  const names = [...requiredEndpoints];
  while (names.length < expectedEndpointCount) names.push(`fixture${names.length}`);
  const endpoints = Object.fromEntries(names.map(name => [name, {}]));
  assert.equal(validateCliBuild({ endpoints }, 7000), 346);
  for (const time of [-1, 7001, Infinity, NaN]) assert.throws(() => validateCliBuild({ endpoints }, time), /STARTUP_LIMIT/);
  for (const build of [null, {}, { endpoints: [] }, { endpoints: "invalid" }]) assert.throws(() => validateCliBuild(build, 1), /INVALID_BUILD/);
  assert.throws(() => validateCliBuild({ endpoints: { ...endpoints, extra: {} } }, 1), /ENDPOINT_CONTRACT/);
  const replaced = { ...endpoints };
  delete replaced[requiredEndpoints[0]];
  replaced.noncriticalReplacement = {};
  assert.throws(() => validateCliBuild({ endpoints: replaced }, 1), /ENDPOINT_CONTRACT/);
});

test("discovery failure terminates its owned hung SDK process", async () => {
  let child;
  class FixtureDelegate {
    spawnFunctionsProcess() {
      child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
      return child;
    }
    async discoverBuild() {
      this.spawnFunctionsProcess();
      await new Promise(resolve => setTimeout(resolve, 100));
      throw Error("FIXTURE_CLI_TIMEOUT");
    }
  }
  await assert.rejects(discoverOwned(FixtureDelegate, [], {}, {}), /FIXTURE_CLI_TIMEOUT/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("interruption cannot produce a successful manifest or spawn new SDK work", async () => {
  class CompletedDelegate {
    async discoverBuild() { process.emit("SIGTERM"); return { endpoints: {} }; }
  }
  await assert.rejects(discoverOwned(CompletedDelegate, [], {}, {}), /INTERRUPTED/);
  let spawned = false;
  class PendingDelegate {
    spawnFunctionsProcess() { spawned = true; throw Error("UNEXPECTED_SPAWN"); }
    async discoverBuild() { process.emit("SIGINT"); this.spawnFunctionsProcess(); }
  }
  await assert.rejects(discoverOwned(PendingDelegate, [], {}, {}), /INTERRUPTED/);
  assert.equal(spawned, false);
});

test("real launcher selects temporary discovery only for Functions deployments and strips timeout extensions", () => {
  const root = mkdtempSync(join(tmpdir(), "pay0-cli-fixture-"));
  try {
    const cli = join(root, "npm/node_modules/firebase-tools/lib/bin/firebase.js");
    mkdirSync(join(cli, ".."), { recursive: true });
    writeFileSync(cli, 'console.log(JSON.stringify({mode:process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH,timeout:process.env.FUNCTIONS_DISCOVERY_TIMEOUT,debug:process.env.DEBUG,args:process.argv.slice(2)}));');
    for (const [args, functions] of [
      [["deploy"], true], [["deploy", "--only", "functions:x"], true],
      [["deploy", "--only=firestore,functions:y"], true], [["deploy", "--only", "functions"], true],
      [["deploy", "--only", "hosting"], false], [["projects:list"], false],
    ]) {
      const result = spawnSync(process.execPath, [resolve(__dirname, "../../scripts/run-firebase-clean-env.mjs"), ...args], {
        env: { ...process.env, APPDATA: root, FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH: "false", FUNCTIONS_DISCOVERY_TIMEOUT: "999", DEBUG: "fixture" },
        encoding: "utf8", windowsHide: true, timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout.trim());
      assert.equal(output.mode, functions ? "true" : "false");
      assert.equal(output.timeout, functions ? undefined : "999");
      assert.equal(output.debug, undefined);
      assert.deepEqual(output.args, args);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
