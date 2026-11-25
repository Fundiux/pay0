// Automatic beneficiary creation in IQ, with IQ faked at the HTTP boundary (global.fetch). Emulator only.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !String(process.env.GCLOUD_PROJECT || "").startsWith("demo-")) throw new Error("LOCAL_EMULATOR_REQUIRED");
process.env.IQ_CREDENTIALS_KEY = "pay0-local-test-credentials-key-not-a-secret";
process.env.PAY0_IQ_API_ORIGIN = "https://iq.test";
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const lib = "../../functions/lib/modules/beneficiaries";
const { productionIqLinkPorts } = require(`${lib}/iqLinkPorts.js`);
const { linkOrCreateMethod } = require(`${lib}/iqLinkService.js`);
const { createReservationId, catalogAbsenceProof, summarizeEntries, mexicoDay } = require(`${lib}/iqLinkDomain.js`);
const { iqAccountKey, iqCreateAliasForCatalog } = require(`${lib}/iqCatalogDomain.js`);
const { isAlreadyExists, resolveIqBankId } = require(`${lib}/iqBeneficiaryCreateHttp.js`);
const { syncIqCatalog, linkMethodsToCatalog } = require(`${lib}/iqCatalogSync.js`);
const { summarizeIqBeneficiaryLinks } = require(`${lib}/iqLinkSummary.js`);
const { parseCreateConfigPatch } = require(`${lib}/iqCreateConfigCallables.js`);
const { SafetyRuntime } = require("../../functions/lib/modules/automationSafety/runtime.js");

let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (v, label) => { assert.ok(v, label); checks++; };

// ---- fake IQ ----
const iq = { requests: [], logins: [], beneficiaries: [], nextBeneficiary: 500, nextAccount: 9000, accountMode: "ok", accountConciliated: false, failAccounts: new Set() };
const banks = [{ id: 7, name: "BBVA MEXICO" }, { id: 9, name: "SANTANDER" }];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
const norm = value => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const page = (rows, url) => { const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 100); return rows.slice(offset, offset + limit); };
const posts = path => iq.requests.filter(r => r.method === "POST" && r.path === path).length;
const accountPosts = () => iq.requests.filter(r => r.method === "POST" && /^\/beneficiaries\/\d+\/accounts$/.test(r.path)).length;
const beneficiaryPosts = () => iq.requests.filter(r => r.method === "POST" && /^\/partners\/\d+\/beneficiaries$/.test(r.path)).length;
const abort = () => { const error = new Error("aborted"); error.name = "AbortError"; return error; };

