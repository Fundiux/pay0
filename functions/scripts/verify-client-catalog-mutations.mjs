import assert from "node:assert/strict";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "pay0-local-fixtures";
const rootId = "client-catalog-fixtures";
const email = "client.catalog@pay0.local";
const password = "PruebaSegura-2026";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Este smoke solo puede ejecutarse contra Firestore y Auth Emulator.");
}

if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

async function signIn() {
  try { await auth.getUser(rootId); }
  catch { await auth.createUser({ uid: rootId, email, password, emailVerified: true }); }
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.idToken;
}

async function call(name, token, data) {
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/${name}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ data }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${name}: ${JSON.stringify(body)}`);
  return body.result;
}

await db.doc(`users/${rootId}`).set({ rootId, role: "superadmin", email, active: true, isActive: true }, { merge: true });
const token = await signIn();
const unique = String(Date.now());
const created = await call("saveClientCallable", token, {
  effectiveRootId: rootId, adminId: rootId, uid: rootId,
  name: `Cliente cache ${unique}`, rfc: "CACX7605101P8", whatsapp: "5555555555",
});
assert.equal(created.created, true);
assert.ok(created.id);

const initial = await call("listClientsCanonical", token, { requiredPermission: "view" });
assert.ok(initial.clients.some((client) => client.id === created.id && client.active === true));

const updatedName = `Cliente actualizado ${unique}`;
const updated = await call("saveClientCallable", token, {
  editingId: created.id, effectiveRootId: rootId, adminId: rootId, uid: rootId,
  name: updatedName, rfc: "CACX7605101P8", whatsapp: "5555555555",
});
assert.equal(updated.updated, true);

const afterEdit = await call("listClientsCanonical", token, { requiredPermission: "view" });
assert.ok(afterEdit.clients.some((client) => client.id === created.id && client.name === updatedName));

const toggled = await call("toggleClientActiveCallable", token, { id: created.id, nextActive: false });
assert.equal(toggled.active, false);
const afterToggle = await call("listClientsCanonical", token, { requiredPermission: "view" });
assert.equal(afterToggle.clients.some((client) => client.id === created.id), false);
assert.equal((await db.doc(`clients/${created.id}`).get()).data()?.active, false);

console.log("PASS catalogo de clientes: alta, edicion y activacion reflejan el estado canonico.");
