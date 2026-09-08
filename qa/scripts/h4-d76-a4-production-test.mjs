import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { chromium } from "playwright";

const root = process.cwd();
const serviceAccountPath = String(process.env.PAY0_SERVICE_ACCOUNT_PATH || path.join(root, "service-account-pay0.json"));
if (!fs.existsSync(serviceAccountPath)) throw new Error("No se encontro una llave de servicio PAY0 valida.");
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
const projectId = String(serviceAccount.project_id || "").trim();
if (!projectId) throw new Error("project_id no resuelto.");

initializeApp({ credential: cert(serviceAccount), projectId });
const auth = getAuth();
const db = getFirestore();
const suffix = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
const email = `qa-h4-d76-${suffix}@pay0.invalid`;
const password = `Qa!${crypto.randomBytes(12).toString("base64url")}9`;
const baseUrl = process.env.PAY0_PROD_URL || `https://${projectId}.web.app`;
let testUid = "";
let browser;

async function deleteQuery(collectionName, field, value) {
  const snap = await db.collection(collectionName).where(field, "==", value).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function cleanup() {
  if (!testUid) return;
  await Promise.all([
    deleteQuery("securityAlerts", "uid", testUid),
    deleteQuery("userNotifications", "referenceId", testUid),
    deleteQuery("activityLog", "actorUid", testUid),
  ]);
  await db.doc(`users/${testUid}`).delete().catch(() => undefined);
  await auth.deleteUser(testUid).catch(() => undefined);
}

try {
  const superSnap = await db.collection("users").where("role", "==", "superadmin").limit(10).get();
  const candidates = superSnap.docs.filter((doc) => doc.data()?.isDeleted !== true && doc.data()?.isActive !== false && doc.data()?.active !== false);
  if (candidates.length !== 1) throw new Error(`Se esperaba exactamente 1 superadmin activo y se encontraron ${candidates.length}.`);
  const superUid = candidates[0].id;

  const created = await auth.createUser({ email, password, displayName: "QA H4-D76 URL", emailVerified: true });
  testUid = created.uid;
  await db.doc(`users/${testUid}`).set({
    email,
    displayName: "QA H4-D76 URL",
    nombreUsuario: "QA H4-D76 URL",
    role: "operador",
    rootId: superUid,
    parentUserId: superUid,
    parentRole: "superadmin",
    isActive: true,
    active: true,
    isDeleted: false,
    userNumber: 999999,
    modules: {
      dashboard: { view: true },
      wallet: { view: false, adelantos: false },
    },
    qaMarker: "H4-D76-A4",
    createdAt: new Date(),
  });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 45000 });

  await page.goto(`${baseUrl}/wallet/adelantos`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Acceso bloqueado", { exact: true }).waitFor({ timeout: 45000 });
  const body = await page.locator("body").innerText();
  if (/otorgar adelanto|nuevo adelanto/i.test(body)) throw new Error("La pantalla prohibida llego a renderizar contenido operativo.");
  if (!/HS-[A-Z2-9]{6}/.test(body)) throw new Error("No aparecio el folio de incidente.");

  let alertDoc = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const alertSnap = await db.collection("securityAlerts").where("uid", "==", testUid).limit(10).get();
    alertDoc = alertSnap.docs.find((doc) => doc.data()?.event === "UNAUTHORIZED_ROUTE_ATTEMPT") || null;
    if (alertDoc?.data()?.telegramStatus === "SENT") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!alertDoc) throw new Error("No se creo securityAlerts para el intento.");
  const alert = alertDoc.data();
  if (alert.telegramStatus !== "SENT" || Number(alert.telegramSentCount || 0) < 1) {
    throw new Error(`Telegram no confirmado: ${alert.telegramStatus || "SIN_ESTADO"}.`);
  }
  if (!alert.incidentCode || !alert.unlockCode) throw new Error("Faltan codigos del incidente en el registro exclusivo de seguridad.");
  if (body.includes(String(alert.unlockCode))) throw new Error("El codigo secreto fue expuesto al usuario.");

  console.log("PASS usuario QA temporal creado");
  console.log("PASS URL prohibida no renderizo el modulo");
  console.log("PASS bloqueo inmediato y folio visible");
  console.log("PASS codigo secreto no visible al usuario");
  console.log(`PASS Telegram real SENT (${alert.telegramSentCount})`);
  console.log("H4-D76-A4 prueba productiva: 5/5 OK.");
} finally {
  if (browser) await browser.close().catch(() => undefined);
  await cleanup();
  if (testUid) console.log("PASS limpieza QA temporal completada");
}
