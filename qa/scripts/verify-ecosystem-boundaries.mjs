import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const boundaries = JSON.parse(read("config/ecosystem-boundaries.json"));
const roles = read("src/lib/roles.ts");
const activity = read("src/components/ActivityLog.tsx");
const activityPage = read("src/app/activity-log/page.tsx");
const logger = read("functions/src/utils/logActivity.ts");
const facturamaSandbox = read("functions/src/modules/facturama/sandboxCallables.ts");
const paymentApplications = read("functions/src/modules/paymentApplications/service.ts");
const iqDispersions = read("functions/src/modules/iq/dispersionCreationCallables.ts");
const rules = read("firestore.rules");
const backendBoundary = read("functions/src/modules/activityLog/systemBoundary.ts");

assert.equal(boundaries.systems.PAY0.activityCollection, "pay0ActivityLog");
assert.equal(boundaries.systems.ASSETS.activityCollection, "assetsActivityLog");
assert.equal(boundaries.systems.CANONICAL, undefined);
assert(boundaries.systems.PAY0.owns.includes("pay0Canonical"));
assert.deepEqual(boundaries.systems.HUGO.mayReadSystems, ["PAY0", "ASSETS", "TTT"]);
assert.doesNotMatch(roles, /label:\s*["']Hugo["'][^\n]*href:\s*["']\/hugo["']/);
assert.doesNotMatch(backendBoundary, /CANONICAL:\s*["']canonicalActivityLog/);
assert.match(backendBoundary, /GLOBAL_CANONICAL_ACTIVITY_FORBIDDEN/);
assert.match(activity, /SYSTEM_ACTIVITY_COLLECTIONS\.PAY0/);
assert.match(activity, /belongsToSystem\(row, "PAY0"\)/);
assert.match(activityPage, /activityEventBelongsToSystem\(eventKey, "PAY0"\)/);
assert.match(activityPage, /title="Actividad PAY0"/);
assert.match(logger, /activityCollectionForSystem\(payload\.sourceSystem\)/);
for (const source of [facturamaSandbox, paymentApplications, iqDispersions]) {
  assert.doesNotMatch(source, /collection\(["']activityLog["']\)/);
}
for (const collectionName of ["pay0ActivityLog", "assetsActivityLog", "tttActivityLog", "hugoActivityLog"]) {
  assert.match(rules, new RegExp(`match /${collectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/{docId\\}`));
}

const canonicalContract = read("functions/src/modules/canonicalCenter/contracts.ts");
assert.match(canonicalContract, /system: "PAY0"/);
assert.match(canonicalContract, /pay0CanonicalResources/);
assert.doesNotMatch(canonicalContract, /resources: "canonicalResources"/);
console.log("PASS ecosystem boundaries and PAY0 Canonical ownership contract");
