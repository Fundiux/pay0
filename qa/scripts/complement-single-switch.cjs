const assert = require("node:assert/strict");
const fs = require("node:fs");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || process.env.GCLOUD_PROJECT !== "demo-pay0") throw new Error("LOCAL_EMULATOR_REQUIRED");
global.fetch = async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0" });
const db = admin.firestore(), stamp = admin.firestore.Timestamp;
const { configurePaymentComplementAutomation: configure } = require("../../functions/lib/modules/paymentApplications/complementAutomation");
const { inspectIqComplementGate, IQ_REQUEST_DAILY_FUSE } = require("../../functions/lib/modules/paymentApplications/complementGates");

let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (v, label) => { assert.ok(v, label); checks++; };
const code = async (fn) => { try { await fn(); } catch (error) { return error.code; } return "no-error"; };

(async () => {
  const run = `sw${Date.now()}`, rootId = `${run}-root`, other = `${run}-other`;
  const call = (uid, data) => configure.run({ auth: { uid, token: {} }, data });
  await Promise.all([
    db.doc(`users/${rootId}`).set({ rootId, role: "superadmin", active: true }),
    db.doc(`users/${run}-op`).set({ rootId, role: "operador", active: true }),
    db.doc(`users/${other}`).set({ rootId: other, role: "superadmin", active: true }),
  ]);
  const job = (id, extra) => db.doc(`paymentComplementJobs/${id}`).set({ rootId, provider: "IQ", status: "PAUSED", createdAt: stamp.fromMillis(1000 + Number(String(id).replace(/\D/g, "").slice(-3) || 0)), ...extra });
  const request = (id, jobId) => db.doc(`paymentComplementRequests/${id}`).set({ rootId, automationJobId: jobId, automationStatus: "PAUSED", automationError: null });

  // Validation and authority ------------------------------------------------------------------------------------
  eq(await code(() => call(`${run}-op`, { provider: "IQ_REQUEST", enabled: true, confirmation: "AUTORIZO_SOLICITUD_REP_IQ" })), "permission-denied", "un operador no activa");
  eq(await code(() => call(rootId, { provider: "IQ_REQUEST", enabled: true })), "failed-precondition", "activar exige la confirmación");
  eq(await code(() => call(rootId, { provider: "IQ_REQUEST", enabled: "si", confirmation: "AUTORIZO_SOLICITUD_REP_IQ" })), "invalid-argument", "el estado debe ser booleano");
  eq((await db.doc(`paymentComplementConfigs/${rootId}`).get()).exists, false, "nada se guardó con una petición inválida");

  // Jobs: only those paused by a switch or quota go back to the queue ------------------------------------------------
  await job("j-hard", { gateReason: "REP_REQUEST_HARD_DISABLED" }); await request("r-hard", "j-hard");
  await job("j-off", { gateReason: "REP_GATE_REQUEST_OFF" });
  await job("j-flow", { gateReason: "REP_GATE_APPLICATION_FLOW_OFF" });
  await job("j-quota", { gateReason: "REP_GATE_QUOTA_EXHAUSTED" });
  await job("j-wait", { gateReason: "IQ_REP_NOT_REQUESTABLE_YET" });
  await job("j-blocked", { status: "BLOCKED", gateReason: "REP_GATE_REQUEST_OFF" });
  await job("j-unknown", { status: "UNKNOWN", gateReason: "REP_GATE_REQUEST_OFF" });
  await job("j-facturama", { provider: "FACTURAMA", gateReason: "REP_GATE_REQUEST_OFF" });
  await db.doc("paymentComplementJobs/j-foreign").set({ rootId: other, provider: "IQ", status: "PAUSED", gateReason: "REP_GATE_REQUEST_OFF", createdAt: stamp.now() });

  const first = await call(rootId, { provider: "IQ_REQUEST", enabled: true, confirmation: "AUTORIZO_SOLICITUD_REP_IQ" });
  eq([first.ok, first.requeued], [true, 4], "activar en un paso re-encola los cuatro motivos de compuerta");
  const config = (await db.doc(`paymentComplementConfigs/${rootId}`).get()).data();
  eq([config.iqEnabled, config.iqRequestEnabled, config.iqRequestDailyLimit, config.rootId], [true, true, IQ_REQUEST_DAILY_FUSE, rootId], "un solo paso enciende los dos interruptores y deja el fusible del servidor");
  eq(IQ_REQUEST_DAILY_FUSE, 25, "el fusible es 25");
  ok(config.activatedAt, "la primera activación crea la configuración");
  const status = async id => (await db.doc(`paymentComplementJobs/${id}`).get()).data();
  for (const id of ["j-hard", "j-off", "j-flow", "j-quota"]) eq([(await status(id)).status, (await status(id)).gateReason], ["QUEUED", null], `${id} vuelve a la cola`);
  eq((await status("j-wait")).status, "PAUSED", "una pausa que no es de compuerta no se toca");
  eq((await status("j-blocked")).status, "BLOCKED", "BLOCKED no se toca");
  eq((await status("j-unknown")).status, "UNKNOWN", "UNKNOWN no se toca");
  eq((await status("j-facturama")).status, "PAUSED", "otro proveedor no se toca");
  eq((await status("j-foreign")).status, "PAUSED", "otro root no se toca");
  eq((await db.doc("paymentComplementRequests/r-hard").get()).get("automationStatus"), "QUEUED", "el seguimiento refleja la cola");
  eq((await call(rootId, { provider: "IQ_REQUEST", enabled: true, confirmation: "AUTORIZO_SOLICITUD_REP_IQ" })).requeued, 0, "repetir la activación no re-encola de nuevo");

  // Pausing turns both off, requeues nothing, and never touches Facturama -----------------------------------------------
  await job("j-late", { gateReason: "REP_GATE_REQUEST_OFF" });
  await db.doc(`paymentComplementConfigs/${rootId}`).update({ facturamaEnabled: true });
  const paused = await call(rootId, { provider: "IQ_REQUEST", enabled: false });
  eq(paused.requeued, 0, "pausar no re-encola");
  const after = (await db.doc(`paymentComplementConfigs/${rootId}`).get()).data();
  eq([after.iqEnabled, after.iqRequestEnabled, after.facturamaEnabled], [false, false, true], "pausar apaga los dos interruptores y conserva Facturama");
  eq((await status("j-late")).status, "PAUSED", "el job pausado sigue pausado");

  // Cap: one activation stays under the safety circuit ---------------------------------------------------------------------
  for (let i = 0; i < 20; i++) await job(`cap-${String(i).padStart(3, "0")}`, { gateReason: "REP_GATE_REQUEST_OFF" });
  const capped = await call(rootId, { provider: "IQ_REQUEST", enabled: true, confirmation: "AUTORIZO_SOLICITUD_REP_IQ" });
  eq(capped.requeued, 15, "una activación re-encola como máximo 15");
  const queued = (await db.collection("paymentComplementJobs").where("rootId", "==", rootId).where("status", "==", "QUEUED").get()).size;
  eq(queued, 4 + 15, "los demás esperan la corrida diaria");

  // The fuse is the default limit when no number is stored ------------------------------------------------------------------
  const profileId = `${run}-profile`;
  await Promise.all([
    db.doc(`iqIntegrationConfigs/${rootId}`).set({ rootId, enabled: true, automation: { aplicacionPagos: true } }),
    db.doc(`iqUserAccess/${rootId}`).set({ rootId, active: true, iqEnabled: true, iqCredentialProfileId: profileId, allowedModules: { pagos: true } }),
    db.doc(`iqCredentialProfiles/${profileId}`).set({ rootId, active: true, hasPassword: true, username: "smoke" }),
    db.doc(`clients/${rootId}`).set({ rootId, adminId: rootId, active: true }),
  ]);
  await db.doc(`paymentComplementConfigs/${rootId}`).update({ iqRequestDailyLimit: admin.firestore.FieldValue.delete() });
  const gate = await inspectIqComplementGate({ rootId, provider: "IQ", profileId, originIqProfileId: profileId, actorUid: rootId, clientId: rootId }, "REQUEST");
  eq([gate.allowed, gate.limit], [true, 25], "sin número guardado, el límite es el fusible de 25");

  // Wiring -------------------------------------------------------------------------------------------------------------------
  const squash = text => text.split(/\s+/).join(" ");
  const ui = squash(fs.readFileSync("src/components/control-center/PaymentComplementFollowup.tsx", "utf8"));
  ok(!ui.includes("¿Cuántas por día?") && !ui.includes("window.prompt"), "la pantalla ya no pregunta cuántas por día");
  ok(ui.includes("Activar solicitudes de complementos") && ui.includes("aviso tras 5 días") && !ui.includes("tras 7 días"), "texto de activación único y aviso a los 5 días");
  ok(ui.includes("REP_GATE_QUOTA_EXHAUSTED: \"se alcanzó el límite de seguridad diario"), "el fusible solo aparece como motivo cuando se dispara");
  console.log(`PASS un solo interruptor de solicitudes de complementos: ${checks} verificaciones`);
})().catch(error => { console.error(error); process.exit(1); });
