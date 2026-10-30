/*
 * Runs one isolated test process and writes evidence that remains available
 * even when the interactive terminal disconnects. Usage:
 *   node persistent-test-runner.cjs <spec.json>
 * A spec has { command, args, cwd, timeoutMs, checkpointPattern, env, outputDir }.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const specPath = process.argv[2];
if (!specPath) throw new Error("Uso: node persistent-test-runner.cjs <spec.json>");
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const outputDir = path.resolve(spec.outputDir || path.join("qa", "artifacts", "persistent-tests", path.basename(specPath, ".json")));
fs.mkdirSync(outputDir, { recursive: true });
const startedAt = new Date().toISOString();
const startedMs = Date.now();
const metaPath = path.join(outputDir, "result.json");
const events = fs.createWriteStream(path.join(outputDir, "events.jsonl"), { flags: "a" });
const stdout = fs.createWriteStream(path.join(outputDir, "stdout.log"), { flags: "a" });
const stderr = fs.createWriteStream(path.join(outputDir, "stderr.log"), { flags: "a" });
let lastCheckpoint = "";
let timedOut = false;
let killedTree = false;

function event(type, value = {}) { events.write(`${JSON.stringify({ at: new Date().toISOString(), type, ...value })}\n`); }
function save(result) { fs.writeFileSync(metaPath, JSON.stringify(result, null, 2)); }
function capture(stream, sink, source) {
  stream.on("data", (chunk) => {
    const text = String(chunk); sink.write(text);
    const rx = new RegExp(spec.checkpointPattern || "(?:SMOKE_STAGE|PASS)=[A-Z0-9_-]+", "g");
    for (const match of text.matchAll(rx)) { lastCheckpoint = match[0]; event("checkpoint", { source, value: lastCheckpoint }); }
  });
}

const child = spawn(spec.command, spec.args || [], {
  cwd: path.resolve(spec.cwd || process.cwd()), windowsHide: true,
  env: { ...process.env, ...(spec.env || {}) }, stdio: ["ignore", "pipe", "pipe"],
});
capture(child.stdout, stdout, "stdout"); capture(child.stderr, stderr, "stderr");
event("started", { pid: child.pid, command: spec.command, args: spec.args || [], timeoutMs: spec.timeoutMs });
save({ status: "RUNNING", pid: child.pid, startedAt, command: spec.command, args: spec.args || [], lastCheckpoint });

const timer = setTimeout(() => {
  timedOut = true; event("timeout", { pid: child.pid, timeoutMs: spec.timeoutMs });
  // taskkill /T is required on Windows because Firebase may spawn Java/Node children.
  child.kill();
  const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let killerOutput = "";
  killer.stdout.on("data", chunk => { killerOutput += String(chunk); });
  killer.stderr.on("data", chunk => { killerOutput += String(chunk); });
  killer.once("close", (code) => { killedTree = code === 0; event("tree-kill-result", { pid: child.pid, exitCode: code, output: killerOutput.slice(0, 500) }); });
}, Math.max(1, Number(spec.timeoutMs || 60_000)));

child.once("error", (error) => event("spawn-error", { message: String(error.message || error) }));
child.once("close", (code, signal) => {
  clearTimeout(timer);
  const result = { status: timedOut ? "TIMEOUT" : code === 0 ? "PASSED" : "FAILED", pid: child.pid,
    exitCode: code, signal: signal || null, timedOut, killedTree, startedAt,
    finishedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, lastCheckpoint };
  event("finished", result); save(result); stdout.end(); stderr.end(); events.end();
});
