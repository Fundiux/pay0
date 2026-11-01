import net from "node:net";
import { readFile } from "node:fs/promises";

const [pidText, logPath] = process.argv.slice(2);
const pid = Number(pidText);
const timeoutMs = Number(process.env.AUTHENTICATED_QA_READINESS_TIMEOUT_MS || 90_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) throw new Error("AUTHENTICATED_QA_READINESS_TIMEOUT_INVALID");
const deadline = Date.now() + timeoutMs;
const projectId = "demo-pay0-ui-qa";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const portOpen = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  const done = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(1_500, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});
const request = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
};
const processAlive = () => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

console.log("AUTHENTICATED_QA_STAGE emulators:start");
let last = "ports";
while (Date.now() < deadline) {
  if (!processAlive()) break;
  const [authPort, firestorePort, functionsPort] = await Promise.all([portOpen(9099), portOpen(8080), portOpen(5001)]);
  if (!authPort || !firestorePort || !functionsPort) {
    last = `ports auth=${authPort} firestore=${firestorePort} functions=${functionsPort}`;
    await delay(1_000);
    continue;
  }
  try {
    const auth = await request(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`);
    const firestore = await request(`http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`);
    const callable = await request(`http://127.0.0.1:5001/${projectId}/us-central1/logAuthEventCallable`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { event: "LOGIN" } }),
    });
    if (auth.status < 500 && firestore.status < 500 && [401, 403].includes(callable.status)) {
      console.log("AUTHENTICATED_QA_STAGE auth:ready");
      console.log("AUTHENTICATED_QA_STAGE firestore:ready");
      console.log("AUTHENTICATED_QA_STAGE functions:ready callable=logAuthEventCallable");
      process.exit(0);
    }
    last = `http auth=${auth.status} firestore=${firestore.status} callable=${callable.status}`;
  } catch (error) {
    last = `request ${error instanceof Error ? error.message : String(error)}`;
  }
  await delay(1_000);
}
let log = "";
try { log = (await readFile(logPath, "utf8")).slice(-8_000); } catch {}
console.error(`AUTHENTICATED_QA_READINESS_TIMEOUT last=${last} processAlive=${processAlive()}`);
if (log) console.error(`AUTHENTICATED_QA_EMULATOR_LOG\n${log}`);
process.exit(1);
