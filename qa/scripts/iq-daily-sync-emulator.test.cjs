// Emulator gate for the automatic daily IQ → PAY0 reverse sync (functions/src/modules/iqDailySync).
// The real P4 planner/executor, SafetyRuntime, guards and Firestore writes run against the Firestore emulator.
// Only the IQ HTTP boundary is faked (profile access, session and fetchIq); the fake transport goes through
// SafetyRuntime's reserve/observe hooks exactly like fetchIqExternal does in production.
// Run through qa/scripts/iq-daily-sync-emulator-run.ps1 (npm run qa:iq-daily-sync).
const assert = require("node:assert/strict");
const path = require("node:path");

if (process.env.GCLOUD_PROJECT !== "demo-pay0" || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw Error("DEMO_LOOPBACK_REQUIRED");
process.env.IQ_CREDENTIALS_KEY = "demo-secret-never-used";
global.fetch = async () => { throw Error("EXTERNAL_NETWORK_FORBIDDEN"); };

const root = path.resolve(__dirname, "..", "..");
const lib = (file) => path.join(root, "functions/lib/modules", file);
const ROOT_UID = "Ab4z0RttIqXbZFT0NuWsDjBkt6J2"; // EBASOR, the R3 policy root
const BETELL_UID = "lcOz4nO5DTbksM3Lbz3hJcCpCdu1";
const ROOT_B = "rootBreakerDemo0000000000001";
const ELIUT_PROFILE = "bEGPMuplqNHMZ3lvYkeb";
const CLIENT_NAME = "CLIENTE DEMO SA DE CV";
const COMPANY_NAME = "EMPRESA DEMO";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Fake IQ. ELIUT (iq-group-pay0) is a mapped user; the RR group logs in as an unmapped IQ user ("OTRO").
// ---------------------------------------------------------------------------
const PROFILES = {
  [ELIUT_PROFILE]: { username: "ELIUT", associatedName: "ELIUT" },
  Q3TaFdNTdR2mLPh7KcTi: { username: "OTRO", associatedName: "OTRO" },
  LxyRRZrJsAYoiAU62scb: { username: "OTRO", associatedName: "OTRO" },
};
const financial = (extra) => ({ client: CLIENT_NAME, company: COMPANY_NAME, currency: "MXN", operation_status: "EN OPERACION", ...extra });
const invoice = (id, sum, at) => financial({ id, invoice_type: "PUE", cfdi_uuid: `UUID-${id}`, sum, created_at: at });
const deposit = (id, sum, at) => financial({ id, voucher: `V-${id}`, deposit_date: at.slice(0, 10), conciliation_status: "CONCILIADO", sum, created_at: at });
const application = (id, invoiceId, depositId, sum, at) => financial({ id, invoice_id: invoiceId, deposit_id: depositId, applied_amount: sum, sum, created_at: at });
const IQ = {
  ELIUT: {
    "/clients": [{ id: "501", name: CLIENT_NAME, rfc: "CDE010101AAA", status: "ACTIVO" }],
    "/invoices": [invoice("7101", 1000, "2026-11-21T10:00:00"), invoice("7102", 777, "2026-11-22T10:00:00")],
    "/deposits": [deposit("8101", 1000, "2026-11-21T11:00:00")],
    "/payment_applications": [application("9101", "7101", "8101", 1000, "2026-11-22T09:00:00")],
    "/dispersions": [{ id: "555", created_at: "2026-11-22T13:00:00", total_to_disperse: 300, operation_status: "EN OPERACION" }, { id: "556", created_at: "2026-11-22T14:00:00", total_to_disperse: 120, operation_status: "EN OPERACION" }],
  },
  OTRO: {
    "/clients": [{ id: "601", name: "CLIENTE RR SA", rfc: "CRR010101AAA", status: "ACTIVO" }],
    "/invoices": [financial({ id: "7201", client: "CLIENTE RR SA", invoice_type: "PUE", cfdi_uuid: "UUID-7201", sum: 450, created_at: "2026-11-22T10:30:00" })],
    "/deposits": [], "/payment_applications": [], "/dispersions": [],
  },
};
const failing = new Set();
const iqMetrics = { reads: 0, writes: 0 };
function serve(profileId, url) {
  const match = url.pathname.match(/^(\/[a-z_]+)(?:\/([^/]+))?$/);
  assert.ok(match, `unexpected IQ path ${url.pathname}`);
  const [, endpoint, pathId] = match;
  const rows = IQ[PROFILES[profileId].username][endpoint] || [];
  const id = pathId || url.searchParams.get("id");
  if (id) return rows.filter((row) => row.id === id);
  if (Number(url.searchParams.get("offset") || 0) > 0) return [];
  const start = url.searchParams.get("start_date"), end = url.searchParams.get("end_date");
  if (start && end) return rows.filter((row) => String(row.created_at).slice(0, 10) >= start && String(row.created_at).slice(0, 10) <= end);
  return rows;
}
const runtime = require(lib("automationSafety/runtime.js"));
const access = require(lib("iq/iqCanonicalAccess.js"));
access.loadIqCanonicalProfileById = async ({ profileId, rootId }) => ({ profileId, rootId, profileAlias: profileId, ...PROFILES[profileId], password: "", erpUrl: "http://iq.invalid" });
access.openIqCanonicalSession = async ({ access: row }) => ({ apiOrigin: "http://iq.invalid", accessToken: `token-${row.rootId}-${row.profileId}` });
const http = require(lib("iq/iqHttpClient.js"));
http.fetchIq = async (input, init = {}) => {
  const url = new URL(String(input instanceof URL ? input.href : input));
  if (String(init.method || "GET").toUpperCase() !== "GET") { iqMetrics.writes++; throw Error("IQ_WRITE_FORBIDDEN"); }
  const [, rootId, profileId] = String(init.headers?.Authorization || "").match(/^Bearer token-([^-]+)-(.+)$/) || [];
  await runtime.reserveProtectedRequest(); // production transport hook (fetchIqExternal)
  iqMetrics.reads++;
  const status = failing.has(rootId) ? 503 : 200;
  await runtime.observeProtectedResponse(status);
  if (status !== 200) return { ok: false, status, json: async () => ({}) };
  return { ok: true, status, json: async () => serve(profileId, url) };
};

const admin = require(path.join(root, "functions/node_modules/firebase-admin"));
if (!admin.apps.length) admin.initializeApp({ projectId: "demo-pay0" });
const db = admin.firestore();
const { manageP4HistoricalIqImport } = require(lib("iqHistoricalImport/service.js"));
const { R3_OPERATIONAL_POLICY, R3_OPERATIONAL_POLICY_HASH } = require(lib("iqHistoricalImport/r3OperationalPolicy.js"));
const daily = require(lib("iqDailySync/service.js"));
const guard = require(lib("iq/historicalImportGuard.js"));
const controlCenter = require(lib("controlCenter/automation.js"));

const mexico = (iso) => new Date(`${iso}-06:00`);
let runs = 0;
async function run(rootId, now, extra = {}) {
  await sleep(1100); // SafetyRuntime admission spacing
  runs++;
  const [result] = await daily.runIqDailySync({ secret: "demo", now, rootIds: [rootId], runKey: `test-${runs}`, ...extra });
  console.error(JSON.stringify({ step: `run${runs}`, rootId: rootId.slice(0, 6), status: result.status, safety: result.safety, window: result.window, groups: result.groups.map((g) => ({ g: g.groupId, s: g.status, r: g.stopReason, c: g.created, f: g.failed, rn: g.reviewsNew, rr: g.reviewsResolved, dm: g.dispersionsMissing })) }));
  return result;
}
const imported = async (collection) => (await db.collection(collection).where("rootId", "==", ROOT_UID).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((row) => row.source === "IQ_IMPORT");
const reviews = async () => (await db.collection("iqDailySyncReviews").where("rootId", "==", ROOT_UID).get()).docs.map((doc) => doc.data());
const created = (result) => result.groups.reduce((sum, group) => sum + Object.values(group.created).reduce((a, b) => a + b, 0), 0);

async function seed() {
  const batch = db.batch();
  batch.set(db.doc(`users/${ROOT_UID}`), { role: "superadmin", rootId: ROOT_UID, active: true, username: "EBASOR", displayName: "EBASOR" });
  batch.set(db.doc(`users/${BETELL_UID}`), { role: "admin", rootId: ROOT_UID, active: true, username: "BETELL", displayName: "BETELL" });
  batch.set(db.doc("companies/company-demo"), { rootId: ROOT_UID, nombre: COMPANY_NAME, despachoId: "despacho-demo", companyNumber: 7 });
  batch.set(db.doc("clientDispersionLegs/leg-pay0-556"), { rootId: ROOT_UID, principalDispersionId: "disp-pay0-556", iqDispersionId: "556" });
  await batch.commit();
  const activated = await manageP4HistoricalIqImport.run({ data: { mode: "ACTIVATE_R3_OPERATIONAL_POLICY", confirmation: `ACTIVATE_R3_POLICY:${R3_OPERATIONAL_POLICY.policyVersion}:${R3_OPERATIONAL_POLICY_HASH}` }, auth: { uid: ROOT_UID, token: { uid: ROOT_UID } }, rawRequest: {} });
  assert.equal(activated.ok, true, "R3 policy must activate");
}

async function main() {
  await seed();
  let checks = 0;
  const day1 = mexico("2026-11-22T21:00:00");

  // Kill switch: a paused process is never admitted and reads nothing from IQ.
  const safety = new runtime.SafetyRuntime(db);
  await safety.setControl({ rootId: ROOT_UID, process: daily.IQ_DAILY_SYNC_PROCESS, paused: true, actor: "qa", reason: "qa kill switch" });
  const readsBefore = iqMetrics.reads, paused = await run(ROOT_UID, day1);
  assert.equal(paused.status, "NOT_ADMITTED"); assert.equal(paused.safety, "KILL_SWITCH"); assert.equal(iqMetrics.reads, readsBefore); checks += 3;
  await safety.setControl({ rootId: ROOT_UID, process: daily.IQ_DAILY_SYNC_PROCESS, paused: false, actor: "qa", reason: "qa resume" });

  // Run 1, write budget 1: only the new client is created; the run is partial and the window does not advance.
  const run1 = await run(ROOT_UID, day1, { budget: { maxWrites: 1 } });
  assert.equal(run1.status, "PARTIAL"); assert.deepEqual(run1.window, { start: "2026-11-21", end: "2026-11-22", timezone: "America/Mexico_City" }); checks += 2;
  const clients = await imported("clients");
  assert.equal(clients.length, 1); assert.equal(clients[0].importMode, "DAILY_SYNC"); assert.equal(clients[0].adminId, ROOT_UID); checks += 3;
  assert.equal((await db.doc(`iqDailySyncState/${ROOT_UID}`).get()).get("lastCompletedDate"), undefined); checks++;

  // A PAY0 solicitud whose IQ id was never written back (same client, amount and day as IQ invoice 7102).
  await db.doc("solicitudes/pay0-native-777").set({ rootId: ROOT_UID, clientId: clients[0].id, clienteId: clients[0].id, monto: 777, moneda: "MXN", status: "PENDIENTE", source: "PAY0", createdAt: admin.firestore.Timestamp.fromDate(mexico("2026-11-22T12:00:00")) });

  // Run 2 resumes: invoices, deposit and application are recovered; everything else becomes review.
  const run2 = await run(ROOT_UID, day1);
  assert.equal(run2.status, "COMPLETE", JSON.stringify(run2)); checks++;
  const solicitudes = await imported("solicitudes"), pagos = await imported("pagos"), apps = await imported("pagoAplicaciones");
  assert.deepEqual(solicitudes.map((row) => row.originalIqEntityId), ["7101"], "7102 must not be duplicated"); checks++;
  assert.deepEqual(pagos.map((row) => row.originalIqEntityId), ["8101"]); assert.deepEqual(apps.map((row) => row.originalIqEntityId), ["9101"]); checks += 2;
  assert.ok([...solicitudes, ...pagos, ...apps].every((row) => row.importMode === "DAILY_SYNC" && row.adminId === ROOT_UID)); checks++;
  assert.equal(solicitudes[0].totalAbonado, 1000); assert.equal(solicitudes[0].saldoPendiente, 0); assert.equal(pagos[0].totalAplicado, 1000); assert.equal(pagos[0].saldoDisponible, 0); checks += 4;
  assert.equal((await db.collection("solicitudes").where("rootId", "==", ROOT_UID).get()).size, 2, "only the PAY0 original and 7101"); checks++;
  let open = await reviews();
  const byEntity = (type, id) => open.find((row) => row.entityType === type && row.iqEntityId === id);
  assert.equal(byEntity("SOLICITUD", "7102")?.code, "POSSIBLE_PAY0_DUPLICATE"); checks++;
  assert.deepEqual(byEntity("SOLICITUD", "7102").evidence.dailySync.candidates, ["solicitudes/pay0-native-777"]); checks++;
  assert.match(String(byEntity("SOLICITUD", "7201")?.code), /IDENTITY|CLIENT/, "unmapped IQ user goes to review"); checks++;
  assert.equal((await db.collection("solicitudes").where("originalIqEntityId", "==", "7201").get()).size, 0); checks++;
  assert.equal(byEntity("DISPERSION", "555")?.code, "DISPERSION_NOT_FINISHED", "an unfinished dispersion waits, with its reason"); assert.equal(byEntity("DISPERSION", "556"), undefined); checks += 2;
  assert.equal(byEntity("PAYMENT_POSTING", "8101")?.code, "WALLET_POSTING_REQUIRES_OPERATION_TYPE"); checks++;
  const incident = await db.doc(`analyticsRoots/${ROOT_UID}/incidents/iq-daily-sync-review`).get();
  assert.equal(incident.get("status"), "NEEDS_REVIEW"); assert.equal(incident.get("openCount"), open.filter((row) => row.status === "OPEN").length); checks += 2;
  const audits = await db.collection("p4ImportAudit").where("rootId", "==", ROOT_UID).where("mode", "==", "EXECUTE").get();
  assert.ok(audits.size >= 4 && audits.docs.every((doc) => doc.get("actorUid") === daily.IQ_DAILY_SYNC_ACTOR_UID), "system actor on every execution audit"); checks++;
  assert.equal((await db.doc(`iqDailySyncState/${ROOT_UID}`).get()).get("lastCompletedDate"), "2026-11-21"); checks++;

  // Side effects: daily-sync rows pass the legacy-only guard (projections run) but stay behind the full guard
  // (IQ application/complement flows); a legacy historical row stays suppressed everywhere.
  const legacy = { source: "IQ_IMPORT", importRunId: "p4r_legacy0001", importVersion: 7, canonicalIqProfileId: ELIUT_PROFILE, originalIqEntityId: "1" };
  assert.equal(guard.shouldSuppressLegacyIqHistoricalImport(null, pagos[0]), false); assert.equal(guard.shouldSuppressIqHistoricalImport(null, pagos[0]), true); checks += 2;
  assert.equal(guard.shouldSuppressLegacyIqHistoricalImport(null, legacy), true); assert.equal(guard.shouldSuppressIqHistoricalImport(null, legacy), true); checks += 2;
  const change = (row) => ({ before: { exists: false, data: () => ({}) }, after: { exists: true, data: () => row } });
  await controlCenter.markControlCenterDirty(change({ ...legacy, rootId: ROOT_B }), "pagos", "legacy-doc");
  assert.equal((await db.doc(`controlCenterDirtyRoots/${ROOT_B}`).get()).exists, false, "legacy import stays suppressed"); checks++;
  await controlCenter.markControlCenterDirty(change(pagos[0]), "pagos", pagos[0].id);
  await controlCenter.markControlCenterDirty(change(pagos[0]), "pagos", pagos[0].id); // redelivery
  const dirty = await db.doc(`controlCenterDirtyRoots/${ROOT_UID}`).get();
  assert.deepEqual(dirty.get("modules"), ["pagos"], "daily-sync row reaches Control Center once (idempotent merge)"); checks++;

  // Run 3, same day: nothing new is written and no review is duplicated.
  const reviewCount = open.length, run3 = await run(ROOT_UID, day1);
  assert.equal(created(run3), 0); assert.equal(run3.groups.reduce((sum, group) => sum + group.reviewsNew, 0), 0); checks += 2;
  open = await reviews(); assert.equal(open.length, reviewCount); checks++;
  assert.equal((await imported("solicitudes")).length, 1); assert.equal((await imported("pagos")).length, 1); assert.equal((await imported("pagoAplicaciones")).length, 1); checks += 3;

  // Next days: a new invoice and deposit, then an IQ application between them on the following day.
  // The application moves the parents' balances forward exactly once (exact-cent rule).
  IQ.ELIUT["/invoices"].push(invoice("7103", 500, "2026-11-23T10:00:00"));
  IQ.ELIUT["/deposits"].push(deposit("8103", 500, "2026-11-23T11:00:00"));
  const run4 = await run(ROOT_UID, mexico("2026-11-23T21:00:00"));
  assert.equal(run4.status, "COMPLETE"); // Open reviews from 2026-11-21 are still pending, so the window reaches back to that day to re-evaluate them.
  assert.deepEqual(run4.window, { start: "2026-11-21", end: "2026-11-23", timezone: "America/Mexico_City" }); checks += 2;
  IQ.ELIUT["/payment_applications"].push(application("9103", "7103", "8103", 500, "2026-11-24T09:00:00"));
  // Every open review carries the readable data of its IQ operation (kind, client, amount, date), so a person can understand it.
  const openReviews = (await db.collection("iqDailySyncReviews").where("rootId", "==", ROOT_UID).where("status", "==", "OPEN").get()).docs;
  assert.ok(openReviews.length > 0); checks++;
  assert.equal(openReviews.filter(doc => !doc.get("evidence.display.kind")).length, 0, "every open review has its readable data"); checks++;
  assert.equal(openReviews.find(doc => doc.get("entityType") === "DISPERSION")?.get("evidence.display.kind"), "Dispersión"); checks++;
  const run5 = await run(ROOT_UID, mexico("2026-11-24T21:00:00"));
  assert.equal(run5.status, "COMPLETE", JSON.stringify(run5)); checks++;
  const parent = (await imported("solicitudes")).find((row) => row.originalIqEntityId === "7103"), deposit8103 = (await imported("pagos")).find((row) => row.originalIqEntityId === "8103");
  assert.equal(parent.totalAbonado, 500); assert.equal(parent.saldoPendiente, 0); assert.equal(deposit8103.totalAplicado, 500); assert.equal(deposit8103.saldoDisponible, 0); checks += 4;
  assert.equal((await imported("pagoAplicaciones")).filter((row) => row.originalIqEntityId === "9103").length, 1); checks++;
  const run6 = await run(ROOT_UID, mexico("2026-11-24T21:30:00"));
  assert.equal(created(run6), 0); checks++;
  const parentAgain = (await imported("solicitudes")).find((row) => row.originalIqEntityId === "7103");
  assert.equal(parentAgain.totalAbonado, 500, "parent balance is not moved twice"); checks++;

  // A PAY0 client with the same RFC and owner as an IQ client is linked to it, and its deposit is brought in with the original date.
  IQ.ELIUT["/clients"].push({ id: "502", name: "CLIENTE ENLACE SA", rfc: "CEN010101AAA", status: "ACTIVO" });
  IQ.ELIUT["/deposits"].push(financial({ id: "8104", client: "CLIENTE ENLACE SA", voucher: "V-8104", deposit_date: "2026-11-25", conciliation_status: "CONCILIADO", sum: 300, created_at: "2026-11-25T10:00:00" }));
  await db.doc("clients/pay0-link-client").set({ rootId: ROOT_UID, name: "CLIENTE ENLACE SA", rfc: "CEN010101AAA", adminId: ROOT_UID, source: "PAY0", active: true, createdAt: new Date("2026-01-15T10:00:00Z") });
  // A look-alike owned by someone else must stay untouched: same RFC as another IQ client, other owner.
  IQ.ELIUT["/clients"].push({ id: "503", name: "CLIENTE AJENO SA", rfc: "CAJ010101AAA", status: "ACTIVO" });
  await db.doc("clients/pay0-other-owner").set({ rootId: ROOT_UID, name: "CLIENTE AJENO SA", rfc: "CAJ010101AAA", adminId: BETELL_UID, source: "PAY0", active: true });
  const clientsBefore = (await db.collection("clients").where("rootId", "==", ROOT_UID).get()).size;
  const run7 = await run(ROOT_UID, mexico("2026-11-25T21:00:00"));
  assert.equal(run7.status, "COMPLETE", JSON.stringify(run7)); checks++;
  const linkedClient = (await db.doc("clients/pay0-link-client").get()).data();
  assert.equal(linkedClient.iqClientId, "502"); assert.equal(linkedClient.iqLink.clientId, "502"); assert.equal(linkedClient.iqLink.status, "LINKED"); assert.equal(linkedClient.iqLink.source, "RFC_EXACT_DAILY_SYNC"); checks += 4;
  assert.equal(linkedClient.source, "PAY0", "the client is not rewritten as an import"); assert.equal(linkedClient.name, "CLIENTE ENLACE SA"); checks += 2;
  assert.equal((await db.collection("clients").where("rootId", "==", ROOT_UID).get()).size, clientsBefore, "no second client was created for the same company"); checks++;
  const linkedDeposit = (await imported("pagos")).find((row) => row.originalIqEntityId === "8104");
  assert.ok(linkedDeposit, "the deposit of the linked client was brought in"); assert.equal(linkedDeposit.clientId, "pay0-link-client"); checks += 2;
  assert.equal(String(linkedDeposit.createdAt?.toDate?.().toISOString?.() || "").slice(0, 10), "2026-11-25", "original IQ date, not today"); checks++;
  const otherOwner = (await db.doc("clients/pay0-other-owner").get()).data();
  assert.equal(otherOwner.iqClientId, undefined, "a client of another owner is never linked"); checks++;
  const activity = (await db.collection("pay0ActivityLog").where("referenceId", "==", "pay0-link-client").get()).docs.map((doc) => doc.data());
  assert.ok(activity.some((row) => row.event === "CLIENT_IQ_LINK"), "the link is recorded in the activity log"); checks++;
  const run8 = await run(ROOT_UID, mexico("2026-11-25T21:30:00"));
  assert.equal((await db.collection("clients").where("rootId", "==", ROOT_UID).get()).size, clientsBefore, "running again creates nothing"); checks++;
  assert.equal(created(run8), 0); checks++;

  // A dispersion made directly in IQ is created in PAY0 with its original date, its beneficiary and its account, and debits the client's balance.
  const CLABE_OK = "002580701012614311";
  const dispersionRow = (id, over) => ({ id, created_at: "2026-11-25T10:00:00", total_to_disperse: 1250, currency: "MXN", operation_status: "TERMINADA", conciliation_status: "SIN CONCILIAR", dispersion_type: "Transferencia",
    sale_percentage: "0.0%", client: "CLIENTE ENLACE SA", beneficiary_name: "BENEFICIARIO NUEVO SA", partner: "ELIUT", account: "CLABE: " + CLABE_OK, bank_name: "BANAMEX", ...over });
  await db.doc("users/" + ROOT_UID).set({ userNumber: 1 }, { merge: true });
  await db.doc("clients/pay0-link-client").set({ clientNumber: 7 }, { merge: true });
  await db.doc("balanceAccounts/CLIENT_pay0-link-client").set({ rootId: ROOT_UID, holderType: "CLIENT", holderId: "pay0-link-client", availableBalance: 5000 });
  await db.doc("clientDispersions/pay0-native-900").set({ rootId: ROOT_UID, clientId: "pay0-link-client", clienteId: "pay0-link-client", amount: 900, folio: "D900", createdAt: new Date("2026-11-25T15:00:00Z"), status: "REGISTRADA" });
  IQ.ELIUT["/dispersions"].push(
    dispersionRow("701"),
    dispersionRow("702", { total_to_disperse: 300, created_at: "2026-11-25T11:00:00" }),                       // same beneficiary and account as 701
    dispersionRow("703", { client: "CLIENTE QUE NO EXISTE SA" }),                                              // client not in PAY0
    dispersionRow("704", { operation_status: "EN OPERACION" }),                                                // not finished
    dispersionRow("705", { total_to_disperse: 900, beneficiary_name: "OTRO BENEFICIARIO", account: "CLABE: 661610005732587353", bank_name: "KLAR" }), // looks like PAY0's own dispersion
    dispersionRow("706", { account: "CLABE: 002580701012614312" }),                                            // wrong check digit
  );
  const typeBefore = (await db.doc("operationTypes/TRANSFERENCIA").get()).exists;
  const run9 = await run(ROOT_UID, mexico("2026-11-25T22:00:00"));
  assert.equal(run9.status, "COMPLETE", JSON.stringify(run9)); checks++;
  const principal = (await db.collection("clientDispersions").where("iqDispersionId", "==", "701").get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  assert.equal(principal.length, 1); const d701 = principal[0]; checks++;
  assert.equal(d701.folio, "DIQP701"); assert.equal(d701.amount, 1250); assert.equal(d701.clientChargeAmount, 0); assert.equal(d701.totalClientDebitAmount, 1250); assert.equal(d701.clientId, "pay0-link-client"); checks += 5;
  assert.equal(d701.createdAt.toDate().toISOString().slice(0, 10), "2026-11-25", "original IQ date, not today"); checks++;
  assert.equal(d701.iqGenerationStatus, "IQ_GENERADA"); assert.equal(d701.source, "IQ_IMPORT"); assert.equal(d701.forwardOnlyVersion, undefined, "no reservation flow"); assert.equal(d701.reservationStatus, undefined); checks += 4;
  assert.equal(d701.operationTypeKey, "TRANSFERENCIA"); assert.equal(d701.destinationKind, "CLABE"); assert.equal(d701.clabe, CLABE_OK); assert.equal(d701.bankName, "BANAMEX"); checks += 4;
  assert.equal((await db.doc("balanceAccounts/CLIENT_pay0-link-client").get()).data().availableBalance, 5000 - 1250 - 300, "the client's balance is debited by both dispersions");
  checks++;
  const movement = (await db.doc("balanceMovements/" + d701.principalMovementId).get()).data();
  assert.equal(movement.direction, "OUT"); assert.equal(movement.amount, 1250); assert.equal(movement.movementType, "DISPERSION_REGISTRADA"); assert.equal(movement.createdAt.toDate().toISOString().slice(0, 10), "2026-11-25"); checks += 4;
  assert.equal((await db.collection("balanceMovements").where("dispersionId", "==", d701.id).get()).size, 1, "no commission movement when IQ charged 0%"); checks++;
  const beneficiaries = (await db.collection("clientBeneficiaries").where("clientId", "==", "pay0-link-client").get()).docs.filter((doc) => doc.get("nombre") === "BENEFICIARIO NUEVO SA");
  assert.equal(beneficiaries.length, 1, "one beneficiary for both dispersions"); assert.equal(beneficiaries[0].get("methodCount"), 1); assert.match(beneficiaries[0].get("folio"), /^B/); checks += 3;
  const methods = (await db.collection("clientBeneficiaryMethods").where("clientId", "==", "pay0-link-client").get()).docs.filter((doc) => doc.get("clabe") === CLABE_OK);
  assert.equal(methods.length, 1, "one account for both dispersions"); assert.equal(methods[0].get("destinationKind"), "CLABE"); assert.equal(methods[0].get("active"), true); checks += 3;
  assert.equal(typeBefore || (await db.doc("operationTypes/TRANSFERENCIA").get()).get("category") === "DISPERSION", true, "the dispersion type exists, created when it was missing"); checks++;
  assert.equal((await db.collection("clientDispersions").where("iqDispersionId", "==", "702").get()).size, 1); checks++;
  for (const id of ["703", "704", "705", "706"]) assert.equal((await db.collection("clientDispersions").where("iqDispersionId", "==", id).get()).size, 0, "not created: " + id);
  checks += 4;
  const openDispersions = Object.fromEntries((await db.collection("iqDailySyncReviews").where("rootId", "==", ROOT_UID).where("status", "==", "OPEN").get()).docs.filter((doc) => doc.get("entityType") === "DISPERSION").map((doc) => [doc.get("iqEntityId"), doc.get("code")]));
  assert.equal(openDispersions["703"], "DISPERSION_CLIENT_NOT_IDENTIFIED"); assert.equal(openDispersions["704"], "DISPERSION_NOT_FINISHED"); assert.equal(openDispersions["705"], "POSSIBLE_PAY0_DUPLICATE"); assert.equal(openDispersions["706"], "DISPERSION_ACCOUNT_UNREADABLE"); checks += 4;
  assert.equal(openDispersions["701"], undefined); assert.equal(openDispersions["702"], undefined); checks += 2;
  const run10 = await run(ROOT_UID, mexico("2026-11-25T22:30:00"));
  assert.equal(run10.groups.reduce((sum, group) => sum + (group.dispersionsImported || 0), 0), 0, "a second run creates nothing"); checks++;
  assert.equal((await db.doc("balanceAccounts/CLIENT_pay0-link-client").get()).data().availableBalance, 3450, "and the balance does not move again"); checks++;
  assert.equal((await db.collection("clientDispersions").where("iqDispersionId", "==", "701").get()).size, 1); checks++;

  // Breaker: three IQ 503 runs open the circuit; the next run is not admitted and does not read IQ.
  await db.doc(`iqOperationalAssignmentPolicies/${ROOT_B}`).set({ activeVersion: "none" });
  failing.add(ROOT_B);
  for (let i = 0; i < 3; i++) { const failed = await run(ROOT_B, day1); assert.notEqual(failed.status, "COMPLETE"); checks++; }
  const readsAtOpen = iqMetrics.reads, blocked = await run(ROOT_B, day1);
  assert.equal(blocked.status, "NOT_ADMITTED"); assert.equal(blocked.safety, "CIRCUIT_OPEN"); assert.equal(iqMetrics.reads, readsAtOpen); checks += 3;

  assert.equal(iqMetrics.writes, 0); checks++;
  console.log(JSON.stringify({ mode: "IQ_DAILY_SYNC_EMULATOR", checks, runs, iqReads: iqMetrics.reads, iqWrites: iqMetrics.writes }));
}

main().then(() => process.exit(0)).catch((error) => { console.error({ error: "IQ_DAILY_SYNC_EMULATOR_FAILED", code: error.code || "ASSERTION", message: error.message, stack: String(error.stack || "").split("\n").slice(0, 6).join(" | ") }); process.exit(1); });
