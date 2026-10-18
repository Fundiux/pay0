import { access, constants, stat } from "node:fs/promises";
const required = ["/opt/pay0/functions", "/opt/pay0/firestore.rules", "/opt/pay0/.next", "/opt/pay0/test-results", "/opt/pay0/qa/playwright/test-results"];
for (const path of required) await access(path, constants.F_OK);
for (const path of ["/opt/pay0/.next", "/opt/pay0/test-results", "/opt/pay0/qa/playwright/test-results"]) { await access(path, constants.W_OK); const info = await stat(path); if (!info.isDirectory()) throw new Error(`WRITABLE_PATH_NOT_DIRECTORY:${path}`); }
console.log("AUTHENTICATED_QA_PATH_PREFLIGHT_PASS");