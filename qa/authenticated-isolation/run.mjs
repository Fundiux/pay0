import { spawn } from "node:child_process";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "demo-pay0-ui-qa";
const host = "127.0.0.1";
const request = (options, body) => new Promise((resolve, reject) => {
  const req = http.request(options, (res) => {
    let text = "";
    res.on("data", (chunk) => { text += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, text }));
  });
  req.once("error", reject);
  if (body) req.write(body);
  req.end();
});
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: "/opt/pay0", env, stdio: "inherit" });
  child.once("error", reject);
  child.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`QA_COMMAND_FAILED:${command}:${code ?? signal}`)));
});

await run("npx", ["playwright", "test", "--config", "qa/playwright/authenticated-emulator.config.mjs", "--output=/tmp/pay0-playwright-output"]);
const fixtures = JSON.parse(await readFile("/opt/pay0/qa/.auth/emulator-fixtures.json", "utf8"));
const superadmin = fixtures.accounts.find((account) => account.key === "superadmin");
if (!superadmin || !fixtures.password) throw new Error("AUTH_FIXTURE_MISSING");
const credentials = JSON.stringify({ email: superadmin.email, password: fixtures.password, returnSecureToken: true });
const signIn = await request({ host, port: 9099, path: "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-emulator-only", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(credentials) } }, credentials);
if (signIn.status !== 200) throw new Error(`AUTH_SIGNIN_FAILED:${signIn.status}`);
const idToken = JSON.parse(signIn.text).idToken;
if (!idToken) throw new Error("AUTH_SIGNIN_TOKEN_MISSING");
const payload = JSON.stringify({ data: { event: "LOGIN" } });
const call = await request({ host, port: 5001, path: `/demo-pay0-ui-qa/us-central1/logAuthEventCallable`, method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idToken}`, "content-length": Buffer.byteLength(payload) } }, payload);
const callResult = JSON.parse(call.text)?.result;
if (call.status !== 200 || callResult?.ok !== true || callResult?.event !== "LOGIN") throw new Error(`LOG_AUTH_EVENT_FAILED:${call.status}`);
console.log("AUTHENTICATED_CALLABLE_PASS event=LOGIN");
const app = getApps()[0] || initializeApp({ projectId });
const events = await getFirestore(app).collection("pay0ActivityLog").where("actorUid", "==", "qa-superadmin").limit(1).get();
if (events.empty) throw new Error("LOG_AUTH_EVENT_NOT_PERSISTED");
console.log("AUTHENTICATED_FUNCTIONS_PASS");

await run(process.execPath, ["qa/scripts/authenticated-emulator-rules.cjs"]);
console.log("AUTHENTICATED_BATCH1_PASS");