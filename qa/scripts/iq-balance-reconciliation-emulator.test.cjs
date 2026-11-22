const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Firestore emulator requerido");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0" });
const { SafetyRuntime, scopeId } = require("../../functions/lib/modules/automationSafety/runtime.js");
const domain = require("../../functions/lib/modules/iqBalanceReconciliation/domain.js");
const { runIqBalanceReconciliation } = require("../../functions/lib/modules/iqBalanceReconciliation/service.js");
const { getIqBalanceComparison } = require("../../functions/lib/modules/iqBalanceReconciliation/callables.js");
const { loadPendingItems } = require("../../functions/lib/modules/agentOperations/pendingItems.js");

const db = admin.firestore();
const rootId = "rootBal00001", superUid = rootId, adminA = "adminAuid001", adminB = "adminBuid001", operador = "operUid00001";
const day = "2026-11-20";
const calls = [];
const json = body => ({ ok: true, status: 200, json: async () => body });

// IQ faked at the HTTP boundary. RR and PAY0 are two IQ data groups with their own clients.
let general = {
  "rr": [
    { client_id: 101, client_name: "CLIENTE UNO IQ", balance: "1,000.005", partner: "RR", created_at: "2026-01-01" },
    { client_id: 999, client_name: "SIN VINCULO SA", balance: "75.00", partner: "ELIUT", created_at: "2026-01-01" },
  ],
  "pay0": [{ client_id: 201, client_name: "CLIENTE DOS IQ", balance: "450.00", partner: { id: 7, name: "Asociado ELIUT" }, created_at: "2026-01-01" }],
};
global.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const group = parsed.hostname.split(".")[0];
  calls.push({ method: init.method, group, path: parsed.pathname });
  assert.equal(init.method, "GET", "la conciliación solo lee IQ");
  if (parsed.pathname === "/balances/general") return json(general[group]);
  if (parsed.pathname === "/balances/details") {
    assert.equal(parsed.searchParams.get("client_id"), "201");
    assert.equal(parsed.searchParams.get("month"), "11");
    assert.equal(parsed.searchParams.get("year"), "2026");
    return json({ client_name: "CLIENTE DOS IQ", previous_balance: "400.00", total_credits: "100.00", total_charges: "50.00", movements: [
      { client_movement_id: 1, individual_id: "D-77", concepto: "Depósito", fecha: "2026-11-05", credit: "100.00", charge: "0", balance: "500.00" },
      { client_movement_id: 2, individual_id: "X-9", concepto: "Dispersión a proveedor", fecha: "2026-11-10", credit: "0", charge: "50.00", balance: "450.00" },
    ] });
  }
  throw new Error(`RUTA_INESPERADA ${parsed.pathname}`);
};
const source = (catalog, group) => ({ catalog, openSession: async () => ({ apiOrigin: `https://${group}.iq.example.com`, accessToken: "token" }) });
const catalogs = [source("iq-group-rr", "rr"), source("iq-group-pay0", "pay0")];
const link = (alias, clientId, partnerName) => ({ [`profile-${alias}`]: { status: "LINKED", active: true, clientId: String(clientId), profileAlias: alias, partnerName } });
const nov5 = admin.firestore.Timestamp.fromDate(new Date("2026-11-05T18:00:00Z"));
const call = (uid, data = {}) => getIqBalanceComparison.run({ auth: { uid, token: {} }, data, rawRequest: {} });

