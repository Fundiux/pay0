const assert = require("node:assert/strict");
const fs = require("node:fs");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !String(process.env.GCLOUD_PROJECT || "").startsWith("demo-")) throw new Error("LOCAL_EMULATOR_REQUIRED");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
global.fetch = async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const { mergeDuplicateClient } = require("../../functions/lib/modules/clients/mergeCallables.js");
const { planClientMerge, resolveCanonicalClientId, mergedClientBlocksPermission } = require("../../functions/lib/modules/clients/mergeDomain.js");
const { requireClientOperationalAccess } = require("../../functions/lib/modules/clientDelegations/access.js");

const run = `mrg${Date.now()}`;
const rootId = `${run}-root`;
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (v, label) => { assert.ok(v, label); checks++; };
const rejects = async (fn, code, label) => {
  try { await fn(); } catch (error) { eq(error?.details?.code || error?.code, code, label); return; }
  assert.fail(`${label}: no falló`);
};

const superUid = `${run}-super`, adminUid = `${run}-admin`;
const superUser = { role: "superadmin", rootId, active: true, email: "s@x.test" };
const actor = { ...superUser };
const client = (name, extra = {}) => db.doc(`clients/${run}-${name}`).set({ rootId, name, rfc: "HEAP8801291C5", active: true, adminId: adminUid, ...extra });
const id = name => `${run}-${name}`;
const merge = (canonical, duplicate, extra = {}) => mergeDuplicateClient({ rootId, actorUid: superUid, actor, canonicalId: id(canonical), duplicateId: id(duplicate), ...extra });