global.fetch = async (input, init = {}) => {
  const url = new URL(String(input)), path = url.pathname, method = String(init.method || "GET").toUpperCase();
  if (url.origin !== "https://iq.test") throw new Error("EXTERNAL_NETWORK_FORBIDDEN");
  iq.requests.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
  if (path === "/users/sessions" && method === "POST") { iq.logins.push(JSON.parse(init.body).user.username); return reply(201, { access_token: "tok", user_id: 5 }); }
  if (path === "/partners" && method === "GET") return reply(200, page([{ id: 1 }, { id: 2 }], url));
  let m = path.match(/^\/partners\/(\d+)\/beneficiaries$/);
  if (m && method === "GET") {
    const name = url.searchParams.get("filter[name]");
    return reply(200, page(iq.beneficiaries.filter(b => b.partnerId === Number(m[1]) && (!name || norm(b.name).includes(norm(name)))).map(b => ({ id: b.id, name: b.name, accounts: b.accounts.length })), url));
  }
  if (m && method === "POST") {
    const body = JSON.parse(init.body);
    const beneficiary = { id: iq.nextBeneficiary++, partnerId: Number(m[1]), name: body.beneficiary.name, accounts: [] };
    iq.beneficiaries.push(beneficiary);
    return reply(201, { id: beneficiary.id, name: beneficiary.name });
  }
  if ((m = path.match(/^\/beneficiaries\/(\d+)\/accounts\/new$/))) return reply(200, { banks });
  if (path === "/partners/accounts/new") return reply(200, { banks });
  m = path.match(/^\/beneficiaries\/(\d+)\/accounts$/);
  if (m) {
    const beneficiary = iq.beneficiaries.find(b => b.id === Number(m[1]));
    if (!beneficiary) return reply(404, { errors: ["No encontrado"] });
    if (iq.failAccounts.has(beneficiary.id)) return reply(404, { errors: ["No encontrado"] });
    if (method === "GET") {
      const clabe = url.searchParams.get("filter[clabe]"), card = url.searchParams.get("filter[card_number]");
      return reply(200, page(beneficiary.accounts.filter(a => !a.hidden && (!clabe || String(a.clabe || "").includes(clabe)) && (!card || String(a.card_number || "").includes(card))), url));
    }
    const body = JSON.parse(init.body);
    const hidden = beneficiary.accounts.find(a => a.hidden && a.clabe === body.clabe);
    if (hidden) { hidden.hidden = false; return reply(422, { errors: ["Clabe ya ha sido tomada"] }); }
    const mode = iq.accountMode;
    if (mode === "timeoutLost") throw abort();
    if (mode === "500") return reply(500, { errors: ["Error interno"] });
    const account = { id: iq.nextAccount++, clabe: body.clabe, card_number: body.card_number, bank_id: body.bank_id, owner_name: body.name, conciliation_status: iq.accountConciliated ? "Conciliado" : "pending_conciliation" };
    beneficiary.accounts.push(account);
    if (mode === "timeoutAfterSend") throw abort();
    return reply(201, account);
  }
  throw new Error(`RUTA_INESPERADA ${method} ${path}`);
};

// ---- PAY0 data ----
const run = `bc${Date.now()}`;
const rootId = `${run}-root`;
const keyBuffer = crypto.createHash("sha256").update(process.env.IQ_CREDENTIALS_KEY).digest();
function encrypted(password) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return { passwordCiphertext: ciphertext.toString("base64"), passwordIv: iv.toString("base64"), passwordTag: cipher.getAuthTag().toString("base64") };
}
const PROFILES = { "p-betell": { alias: "BETELL 1", username: "betell-user" }, "p-rr": { alias: "RR", username: "rr-user" }, "p-pay0": { alias: "PAY0", username: "pay0-user" } };
let seq = 100;
const newClabe = () => `0121800${String(++seq).padStart(3, "0")}${String(Date.now()).slice(-8)}`;
async function setup(name, { clabe = newClabe(), profileId = "p-betell", benName = `Beneficiario ${name}`, bankName = "BBVA México, S.A., Institución de Banca Múltiple", bankCode = "012" } = {}) {
  const clientId = `${run}-${name}-c`, benId = `${run}-${name}-b`, methodId = `${run}-${name}-m`;
  const alias = PROFILES[profileId].alias;
  await db.doc(`clients/${clientId}`).set({ rootId, iqLinksByProfile: { [profileId]: { status: "LINKED", clientId: "77", profileId, profileAlias: alias, partnerName: "ASOCIADO", partnerId: "1", active: true } } });
  await db.doc(`clientBeneficiaries/${benId}`).set({ rootId, clientId, nombre: benName });
  await db.doc(`clientBeneficiaryMethods/${methodId}`).set({ rootId, clientId, beneficiaryId: benId, clabe, bankCode, bankName, destinationKind: "CLABE", active: true });
  return { clientId, benId, methodId, clabe, benName };
}
const catalogOf = profileId => PROFILES[profileId].alias === "PAY0" ? "iq-group-pay0" : "iq-group-rr";
const entry = async (methodId, catalog = "iq-group-rr") => (await db.doc(`clientBeneficiaryMethods/${methodId}`).get()).get("iqLinksByCatalog")?.[catalog];
const reservation = async (clabe, catalog = "iq-group-rr") => (await db.doc(`iqBeneficiaryCreateReservations/${createReservationId(rootId, catalog, iqAccountKey(clabe))}`).get()).data();
const counter = () => db.doc(`iqBeneficiaryCreateCounters/${rootId}_${mexicoDay(Date.now())}`);
const setFresh = hoursAgo => Promise.all(["iq-group-rr", "iq-group-pay0"].map(catalog => db.doc(`iqBeneficiaryCatalogState/${rootId}_${catalog}`).set({ partnerSyncedAt: { "1": Timestamp.fromMillis(Date.now() - hoursAgo * 3_600_000) } }, { merge: true })));
const resetSafety = async () => { for (const name of ["automationSafetyScopes", "automationSafetyEvents"]) for (const doc of (await db.collection(name).get()).docs) await db.recursiveDelete(doc.ref); };
let clock = Date.now();
const safety = new SafetyRuntime(db, () => (clock += 5000));
// The name search through the dispersion wizard is replaced; create and findExisting are the production ports.
const ports = { ...productionIqLinkPorts, liveLookup: async () => ({ found: false }) };
const link = async (methodId, nowMs) => (await linkOrCreateMethod({ methodId, ports, safety, nowMs }))[0];
const resetIq = () => { iq.requests.length = 0; iq.logins.length = 0; iq.accountMode = "ok"; iq.accountConciliated = false; };

