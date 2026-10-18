import { access, constants, readFile, stat } from "node:fs/promises";
const required = ["/opt/pay0/functions", "/opt/pay0/firestore.rules", "/opt/pay0/.next", "/opt/pay0/test-results", "/opt/pay0/qa/playwright/test-results"];
for (const path of required) await access(path, constants.F_OK);
for (const path of ["/opt/pay0/.next", "/opt/pay0/test-results", "/opt/pay0/qa/playwright/test-results"]) { await access(path, constants.W_OK); const info = await stat(path); if (!info.isDirectory()) throw new Error(`WRITABLE_PATH_NOT_DIRECTORY:${path}`); }
const configPath = "/opt/pay0/firebase.authenticated-qa.json";
await access(configPath, constants.R_OK);
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.functions?.source !== "functions" || config.firestore?.rules !== "firestore.rules") throw new Error("AUTHENTICATED_QA_FIREBASE_CONFIG_PATH_INVALID");
const hosts = [config.emulators?.auth?.host, config.emulators?.firestore?.host, config.emulators?.functions?.host];
if (!hosts.every((host) => host === "127.0.0.1")) throw new Error("AUTHENTICATED_QA_NONLOCAL_EMULATOR_HOST");
console.log("AUTHENTICATED_QA_PATH_PREFLIGHT_PASS");
