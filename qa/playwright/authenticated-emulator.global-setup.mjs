import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "demo-pay0-ui-qa";
const fixturePath = resolve("qa/.auth/emulator-fixtures.json");

function requireLocal(value, name) {
  if (!/^127\.0\.0\.1:\d+$/.test(value || "")) {
    throw new Error(`${name} must point to a local emulator.`);
  }
}

export default async function globalSetup() {
  const startedAt = Date.now();
  console.log("QA_AUTH_STAGE global-setup:start");
  if (process.env.GCLOUD_PROJECT !== projectId) {
    throw new Error(`Authenticated QA requires ${projectId}.`);
  }
  requireLocal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "FIREBASE_AUTH_EMULATOR_HOST");
  requireLocal(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST");

  const app = getApps()[0] || initializeApp({ projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const password = `Qa-${randomBytes(18).toString("base64url")}!`;
  const accounts = [
    { key: "superadmin", uid: "qa-superadmin", email: "superadmin@pay0-qa.local", role: "superadmin", rootId: "qa-superadmin" },
    { key: "admin", uid: "qa-admin", email: "admin@pay0-qa.local", role: "admin", rootId: "qa-superadmin" },
    { key: "limited", uid: "qa-limited", email: "limited@pay0-qa.local", role: "operador", rootId: "qa-superadmin", modules: { usuarios: { view: false } } },
  ];

  for (const account of accounts) {
    console.log(`QA_AUTH_STAGE seed-user:start role=${account.key}`);
    await auth.createUser({ uid: account.uid, email: account.email, password, displayName: `QA ${account.key}` });
    await db.doc(`users/${account.uid}`).set({
      rootId: account.rootId,
      role: account.role,
      active: true,
      isActive: true,
      displayName: `QA ${account.key}`,
      name: `QA ${account.key}`,
      email: account.email,
      ...(account.modules ? { modules: account.modules } : {}),
    });
    console.log(`QA_AUTH_STAGE seed-user:done role=${account.key}`);
  }

  const now = new Date();
  await db.doc("clients/qa-client-001").set({
    rootId: "qa-superadmin", adminId: "qa-admin", createdBy: "qa-superadmin", active: true,
    name: "Cliente sintético QA", razonSocial: "Cliente sintético QA", rfc: "XAXX010101000", createdAt: now,
  });
  await db.doc("clientBeneficiaries/qa-beneficiary-001").set({
    rootId: "qa-superadmin", clientId: "qa-client-001", adminId: "qa-admin", createdBy: "qa-superadmin",
    nombre: "Beneficiario sintético QA", active: true, createdAt: now,
  });
  await db.doc("clientBeneficiaryMethods/qa-method-001").set({
    rootId: "qa-superadmin", clientId: "qa-client-001", beneficiaryId: "qa-beneficiary-001", adminId: "qa-admin",
    tipo: "DEBITO", destinationKind: "CLABE", bankCode: "002", bankName: "Banco QA", clabe: "002010077777777777",
    last4: "7777", masked: "••••7777", active: true, createdAt: now,
  });
  await db.doc("solicitudes/qa-solicitud-001").set({ rootId: "qa-superadmin", adminId: "qa-admin", createdBy: "qa-superadmin", clientId: "qa-client-001", status: "PENDIENTE", createdAt: now });
  await db.doc("pagos/qa-pago-001").set({ rootId: "qa-superadmin", adminId: "qa-admin", createdBy: "qa-superadmin", clientId: "qa-client-001", status: "PENDIENTE", createdAt: now });
  await db.doc("clientDispersions/qa-dispersion-001").set({ rootId: "qa-superadmin", adminId: "qa-admin", createdBy: "qa-superadmin", clientId: "qa-client-001", status: "BORRADOR", createdAt: now });

  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, JSON.stringify({ projectId, password, accounts }, null, 2), { mode: 0o600 });
  console.log(`QA_AUTH_STAGE global-setup:done durationMs=${Date.now() - startedAt}`);
}
