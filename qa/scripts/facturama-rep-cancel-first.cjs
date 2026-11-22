const assert = require("node:assert/strict");
const fs = require("node:fs");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw new Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
global.fetch = async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const admin = require("../../functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore(), stamp = admin.firestore.Timestamp;
const core = require("../../functions/lib/modules/facturama/repCancellation.js");
const callables = require("../../functions/lib/modules/facturama/repCancellationCallables.js");

let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (v, label) => { assert.ok(v, label); checks++; };
const code = async fn => { try { await fn(); } catch (error) { return error.code || error.message; } return "no-error"; };

(async () => {
  const run = `rep${Date.now()}`, rootId = `${run}-root`;
  await db.doc(`users/${rootId}`).set({ role: "superadmin", rootId, active: true });
  await db.doc(`users/${run}-op`).set({ role: "operador", rootId, active: true });
  await db.doc(`users/${run}-other`).set({ role: "superadmin", rootId: `${rootId}-x`, active: true });
  const solicitud = async (name, extra = {}) => { await db.doc(`solicitudes/${run}-${name}`).set({ rootId, folio: `F-${name}`, ...extra }); return `${run}-${name}`; };
  const rep = async (solId, n, job = {}, request = {}) => {
    const jobId = `${run}-${solId.slice(-4)}-job${n}`;
    await db.doc(`paymentComplementJobs/${jobId}`).set({ rootId, provider: "FACTURAMA", status: "RECEIVED", cfdiId: `cfdi-${jobId}`, ...job });
    await db.doc(`paymentComplementRequests/${jobId}-req`).set({ rootId, solicitudId: solId, provider: "FACTURAMA", automationJobId: jobId, applicationFolio: `A-${n}`, installment: n, amountMinor: 10000 * n, ...request });
    return jobId;
  };
  const calls = [];
  const cancelCfdi = (answers = {}) => async (cfdiId, motive) => { calls.push([cfdiId, motive]); const a = answers[cfdiId]; if (a instanceof Error) throw a; return { Status: a ?? "canceled" }; };
  const input = (solId, extra = {}) => ({ db, rootId, solicitudId: solId, solicitudFolio: "F", actorUid: rootId, actorRole: "superadmin", cancelCfdi: cancelCfdi(), ...extra });

  // Which complements count -------------------------------------------------------------------------------------------
  const s1 = await solicitud("s1");
  const j2 = await rep(s1, 2), j1 = await rep(s1, 1);
  await rep(s1, 3, { status: "PAUSED", cfdiId: "" });
  await db.doc(`paymentComplementRequests/${run}-iq`).set({ rootId, solicitudId: s1, provider: "IQ", automationJobId: "none", installment: 9 });
  await db.doc(`paymentComplementJobs/${run}-foreign`).set({ rootId: `${rootId}-x`, provider: "FACTURAMA", status: "RECEIVED", cfdiId: "cfdi-foreign" });
  await db.doc(`paymentComplementRequests/${run}-foreign-req`).set({ rootId, solicitudId: s1, provider: "FACTURAMA", automationJobId: `${run}-foreign`, installment: 8 });
  const listed = await core.listFacturamaReps(db, rootId, s1);
  eq(listed.map(r => r.installment), [1, 2], "solo los complementos de Facturama ya emitidos, del mismo root, en orden de parcialidad");
  eq(core.publicRep(listed[0]), { installment: 1, amountMinor: 10000, cancelled: false }, "la pantalla recibe parcialidad e importe, sin ids");

  // Complements first, in order -----------------------------------------------------------------------------------------
  const done = await core.cancelRepsBeforeInvoice(input(s1));
  eq(done.allConfirmed, true, "todos confirmados: se puede cancelar la factura");
  eq(calls.map(call => call[0]), [`cfdi-${j1}`, `cfdi-${j2}`], "se cancelan uno por uno, por parcialidad");
  eq([...new Set(calls.map(call => call[1]))], ["02"], "con motivo SAT 02");
  eq((await db.doc(`paymentComplementJobs/${j1}`).get()).get("repCancellationStatus"), "CANCELED", "queda el estado en el complemento");
  eq((await db.collection("pay0ActivityLog").where("referenceId", "==", s1).get()).size, 2, "una auditoría por complemento");

  // Retry-safe -----------------------------------------------------------------------------------------------------------
  calls.length = 0;
  const again = await core.cancelRepsBeforeInvoice(input(s1));
  eq([again.allConfirmed, calls.length], [true, 0], "repetir no vuelve a enviar nada a Facturama");
  eq(core.repsToCancel(await core.listFacturamaReps(db, rootId, s1)).length, 0, "ya no quedan complementos por cancelar");

  // A failure stops before the invoice ----------------------------------------------------------------------------------
  const s2 = await solicitud("s2");
  const k1 = await rep(s2, 1), k2 = await rep(s2, 2);
  calls.length = 0;
  const rejected = await core.cancelRepsBeforeInvoice(input(s2, { cancelCfdi: cancelCfdi({ [`cfdi-${k1}`]: Object.assign(new Error("rechazado"), { providerStatus: 400 }) }) }));
  eq([rejected.allConfirmed, rejected.results[0].status, calls.length], [false, "REQUEST_FAILED", 1], "un 4xx detiene la secuencia y no toca los siguientes");
  eq((await db.doc(`paymentComplementJobs/${k2}`).get()).get("repCancellationStatus") ?? null, null, "el segundo complemento no se tocó");
  calls.length = 0;
  const retried = await core.cancelRepsBeforeInvoice(input(s2));
  eq([retried.allConfirmed, calls.length], [true, 2], "tras un 4xx se puede reintentar completo");

  const s3 = await solicitud("s3");
  const u1 = await rep(s3, 1);
  const uncertain = await core.cancelRepsBeforeInvoice(input(s3, { cancelCfdi: cancelCfdi({ [`cfdi-${u1}`]: Object.assign(new Error("timeout"), { providerStatus: 504 }) }) }));
  eq([uncertain.allConfirmed, uncertain.results[0].status], [false, "REQUEST_UNCERTAIN"], "un timeout queda incierto y detiene la secuencia");
  calls.length = 0;
  const blocked = await core.cancelRepsBeforeInvoice(input(s3));
  eq([blocked.allConfirmed, calls.length], [false, 0], "con una solicitud incierta abierta no se reenvía a ciegas");
  const open = await core.cancelRepsBeforeInvoice(input(s3, { now: () => Date.now() + 8 * 24 * 3600_000 }));
  eq(open.allConfirmed, true, "pasada la ventana de una semana se puede reintentar");

  const s4 = await solicitud("s4");
  const v1 = await rep(s4, 1);
  const pending = await core.cancelRepsBeforeInvoice(input(s4, { cancelCfdi: cancelCfdi({ [`cfdi-${v1}`]: "Vigente" }) }));
  eq([pending.allConfirmed, pending.results[0].status], [false, "VIGENTE"], "si el SAT aún no confirma, la factura espera");

  const none = await solicitud("none");
  eq((await core.cancelRepsBeforeInvoice(input(none))).allConfirmed, true, "sin complementos no hay nada que esperar");

  // Callables --------------------------------------------------------------------------------------------------------------
  const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data });
  const s5 = await solicitud("s5");
  await rep(s5, 1); await rep(s5, 2);
  const impact = await call(callables.getRepCancellationImpact, rootId, { solicitudId: s5 });
  eq(impact.reps, [{ installment: 1, amountMinor: 10000, cancelled: false }, { installment: 2, amountMinor: 20000, cancelled: false }], "el aviso lista los complementos que se cancelarían");
  eq((await call(callables.getRepCancellationImpact, rootId, { solicitudId: none })).reps, [], "sin complementos, sin aviso");
  eq(await code(() => call(callables.getRepCancellationImpact, `${run}-op`, { solicitudId: s5 })), "permission-denied", "el operador no consulta");
  eq(await code(() => call(callables.getRepCancellationImpact, `${run}-other`, { solicitudId: s5 })), "permission-denied", "otro root no consulta");
  eq(await code(() => callables.getRepCancellationImpact.run({ data: { solicitudId: s5 } })), "unauthenticated", "sin sesión no consulta");
  eq((await call(callables.confirmRepCancellation, rootId, { solicitudId: none })).reps, 0, "confirmar sin complementos no marca nada");
  eq((await db.doc(`solicitudes/${none}`).get()).get("repCancellationConfirmedAt") ?? null, null, "y no deja confirmación");
  eq((await call(callables.confirmRepCancellation, rootId, { solicitudId: s5 })).reps, 2, "la confirmación manual cuenta los complementos");
  const confirmed = (await db.doc(`solicitudes/${s5}`).get()).data();
  eq([!!confirmed.repCancellationConfirmedAt, confirmed.repCancellationConfirmedBy], [true, rootId], "queda quién y cuándo confirmó");
  eq(await code(() => call(callables.confirmRepCancellation, `${run}-other`, { solicitudId: s5 })), "permission-denied", "otro root no confirma");

  // Wiring -------------------------------------------------------------------------------------------------------------------
  const squash = text => text.split(/\s+/).join(" ");
  const src = squash(fs.readFileSync("functions/src/modules/facturama/sandboxCallables.ts", "utf8").split("\r\n").join("\n"));
  ok(src.includes("if (repsToCancel(await listFacturamaReps(db, rootId, solicitudId)).length) { if (request.data?.confirmRepCancellation !== true && !sol.repCancellationConfirmedAt) throw new HttpsError(\"failed-precondition\""), "cancelar la factura exige la confirmación manual cuando hay complementos");
  ok(src.indexOf("cancelRepsBeforeInvoice({ db, rootId, solicitudId,") > 0 && src.indexOf("cancelRepsBeforeInvoice({ db, rootId, solicitudId,") < src.indexOf("let previousMotive: unknown = null;"), "los complementos se cancelan antes de bloquear y cancelar la factura");
  ok(src.indexOf("if (repsToCancel(await listFacturamaReps(db, rootId, originalRef.id)).length)") > 0 && src.indexOf("if (repsToCancel(await listFacturamaReps(db, rootId, originalRef.id)).length)") < src.indexOf("const cancelResult = await requestFacturama(PRODUCTION_BASE_URL, `/api-lite/cfdis/${encodeURIComponent(originalInvoice.facturamaCfdiId)}?${new URLSearchParams({ motive: \"01\""), "la sustitución también cancela los complementos antes que la original");
  ok(src.includes("if (!original.repCancellationConfirmedAt) repWait = REP_CANCELLATION_CONFIRM_REQUIRED;"), "la sustitución no avanza sin la confirmación guardada");
  console.log(`PASS cancelar complementos antes que la factura: ${checks} verificaciones`);
})().catch(error => { console.error(error); process.exit(1); });