(async () => {
  // ---- pure rules ----
  eq(iqCreateAliasForCatalog("iq-group-rr"), "RR", "el catálogo RR/BETELL crea con RR");
  eq(iqCreateAliasForCatalog("iq-group-pay0"), "PAY0", "el catálogo de ELIUT crea con PAY0");
  ok(isAlreadyExists(["Clabe ya ha sido tomada"]) && isAlreadyExists("La cuenta ya existe") && isAlreadyExists(["has already been taken"]), "reconoce 'ya existe'");
  ok(!isAlreadyExists(["Banco no puede estar vacío"]), "otros errores no son 'ya existe'");
  eq(resolveIqBankId([{ id: 3, name: "X", code: "012" }, { id: 4, name: "Y", code: "014" }], "012", ""), 3, "banco por clave ABM cuando IQ la expone");
  eq(resolveIqBankId(banks, "012", "BBVA México, S.A., Institución de Banca Múltiple"), 7, "banco por nombre normalizado");
  eq(resolveIqBankId(banks, "999", "Banco Inexistente"), 0, "banco desconocido: no se adivina");
  const ts = ms => ({ toMillis: () => ms }), now = Date.now();
  eq(catalogAbsenceProof({ partnerId: "", partnerRows: [], state: { partnerSyncedAt: { 1: ts(now) } }, nowMs: now, maxAgeMs: 36 * 3_600_000 }).reason, "PARTNER_UNKNOWN", "sin asociado no hay prueba");
  eq(catalogAbsenceProof({ partnerId: "1", partnerRows: [{}], state: { partnerSyncedAt: { 1: ts(now) } }, nowMs: now, maxAgeMs: 36 * 3_600_000 }).reason, "ACCOUNT_IN_CATALOG", "una fila (aun cancelada) no es ausencia");
  eq(catalogAbsenceProof({ partnerId: "1", partnerRows: [], state: { partnerSyncedAt: { 1: ts(now - 37 * 3_600_000) } }, nowMs: now, maxAgeMs: 36 * 3_600_000 }).reason, "CATALOG_STALE", "más de 36 h: viejo");
  eq(catalogAbsenceProof({ partnerId: "1", partnerRows: [], state: { partnerSyncedAt: { 1: ts(now - 3_600_000) } }, nowMs: now, maxAgeMs: 36 * 3_600_000 }).proven, true, "catálogo reciente sin fila: ausencia probada");
  eq(summarizeEntries([{ status: "LINKED", source: "CREATED_IN_IQ" }, { status: "LINKED", source: "CATALOG" }, { status: "NOT_CONCILIATED", source: "CREATED_IN_IQ" }, { status: "PENDING_RETRY", pendingSince: ts(now - 25 * 3_600_000) }, { status: "PENDING_RETRY", pendingSince: ts(now) }, { status: "REVIEW_REQUIRED" }], now),
    { linked: 2, created: 1, awaitingConciliation: 1, pending: 2, stuck: 1, review: 1, notFound: 0 }, "resumen diario por estado");
  eq(parseCreateConfigPatch({ enabled: true, dailyLimit: 100 }), { enabled: true, dailyLimit: 100 }, "configuración válida");
  assert.throws(() => parseCreateConfigPatch({ dailyLimit: 500 }), /dailyLimit/); checks++;
  eq(parseCreateConfigPatch({ dailyLimit: null }), { dailyLimit: null }, "vaciar el límite diario lo quita");
  eq(parseCreateConfigPatch({ dailyLimit: "" }), { dailyLimit: null }, "límite vacío = sin límite");
  assert.throws(() => parseCreateConfigPatch({ enabled: "si" }), /enabled/); checks++;
  assert.throws(() => parseCreateConfigPatch({}), /Sin cambios/); checks++;

  // ---- setup ----
  for (const [id, profile] of Object.entries(PROFILES)) await db.doc(`iqCredentialProfiles/${id}`).set({ rootId, alias: profile.alias, username: profile.username, active: true, hasPassword: true, ...encrypted(`pw-${id}`) });
  await db.doc(`iqIntegrationConfigs/${rootId}`).set({ enabled: true });
  await db.doc(`iqBeneficiaryCreateConfig/${rootId}`).set({ enabled: true, contractVerified: true }); // no daily limit by default (owner 2026-11-24)
  await setFresh(1);

  // A. RR catalog through a BETELL 1 client: absent in the catalog -> created once, with the RR login
  resetIq();
  const a = await setup("a");
  const outA = await link(a.methodId);
  eq([outA.status, outA.createState], ["NOT_CONCILIATED", "PENDING_CONCILIATION"], "creada: espera conciliación de IQ, no se usa aún");
  eq([beneficiaryPosts(), accountPosts()], [1, 1], "un alta de beneficiario y una de cuenta");
  eq([...new Set(iq.logins)], ["rr-user"], "el catálogo RR crea con el perfil RR, no con BETELL 1");
  const accountBody = iq.requests.find(r => r.method === "POST" && /accounts$/.test(r.path)).body;
  eq(accountBody, { name: a.benName, bank_id: 7, clabe: a.clabe }, "cuerpo de la cuenta según el contrato de IQ");
  eq(iq.requests.find(r => r.method === "POST" && /beneficiaries$/.test(r.path)).body, { beneficiary: { name: a.benName } }, "cuerpo del beneficiario según el contrato de IQ");
  const eA = await entry(a.methodId);
  ok(eA.iqBeneficiaryId > 0 && eA.iqAccountId > 0 && eA.source === "CREATED_IN_IQ", "guarda los ids de lo creado");
  eq((await reservation(a.clabe)).status, "CREATED", "reserva cerrada");
  eq((await counter().get()).get("count"), 1, "el contador diario cuenta una creación");
  resetIq();
  const a2Id = `${run}-a2-m`;
  await db.doc(`clientBeneficiaryMethods/${a2Id}`).set({ rootId, clientId: a.clientId, beneficiaryId: a.benId, clabe: a.clabe, bankCode: "012", bankName: "BBVA", destinationKind: "CLABE", active: true });
  const outA2 = await link(a2Id);
  eq([outA2.status, (await entry(a2Id)).iqAccountId, iq.requests.length], ["NOT_CONCILIATED", eA.iqAccountId, 0], "la misma cuenta en otro método reutiliza la creación sin tocar IQ");

  // A-personal. New personal commission account only stores masked digits in
  // the client-scoped method. Full CLABE is provided to IQ in transient memory.
  await resetSafety(); resetIq();
  const personal = await setup("personal");
  await db.doc(`clientBeneficiaryMethods/${personal.methodId}`).update({
    clabe: FieldValue.delete(), cardNumber: FieldValue.delete(),
    sourceType: "PERSONAL_COMMISSION", personalCommissionAccountId: "personal-owner-account",
    personalAccountFingerprint: "fixture-fingerprint", last4: personal.clabe.slice(-4),
    masked: "••" + personal.clabe.slice(-4),
  });
  const personalResult = (await linkOrCreateMethod({
    methodId: personal.methodId, ports, safety,
    methodOverride: { clabe: personal.clabe, cardNumber: null },
  }))[0];
  eq([personalResult.status, beneficiaryPosts(), accountPosts()],
    ["NOT_CONCILIATED", 1, 1], "cuenta cifrada de comisión: creación IQ con CLABE solo en memoria");
  const persistedPersonal = (await db.doc(`clientBeneficiaryMethods/${personal.methodId}`).get()).data();
  ok(!persistedPersonal.clabe && !persistedPersonal.cardNumber &&
    persistedPersonal.personalCommissionAccountId === "personal-owner-account",
    "el método compatible conserva sólo máscara e identificador, nunca CLABE completa");
  resetIq();
  const personalAgain = (await linkOrCreateMethod({
    methodId: personal.methodId, ports, safety,
    methodOverride: { clabe: personal.clabe, cardNumber: null },
  }))[0];
  eq([personalAgain.status, accountPosts(), beneficiaryPosts()],
    ["NOT_CONCILIATED", 0, 0], "solicitud repetida no crea dos veces en IQ");
  await assert.rejects(() => linkOrCreateMethod({
    methodId: a.methodId, ports, safety,
    methodOverride: { clabe: personal.clabe },
  }), /PERSONAL_IQ_OVERRIDE_NOT_ALLOWED/); checks++;
  resetIq();

  // B. PAY0 catalog with the PAY0 login; the beneficiary already exists in IQ, only the account is added
  resetIq(); iq.accountConciliated = true;
  iq.beneficiaries.push({ id: iq.nextBeneficiary++, partnerId: 1, name: "Beneficiario b", accounts: [] });
  const b = await setup("b", { profileId: "p-pay0" });
  const outB = await link(b.methodId);
  eq([outB.status, beneficiaryPosts(), accountPosts()], ["LINKED", 0, 1], "beneficiario existente: solo se agrega la cuenta; conciliada queda vinculada");
  eq([...new Set(iq.logins)], ["pay0-user"], "el catálogo de ELIUT crea con el perfil PAY0");
  eq((await entry(b.methodId, "iq-group-pay0")).source, "CREATED_IN_IQ", "origen creado en IQ");

  // C. "ya existe" -> read again and link, never an error loop
  resetIq(); iq.accountConciliated = true;
  const c = await setup("c");
  iq.beneficiaries.push({ id: iq.nextBeneficiary++, partnerId: 1, name: c.benName, accounts: [{ id: iq.nextAccount++, clabe: c.clabe, conciliation_status: "Conciliado", hidden: true }] });
  const outC = await link(c.methodId);
  eq([outC.status, accountPosts()], ["LINKED", 1], "'ya existe': se relee y se vincula");
  eq((await reservation(c.clabe)).reconciledFrom, "EXISTS", "la reserva registra que se resolvió leyendo");

  // D. timeout after the POST left: the account is found by reading, never sent twice
  await resetSafety(); resetIq(); iq.accountMode = "timeoutAfterSend";
  const d = await setup("d");
  const outD = await link(d.methodId);
  eq([outD.status, accountPosts()], ["NOT_CONCILIATED", 1], "respuesta perdida: se encuentra leyendo y se vincula");
  eq((await reservation(d.clabe)).status, "CREATED", "reserva cerrada tras la lectura");
  await db.doc(`clientBeneficiaryMethods/${d.methodId}`).update({ iqLinksByCatalog: FieldValue.delete() });
  resetIq();
  await link(d.methodId, Date.now() + 3_600_000);
  eq(accountPosts(), 0, "repetir el método no vuelve a crear");

  // E. timeout and nothing in IQ: re-read a few times, never re-sent, then a person
  await resetSafety(); resetIq(); iq.accountMode = "timeoutLost";
  const e = await setup("e");
  const outE = await link(e.methodId);
  eq([outE.status, outE.createState, accountPosts()], ["PENDING_RETRY", "CREATE_OUTCOME_UNKNOWN", 1], "resultado incierto: pendiente de releer");
  let last;
  for (let i = 1; i <= 3; i++) { await resetSafety(); last = await link(e.methodId, Date.now() + i * 7 * 3_600_000); }
  eq([last.status, last.createState, accountPosts()], ["REVIEW_REQUIRED", "OUTCOME_UNKNOWN", 1], "tras releer sin encontrarla va a revisión; un solo POST de cuenta en total");
  eq((await reservation(e.clabe)).status, "OUTCOME_UNKNOWN", "la reserva incierta nunca se vuelve a tomar");

  // F. an explicit daily limit of 100 is respected
  await db.doc(`iqBeneficiaryCreateConfig/${rootId}`).set({ dailyLimit: 100 }, { merge: true });
  await resetSafety(); resetIq();
  await counter().set({ count: 99 }, { merge: true });
  const f = await setup("f");
  eq([(await link(f.methodId)).status, accountPosts()], ["NOT_CONCILIATED", 1], "la creación 100 del día cabe");
  resetIq();
  const f2 = await setup("f2");
  const outF2 = await link(f2.methodId);
  eq([outF2.status, outF2.createState, accountPosts(), beneficiaryPosts()], ["PENDING_RETRY", "DAILY_LIMIT_REACHED", 0, 0], "la 101 espera al día siguiente sin escribir en IQ");
  // F3. without dailyLimit there is no cap: the 101st of the day is created
  await db.doc(`iqBeneficiaryCreateConfig/${rootId}`).set({ dailyLimit: FieldValue.delete() }, { merge: true });
  await resetSafety(); resetIq();
  await counter().set({ count: 100 }, { merge: true });
  const f3 = await setup("f3");
  eq([(await link(f3.methodId)).status, accountPosts()], ["NOT_CONCILIATED", 1], "sin límite configurado la 101 del día se crea");
  await counter().set({ count: 0 }, { merge: true });

  // G. stale catalog does not make a new beneficiary wait: IQ is read for this associate and account, then created once
  resetIq(); await setFresh(130);
  const g = await setup("g");
  const outG = await link(g.methodId);
  eq([outG.status, outG.createState, accountPosts(), beneficiaryPosts()], ["NOT_CONCILIATED", "PENDING_CONCILIATION", 1, 1], "catálogo viejo: se consulta IQ en el momento y se crea una sola vez");
  eq([outG.methodId, (await entry(g.methodId)).source], [g.methodId, "CREATED_IN_IQ"], "se registra como creado en IQ");
  // G2. stale catalog and the account is already in IQ for that associate: linked, nothing created
  resetIq();
  const g2 = await setup("g2");
  iq.beneficiaries.push({ id: iq.nextBeneficiary++, partnerId: 1, name: g2.benName, accounts: [{ id: iq.nextAccount++, clabe: g2.clabe, bank_id: 7, owner_name: g2.benName, conciliation_status: "Conciliado" }] });
  const outG2 = await link(g2.methodId);
  eq([outG2.status, accountPosts(), beneficiaryPosts()], ["LINKED", 0, 0], "catálogo viejo y la cuenta ya existe en IQ: se vincula sin crear");
  eq((await entry(g2.methodId)).source, "LIVE_LOOKUP", "se vinculó por consulta en vivo");
  await setFresh(1);

  // H. unknown bank: stops before writing and gives the day's slot back
  resetIq();
  const before = Number((await counter().get()).get("count") || 0);
  const h = await setup("h", { bankName: "Banco Inexistente", bankCode: "999", clabe: `9991800${String(++seq).padStart(3, "0")}${String(Date.now()).slice(-8)}` });
  const outH = await link(h.methodId);
  eq([outH.status, outH.createState, accountPosts(), beneficiaryPosts()], ["REVIEW_REQUIRED", "IQ_BANK_UNRESOLVED", 0, 0], "banco sin equivalente en IQ: revisión, sin escribir");
  eq([Number((await counter().get()).get("count") || 0), (await reservation(h.clabe)).status], [before, "FAILED_SAFE"], "devuelve el lugar del día");

  // I. burst: five methods with the same account at once (several instances) -> one create
  await resetSafety(); resetIq();
  const burst = await setup("i0");
  const ids = [burst.methodId];
  for (let n = 1; n < 5; n++) { const id = `${run}-i${n}-m`; ids.push(id); await db.doc(`clientBeneficiaryMethods/${id}`).set({ rootId, clientId: burst.clientId, beneficiaryId: burst.benId, clabe: burst.clabe, bankCode: "012", bankName: "BBVA MEXICO", destinationKind: "CLABE", active: true }); }
  const burstOutcomes = (await Promise.all(ids.map(id => linkOrCreateMethod({ methodId: id, ports, safety })))).flat();
  ok(accountPosts() <= 1, "ráfaga concurrente: nunca más de una cuenta creada en IQ");
  ok(burstOutcomes.every(o => ["NOT_CONCILIATED", "DEFERRED", "IN_PROGRESS"].includes(o.status)), `lo que no se resolvió se difiere para reintento (${burstOutcomes.map(o => o.status + ":" + (o.createState || "")).join(",")})`);
  // The trigger retries what was deferred or in progress (several rounds, like the platform's backoff).
  for (let round = 1; round <= 3; round++) for (const id of ids) if ((await entry(id))?.status !== "NOT_CONCILIATED") await linkOrCreateMethod({ methodId: id, ports, safety, nowMs: Date.now() + round * 3_600_000 });
  const burstAccounts = new Set(await Promise.all(ids.map(async id => (await entry(id))?.iqAccountId)));
  eq([burstAccounts.size, accountPosts()], [1, 1], "los reintentos enlazan todos con la misma cuenta, sin otra creación");

  // J. the nightly pass does not rewrite an unchanged link (no trigger storm)
  const j = await setup("j");
  await db.doc(`iqBeneficiaryCatalog/${rootId}_iq-group-rr_7777`).set({ rootId, catalog: "iq-group-rr", key: iqAccountKey(j.clabe), last4: j.clabe.slice(-4), partnerId: 1, beneficiaryId: 77, beneficiaryName: j.benName, accountId: 7777, conciliationStatus: "Conciliado" });
  await db.doc(`iqBeneficiaryCatalogState/${rootId}_iq-group-rr`).set({ methodCursor: null }, { merge: true });
  await linkMethodsToCatalog({ rootId, catalog: "iq-group-rr", limit: 500 });
  const firstWrite = (await db.doc(`clientBeneficiaryMethods/${j.methodId}`).get()).updateTime.toMillis();
  eq((await entry(j.methodId)).status, "LINKED", "el barrido vincula por catálogo");
  await db.doc(`iqBeneficiaryCatalogState/${rootId}_iq-group-rr`).set({ methodCursor: null }, { merge: true });
  await linkMethodsToCatalog({ rootId, catalog: "iq-group-rr", limit: 500 });
  eq((await db.doc(`clientBeneficiaryMethods/${j.methodId}`).get()).updateTime.toMillis(), firstWrite, "la segunda noche no reescribe un vínculo igual");

  // K. the catalog sync stamps an associate only when read whole with no row skipped
  const kRoot = `${run}-k`;
  iq.beneficiaries.push({ id: 801, partnerId: 2, name: "Otro", accounts: [{ id: 8101, clabe: "002180000000000001", conciliation_status: "Conciliado" }] });
  iq.beneficiaries.push({ id: 802, partnerId: 2, name: "Falla", accounts: [] });
  iq.failAccounts.add(802);
  await syncIqCatalog({ rootId: kRoot, catalog: "iq-group-pay0", session: { apiOrigin: "https://iq.test", accessToken: "tok" }, deadlineMs: Date.now() + 120_000, spacingMs: 0 });
  const kState = (await db.doc(`iqBeneficiaryCatalogState/${kRoot}_iq-group-pay0`).get()).data();
  ok(kState.partnerSyncedAt?.["1"], "asociado leído completo: queda fechado");
  eq(kState.partnerSyncedAt?.["2"], undefined, "asociado con una fila omitida: no prueba ausencias");

  // K2. a pass resumed on a later night keeps its start date; a resumed pass with no stored start proves nothing
  const session = { apiOrigin: "https://iq.test", accessToken: "tok" };
  const startedAt = Timestamp.fromMillis(Date.now() - 3 * 86_400_000);
  const resumedRoot = `${run}-k2`, unknownRoot = `${run}-k3`;
  await db.doc(`iqBeneficiaryCatalogState/${resumedRoot}_iq-group-pay0`).set({ partnerId: 1, offset: 1, passPartnerId: 1, passStartedAt: startedAt, passClean: true });
  await db.doc(`iqBeneficiaryCatalogState/${unknownRoot}_iq-group-pay0`).set({ partnerId: 1, offset: 1 });
  await syncIqCatalog({ rootId: resumedRoot, catalog: "iq-group-pay0", session, deadlineMs: Date.now() + 120_000, spacingMs: 0 });
  await syncIqCatalog({ rootId: unknownRoot, catalog: "iq-group-pay0", session, deadlineMs: Date.now() + 120_000, spacingMs: 0 });
  eq((await db.doc(`iqBeneficiaryCatalogState/${resumedRoot}_iq-group-pay0`).get()).data().partnerSyncedAt?.["1"]?.toMillis(), startedAt.toMillis(), "pasada reanudada: se fecha con el inicio de la pasada");
  eq((await db.doc(`iqBeneficiaryCatalogState/${unknownRoot}_iq-group-pay0`).get()).data().partnerSyncedAt?.["1"], undefined, "pasada reanudada sin inicio guardado: no prueba ausencias");

  // L. daily summary: counts without identifiers and an incident for methods stuck more than a day
  const stuck = await setup("stuck");
  await db.doc(`clientBeneficiaryMethods/${stuck.methodId}`).set({ iqLinksByCatalog: { "iq-group-rr": { status: "PENDING_RETRY", reason: "CATALOG_STALE", attempts: 1, key: iqAccountKey(stuck.clabe), last4: stuck.clabe.slice(-4), source: "CATALOG", pendingSince: Timestamp.fromMillis(Date.now() - 30 * 3_600_000) } } }, { merge: true });
  const summary = await summarizeIqBeneficiaryLinks({ catalogs: ["iq-group-rr"], force: true });
  ok(summary["iq-group-rr"].stuck >= 1 && summary["iq-group-rr"].created >= 1 && summary["iq-group-rr"].awaitingConciliation >= 1, "el resumen cuenta creadas, en conciliación y atoradas");
  const incidents = (await db.collection("agentIncidents").where("rootId", "==", rootId).where("entityType", "==", "beneficiaryIqLink").get()).docs.map(doc => doc.data());
  eq([incidents.length, incidents[0]?.status, incidents[0]?.entityId], [1, "OPEN", "iq-group-rr"], "un incidente abierto por root y catálogo");
  ok(!/clientBeneficiaryMethods|\d{10,}/.test(incidents[0].cause), "el incidente no muestra identificadores ni cuentas");

  console.log(`PASS alta automática de beneficiarios en IQ: ${checks} verificaciones en emulador (IQ simulado por HTTP).`);
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
