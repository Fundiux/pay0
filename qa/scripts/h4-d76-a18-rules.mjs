import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const root = process.cwd();
const projectId = process.env.GCLOUD_PROJECT || "pay0-h4-d76-a18";
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync(path.join(root, "firestore.rules"), "utf8") },
});

let passed = 0;
async function test(name, action) {
  await action();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function readAs(uid, collection, id) {
  return getDoc(doc(env.authenticatedContext(uid).firestore(), collection, id));
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const users = {
      legacyAdmin: { role: "admin", rootId: "rootA", isActive: true },
      blockedAdmin: {
        role: "admin", rootId: "rootA", isActive: true,
        modules: { clientes: { view: false }, solicitudes: { view: false }, pagos: { view: false }, actividad: { view: false } },
      },
      actionBlockedAdmin: {
        role: "admin", rootId: "rootA", isActive: true,
        modules: { clientes: { costs: false }, wallet: { dispersiones: false } },
      },
      elevatedOperator: {
        role: "operador", rootId: "rootA", isActive: true,
        modules: { wallet: { view: true, dispersiones: true }, pagos: { conciliate: true } },
      },
      inactiveAdmin: { role: "admin", rootId: "rootA", isActive: false },
      deletedAdmin: { role: "admin", rootId: "rootA", isActive: true, isDeleted: true },
      rootA: {
        role: "superadmin", rootId: "rootA", isActive: true,
        modules: { clientes: { view: false }, wallet: { view: false } },
      },
    };
    for (const [uid, data] of Object.entries(users)) await setDoc(doc(db, "users", uid), data);

    await setDoc(doc(db, "clients", "clientA"), { adminId: "legacyAdmin", rootId: "rootA" });
    await setDoc(doc(db, "clients", "clientA", "costos", "costA"), { adminId: "actionBlockedAdmin", rootId: "rootA" });
    await setDoc(doc(db, "solicitudes", "solA"), { adminId: "blockedAdmin", createdBy: "blockedAdmin", clientId: "clientA" });
    await setDoc(doc(db, "pagos", "pagoA"), { adminId: "blockedAdmin", createdBy: "blockedAdmin", clientId: "clientA" });
    await setDoc(doc(db, "activityLog", "eventA"), { adminId: "blockedAdmin", actorUid: "blockedAdmin" });
    await setDoc(doc(db, "clientDispersions", "dispA"), { adminId: "actionBlockedAdmin", createdBy: "actionBlockedAdmin", clientId: "clientA" });
    await setDoc(doc(db, "pagoAplicaciones", "appA"), { adminId: "elevatedOperator", createdBy: "elevatedOperator" });
  });

  await test("rechaza lectura sin autenticacion", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "clients", "clientA")));
  });
  await test("usuario legacy hereda lectura permitida por su rol", async () => {
    await assertSucceeds(readAs("legacyAdmin", "clients", "clientA"));
  });
  await test("bloqueo individual impide leer Cliente", async () => {
    await assertFails(readAs("blockedAdmin", "clients", "clientA"));
  });
  await test("bloqueo individual impide lecturas directas de Solicitudes Pagos y Actividad", async () => {
    await assertFails(readAs("blockedAdmin", "solicitudes", "solA"));
    await assertFails(readAs("blockedAdmin", "pagos", "pagoA"));
    await assertFails(readAs("blockedAdmin", "activityLog", "eventA"));
  });
  await test("bloqueo de accion impide leer costos", async () => {
    await assertFails(getDoc(doc(env.authenticatedContext("actionBlockedAdmin").firestore(), "clients", "clientA", "costos", "costA")));
  });
  await test("bloqueo de accion impide leer Dispersiones", async () => {
    await assertFails(readAs("actionBlockedAdmin", "clientDispersions", "dispA"));
  });
  await test("operador no eleva Wallet ni conciliacion sobre el techo del rol", async () => {
    await assertFails(readAs("elevatedOperator", "clientDispersions", "dispA"));
    await assertFails(readAs("elevatedOperator", "pagoAplicaciones", "appA"));
  });
  await test("usuario inactivo o eliminado no puede leer ni su perfil", async () => {
    await assertFails(readAs("inactiveAdmin", "users", "inactiveAdmin"));
    await assertFails(readAs("deletedAdmin", "users", "deletedAdmin"));
  });
  await test("perfil propio activo sigue disponible para autenticacion y redireccion", async () => {
    const snapshot = await assertSucceeds(readAs("blockedAdmin", "users", "blockedAdmin"));
    assert.equal(snapshot.exists(), true);
  });
  await test("superadmin activo conserva bypass explicito", async () => {
    await assertSucceeds(readAs("rootA", "clients", "clientA"));
    await assertSucceeds(readAs("rootA", "clientDispersions", "dispA"));
  });

  console.log(`H4-D76-A18 reglas Firestore: ${passed}/10 pruebas OK.`);
} finally {
  await env.cleanup();
}
