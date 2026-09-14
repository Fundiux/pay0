import assert from "node:assert/strict";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const projectId = "pay0-local-fixtures";
const rootId = "pay0-perf-fixtures";
const email = "fixtures@pay0.local";
const password = "PruebaSegura-2026";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Este smoke sólo puede ejecutarse contra Firestore y Auth Emulator.");
}

if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

async function signIn() {
  try {
    await auth.getUser(rootId);
  } catch {
    await auth.createUser({ uid: rootId, email, password, emailVerified: true });
  }
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return data.idToken;
}

async function call(name, token, data) {
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${name}: ${JSON.stringify(body)}`);
  return body.result;
}

async function seedPagos() {
  const existing = await db.collection("pagos").where("rootId", "==", rootId).get();
  if (existing.size >= 101) return;
  const now = Date.now();
  for (let offset = 0; offset < 101; offset += 450) {
    const batch = db.batch();
    for (let index = offset + 1; index <= 101; index += 1) {
      batch.set(db.doc(`pagos/${rootId}-pago-${String(index).padStart(3, "0")}`), {
        rootId, createdBy: rootId, adminId: rootId, clienteId: "fixture-client",
        montoTotal: index, status: "REGISTRADO", createdAt: Timestamp.fromMillis(now - index * 1000),
      });
    }
    await batch.commit();
  }
}

async function seedDispersions() {
  const existing = await db.collection("clientDispersions").where("rootId", "==", rootId).get();
  if (existing.size >= 501) return;
  const now = Date.now();
  for (let offset = 0; offset < 501; offset += 450) {
    const batch = db.batch();
    for (let index = offset + 1; index <= Math.min(offset + 450, 501); index += 1) {
      batch.set(db.doc(`clientDispersions/${rootId}-dispersion-${String(index).padStart(3, "0")}`), {
        rootId, clienteId: "fixture-client", clientId: "fixture-client", createdBy: rootId,
        folio: `PERF-${index}`, monto: index, createdAt: Timestamp.fromMillis(now - index * 1000),
      });
    }
    await batch.commit();
  }
}

async function seedSolicitudes() {
  const existing = await db.collection("solicitudes").where("rootId", "==", rootId).get();
  if (existing.size >= 101) return;
  const now = Date.now();
  for (let offset = 0; offset < 101; offset += 450) {
    const batch = db.batch();
    for (let index = offset + 1; index <= 101; index += 1) {
      batch.set(db.doc(`solicitudes/${rootId}-solicitud-${String(index).padStart(3, "0")}`), {
        rootId, adminId: rootId, createdBy: rootId, clienteId: "fixture-client", active: true,
        folio: `SOL-PERF-${index}`, status: "PENDIENTE", monto: index, createdAt: Timestamp.fromMillis(now - index * 1000),
      });
    }
    await batch.commit();
  }
}

await db.doc(`users/${rootId}`).set({ rootId, role: "superadmin", email, active: true }, { merge: true });
await seedPagos();
await seedDispersions();
await seedSolicitudes();
const token = await signIn();

const usersFirst = await call("listUsers", token, { limit: 100 });
assert.equal(usersFirst.users.length, 100);
assert.equal(usersFirst.hasMore, true);
const usersSecond = await call("listUsers", token, { limit: 100, cursor: usersFirst.nextCursor });
assert.ok(usersSecond.users.length >= 2);
assert.equal(usersSecond.hasMore, false);

const now = Date.now();
const pagosFirst = await call("listPagos", token, { limit: 100, fromMillis: now - 24 * 60 * 60 * 1000, toMillis: now + 1000 });
assert.equal(pagosFirst.items.length, 100);
assert.equal(pagosFirst.hasMore, true);
const pagosSecond = await call("listPagos", token, {
  limit: 100, fromMillis: now - 24 * 60 * 60 * 1000, toMillis: now + 1000,
  cursorSeconds: pagosFirst.nextCursor.seconds, cursorNanoseconds: pagosFirst.nextCursor.nanoseconds, cursorId: pagosFirst.nextCursor.id,
});
assert.equal(pagosSecond.items.length, 1);
assert.equal(pagosSecond.hasMore, false);
assert.equal(new Set([...pagosFirst.items, ...pagosSecond.items].map((row) => row.id)).size, 101);

const dispersionsFirst = await call("listScopedClientDispersions", token, { limit: 500 });
assert.equal(dispersionsFirst.rows.length, 500);
assert.equal(dispersionsFirst.hasMore, true);
const dispersionsSecond = await call("listScopedClientDispersions", token, {
  limit: 500,
  cursorSeconds: dispersionsFirst.nextCursor.seconds,
  cursorNanoseconds: dispersionsFirst.nextCursor.nanoseconds,
  cursorId: dispersionsFirst.nextCursor.id,
});
assert.equal(dispersionsSecond.rows.length, 1);
assert.equal(dispersionsSecond.hasMore, false);
assert.equal(new Set([...dispersionsFirst.rows, ...dispersionsSecond.rows].map((row) => row.id)).size, 501);

const solicitudesFirst = await call("listSolicitudes", token, { limit: 100 });
assert.equal(solicitudesFirst.items.length, 100);
assert.equal(solicitudesFirst.hasMore, true);
const solicitudesSecond = await call("listSolicitudes", token, {
  limit: 100,
  cursorSeconds: solicitudesFirst.nextCursor.seconds,
  cursorNanoseconds: solicitudesFirst.nextCursor.nanoseconds,
  cursorId: solicitudesFirst.nextCursor.id,
});
assert.equal(solicitudesSecond.items.length, 1);
assert.equal(solicitudesSecond.hasMore, false);
assert.equal(new Set([...solicitudesFirst.items, ...solicitudesSecond.items].map((row) => row.id)).size, 101);

const wallet = await call("getClientWalletDetailOverview", token, { clienteId: "fixture-client" });
assert.equal(wallet.movements.length, 1001);

console.log("PASS rendimiento: Usuarios 102 en dos páginas, Pagos 101 en dos páginas y Wallet conserva 1,001 movimientos.");
