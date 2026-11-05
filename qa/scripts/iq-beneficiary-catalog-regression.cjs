const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Firestore emulator requerido");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0" });
const { iqCatalogForAlias, methodAccountKey, resolveIqLink } = require("../../functions/lib/modules/beneficiaries/iqCatalogDomain.js");
const { syncIqCatalog, linkMethodsToCatalog } = require("../../functions/lib/modules/beneficiaries/iqCatalogSync.js");

const db = admin.firestore();
const rootId = "root-catalog";
const catalog = "iq-group-rr";
const clabe = "012180001234567897", clabe2 = "012180009999999999", card = "4111111111111111";
const json = body => ({ ok: true, status: 200, json: async () => body });
const row = (beneficiaryId, accountId, beneficiaryName, conciliationStatus = "Conciliado") => ({ beneficiaryId, accountId, beneficiaryName, conciliationStatus });
const methods = [];

global.fetch = async (url, init = {}) => {
  methods.push(init.method);
  const path = new URL(String(url)).pathname, offset = Number(new URL(String(url)).searchParams.get("offset"));
  if (offset > 0) return json([]);
  if (path === "/partners") return json([{ id: 1 }]);
  if (path === "/partners/1/beneficiaries") return json([{ id: 10, name: "Juan Pérez" }, { id: 11, name: "JUAN PEREZ" }, { id: 12, name: "Ana Ruiz" }, { id: 13, name: "Comercial SA" }, { id: 14, name: "Otra Razon SA" }]);
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
  assert.equal(methodAccountKey({ clabe: "123" }), null);

  assert.equal(resolveIqLink("x", []).status, "NOT_FOUND");
  assert.equal(resolveIqLink("x", [row(1, 1, "x", "Cancelado")]).status, "NOT_FOUND");
  assert.equal(resolveIqLink("x", [row(1, 1, "x", "Pendiente")]).status, "NOT_CONCILIATED");
  assert.deepEqual(resolveIqLink("Juan", [row(1, 1, "Otro")]), { status: "LINKED", iqBeneficiaryId: 1, iqAccountId: 1, iqBeneficiaryName: "Otro", nameDiffers: true });
  assert.equal(resolveIqLink("José", [row(1, 1, "JOSE"), row(2, 2, "Otro")]).iqBeneficiaryId, 1, "el nombre desempata");
  assert.deepEqual(resolveIqLink("Nadie", [row(2, 2, "A"), row(1, 1, "B")]), { status: "REVIEW_REQUIRED", candidates: [1, 2] }, "PAY0 no elige solo");
  assert.equal(resolveIqLink("A", [row(1, 5, "A"), row(1, 3, "A")]).iqAccountId, 3, "repetida en el mismo beneficiario");

  const session = { apiOrigin: "https://iq.example.com", accessToken: "token" };
  assert.equal(await syncIqCatalog({ rootId, catalog, session, deadlineMs: Date.now() + 60000, spacingMs: 0 }), true);
  assert.ok(methods.every(method => method === "GET"), "el catálogo solo lee IQ");
  const stored = (await db.doc(`iqBeneficiaryCatalog/${catalog}_100`).get()).data();
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

  console.log("PASS catálogo IQ: solo lectura, por catálogo, sin cuentas completas y sin elegir entre beneficiarios.");
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
