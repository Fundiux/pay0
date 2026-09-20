process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-pay0";

const admin = require("../../functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const control = require("../../functions/lib/modules/controlCenter/callables.js");
const automation = require("../../functions/lib/modules/controlCenter/automation.js");

const uid = "control-center-superadmin";
const rootId = "root-control-center-smoke";
const auth = { uid, token: { role: "superadmin" } };

async function run() {
  await db.collection("users").doc(uid).set({ role: "superadmin", rootId, active: true });
  await Promise.all([
    db.collection("solicitudes").doc("s1").set({ rootId, status: "PROCESANDO", monto: 1250, createdAt: new Date() }),
    db.collection("pagos").doc("p1").set({ rootId, status: "PENDIENTE", amount: 1250, reportDateAt: new Date() }),
    db.collection("facturamaInvoices").doc("f1").set({ rootId, status: "DRAFT", createdAt: new Date() }),
    db.collection("materialityOperations").doc("m1").set({ rootId, status: "INCOMPLETE", createdAt: new Date() }),
    db.collection("solicitudes").doc("foreign").set({ rootId: "another-root", status: "PROCESANDO", createdAt: new Date() }),
  ]);

  const refreshed = await control.refreshControlCenterOverview.run({ auth, data: {} });
  const loaded = await control.getControlCenterOverview.run({ auth, data: {} });
  const snapshot = loaded.snapshot;
  if (!refreshed.ok || !loaded.configured || !snapshot) throw new Error("No se genero la fotografia.");
  if (snapshot.summary.solicitudesActive !== 1) throw new Error("Fallo aislamiento por rootId.");
  if (snapshot.summary.pendingPagosAmount !== 1250) throw new Error("Monto pendiente incorrecto.");
  if (!snapshot.alerts.some((row) => row.id === "facturas-pendientes")) throw new Error("Alerta fiscal faltante.");

  await automation.markControlCenterDirty({
    before: { exists: false, data: () => ({}) },
    after: { exists: true, data: () => ({ rootId }) },
  }, "pagos", "p2");
  const dirtyBefore = await db.collection("controlCenterDirtyRoots").doc(rootId).get();
  if (!dirtyBefore.exists || !dirtyBefore.data().modules.includes("pagos")) throw new Error("No se encolo el cambio operativo.");

  await automation.reconcileDirtyControlCenterRoots();
  const dirtyAfter = await db.collection("controlCenterDirtyRoots").doc(rootId).get();
  if (dirtyAfter.exists) throw new Error("La reconciliacion no limpio la cola.");

  console.log(JSON.stringify({ ok: true, automation: "dirty-and-reconciled", summary: snapshot.summary, alerts: snapshot.alerts.length, pipeline: snapshot.pipeline }, null, 2));
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
