const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Firestore emulator requerido");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0" });
const { iqCatalogForAlias, iqLinkMatchesMethod, methodAccountRef, resolveIqLink } = require("../../functions/lib/modules/beneficiaries/iqCatalogDomain.js");
const { iqCatalogGate, syncIqCatalog, linkMethodsToCatalog } = require("../../functions/lib/modules/beneficiaries/iqCatalogSync.js");

const db = admin.firestore();
const rootId = "root-catalog";
const catalog = "iq-group-rr";
const clabe = "012180001234567897", clabe2 = "012180009999999999", card = "4111111111111111";
const json = body => ({ ok: true, status: 200, json: async () => body });
const row = (beneficiaryId, accountId, beneficiaryName, conciliationStatus = "Conciliado") => ({ beneficiaryId, accountId, beneficiaryName, conciliationStatus });
const methods = [];
const failures = new Map();

global.fetch = async (url, init = {}) => {
  methods.push(init.method);
  const path = new URL(String(url)).pathname, offset = Number(new URL(String(url)).searchParams.get("offset"));
  if (failures.has(path)) return { ok: false, status: failures.get(path), json: async () => ({}) };
  if (path === "/partners/1/beneficiaries") return json([{ id: 10, name: "Juan Pérez" }, { id: 11, name: "JUAN PEREZ" }, { id: 12, name: "Ana Ruiz" }, { id: 13, name: "Comercial SA" }, { id: 14, name: "Otra Razon SA" }].slice(offset));
  if (offset > 0) return json([]);
  if (path === "/partners") return json([{ id: 1 }]);
  if (path === "/beneficiaries/10/accounts") return json([{ id: 100, clabe, conciliation_status: "Conciliado" }]);
  if (path === "/beneficiaries/11/accounts") return json([{ id: 101, clabe: clabe2, conciliation_status: "Cancelado" }]);
  if (path === "/beneficiaries/12/accounts") return json([{ id: 102, card_number: card, conciliation_status: "Pendiente" }]);
  if (path === "/beneficiaries/13/accounts") return json([{ id: 103, clabe: "012180007777777777", conciliation_status: "Conciliado" }]);
  if (path === "/beneficiaries/14/accounts") return json([{ id: 104, clabe: "012180007777777777", conciliation_status: "Conciliado" }]);
  throw new Error(`RUTA_INESPERADA ${path}`);
};

