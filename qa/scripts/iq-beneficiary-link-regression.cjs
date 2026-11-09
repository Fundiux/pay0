const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !String(process.env.GCLOUD_PROJECT || "").startsWith("demo-")) throw new Error("LOCAL_EMULATOR_REQUIRED");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
global.fetch = async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const { catalogsForClient, evaluateCreateGate, createReservationId } = require("../../functions/lib/modules/beneficiaries/iqLinkDomain.js");
const { iqAccountKey } = require("../../functions/lib/modules/beneficiaries/iqCatalogDomain.js");
const { linkOrCreateMethod } = require("../../functions/lib/modules/beneficiaries/iqLinkService.js");

const run = `lnk${Date.now()}`;
const rootId = `${run}-root`;
const catalog = "iq-group-rr";
let checks = 0, seq = 100;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (v, label) => { assert.ok(v, label); checks++; };
const newClabe = () => `0121800${String(++seq).padStart(3, "0")}${String(Date.now()).slice(-8)}`;

const calls = { lookup: 0, create: 0 };
let lookupResults = [], createResult = null;
const ports = {
  liveLookup: async () => { calls.lookup++; return lookupResults.length > 1 ? lookupResults.shift() : lookupResults[0] ?? { found: false }; },
  create: async () => { calls.create++; if (createResult instanceof Error) throw createResult; return createResult; },
};
const reset = () => { calls.lookup = 0; calls.create = 0; lookupResults = [{ found: false }]; createResult = { outcome: "OUTCOME_UNKNOWN" }; };

async function setup(name, { clabe = newClabe(), beneficiaryRoot = rootId, linked = true, benName = "Juan Perez" } = {}) {
  const clientId = `${run}-${name}-c`, benId = `${run}-${name}-b`, methodId = `${run}-${name}-m`;
  await db.doc(`clients/${clientId}`).set({ rootId, iqLinksByProfile: linked ? { "p-rr": { status: "LINKED", clientId: "77", profileId: "p-rr", profileAlias: "RR", partnerName: "RR", active: true } } : {} });
  await db.doc(`clientBeneficiaries/${benId}`).set({ rootId: beneficiaryRoot, clientId, nombre: benName });
  await db.doc(`clientBeneficiaryMethods/${methodId}`).set({ rootId, clientId, beneficiaryId: benId, clabe, destinationKind: "CLABE", active: true });
  return { clientId, benId, methodId, clabe };
}
const catalogRow = (clabe, accountId, beneficiaryId, name, status = "Conciliado") => db.doc(`iqBeneficiaryCatalog/${rootId}_${catalog}_${accountId}`).set({ rootId, catalog, key: iqAccountKey(clabe), last4: clabe.slice(-4), beneficiaryId, beneficiaryName: name, accountId, conciliationStatus: status });
const entry = async methodId => (await db.doc(`clientBeneficiaryMethods/${methodId}`).get()).get("iqLinksByCatalog")?.[catalog];
const activities = async (methodId) => (await db.collection("pay0ActivityLog").where("referenceId", "==", methodId).get()).docs.map(d => d.get("event"));
const setMaster = enabled => db.doc(`iqIntegrationConfigs/${rootId}`).set({ enabled });
const setCreate = cfg => db.doc(`iqBeneficiaryCreateConfig/${rootId}`).set(cfg);
let clock = Date.now();
const { SafetyRuntime } = require("../../functions/lib/modules/automationSafety/runtime.js");
// A moving clock keeps the runtime's 1 s admission spacing out of the way, except where a test freezes it.
const safety = new SafetyRuntime(db, () => (clock += 5000));
const link = async (methodId, nowMs) => (await linkOrCreateMethod({ methodId, ports, safety, nowMs }))[0];

