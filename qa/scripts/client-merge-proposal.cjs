const assert = require("node:assert/strict");
const fs = require("node:fs");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !String(process.env.GCLOUD_PROJECT || "").startsWith("demo-")) throw new Error("LOCAL_EMULATOR_REQUIRED");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
global.fetch = async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const { listDuplicateClientGroups, mergeDuplicateClient } = require("../../functions/lib/modules/clients/mergeCallables.js");
const { proposeCanonical, buildDuplicateGroups } = require("../../functions/lib/modules/clients/mergeProposal.js");

const run = `prp${Date.now()}`;
const rootId = `${run}-root`;
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (v, label) => { assert.ok(v, label); checks++; };
const id = name => `${run}-${name}`;
const client = (name, n, extra = {}) => db.doc(`clients/${id(name)}`).set({ rootId, name, clientNumber: n, rfc: "HEAP8801291C5", active: true, ...extra });
const cand = (cid, numero, iqLinked, solicitudes, pagos) => ({ id: cid, name: cid, numero, iqLinked, iqClientId: "", solicitudes, pagos });

(async () => {
  // Pure criterion --------------------------------------------------------------------------------------------
  eq(proposeCanonical([cand("a", 16, false, 5, 5), cand("b", 19, true, 2, 2)]), "b", "el vínculo IQ activo gana aunque tenga menos historial");
  eq(proposeCanonical([cand("a", 16, true, 1, 1), cand("b", 19, true, 4, 3)]), "b", "con vínculo en ambos gana el que tiene más historial");
  eq(proposeCanonical([cand("b", 19, true, 2, 2), cand("a", 16, true, 2, 2)]), "a", "empate: el número más bajo");
  eq(proposeCanonical([cand("a", 1, true, 0, 0), cand("b", 9, false, 1, 0)]), "b", "nunca uno vacío mientras otro tenga historial");
  eq(proposeCanonical([cand("a", 3, false, 0, 0), cand("b", 2, false, 0, 0)]), "b", "todos vacíos: el número más bajo");

  // Grouping ----------------------------------------------------------------------------------------------------
  await client("c16", 16); await client("c19", 19, { iqLink: { status: "LINKED", clientId: "7565" } });
  await client("c9", 9, { rfc: "TLC2407159M6" }); await client("c26", 26, { rfc: "tlc2407159m6", active: true });
  await client("solo", 30, { rfc: "SOLO010101AB1" });
  await client("generic1", 31, { rfc: "XAXX010101000" }); await client("generic2", 32, { rfc: "XAXX010101000" });
  await client("inactive", 33, { rfc: "SOLO010101AB1", active: false });
  await client("merged", 34, { rfc: "SOLO010101AB1", mergedInto: id("solo") });
  await db.doc(`clients/${run}-foreign`).set({ rootId: `${rootId}-x`, name: "ajeno", clientNumber: 1, rfc: "HEAP8801291C5", active: true });
  await db.doc(`pagos/${run}-p1`).set({ rootId, clienteId: id("c16"), status: "APLICADO" });
  await db.doc(`pagos/${run}-p2`).set({ rootId, clienteId: id("c16"), status: "APLICADO" });
  await db.doc(`pagos/${run}-p3`).set({ rootId, clientId: id("c19"), status: "APLICADO" });
  await db.doc(`solicitudes/${run}-s1`).set({ rootId, clienteId: id("c19"), status: "EN_PROCESO" });
  await db.doc(`pagos/${run}-other`).set({ rootId: `${rootId}-x`, clienteId: id("c19"), status: "APLICADO" });

  const groups = await listDuplicateClientGroups(rootId);
  eq(groups.map(g => g.rfc), ["HEAP8801291C5", "TLC2407159M6"], "solo grupos de RFC único con más de un cliente activo sin fusionar, del root");
  const heap = groups[0];
  eq(heap.clients.map(c => [c.id, c.pagos, c.solicitudes, c.iqLinked]), [[id("c16"), 2, 0, false], [id("c19"), 1, 1, true]], "conteos de pagos y solicitudes por cliente, solo del root, ambos campos");
  eq(heap.proposedCanonicalId, id("c19"), "propone el cliente con vínculo IQ activo");
  const tlc = groups[1];
  eq(tlc.proposedCanonicalId, id("c9"), "ambos vacíos: propone el número más bajo (C9)");
  eq(tlc.clients.map(c => c.numero), [9, 26], "el RFC se compara sin importar mayúsculas");

  // Group disappears once merged ---------------------------------------------------------------------------------
  await mergeDuplicateClient({ rootId, actorUid: "u", actor: {}, canonicalId: id("c9"), duplicateId: id("c26") });
  eq((await listDuplicateClientGroups(rootId)).map(g => g.rfc), ["HEAP8801291C5"], "un grupo fusionado desaparece de la lista");
  await mergeDuplicateClient({ rootId, actorUid: "u", actor: {}, canonicalId: id("c19"), duplicateId: id("c16") });
  eq(await listDuplicateClientGroups(rootId), [], "sin grupos pendientes no queda nada que mostrar");
  eq(buildDuplicateGroups([], new Map()), [], "sin clientes no hay grupos");

  // Wiring ---------------------------------------------------------------------------------------------------------
  const squash = text => text.split(/\s+/).join(" ");
  const src = file => squash(fs.readFileSync(file, "utf8").split("\r\n").join("\n"));
  const cb = src("functions/src/modules/clients/mergeCallables.ts");
  ok(cb.includes('listDuplicateClientGroupsCallable = onCall') && cb.includes('requireRole(caller, ["superadmin"]); assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "clientes", requiredAction: "view" }); const rootId = clean((caller as any)?.rootId) || callerUid; return { ok: true as const, groups: await listDuplicateClientGroups(rootId) };'), "la lectura es solo superadmin, con el root del servidor");
  ok(src("functions/src/index.ts").includes("listDuplicateClientGroupsCallable } from"), "exportada");
  console.log(`PASS propuesta de fusión de clientes: ${checks} verificaciones`);
})().catch(error => { console.error(error); process.exit(1); });