(async () => {
  // Pure rules.
  assert.equal(domain.parseIqMoney("1,234.50"), 1234.5);
  assert.equal(domain.parseIqMoney("abc"), null, "un saldo ilegible no se toma como cero");
  assert.equal(domain.compareBalances(100, 100.01).status, "MATCH", "tolerancia de un centavo");
  assert.equal(domain.compareBalances(100, 100.02).status, "DIFFERENT");
  assert.equal(domain.compareBalances(-100, 100).signInverted, true);
  assert.equal(domain.partnerOf({ id: 7, name: "Asociado ELIUT" }).key, "ELIUT");
  assert.equal(domain.partnerOwnerMap("Ab4z0RttIqXbZFT0NuWsDjBkt6J2", {}).get("RR"), "lcOz4nO5DTbksM3Lbz3hJcCpCdu1", "RR es BETELL según la política R3");
  assert.equal(domain.partnerOwnerMap("otraRaiz0001", {}).size, 0, "la política R3 no se aplica a otra raíz");

  await db.doc(`users/${superUid}`).set({ rootId, role: "superadmin", active: true, username: "DUENO" });
  await db.doc(`users/${adminA}`).set({ rootId, role: "admin", active: true, username: "SOCIO A", modules: { wallet: { view: true, saldos: true } } });
  await db.doc(`users/${adminB}`).set({ rootId, role: "admin", active: true, username: "SOCIO B", modules: { wallet: { view: true, saldos: true } } });
  await db.doc(`users/${operador}`).set({ rootId, role: "operador", active: true, username: "OPER", adminId: adminA, modules: { wallet: { view: true, saldos: true } } });
  await db.doc(`iqIntegrationConfigs/${rootId}`).set({ rootId, enabled: true });
  await db.doc(`iqBalanceReconciliationConfig/${rootId}`).set({ rootId, partnerAdminIds: { ELIUT: adminB, RR: adminA } });
  await db.doc("clients/c1").set({ rootId, adminId: adminA, name: "Cliente Uno", clientNumber: 1, iqLinksByProfile: link("RR", 101, "RR") });
  await db.doc("clients/c2").set({ rootId, adminId: adminB, name: "Cliente Dos", clientNumber: 2, iqLinksByProfile: link("PAY0", 201, "ELIUT") });
  await db.doc("clients/c3").set({ rootId, adminId: adminA, name: "Cliente Tres", clientNumber: 3, iqLinksByProfile: link("BETELL 1", 301, "RR") });
  await db.doc("clients/c4").set({ rootId, adminId: adminA, name: "Cliente Cuatro", clientNumber: 4, iqLinksByProfile: link("RR", 401, "RR") });
  await db.doc("balanceAccounts/CLIENT_c1").set({ rootId, holderType: "CLIENT", holderId: "c1", availableBalance: 1000 });
  await db.doc("balanceAccounts/CLIENT_c2").set({ rootId, holderType: "CLIENT", holderId: "c2", availableBalance: 500 });
  await db.doc("balanceAccounts/CLIENT_c3").set({ rootId, holderType: "CLIENT", holderId: "c3", availableBalance: 20 });
  await db.doc("pagos/p1").set({ rootId, iqDepositId: "D-77", folio: "P-15" });
  await db.doc("balanceMovements/m1").set({ rootId, holderType: "CLIENT", holderId: "c2", direction: "IN", amount: 100, depositId: "p1", folio: "P-15", displayConcept: "Pago recibido", status: "APPLIED", createdAt: nov5 });

  const safety = new SafetyRuntime(db);
  const summary = await runIqBalanceReconciliation({ rootId, day, catalogs, safety, spacingMs: 0 });
  assert.equal(summary.ran, true);
  assert.deepEqual({ match: summary.match, different: summary.different, unmapped: summary.unmapped }, { match: 1, different: 2, unmapped: 1 });
  const snaps = (await db.collection("iqBalanceSnapshots").where("rootId", "==", rootId).where("runId", "==", summary.runId).get()).docs.map(doc => doc.data());
  const byClient = Object.fromEntries(snaps.filter(row => row.clientId).map(row => [row.clientId, row]));
  assert.equal(byClient.c1.status, "MATCH", "1,000.005 en IQ redondea a 1000.01 y queda dentro de 0.01");
  assert.equal(byClient.c2.status, "DIFFERENT");
  assert.equal(byClient.c2.difference, 50);
  assert.equal(byClient.c3.reason, "IQ_ROW_MISSING", "saldo en PAY0 sin fila en IQ es diferencia");
  assert.equal(byClient.c4, undefined, "sin saldo en ningún lado no genera ruido");
  const unmapped = snaps.find(row => row.status === "UNMAPPED");
  assert.equal(unmapped.reason, "NO_PAY0_CLIENT");
  assert.equal(unmapped.ownerAdminId, adminB, "el socio de IQ se asigna al usuario PAY0 configurado");
  const explanation = byClient.c2.explanation;
  assert.equal(byClient.c2.explanationStatus, "OK");
  assert.equal(explanation.unexplainedIqCount, 1, "el depósito con id de IQ se explica por el pago de PAY0");
  assert.deepEqual(explanation.unexplainedIq[0], { day: "2026-11-10", concept: "Dispersión a proveedor", credit: 0, charge: 50 });
  assert.equal(explanation.unmatchedPay0Count, 0);
  assert.equal(explanation.previousBalance, 400);
  assert.ok(calls.every(row => row.method === "GET"));
  assert.equal(calls.filter(row => row.path === "/balances/details").length, 1, "solo se detalla lo que difiere y tiene fila en IQ");

  // Idempotent: the same day does nothing more, and IQ is not called again.
  const before = calls.length;
  const again = await runIqBalanceReconciliation({ rootId, day, catalogs, safety, spacingMs: 0 });
  assert.equal(again.ran, false);
  assert.equal(again.reason, "ALREADY_DONE");
  assert.equal(calls.length, before, "una segunda corrida del mismo día no toca IQ");
  assert.equal((await db.doc(`iqBalanceReconciliationState/${rootId}`).get()).data().lastRunId, summary.runId);

  // Visibility on the server.
  const asA = await call(adminA);
  assert.deepEqual(asA.rows.map(row => row.clientName).sort(), ["Cliente Tres", "Cliente Uno"], "el socio A solo ve a sus clientes");
  assert.equal(asA.isSuperadmin, false);
  assert.deepEqual(asA.owners, []);
  const asAForB = await call(adminA, { ownerId: adminB });
  assert.deepEqual(asAForB.rows.map(row => row.clientName).sort(), ["Cliente Tres", "Cliente Uno"], "pedir los clientes de otro socio no cambia nada");
  const asB = await call(adminB);
  assert.deepEqual(asB.rows.map(row => row.clientName).sort(), ["Cliente Dos", "SIN VINCULO SA"]);
  const asSuper = await call(superUid);
  assert.equal(asSuper.rows.length, 4, "superadmin ve todo");
  assert.deepEqual(asSuper.owners.map(owner => owner.label), ["SOCIO A", "SOCIO B"]);
  const superFilter = await call(superUid, { ownerId: adminB });
  assert.deepEqual(superFilter.rows.map(row => row.clientName).sort(), ["Cliente Dos", "SIN VINCULO SA"], "superadmin cambia de socio");
  assert.equal(superFilter.rows.find(row => row.clientName === "Cliente Dos").ownerLabel, "SOCIO B");
  const text = JSON.stringify(asSuper);
  for (const raw of ["c1", "c2", adminA, adminB, "101", "201", "999", summary.runId, "D-77"]) {
    assert.ok(!text.replace(/"id":"[^"]+"/g, "").includes(`"${raw}"`), `sin ids crudos en filas: ${raw}`);
  }
  await assert.rejects(call(operador), error => error.code === "permission-denied", "operador no ve saldos de socios");
  await assert.rejects(getIqBalanceComparison.run({ data: {}, rawRequest: {} }), error => error.code === "unauthenticated");

  // Hugo's daily summary count.
  assert.equal((await loadPendingItems(rootId)).iqBalanceDifferences, 2);

  // Breaker: an open circuit means IQ is not called and nothing is judged.
  const otherRoot = "rootBrk00001";
  await db.doc(`iqIntegrationConfigs/${otherRoot}`).set({ rootId: otherRoot, enabled: true });
  for (const catalog of ["iq-group-rr", "iq-group-pay0"]) {
    await db.doc(`automationSafetyScopes/${scopeId(otherRoot, `IQ_BALANCE_RECON:${catalog}`)}`).set({ circuitState: "OPEN", openUntil: Date.now() + 600_000, manualRecovery: false });
  }
  const callsBefore = calls.length;
  const blocked = await runIqBalanceReconciliation({ rootId: otherRoot, day, catalogs, safety, spacingMs: 0 });
  assert.equal(blocked.reason, "NO_CATALOG_READ");
  assert.equal(calls.length, callsBefore, "con el circuito abierto no se llama a IQ");
  assert.equal((await db.doc(`iqBalanceReconciliationState/${otherRoot}`).get()).data().catalogStatus["iq-group-rr"], "CIRCUIT_OPEN");

  // Master switch off: nothing is read.
  const offRoot = "rootOff00001";
  const off = await runIqBalanceReconciliation({ rootId: offRoot, day, catalogs, safety, spacingMs: 0 });
  assert.equal(off.reason, "IQ_MASTER_OFF");
  assert.equal(calls.length, callsBefore);

  // An IQ failure on one group yields a partial run; the other group is still compared.
  const partialRoot = "rootPar00001";
  await db.doc(`iqIntegrationConfigs/${partialRoot}`).set({ rootId: partialRoot, enabled: true });
  const failing = { catalog: "iq-group-rr", openSession: async () => { throw new Error("IQ_AUTH_HTTP_503"); } };
  const partial = await runIqBalanceReconciliation({ rootId: partialRoot, day, catalogs: [failing, source("iq-group-pay0", "pay0")], safety, spacingMs: 0 });
  assert.equal(partial.reason, "PARTIAL");
  const partialState = (await db.doc(`iqBalanceReconciliationState/${partialRoot}`).get()).data();
  assert.equal(partialState.complete, false);
  assert.equal(partialState.lastCompletedDay, undefined, "una corrida parcial no se marca como terminada");
  const partialAgain = await runIqBalanceReconciliation({ rootId: partialRoot, day, catalogs, safety, spacingMs: 0 });
  assert.equal(partialAgain.reason, "ALREADY_DONE", "no se reemplaza la foto del día por otra más incompleta");
  assert.equal((await db.doc(`iqBalanceReconciliationState/${partialRoot}`).get()).data().lastRunId, partialState.lastRunId);

  console.log("PASS saldos IQ vs PAY0: tolerancia, diferencia explicada, sin vínculo, visibilidad por socio, idempotencia y breaker.");
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
