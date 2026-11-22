const assert = require("node:assert/strict");
const fs = require("node:fs");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw new Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
global.fetch = async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const admin = require("../../functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const core = require("../../functions/lib/modules/facturama/repCancellation.js");
const proc = require("../../functions/lib/modules/facturama/repCancellationProcess.js");
const callables = require("../../functions/lib/modules/facturama/repCancellationCallables.js");

let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (v, label) => { assert.ok(v, label); checks++; };
const code = async fn => { try { await fn(); } catch (error) { return error.code || error.message; } return "no-error"; };
const HOURS = 3600_000;

(async () => {
  const run = `rep${Date.now()}`, rootId = `${run}-root`;
  await db.doc(`users/${rootId}`).set({ role: "superadmin", rootId, active: true });
  await db.doc(`users/${run}-op`).set({ role: "operador", rootId, active: true });
  await db.doc(`users/${run}-other`).set({ role: "superadmin", rootId: `${rootId}-x`, active: true });
  const solicitud = async name => { await db.doc(`solicitudes/${run}-${name}`).set({ rootId, folio: `F-${name}` }); return `${run}-${name}`; };
  const rep = async (solId, n, job = {}) => {
    const jobId = `${run}-${solId.slice(-4)}-job${n}`;
    await db.doc(`paymentComplementJobs/${jobId}`).set({ rootId, provider: "FACTURAMA", status: "RECEIVED", cfdiId: `cfdi-${jobId}`, ...job });
    await db.doc(`paymentComplementRequests/${jobId}-req`).set({ rootId, solicitudId: solId, provider: "FACTURAMA", automationJobId: jobId, applicationFolio: `A-${n}`, installment: n, amountMinor: 10000 * n, uuid: `UUID-${jobId}` });
    return jobId;
  };

  // Ports over the real Firestore helpers; everything that would reach Facturama, the SAT or WhatsApp is recorded instead.
  const harness = (solId, options = {}) => {
    const log = { cancelCalls: [], acuses: [], alerts: [], originalRequests: 0, order: [] };
    const state = { satCancelled: new Set(options.satCancelled || []), answers: options.answers || {}, original: options.original || { state: "NOT_REQUESTED", requestedAtMs: 0 }, offsetMs: options.offsetMs || 0 };
    const ports = {
      nowMs: () => Date.now() + state.offsetMs,
      reps: () => core.listFacturamaReps(db, rootId, solId),
      repSatCancelled: async r => state.satCancelled.has(r.cfdiId),
      requestRepCancel: async r => {
        log.order.push(`REP${r.installment}`);
        return core.requestOneRepCancellation({ db, rootId, solicitudId: solId, solicitudFolio: "F", actorUid: rootId, actorRole: "superadmin", rep: r,
          cancelCfdi: async (cfdiId, motive) => { log.cancelCalls.push([cfdiId, motive]); const a = state.answers[cfdiId]; if (a instanceof Error) throw a; return { Status: a ?? "canceled" }; } });
      },
      markRepCancelled: r => core.markRepCancelled(db, r),
      saveRepAcuse: async r => { log.acuses.push(r.installment); await db.doc(`paymentComplementJobs/${r.jobId}`).set({ repCancellationReceiptUploadId: `acuse-${r.jobId}` }, { merge: true }); },
      original: async () => state.original,
      requestOriginal: async () => { log.originalRequests++; log.order.push("ORIGINAL"); state.original = { state: "REQUESTED", requestedAtMs: Date.now() + state.offsetMs }; },
      alert: async a => { log.alerts.push(a); },
    };
    return { ports, log, state };
  };

  // Which complements count ---------------------------------------------------------------------------------------------
  const s1 = await solicitud("s1");
  const j2 = await rep(s1, 2), j1 = await rep(s1, 1);
  await rep(s1, 3, { status: "PAUSED", cfdiId: "" });
  await db.doc(`paymentComplementRequests/${run}-iq`).set({ rootId, solicitudId: s1, provider: "IQ", automationJobId: "none", installment: 9 });
  await db.doc(`paymentComplementJobs/${run}-foreign`).set({ rootId: `${rootId}-x`, provider: "FACTURAMA", status: "RECEIVED", cfdiId: "cfdi-foreign" });
  await db.doc(`paymentComplementRequests/${run}-foreign-req`).set({ rootId, solicitudId: s1, provider: "FACTURAMA", automationJobId: `${run}-foreign`, installment: 8 });
  const listed = await core.listFacturamaReps(db, rootId, s1);
  eq(listed.map(r => r.installment), [1, 2], "solo los complementos de Facturama ya emitidos, del mismo root, en orden de parcialidad");
  eq(core.publicRep(listed[0]), { installment: 1, amountMinor: 10000, cancelled: false }, "la pantalla recibe parcialidad e importe, sin ids");
  eq(listed[0].uuid, `UUID-${j1}`.toUpperCase(), "se conoce el UUID del complemento para preguntar al SAT");

  // The happy path: complements first, receipts as they come, the original last ---------------------------------------------
  let h = harness(s1);
  let summary = await proc.advanceCancellation(h.ports);
  eq(h.log.order, ["REP1", "REP2", "ORIGINAL"], "primero los complementos, uno por uno, y la original al final");
  eq([summary.phase, h.log.originalRequests, h.log.acuses], ["ORIGINAL", 1, [1, 2]], "con todos confirmados se pide la original y se guardan los acuses de cada complemento");
  eq([...new Set(h.log.cancelCalls.map(c => c[1]))], ["02"], "complementos con motivo SAT 02");
  eq((await db.doc(`paymentComplementJobs/${j1}`).get()).get("repCancellationStatus"), "CANCELED", "el complemento queda cancelado");
  // The same pass again: nothing is sent twice (no second cancellation, no second receipt, no second original request).
  const before = h.log.cancelCalls.length;
  summary = await proc.advanceCancellation({ ...h.ports, original: async () => ({ state: "REQUESTED", requestedAtMs: Date.now() }) });
  eq([h.log.cancelCalls.length, h.log.acuses.length, h.log.originalRequests], [before, 2, 1], "repetir la pasada no reenvía cancelaciones, acuses ni la solicitud de la original");
  eq((await proc.advanceCancellation({ ...h.ports, original: async () => ({ state: "CANCELED", requestedAtMs: 0 }) })).phase, "DONE", "con la original cancelada el proceso termina");

  // A complement the SAT has not confirmed: nothing is cancelled early ----------------------------------------------------------
  const s2 = await solicitud("s2");
  const k1 = await rep(s2, 1), k2 = await rep(s2, 2);
  h = harness(s2, { answers: { [`cfdi-${k1}`]: "Vigente" } });
  summary = await proc.advanceCancellation(h.ports);
  eq([summary.phase, h.log.originalRequests, h.log.order], ["REPS", 0, ["REP1", "REP2"]], "un complemento sin confirmar deja la original sin pedir");
  eq((await db.doc(`paymentComplementJobs/${k2}`).get()).get("repCancellationStatus"), "CANCELED", "los demás complementos sí se cancelan");
  // Before 72 hours: patience, no new request, no alert.
  h.log.cancelCalls.length = 0; h.log.order.length = 0;
  summary = await proc.advanceCancellation(h.ports);
  eq([summary.phase, h.log.cancelCalls.length, h.log.alerts.length, h.log.originalRequests], ["REPS", 0, 0, 0], "antes de 72 horas no se vuelve a pedir ni se avisa");
  // The SAT confirms later: the receipt is saved and only now the original goes.
  h.state.satCancelled.add(`cfdi-${k1}`);
  summary = await proc.advanceCancellation(h.ports);
  eq([summary.phase, h.log.originalRequests, h.log.acuses.includes(1)], ["ORIGINAL", 1, true], "al confirmar el SAT se guarda el acuse y recién entonces se cancela la original");

  // After 72 hours: ask again and tell the internal group, once -------------------------------------------------------------------
  const s3 = await solicitud("s3");
  const u1 = await rep(s3, 1);
  h = harness(s3, { answers: { [`cfdi-${u1}`]: "Vigente" } });
  await proc.advanceCancellation(h.ports);
  h.log.cancelCalls.length = 0;
  h.state.offsetMs = 73 * HOURS;
  summary = await proc.advanceCancellation(h.ports);
  eq([h.log.cancelCalls.length, h.log.alerts, h.log.originalRequests], [1, [{ kind: "REP", installment: 1, attempt: 2 }], 0], "pasadas 72 horas se solicita de nuevo, se avisa al grupo interno y la original sigue esperando");
  eq((await db.doc(`paymentComplementJobs/${u1}`).get()).get("repCancellationAttempts"), 2, "queda contado el segundo intento");
  h.state.offsetMs = 1 * HOURS;
  await proc.advanceCancellation(h.ports);
  eq([h.log.cancelCalls.length, h.log.alerts.length], [1, 1], "tras volver a solicitar, no se avisa ni se pide otra vez hasta pasar otras 72 horas");

  // A rejected request (4xx) stays pending and follows the same 72-hour rule --------------------------------------------------------
  const s4 = await solicitud("s4");
  const v1 = await rep(s4, 1);
  h = harness(s4, { answers: { [`cfdi-${v1}`]: Object.assign(new Error("rechazado"), { providerStatus: 400 }) } });
  summary = await proc.advanceCancellation(h.ports);
  eq([summary.phase, h.log.originalRequests, (await db.doc(`paymentComplementJobs/${v1}`).get()).get("repCancellationStatus")], ["REPS", 0, "REQUEST_FAILED"], "un rechazo deja el proceso pendiente sin tocar la original");
  h.state.answers = {};
  h.state.offsetMs = 73 * HOURS;
  summary = await proc.advanceCancellation(h.ports);
  eq([h.log.alerts.length, summary.phase, h.log.originalRequests], [1, "ORIGINAL", 1], "a las 72 horas se reintenta con aviso y, si ya quedó cancelado, sigue la original");

  const s5 = await solicitud("s5");
  const w1 = await rep(s5, 1);
  h = harness(s5, { answers: { [`cfdi-${w1}`]: Object.assign(new Error("timeout"), { providerStatus: 504 }) } });
  await proc.advanceCancellation(h.ports);
  eq((await db.doc(`paymentComplementJobs/${w1}`).get()).get("repCancellationStatus"), "REQUEST_UNCERTAIN", "un timeout queda incierto");
  h.log.cancelCalls.length = 0;
  await proc.advanceCancellation(h.ports);
  eq(h.log.cancelCalls.length, 0, "con una solicitud incierta abierta no se reenvía a ciegas");

  // The original: waits 72 hours, then asks again with a notice --------------------------------------------------------------------------
  const none = await solicitud("none");
  h = harness(none, { original: { state: "REQUESTED", requestedAtMs: Date.now() } });
  summary = await proc.advanceCancellation(h.ports);
  eq([summary.phase, h.log.originalRequests, h.log.alerts.length], ["ORIGINAL", 0, 0], "la original solicitada espera la confirmación sin repetirse");
  h.state.offsetMs = 73 * HOURS;
  await proc.advanceCancellation(h.ports);
  eq([h.log.originalRequests, h.log.alerts], [1, [{ kind: "ORIGINAL", attempt: 2 }]], "pasadas 72 horas se pide de nuevo y se avisa al grupo interno");
  eq((await proc.advanceCancellation(harness(none, { original: { state: "NOT_REQUESTED", requestedAtMs: 0 } }).ports)).phase, "ORIGINAL", "sin complementos y sin solicitud, se pide la original");
  const s6 = await solicitud("s6");
  await rep(s6, 1);
  h = harness(s6);
  summary = await proc.advanceCancellation(h.ports, { repsOnly: true });
  eq([summary.phase, h.log.originalRequests, h.log.order], ["ORIGINAL", 0, ["REP1"]], "la ruta de sustitución cancela solo los complementos y deja la original a su propio flujo");
  const text = proc.alertText({ kind: "REP", clientName: "Cliente Demo", folio: "F-1", installment: 2 });
  ok(/72 horas/.test(text) && /aceptación/.test(text) && /parcialidad 2/.test(text) && !/[a-f0-9]{20,}/.test(text), "el aviso explica qué pasó, sin ids internos");

  // Callables ---------------------------------------------------------------------------------------------------------------------------
  const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data });
  const s7 = await solicitud("s7");
  await rep(s7, 1); await rep(s7, 2);
  const impact = await call(callables.getRepCancellationImpact, rootId, { solicitudId: s7 });
  eq(impact.reps, [{ installment: 1, amountMinor: 10000, cancelled: false }, { installment: 2, amountMinor: 20000, cancelled: false }], "el aviso lista los complementos que se cancelarían");
  eq((await call(callables.getRepCancellationImpact, rootId, { solicitudId: none })).reps, [], "sin complementos, sin aviso");
  eq(await code(() => call(callables.getRepCancellationImpact, `${run}-op`, { solicitudId: s7 })), "permission-denied", "el operador no consulta");
  eq(await code(() => call(callables.getRepCancellationImpact, `${run}-other`, { solicitudId: s7 })), "permission-denied", "otro root no consulta");
  eq(await code(() => callables.getRepCancellationImpact.run({ data: { solicitudId: s7 } })), "unauthenticated", "sin sesión no consulta");
  eq((await call(callables.confirmRepCancellation, rootId, { solicitudId: none })).reps, 0, "confirmar sin complementos no marca nada");
  eq((await call(callables.confirmRepCancellation, rootId, { solicitudId: s7 })).reps, 2, "la confirmación manual cuenta los complementos");
  const confirmed = (await db.doc(`solicitudes/${s7}`).get()).data();
  eq([!!confirmed.repCancellationConfirmedAt, confirmed.repCancellationConfirmedBy], [true, rootId], "queda quién y cuándo confirmó");
  eq(await code(() => call(callables.confirmRepCancellation, `${run}-other`, { solicitudId: s7 })), "permission-denied", "otro root no confirma");

  // The daily lookup limit is editable by hand --------------------------------------------------------------------------------------------
  const config = require("../../functions/lib/modules/paymentApplications/complementAutomation.js");
  eq((await call(config.configurePaymentComplementAutomation, rootId, { provider: "IQ_LOOKUP_LIMIT", dailyLimit: 40 })).ok, true, "el dueño puede cambiar el límite diario de consultas a IQ");
  eq((await db.doc(`paymentComplementConfigs/${rootId}`).get()).get("iqLookupDailyLimit"), 40, "queda guardado en la configuración");
  for (const bad of [0, 101, 2.5, "x"]) eq(await code(() => call(config.configurePaymentComplementAutomation, rootId, { provider: "IQ_LOOKUP_LIMIT", dailyLimit: bad })), "invalid-argument", "un límite fuera de 1 a 100 se rechaza");
  eq(await code(() => call(config.configurePaymentComplementAutomation, `${run}-op`, { provider: "IQ_LOOKUP_LIMIT", dailyLimit: 30 })), "permission-denied", "un operador no lo cambia");
  eq((await db.doc(`paymentComplementConfigs/${rootId}`).get()).get("iqLookupDailyLimit"), 40, "y el valor no cambió");

  // Wiring ---------------------------------------------------------------------------------------------------------------------------------
  const squash = text => text.split(/\s+/).join(" ");
  const src = squash(fs.readFileSync("functions/src/modules/facturama/sandboxCallables.ts", "utf8").split("\r\n").join("\n"));
  ok(src.includes("if (!input.confirmRep && !sol.repCancellationConfirmedAt) throw new HttpsError(\"failed-precondition\""), "cancelar la factura exige la confirmación manual cuando hay complementos");
  ok(src.includes("cancellationProcess: { active: true, motive, uuidReplacement: replacement || null"), "la ruta directa deja el proceso abierto para que siga solo");
  ok(src.indexOf("advanceCancellation(cancellationPorts({ uid, actorRole: input.actorRole") > 0 && src.indexOf("advanceCancellation(cancellationPorts({ uid, actorRole: input.actorRole") < src.indexOf("let previousMotive: unknown = null;"), "los complementos se tratan antes de bloquear y cancelar la factura");
  ok(src.indexOf("if (repsToCancel(await listFacturamaReps(db, rootId, originalRef.id)).length)") > 0 && src.indexOf("if (repsToCancel(await listFacturamaReps(db, rootId, originalRef.id)).length)") < src.indexOf("const cancelResult = await requestFacturama(PRODUCTION_BASE_URL, `/api-lite/cfdis/${encodeURIComponent(originalInvoice.facturamaCfdiId)}?${new URLSearchParams({ motive: \"01\""), "la sustitución también cancela los complementos antes que la original");
  ok(src.includes("if (!original.repCancellationConfirmedAt) repWait = REP_CANCELLATION_CONFIRM_REQUIRED;"), "la sustitución no avanza sin la confirmación guardada");
  ok(src.includes("export const advanceFacturamaCancellations = onSchedule(") && src.includes("where(\"cancellationProcess.active\", \"==\", true)"), "un programa revisa los procesos abiertos");
  ok(src.includes("variant: { key: `REP:${rep.requestId}`") && src.includes("variant: { key: \"FACTURA_ORIGINAL\", label: \"FACTURA\" }"), "los acuses de los complementos y de la factura conviven sin reemplazarse");
  ok(fs.readFileSync("functions/src/modules/facturama/cancellationGuard.ts", "utf8").includes("72 * 60 * 60 * 1000"), "la ventana de espera es de 72 horas");
  console.log(`PASS cancelar complementos antes que la factura: ${checks} verificaciones`);
})().catch(error => { console.error(error); process.exit(1); });
