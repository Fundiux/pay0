import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const fixtureRootId = process.env.PAY0_FIXTURE_ROOT_ID || "pay0-perf-fixtures";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  throw new Error("Este script sólo funciona con FIRESTORE_EMULATOR_HOST configurado; se negó ejecutar contra producción.");
}

if (!getApps().length) initializeApp({ projectId: "pay0-local-fixtures" });
const db = getFirestore();
const now = Timestamp.now();

async function commitRows(rows) {
  for (let offset = 0; offset < rows.length; offset += 450) {
    const batch = db.batch();
    rows.slice(offset, offset + 450).forEach(({ ref, value }) => batch.set(ref, value));
    await batch.commit();
  }
}

async function seed() {
  const rows = [];
  rows.push({ ref: db.doc(`users/${fixtureRootId}`), value: { rootId: fixtureRootId, role: "superadmin", email: "fixtures@pay0.local", active: true, createdAt: now } });

  for (let index = 1; index <= 101; index += 1) {
    rows.push({ ref: db.doc(`users/${fixtureRootId}-user-${index}`), value: { rootId: fixtureRootId, role: index % 2 ? "operador" : "admin", email: `fixture-${index}@pay0.local`, displayName: `Usuario fixture ${index}`, active: true, createdAt: now } });
  }
  for (let index = 1; index <= 501; index += 1) {
    rows.push({ ref: db.doc(`clientDispersions/${fixtureRootId}-dispersion-${index}`), value: { rootId: fixtureRootId, clientId: "fixture-client", clienteId: "fixture-client", folio: `FIX-D-${index}`, amount: index, status: "REGISTRADA", createdAt: Timestamp.fromMillis(now.toMillis() - index * 1000) } });
  }
  rows.push({ ref: db.doc(`balanceAccounts/CLIENT_fixture-client`), value: { rootId: fixtureRootId, holderType: "CLIENT", holderId: "fixture-client", availableBalance: 1000000, createdAt: now, updatedAt: now } });
  for (let index = 1; index <= 1001; index += 1) {
    rows.push({ ref: db.doc(`balanceMovements/${fixtureRootId}-movement-${index}`), value: { rootId: fixtureRootId, holderType: "CLIENT", holderId: "fixture-client", clienteId: "fixture-client", direction: "IN", amount: 1, createdAt: Timestamp.fromMillis(now.toMillis() - index * 1000) } });
  }
  await commitRows(rows);
  console.log(`Fixtures creados para ${fixtureRootId}: 101 usuarios, 501 dispersiones y 1001 movimientos.`);
}

async function cleanup() {
  for (const collection of ["users", "clientDispersions", "balanceMovements", "balanceAccounts"]) {
    const field = collection === "balanceAccounts" ? "rootId" : "rootId";
    const snap = await db.collection(collection).where(field, "==", fixtureRootId).get();
    for (let offset = 0; offset < snap.docs.length; offset += 450) {
      const batch = db.batch();
      snap.docs.slice(offset, offset + 450).forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }
  console.log(`Fixtures eliminados para ${fixtureRootId}.`);
}

if (process.argv.includes("--cleanup")) await cleanup(); else await seed();