(async () => {
  // Domain
  eq(catalogsForClient({ iqLinksByProfile: { b: { status: "LINKED", clientId: "1", profileAlias: "BETELL 1", active: true }, a: { status: "LINKED", clientId: "2", profileAlias: "RR", active: true }, z: { status: "LINKED", clientId: "3", profileAlias: "PAY0", active: true }, x: { status: "LINKED", clientId: "4", profileAlias: "OTRO", active: true }, w: { status: "PENDING", clientId: "5", profileAlias: "RR", active: true } } }).map(p => [p.catalog, p.clientIqId]), [["iq-group-rr", "2"], ["iq-group-pay0", "3"]], "RR y BETELL son un solo catálogo; perfil desconocido o sin vincular se ignora");
  eq(evaluateCreateGate({ masterEnabled: false, config: { enabled: true, contractVerified: true }, createdToday: 0 }).reason, "IQ_MASTER_OFF", "sin interruptor maestro");
  eq(evaluateCreateGate({ masterEnabled: true, config: { enabled: false, contractVerified: true }, createdToday: 0 }).reason, "CREATE_DISABLED", "creación apagada");
  eq(evaluateCreateGate({ masterEnabled: true, config: { enabled: true }, createdToday: 0 }).reason, "CREATE_CONTRACT_UNVERIFIED", "contrato sin verificar");
  eq(evaluateCreateGate({ masterEnabled: true, config: { enabled: true, contractVerified: true }, createdToday: 3 }).reason, "DAILY_LIMIT_REACHED", "límite por defecto bajo (3)");
  eq(evaluateCreateGate({ masterEnabled: true, config: { enabled: true, contractVerified: true, dailyLimit: 10 }, createdToday: 3 }).allowed, true, "el límite se lee de la configuración");
  eq(createReservationId("r", "c", "k"), createReservationId("r", "c", "k"), "la reserva es determinista");

  // 1. in the catalog: linked with no IQ contact at all
  reset();
  const a = await setup("a");
  await catalogRow(a.clabe, 5001, 900, "Juan Perez");
  const outA = await link(a.methodId);
  eq([outA.status, calls.lookup, calls.create], ["LINKED", 0, 0], "catálogo: vincula sin tocar IQ");
  const eA = await entry(a.methodId);
  eq([eA.status, eA.iqBeneficiaryId, eA.iqAccountId, eA.source, eA.key], ["LINKED", 900, 5001, "CATALOG", iqAccountKey(a.clabe)], "guarda ids y huella de la cuenta");
  ok((await activities(a.methodId)).includes("IQ_BENEFICIARIO_VINCULADO"), "evento de auditoría de vínculo");
  eq((await link(a.methodId)).skipped, "UNCHANGED", "misma cuenta y mismo estado: no se repite");

  // 2. several candidates: review, never a guess
  reset();
  const b = await setup("b", { benName: "Nombre Distinto" });
  await catalogRow(b.clabe, 5002, 901, "Otro Uno"); await catalogRow(b.clabe, 5003, 902, "Otro Dos");
  const outB = await link(b.methodId);
  eq([outB.status, calls.lookup], ["REVIEW_REQUIRED", 0], "varios candidatos van a revisión");
  eq((await entry(b.methodId)).candidates, [901, 902], "guarda los candidatos");
  ok((await activities(b.methodId)).includes("IQ_BENEFICIARIO_REVISION_REQUERIDA"), "auditoría de revisión");

  // 3. not in the catalog and IQ master off: no IQ contact
  reset();
  const c = await setup("c");
  const outC = await link(c.methodId);
  eq([outC.status, outC.createState, calls.lookup, calls.create], ["NOT_FOUND", "IQ_MASTER_OFF", 0, 0], "interruptor maestro apagado: no se consulta IQ");

  // 4. catalog stale: the live lookup finds it, nothing is created
  await setMaster(true); reset();
  lookupResults = [{ found: true, iqBeneficiaryId: 777, iqAccountId: 8888, iqBeneficiaryName: "Juan Perez" }];
  const d = await setup("d");
  const outD = await link(d.methodId);
  eq([outD.status, calls.lookup, calls.create], ["LINKED", 1, 0], "consulta en vivo encuentra la cuenta: se vincula sin crear");
  eq((await entry(d.methodId)).source, "LIVE_LOOKUP", "origen consulta en vivo");

  // 5-6. not found anywhere: create stays closed until switch and verified contract
  reset();
  const e = await setup("e");
  eq((await link(e.methodId)).createState, "CREATE_DISABLED", "sin configuración no se crea");
  eq(calls.create, 0, "no se llamó a crear");
  await setCreate({ enabled: true, contractVerified: false, dailyLimit: 5 });
  const e2 = await setup("e2");
  eq((await link(e2.methodId)).createState, "CREATE_CONTRACT_UNVERIFIED", "contrato sin verificar no crea");
  eq(calls.create, 0, "tampoco se llamó a crear");
  eq((await db.collection("iqBeneficiaryCreateReservations").where("rootId", "==", rootId).get()).size, 0, "sin reserva si no se puede crear");

  // 7. create allowed: once, then the second method with the same account reuses the reservation
  await setCreate({ enabled: true, contractVerified: true, dailyLimit: 2 }); reset();
  createResult = { outcome: "CREATED", iqBeneficiaryId: 4000, iqAccountId: 9000, iqBeneficiaryName: "Juan Perez" };
  const f = await setup("f");
  const outF = await link(f.methodId);
  eq([outF.status, calls.create], ["LINKED", 1], "se crea y se vincula");
  eq((await entry(f.methodId)).source, "CREATED_IN_IQ", "origen creado en IQ");
  const reservation = (await db.doc(`iqBeneficiaryCreateReservations/${createReservationId(rootId, catalog, iqAccountKey(f.clabe))}`).get()).data();
  eq([reservation.status, reservation.iqBeneficiaryId, reservation.iqAccountId], ["CREATED", 4000, 9000], "reserva cerrada con los ids");
  ok((await activities(f.methodId)).includes("IQ_BENEFICIARIO_CREADO"), "auditoría de creación");
  const f2Id = `${run}-f2-m`;
  await db.doc(`clientBeneficiaryMethods/${f2Id}`).set({ rootId, clientId: f.clientId, beneficiaryId: f.benId, clabe: f.clabe, destinationKind: "CLABE", active: true });
  const outF2 = await link(f2Id);
  eq([outF2.status, calls.create], ["LINKED", 1], "una segunda alta de la misma cuenta no crea otra vez");
  eq((await db.doc(`iqBeneficiaryCreateCounters/${rootId}_${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date())}`).get()).get("count"), 1, "el contador diario solo cuenta la creación real");

  // 8. daily limit
  reset(); createResult = { outcome: "CREATED", iqBeneficiaryId: 4001, iqAccountId: 9001, iqBeneficiaryName: "Ana" };
  const g = await setup("g");
  eq((await link(g.methodId)).status, "LINKED", "segunda creación del día cabe en el límite de 2");
  reset(); createResult = { outcome: "CREATED", iqBeneficiaryId: 4002, iqAccountId: 9002, iqBeneficiaryName: "Luis" };
  const h = await setup("h");
  const outH = await link(h.methodId);
  eq([outH.status, outH.createState, calls.create], ["NOT_FOUND", "DAILY_LIMIT_REACHED", 0], "el límite diario detiene la creación sin tocar IQ");
  await setCreate({ enabled: true, contractVerified: true, dailyLimit: 50 });

  // 9. "ya existe" is a link
  reset(); lookupResults = [{ found: false }, { found: true, iqBeneficiaryId: 4100, iqAccountId: 9100, iqBeneficiaryName: "Rosa" }]; createResult = { outcome: "EXISTS" };
  const i = await setup("i");
  const outI = await link(i.methodId);
  eq([outI.status, (await entry(i.methodId)).iqAccountId, calls.create], ["LINKED", 9100, 1], "'ya existe' termina vinculando, sin bucle de error");
  eq((await db.doc(`iqBeneficiaryCreateReservations/${createReservationId(rootId, catalog, iqAccountKey(i.clabe))}`).get()).get("status"), "CREATED", "la reserva queda cerrada");

  // 10. unknown outcome is never retried
  reset(); createResult = { outcome: "OUTCOME_UNKNOWN" };
  const j = await setup("j");
  const outJ = await link(j.methodId);
  eq([outJ.createState, calls.create], ["OUTCOME_UNKNOWN", 1], "resultado incierto se registra");
  ok((await activities(j.methodId)).includes("IQ_BENEFICIARIO_CREACION_INCIERTA"), "auditoría de resultado incierto");
  await db.doc(`clientBeneficiaryMethods/${j.methodId}`).update({ iqLinksByCatalog: admin.firestore.FieldValue.delete() });
  const outJ2 = await link(j.methodId, Date.now() + 20 * 60_000);
  eq([outJ2.createState, calls.create], ["OUTCOME_UNKNOWN", 1], "una reserva incierta bloquea un segundo POST");

  // 11. an error thrown while creating is treated as unknown: it is not retried on its own
  reset(); createResult = new Error("IQ_BENEFICIARY_CREATE_CONTRACT_UNVERIFIED");
  const k = await setup("k");
  const outK = await link(k.methodId);
  eq([outK.status, outK.createState, calls.create], ["NOT_FOUND", "OUTCOME_UNKNOWN", 1], "un error de creación no deja la cuenta vinculada ni se reintenta");
  eq((await db.doc(`iqBeneficiaryCreateReservations/${createReservationId(rootId, catalog, iqAccountKey(k.clabe))}`).get()).get("status"), "OUTCOME_UNKNOWN", "reserva incierta");

  // 11b. "not now" from the safety runtime writes nothing and gives the slot back
  reset();
  const frozen = new SafetyRuntime(db, () => 1_900_000_000_000);
  const early = await setup("early");
  const before = (await db.doc(`iqBeneficiaryCreateCounters/${rootId}_${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date())}`).get()).get("count");
  await linkOrCreateMethod({ methodId: early.methodId, ports, safety: frozen });
  const late = await setup("late");
  const outLate = (await linkOrCreateMethod({ methodId: late.methodId, ports, safety: frozen }))[0];
  eq(outLate.status, "DEFERRED", "dos operaciones en el mismo instante: la segunda se difiere");
  eq(await entry(late.methodId), undefined, "un diferimiento no escribe ningún estado");
  eq((await db.doc(`iqBeneficiaryCreateCounters/${rootId}_${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date())}`).get()).get("count"), before, "una creación diferida devuelve su lugar del día");

  // 12. kill switch
  await db.doc("automationSafetyControls/master").set({ paused: true });
  reset();
  const l = await setup("l");
  const outL = await link(l.methodId);
  eq([outL.createState, calls.lookup, calls.create], ["SAFETY_KILL_SWITCH", 0, 0], "con el interruptor de emergencia no se toca IQ");
  await db.doc("automationSafetyControls/master").delete();

  // 13. ownership and missing client link
  reset();
  const m = await setup("m", { linked: false });
  eq((await link(m.methodId)).skipped, "NO_IQ_CLIENT_LINK", "cliente sin vínculo IQ: no se hace nada");
  const n = await setup("n", { beneficiaryRoot: "otro-root" });
  eq((await link(n.methodId)).skipped, "OWNERSHIP_MISMATCH", "beneficiario de otro root: no se vincula");
  eq((await entry(n.methodId)), undefined, "sin escritura");

  console.log(`PASS vinculación de beneficiarios IQ: ${checks} verificaciones en emulador.`);
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
