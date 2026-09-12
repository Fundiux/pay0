import assert from "node:assert/strict";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "pay0-local-fixtures";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!firestoreHost || !authHost) {
  throw new Error("Esta verificacion solo corre con los emuladores de Firestore y Auth configurados.");
}

if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

const rootId = "role-access-fixtures";
const password = "PruebaSegura-2026";
const users = [
  ["role-access-admin", "admin.roles@pay0.local", "admin"],
  ["role-access-operator", "operador.roles@pay0.local", "operador"],
  ["role-access-delegated-view", "vista.roles@pay0.local", "operador"],
  ["role-access-delegated-operate", "opera.roles@pay0.local", "operador"],
];

async function ensureAuthUser(uid, email) {
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true });
  }
}

async function tokenFor(email) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload.idToken;
}

async function callSolicitud(email) {
  const token = await tokenFor(email);
  const response = await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/createSolicitud`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          clienteId: "role-access-client",
          companyId: "role-access-company",
          operationTypeKey: "FACTORING",
          monto: 1000,
          tipoFactura: "INGRESO",
        },
      }),
    }
  );
  return { status: response.status, body: await response.json() };
}

function authorizationDenied(result) {
  return result.status === 403 && result.body?.error?.status === "PERMISSION_DENIED";
}

async function seed() {
  for (const [uid, email, role] of users) {
    await ensureAuthUser(uid, email);
    await db.doc(`users/${uid}`).set({
      rootId,
      role,
      email,
      active: true,
      isActive: true,
      ...(role === "operador"
        ? { parentUserId: "role-access-admin", parentRole: "admin" }
        : {}),
    });
    await db.doc(`userCompanyAccess/${uid}/companies/role-access-company`).set({ active: true });
  }

  await db.doc("clients/role-access-client").set({
    rootId,
    active: true,
    adminId: "role-access-admin",
    managedByUserId: "role-access-operator",
    nombre: "Cliente de prueba de roles",
  });
  await db.doc("companies/role-access-company").set({
    rootId,
    active: true,
    despachoId: "role-access-despacho",
    nombre: "Empresa de prueba de roles",
  });
  await db.doc("despachos/role-access-despacho").set({ rootId, active: true, nombre: "Despacho de prueba" });
  await db.doc("operationTypes/FACTORING").set({ active: true, name: "Factoring" });

  await db.doc("userClientAccess/role-access-delegated-view/clients/role-access-client").set({
    active: true,
    permissions: { view: true, operate: false, operateSolicitudes: false, operatePagos: false },
  });
  await db.doc("userClientAccess/role-access-delegated-operate/clients/role-access-client").set({
    active: true,
    permissions: { view: true, operate: true, operateSolicitudes: true, operatePagos: true },
  });
}

await seed();

const deniedViewOnly = await callSolicitud("vista.roles@pay0.local");
assert.equal(authorizationDenied(deniedViewOnly), true, JSON.stringify(deniedViewOnly));

const directOperator = await callSolicitud("operador.roles@pay0.local");
assert.equal(authorizationDenied(directOperator), false, JSON.stringify(directOperator));

const delegatedOperator = await callSolicitud("opera.roles@pay0.local");
assert.equal(authorizationDenied(delegatedOperator), false, JSON.stringify(delegatedOperator));

console.log("PASS acceso a solicitudes: operador directo y delegado autorizado continúan; delegación de solo vista queda bloqueada.");
