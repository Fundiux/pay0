import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";

const projectId = "demo-pay0-delegations";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only isolated demo project allowed");
for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
  assert.match(process.env[key] || "", /^127\.0\.0\.1:\d+$/, `${key} must be loopback`);
}
const require = createRequire(import.meta.url);
const functionsRequire = createRequire(new URL("../../functions/package.json", import.meta.url));
const ts = require("typescript");
const panel = ts.createSourceFile("panel.tsx", fs.readFileSync("src/components/UserClientAccessPanel.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const payloadBuilder = panel.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "buildClientAccessItemPayload");
assert(payloadBuilder, "Use the panel's actual pure payload builder for the roundtrip");
const panelExports = {};
runInNewContext(ts.transpileModule(payloadBuilder.getText(panel),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: panelExports });
// Execute current TypeScript sources; no dependence on stale functions/lib.
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText, filename);
const admin = functionsRequire("firebase-admin");
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore();
const stamp = admin.firestore.Timestamp;
const { delegationIsCurrent, canonicalDelegationTime } = require("../../functions/src/modules/clientDelegations/policy.ts");
const { resolveClientOperationalAccess, getCurrentClientDelegationAccess } = require("../../functions/src/modules/clientDelegations/access.ts");
const { setUserClientAccessService } = require("../../functions/src/modules/clientDelegations/service.ts");
const env = await initializeTestEnvironment({ projectId,
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  storage: { rules: fs.readFileSync("storage.rules", "utf8") },
});
const rootId = "delegation-root", uid = "delegated-user", clientId = "delegated-client";
const accessRef = db.doc(`userClientAccess/${uid}/clients/${clientId}`);
const actor = { rootId, role: "operador", active: true };
const grant = { rootId, targetUid: uid, clientId, active: true };
const families = [
  ["solicitudes", "solicitudes", "operateSolicitudes"],
  ["pagos", "pagos", "operatePagos"],
  ["clientDispersions", "dispersiones", "operateDispersiones"],
];
let assertions = 0;
const backend = () => resolveClientOperationalAccess({ uid, role: "operador", rootId, clientId });
const storage = env.authenticatedContext(uid).storage();
const firestore = env.authenticatedContext(uid).firestore();
const objectPath = kind => `roots/${rootId}/${kind}/op/docs/EVIDENCIA/test.txt`;
async function checkSurfaces(label, data, allowed) {
  await accessRef.set(data);
  assert.equal((await backend()).allowed, allowed, `${label}: backend`); assertions++;
  for (const collection of ["clients", "solicitudes", "pagos"]) {
    const promise = getDoc(doc(firestore, collection, collection === "clients" ? clientId : "op"));
    await (allowed ? assertSucceeds(promise) : assertFails(promise)); assertions++;
  }
  for (const [, kind] of families) {
    const promise = getBytes(ref(storage, objectPath(kind)));
    await (allowed ? assertSucceeds(promise) : assertFails(promise)); assertions++;
  }
  console.log(`PASS ${label}`);
}

try {
  await env.clearFirestore();
  await db.doc(`users/${uid}`).set(actor);
  await db.doc(`users/${rootId}`).set({ rootId, role: "superadmin", active: true });
  await db.doc(`clients/${clientId}`).set({ rootId, adminId: rootId, createdBy: rootId, active: true });
  for (const [collection, kind] of families) {
    await db.doc(`${collection}/op`).set({ rootId, clientId, adminId: rootId, createdBy: rootId });
    await env.withSecurityRulesDisabled(async context => {
      await uploadBytes(ref(context.storage(), objectPath(kind)), new TextEncoder().encode("synthetic fixture"));
    });
  }
  const now = Date.now(), future = stamp.fromMillis(now + 3600000);
  for (const [label, data, allowed] of [
    ["legacy missing expiry/permissions", grant, true],
    ["legacy null expiry", { ...grant, expiresAt: null }, true],
    ["timestamp future", { ...grant, expiresAt: future }, true],
    ["legacy epoch future", { ...grant, expiresAt: future.toMillis() }, true],
    ["expired", { ...grant, expiresAt: stamp.fromMillis(now - 1000) }, false],
    ["inactive", { ...grant, active: false }, false],
    ["temporary missing expiry", { ...grant, mode: "TEMPORARY" }, false],
    ["revoked timestamp", { ...grant, revokedAt: future }, false],
    ["revoked false still non-null", { ...grant, revokedAt: false }, false],
    ["revoked zero still non-null", { ...grant, revokedAt: 0 }, false],
    ["wrong root", { ...grant, rootId: "other" }, false],
    ["wrong target", { ...grant, targetUid: "other" }, false],
    ["wrong client", { ...grant, clientId: "other" }, false],
    ["starts in future", { ...grant, startsAt: future }, false],
    ["permissions null", { ...grant, permissions: null }, false],
    ["permissions malformed", { ...grant, permissions: "yes" }, false],
    ["permission string not boolean", { ...grant, permissions: { view: "yes", operate: "yes" } }, false],
  ]) await checkSurfaces(label, data, allowed);
  for (const invalid of ["2099-01-01", "", false, 0, -1, Infinity, NaN, {}, { seconds: 4102444800 }]) {
    await checkSurfaces(`invalid expiry ${typeof invalid === "number" ? String(invalid) : JSON.stringify(invalid)}`, { ...grant, expiresAt: invalid }, false);
  }
  assert.equal(delegationIsCurrent({ ...grant, expiresAt: stamp.fromMillis(now) }, now), false);
  assert.equal(delegationIsCurrent({ ...grant, expiresAt: now }, now), false);
  assert.equal(delegationIsCurrent({ ...grant, expiresAt: stamp.fromMillis(now + 1) }, now), true);
  assertions += 3;
  // Permission removal takes effect on the next read, even with legacy operate=true.
  await accessRef.set({ ...grant, permissions: { view: true, operate: true, operatePagos: false } });
  assert.equal((await backend()).permissions.operatePagos, false);
  assert.equal(await getCurrentClientDelegationAccess(uid, clientId, "operatePagos"), null);
  await assertFails(getDoc(doc(firestore, "pagos", "op")));
  await assertFails(getBytes(ref(storage, objectPath("pagos"))));
  await assertSucceeds(getDoc(doc(firestore, "solicitudes", "op")));
  await assertSucceeds(getBytes(ref(storage, objectPath("solicitudes")))); assertions += 6;
  await accessRef.set({ ...grant, permissions: { view: true, viewBasic: false, operate: true } });
  assert.equal((await backend()).permissions.view, false, "generic view cannot bypass viewBasic revocation");
  await assertFails(getDoc(doc(firestore, "clients", clientId))); assertions += 2;
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "clients", clientId)));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), objectPath("solicitudes")))); assertions += 2;
  // Current user lifecycle/root belongs to backend and Firestore. Storage S-01
  // needs a separate design because operation+delegation consumes its 2 reads.
  await accessRef.set(grant);
  for (const patch of [{ active: false }, { isActive: false }, { isDeleted: true }, { disabled: true },
    { deleted: true }, { deletedAt: future }, { rootId: "other" }]) {
    await db.doc(`users/${uid}`).set({ ...actor, ...patch });
    assert.equal((await backend()).allowed, false);
    await assertFails(getDoc(doc(firestore, "clients", clientId))); assertions += 2;
  }
  await db.doc(`users/${uid}`).set(actor);
  const save = item => setUserClientAccessService({ auth: { uid: rootId }, data: { targetUid: uid, accessItems: [{ clientId, ...item }] } });
  for (const expiresAt of ["bad", "", false, 0, -1, {}, stamp.fromMillis(now - 1)]) {
    await assert.rejects(save({ expiresAt }), error => error.code === "invalid-argument"); assertions++;
  }
  await assert.rejects(save({ mode: "TEMPORARY" }), error => error.code === "invalid-argument"); assertions++;
  await assert.rejects(save({ permissions: { operatePagos: "true" } }), error => error.code === "invalid-argument"); assertions++;
  await assert.rejects(save({ permissions: null }), error => error.code === "invalid-argument"); assertions++;
  await save({ mode: "TEMPORARY", expiresAt: { seconds: future.seconds, nanoseconds: future.nanoseconds } });
  assert((await accessRef.get()).data().expiresAt instanceof stamp); assertions++;
  assert(canonicalDelegationTime(future.toMillis()) instanceof stamp); assertions++;
  const metadata = { clientId, mode: "TEMPORARY", startsAt: { seconds: Math.floor(now / 1000) - 60, nanoseconds: 0 },
    expiresAt: { seconds: future.seconds, nanoseconds: future.nanoseconds }, grantReason: "Acceso temporal de prueba" };
  const permissionEdit = panelExports.buildClientAccessItemPayload(metadata, { view: true, operate: true, operatePagos: false });
  await save(permissionEdit);
  const roundtrip = (await accessRef.get()).data();
  assert.equal(roundtrip.mode, "TEMPORARY");
  assert.equal(roundtrip.expiresAt.toMillis(), future.toMillis());
  assert.equal(roundtrip.startsAt.seconds, metadata.startsAt.seconds);
  assert.equal(roundtrip.grantReason, metadata.grantReason);
  assert.equal(roundtrip.permissions.operatePagos, false); assertions += 5;
  // Redelegation preserves capability but cannot amplify a narrow grant.
  const grantor = "delegating-admin";
  await db.doc(`users/${grantor}`).set({ rootId, role: "admin", active: true });
  await db.doc(`userClientAccess/${grantor}/clients/${clientId}`).set({ ...grant, targetUid: grantor,
    expiresAt: future, permissions: { view: true, operate: true, operatePagos: false } });
  const regrant = item => setUserClientAccessService({ auth: { uid: grantor }, data: { targetUid: uid, accessItems: [{ clientId, ...item }] } });
  await assert.rejects(regrant({ expiresAt: future }), error => error.code === "permission-denied"); assertions++;
  await assert.rejects(regrant({ permissions: { operatePagos: false } }), error => error.code === "permission-denied"); assertions++;
  await regrant({ expiresAt: future, permissions: { operatePagos: false } }); assertions++;
  await db.doc(`userClientAccess/${grantor}/clients/${clientId}`).update({ revokedAt: stamp.now() });
  await assert.rejects(regrant({ expiresAt: future, permissions: { operatePagos: false } }), error => error.code === "permission-denied"); assertions++;
  // Compatibility with the production baseline recovered before this change.
  await accessRef.set(grant);
  const userFundedPath = `roots/${rootId}/dispersiones/private/docs/EVIDENCIA/test.txt`;
  await db.doc("clientDispersions/private").set({ rootId, clientId, adminId: rootId, createdBy: rootId,
    ownerUid: uid, fundingSource: { holderType: "USER", ownerUid: uid, sourceClientId: clientId } });
  await env.withSecurityRulesDisabled(context => uploadBytes(ref(context.storage(), userFundedPath), new Uint8Array([1])));
  await assertSucceeds(getDoc(doc(firestore, "clientDispersions", "private")));
  await assertSucceeds(getBytes(ref(storage, userFundedPath)));
  await db.doc("users/other-reader").set(actor);
  await db.doc(`userClientAccess/other-reader/clients/${clientId}`).set({ ...grant, targetUid: "other-reader" });
  const other = env.authenticatedContext("other-reader");
  await assertFails(getDoc(doc(other.firestore(), "clientDispersions", "private")));
  await assertFails(getBytes(ref(other.storage(), userFundedPath))); assertions += 4;
  await db.doc(`users/${uid}`).update({ active: false });
  await assertFails(getBytes(ref(storage, userFundedPath))); assertions++;
  await db.doc(`users/${uid}`).set(actor);
  const stagingPath = `pay0-canonical-staging/${rootId}/${rootId}/synthetic-session/file`;
  await db.doc("pay0CanonicalUploadSessions/synthetic-session").set({ rootId, uid: rootId, status: "PENDING",
    expiresAt: future, storagePath: stagingPath, contentType: "application/pdf", sizeBytes: 1 });
  const rootContext = env.authenticatedContext(rootId);
  await assertSucceeds(uploadBytes(ref(rootContext.storage(), stagingPath), new Uint8Array([1]), { contentType: "application/pdf" }));
  await assertFails(getBytes(ref(rootContext.storage(), stagingPath)));
  await assertFails(uploadBytes(ref(storage, `pay0-canonical/${rootId}/file`), new Uint8Array([1]))); assertions += 3;
  for (const collection of ["authUsernames", "pay0CanonicalResources", "commissionUserEntitlements"]) {
    await db.doc(`${collection}/synthetic`).set({ rootId });
    await assertFails(getDoc(doc(rootContext.firestore(), collection, "synthetic"))); assertions++;
  }
  await db.doc("pay0ActivityLog/synthetic").set({ rootId, sourceSystem: "PAY0", actorUid: uid });
  await assertSucceeds(getDoc(doc(firestore, "pay0ActivityLog", "synthetic")));
  await db.doc("pay0ActivityLog/synthetic").update({ rootId: "foreign" });
  await assertFails(getDoc(doc(firestore, "pay0ActivityLog", "synthetic"))); assertions += 2;
  console.log("PASS production baseline: private user funding, corporate staging, canonical deny, log scoping");
  console.log(`PASS remediation delegations: ${assertions} assertions; isolated Firestore+Storage+backend`);
} finally {
  await env.cleanup();
  await admin.app().delete();
}