(async () => {
  assert.equal(iqCatalogForAlias("RR"), catalog);
  assert.equal(iqCatalogForAlias("betell 1"), catalog, "Betell usa el catálogo de RR");
  assert.equal(iqCatalogForAlias("PAY0"), "iq-group-pay0");
  assert.equal(iqCatalogForAlias("OTRO"), null, "un perfil desconocido no se asume");
  assert.equal(methodAccountRef({ clabe: "123" }), null);

  assert.equal(resolveIqLink("x", []).status, "NOT_FOUND");
  assert.equal(resolveIqLink("x", [row(1, 1, "x", "Cancelado")]).status, "NOT_FOUND");
  assert.equal(resolveIqLink("x", [row(1, 1, "x", "Pendiente")]).status, "NOT_CONCILIATED");
  assert.deepEqual(resolveIqLink("Juan", [row(1, 1, "Otro")]), { status: "LINKED", iqBeneficiaryId: 1, iqAccountId: 1, iqBeneficiaryName: "Otro", nameDiffers: true });
  assert.equal(resolveIqLink("José", [row(1, 1, "JOSE"), row(2, 2, "Otro")]).iqBeneficiaryId, 1, "el nombre desempata");
  assert.deepEqual(resolveIqLink("Nadie", [row(2, 2, "A"), row(1, 1, "B")]), { status: "REVIEW_REQUIRED", candidates: [1, 2] }, "PAY0 no elige solo");
  assert.equal(resolveIqLink("A", [row(1, 5, "A"), row(1, 3, "A")]).iqAccountId, 3, "repetida en el mismo beneficiario");

  const state = () => db.doc(`iqBeneficiaryCatalogState/${rootId}_${catalog}`);
  assert.deepEqual(await iqCatalogGate(rootId, catalog), { sync: false, link: false, reason: "IQ_MASTER_OFF" }, "sin master no se toca IQ");
  assert.equal((await state().get()).data().lastSkipReason, "IQ_MASTER_OFF");
  await db.doc(`iqIntegrationConfigs/${rootId}`).set({ rootId, enabled: false });
  assert.equal((await iqCatalogGate(rootId, catalog)).sync, false);
  await db.doc(`iqIntegrationConfigs/${rootId}`).set({ rootId, enabled: true });
  assert.equal((await iqCatalogGate(rootId, catalog)).sync, true);
  await state().set({ paused: true }, { merge: true });
  assert.equal((await iqCatalogGate(rootId, catalog)).reason, "CATALOG_PAUSED");
  await state().set({ paused: false }, { merge: true });

  const session = { apiOrigin: "https://iq.example.com", accessToken: "token" };
  failures.set("/beneficiaries/11/accounts", 500);
  await assert.rejects(syncIqCatalog({ rootId, catalog, session, deadlineMs: Date.now() + 60000, spacingMs: 0 }), /IQ_CATALOG_HTTP_500/);
  const stopped = (await state().get()).data();
  assert.equal(stopped.offset, 1, "un 5xx guarda hasta dónde llegó");
  assert.equal(stopped.lastError, "IQ_CATALOG_HTTP_500");
  failures.delete("/beneficiaries/11/accounts");
  failures.set("/beneficiaries/12/accounts", 404);
  assert.equal(await syncIqCatalog({ rootId, catalog, session, deadlineMs: Date.now() + 60000, spacingMs: 0 }), true, "un 404 no detiene el catálogo");
  assert.deepEqual((await state().get()).data().skippedBeneficiaryIds, [12]);
  failures.delete("/beneficiaries/12/accounts");
  assert.ok((await state().get()).data().nextRunAfter.toMillis() > Date.now(), "al completar espera el siguiente refresco");
  const waiting = await iqCatalogGate(rootId, catalog);
  assert.equal(waiting.sync, false);
  assert.equal(waiting.link, true, "el vínculo termina aunque no toque leer IQ");
  await state().set({ nextRunAfter: null }, { merge: true });
  assert.equal(await syncIqCatalog({ rootId, catalog, session, deadlineMs: Date.now() + 60000, spacingMs: 0 }), true);
  assert.ok(methods.every(method => method === "GET"), "el catálogo solo lee IQ");
  const stored = (await db.doc(`iqBeneficiaryCatalog/${rootId}_${catalog}_100`).get()).data();
  assert.equal(stored.last4, "7897");
  assert.ok(!JSON.stringify(stored).includes(clabe), "la cuenta completa no se copia al catálogo");

  const seed = async (id, name, data) => {
    await db.doc(`clientBeneficiaries/b-${id}`).set({ rootId, nombre: name });
    await db.doc(`clientBeneficiaryMethods/${id}`).set({ rootId, beneficiaryId: `b-${id}`, iqLinkStatus: "PENDING", active: true, ...data });
  };
  await seed("m-link", "JUAN PEREZ", { clabe });
  await seed("m-cancel", "Juan", { clabe: clabe2 });
  await seed("m-pend", "Ana", { cardNumber: card });
  await seed("m-none", "Nadie", { clabe: "012180001111111111" });
  await seed("m-amb", "Sin coincidencia", { clabe: "012180007777777777" });
  await seed("m-off", "Inactivo", { clabe, active: false });
  await linkMethodsToCatalog({ rootId, catalog });
  const link = async id => (await db.doc(`clientBeneficiaryMethods/${id}`).get()).data();
  assert.equal((await link("m-link")).iqLinksByCatalog[catalog].iqAccountId, 100);
  assert.equal((await link("m-link")).iqLinkStatus, "PENDING", "no toca el estado que usan las comisiones");
  assert.equal((await link("m-cancel")).iqLinksByCatalog[catalog].status, "NOT_FOUND");
  assert.equal((await link("m-pend")).iqLinksByCatalog[catalog].status, "NOT_CONCILIATED");
  assert.equal((await link("m-none")).iqLinksByCatalog[catalog].status, "NOT_FOUND");
  assert.deepEqual((await link("m-amb")).iqLinksByCatalog[catalog].candidates, [13, 14]);
  assert.equal((await link("m-off")).iqLinksByCatalog, undefined);
  assert.equal(JSON.stringify((await link("m-link")).iqLinksByCatalog).includes("Juan"), false, "el nombre de IQ no se copia al método");

  const linked = await link("m-link");
  assert.equal(iqLinkMatchesMethod(linked.iqLinksByCatalog[catalog], linked), true);
  assert.equal(iqLinkMatchesMethod(linked.iqLinksByCatalog[catalog], { ...linked, clabe: "012180002222222222" }), false, "un cambio de CLABE invalida el vínculo");

  await db.doc(`iqBeneficiaryCatalog/${rootId}_${catalog}_100`).update({ conciliationStatus: "Cancelado" });
  await state().set({ methodCursor: null }, { merge: true });
  await linkMethodsToCatalog({ rootId, catalog });
  const relinked = (await link("m-link")).iqLinksByCatalog[catalog];
  assert.equal(relinked.status, "NOT_FOUND");
  assert.equal(relinked.iqAccountId, undefined, "no quedan ids de un estado anterior");
  assert.equal(relinked.iqBeneficiaryId, undefined);

  console.log("PASS catálogo IQ: solo lectura, por catálogo, sin cuentas completas y sin elegir entre beneficiarios.");
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