(async () => {
  await db.doc(`users/${superUid}`).set(superUser);
  await db.doc(`users/${adminUid}`).set({ role: "admin", rootId, active: true });

  // Pure plan ---------------------------------------------------------------------------------------------
  const base = { rootId: "r", canonicalId: "a", duplicateId: "b", canonical: { rootId: "r", rfc: "HEAP8801291C5", active: true }, duplicate: { rootId: "r", rfc: "heap8801291c5" } };
  eq(planClientMerge(base).ok, true, "mismo RFC y root: se puede");
  eq(planClientMerge({ ...base, duplicateId: "a" }).refusal, "SAME_CLIENT", "no se fusiona consigo mismo");
  eq(planClientMerge({ ...base, duplicate: { ...base.duplicate, rfc: "OTRO010101AB1" } }).refusal, "RFC_DIFFERENT", "RFC distinto");
  eq(planClientMerge({ ...base, duplicate: { ...base.duplicate, rootId: "x" } }).refusal, "OUT_OF_ROOT", "otro root");
  eq(planClientMerge({ ...base, canonical: { ...base.canonical, rfc: "XAXX010101000" }, duplicate: { ...base.duplicate, rfc: "XAXX010101000" } }).refusal, "RFC_MISSING", "RFC genérico no se fusiona");
  eq(planClientMerge({ ...base, canonical: { ...base.canonical, mergedInto: "z" } }).refusal, "CANONICAL_IS_MERGED", "un fusionado no puede ser el vigente");
  eq(planClientMerge({ ...base, canonical: { ...base.canonical, active: false } }).refusal, "CANONICAL_INACTIVE", "vigente inactivo");
  eq(planClientMerge({ ...base, duplicate: { ...base.duplicate, mergedInto: "z" } }).refusal, "DUPLICATE_ALREADY_MERGED", "ya fusionado");
  eq(resolveCanonicalClientId("b", { mergedInto: "a" }), "a", "una operación nueva se resuelve al vigente");
  eq(resolveCanonicalClientId("a", {}), "a", "sin fusión queda igual");
  eq([mergedClientBlocksPermission({ mergedInto: "a" }, "operatePagos"), mergedClientBlocksPermission({ mergedInto: "a" }, "viewBasic"), mergedClientBlocksPermission({}, "operatePagos")], [true, false, false], "bloquea operar, no ver");

  // Merge keeps history exactly as it was -----------------------------------------------------------------
  await client("keep"); await client("dup");
  await db.doc(`pagos/${run}-p1`).set({ rootId, clientId: id("dup"), status: "APLICADO", amount: 1500 });
  await db.doc(`solicitudes/${run}-s1`).set({ rootId, clientId: id("dup"), status: "EN_PROCESO" });
  await db.doc(`balanceAccounts/CLIENT_${id("dup")}`).set({ rootId, balance: 250 });
  const snapshot = async () => JSON.stringify(await Promise.all([`pagos/${run}-p1`, `solicitudes/${run}-s1`, `balanceAccounts/CLIENT_${id("dup")}`].map(async path => (await db.doc(path).get()).data())));
  const before = await snapshot();
  const result = await merge("keep", "dup", { reason: "RFC duplicado" });
  eq([result.ok, result.alreadyMerged], [true, false], "fusión hecha");
  eq(await snapshot(), before, "pagos, solicitudes y saldos existentes no se tocan");
  const dup = (await db.doc(`clients/${id("dup")}`).get()).data(), keep = (await db.doc(`clients/${id("keep")}`).get()).data();
  eq([dup.mergedInto, dup.mergedBy, dup.mergeReason, dup.active], [id("keep"), superUid, "RFC duplicado", true], "el duplicado queda marcado y conserva su estado");
  ok(dup.mergedAt, "fecha de fusión");
  eq(keep.mergedDuplicateIds, [id("dup")], "el vigente lista sus duplicados");
  const audits = await db.collection("pay0ActivityLog").where("referenceId", "==", id("dup")).get();
  eq(audits.docs.map(d => d.get("event")), ["CLIENT_MERGED"], "una auditoría por fusión");

  // Idempotent and chain-safe ----------------------------------------------------------------------------
  eq((await merge("keep", "dup")).alreadyMerged, true, "repetir el mismo par no hace nada");
  eq((await db.collection("pay0ActivityLog").where("referenceId", "==", id("dup")).get()).size, 1, "sin auditoría duplicada");
  await client("third");
  await rejects(() => merge("third", "dup"), "CLIENT_MERGE_DUPLICATE_ALREADY_MERGED", "un duplicado ya fusionado no pasa a otro");
  await rejects(() => merge("dup", "third"), "CLIENT_MERGE_CANONICAL_IS_MERGED", "no se fusiona hacia un duplicado");
  await client("other-rfc", { rfc: "TLC2407159M6" });
  await rejects(() => merge("keep", "other-rfc"), "CLIENT_MERGE_RFC_DIFFERENT", "RFC distinto no se fusiona");
  await db.doc(`clients/${run}-foreign`).set({ rootId: `${rootId}-x`, name: "ajeno", rfc: "HEAP8801291C5", active: true });
  await rejects(() => merge("keep", "foreign"), "CLIENT_MERGE_OUT_OF_ROOT", "otro root no se fusiona");

  // Operations: new ones are blocked on the duplicate, history stays readable -----------------------------
  const access = (clientId, permission, uid = superUid, role = "superadmin") => requireClientOperationalAccess({ uid, role, rootId, clientId, permission });
  for (const permission of ["operatePagos", "operateSolicitudes", "operateBeneficiarios", "operateDispersiones", "operate"]) {
    await rejects(() => access(id("dup"), permission), "CLIENT_MERGED", `${permission} en el duplicado se bloquea`);
  }
  await rejects(() => access(id("dup"), "operatePagos", adminUid, "admin"), "CLIENT_MERGED", "también para el admin dueño del cliente");
  ok((await access(id("dup"), "viewBasic")).allowed, "el historial del duplicado se puede ver");
  ok((await access(id("dup"), "view")).allowed, "ver el cliente duplicado sigue permitido");
  ok((await access(id("keep"), "operatePagos")).allowed, "el vigente opera normal");
  ok((await access(id("keep"), "operatePagos", adminUid, "admin")).allowed, "el admin opera en el vigente");

  // Wiring -------------------------------------------------------------------------------------------------
  const callable = fs.readFileSync("functions/src/modules/clients/mergeCallables.ts", "utf8");
  ok(/requireRole\(caller, \["superadmin"\]\)/.test(callable) && /allowedRoles: \["superadmin"\]/.test(callable), "el callable es solo superadmin");
  ok(/rootId = clean\(\(caller as any\)\?\.rootId\) \|\| callerUid/.test(callable), "el root sale del usuario, no del navegador");
  ok(/mergeDuplicateClientCallable/.test(fs.readFileSync("functions/src/index.ts", "utf8")), "exportado");
  const rfcGuard = fs.readFileSync("functions/src/modules/clients/callables.ts", "utf8");
  ok(/!doc\.get\("mergedInto"\)/.test(rfcGuard), "un fusionado no bloquea el RFC del vigente");
  console.log(`PASS fusión de clientes hacia adelante: ${checks} verificaciones`);
})().catch(error => { console.error(error); process.exit(1); });
