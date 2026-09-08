import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = process.env.OUT_DIR || "audit";
const LIMIT = Number(process.env.LIMIT || 40);

function writeFile(name, text) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), text, "utf8");
}

function asDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  if (typeof v === "number") return new Date(v).toISOString();
  return String(v);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

try {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("AUDIT_START");
  console.log("OUT_DIR:", OUT_DIR);
  console.log("GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT || "");
  console.log("GCLOUD_PROJECT:", process.env.GCLOUD_PROJECT || "");
  console.log("FIREBASE_CONFIG:", process.env.FIREBASE_CONFIG || "");

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: "pay-0-system",
      storageBucket: "pay-0-system.appspot.com",
    });
  }

  console.log("ADMIN_PROJECT:", admin.app().options.projectId || "");

  const db = admin.firestore();

  console.log("QUERY_START pagos limit", LIMIT);

  const snap = await db
    .collection("pagos")
    .orderBy("createdAt", "desc")
    .limit(LIMIT)
    .get();

  console.log("QUERY_OK docs", snap.size);

  const candidateFields = [
    "folio",
    "status",
    "clienteId",
    "clienteNombre",
    "companyId",
    "empresaNombre",
    "monto",
    "amount",
    "total",
    "createdAt",
    "updatedAt",

    "iqPagoId",
    "iqPagoFolio",
    "iqPagoReceiptStatus",
    "iqPagoReceiptUploadedAt",
    "iqPagoReceiptLastError",
    "iqPagoReceiptLastErrorCode",

    "iqDepositId",
    "iqDepositFolio",
    "iqDepositCreatedAt",
    "iqDepositCreationStatus",
    "iqDepositCreationLastError",
    "iqDepositStatus",
    "iqDepositOperationStatus",
    "iqDepositReconciliationStatus",
    "iqDepositReconciliationMatchStrategy",
    "iqDepositReconciliationLastError",

    "iqPagoDepositId",
    "iqPagoDepositFolio",
    "iqPagoDepositStatus",
    "iqPagoDepositReconciliationStatus",

    "iqPaymentApplicationId",
    "iqPaymentApplicationFolio",
    "iqPaymentApplicationStatus",
  ];

  const rows = [];

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const row = {
      id: doc.id,
      ...pick(d, candidateFields),
    };

    row.createdAt = asDate(d.createdAt);
    row.updatedAt = asDate(d.updatedAt);
    row.iqPagoReceiptUploadedAt = asDate(d.iqPagoReceiptUploadedAt);
    row.iqDepositCreatedAt = asDate(d.iqDepositCreatedAt);

    row.__diagnostico = {
      tieneIqDepositId: Boolean(d.iqDepositId),
      tieneIqDepositFolio: Boolean(d.iqDepositFolio),
      tieneReferenciaIqDeposito: Boolean(
        d.iqDepositId ||
        d.iqDepositFolio ||
        d.iqPagoDepositId ||
        d.iqPagoDepositFolio
      ),
      tieneAplicacionPagoIq: Boolean(
        d.iqPaymentApplicationId ||
        d.iqPaymentApplicationFolio
      ),
      riesgoLecturaVieja:
        Boolean(d.iqPagoReceiptUploadedAt) &&
        !Boolean(
          d.iqDepositId ||
          d.iqDepositFolio ||
          d.iqPagoDepositId ||
          d.iqPagoDepositFolio
        ) &&
        !["CONCILIATED", "CONCILIADO"].includes(
          String(d.iqDepositReconciliationStatus || d.iqDepositStatus || "").toUpperCase()
        ),
      pendienteConciliacionDeposito:
        Boolean(
          d.iqPagoReceiptUploadedAt ||
          d.iqDepositId ||
          d.iqDepositFolio ||
          d.iqPagoDepositId ||
          d.iqPagoDepositFolio
        ) &&
        !["CONCILIATED", "CONCILIADO"].includes(
          String(d.iqDepositReconciliationStatus || d.iqDepositStatus || "").toUpperCase()
        ),
    };

    rows.push(row);
  }

  const outJson = path.join(OUT_DIR, "pagos-recentes-iq-audit.json");
  const outTxt = path.join(OUT_DIR, "pagos-recentes-iq-audit.txt");

  fs.writeFileSync(outJson, JSON.stringify(rows, null, 2), "utf8");

  const lines = [];
  for (const r of rows) {
    lines.push("============================================================");
    lines.push(`PAY0 pago: ${r.id}`);
    lines.push(`folio: ${r.folio || ""}`);
    lines.push(`cliente: ${r.clienteNombre || ""}`);
    lines.push(`empresa: ${r.empresaNombre || ""}`);
    lines.push(`monto: ${r.monto ?? r.amount ?? r.total ?? ""}`);
    lines.push(`status PAY0: ${r.status || ""}`);
    lines.push(`createdAt: ${r.createdAt || ""}`);
    lines.push(`iqPagoReceiptUploadedAt: ${r.iqPagoReceiptUploadedAt || ""}`);
    lines.push(`iqDepositId: ${r.iqDepositId || ""}`);
    lines.push(`iqDepositFolio: ${r.iqDepositFolio || ""}`);
    lines.push(`iqPagoDepositId: ${r.iqPagoDepositId || ""}`);
    lines.push(`iqPagoDepositFolio: ${r.iqPagoDepositFolio || ""}`);
    lines.push(`iqDepositStatus: ${r.iqDepositStatus || ""}`);
    lines.push(`iqDepositReconciliationStatus: ${r.iqDepositReconciliationStatus || ""}`);
    lines.push(`iqDepositReconciliationMatchStrategy: ${r.iqDepositReconciliationMatchStrategy || ""}`);
    lines.push(`iqPaymentApplicationId: ${r.iqPaymentApplicationId || ""}`);
    lines.push(`iqPaymentApplicationFolio: ${r.iqPaymentApplicationFolio || ""}`);
    lines.push(`riesgoLecturaVieja: ${r.__diagnostico.riesgoLecturaVieja}`);
    lines.push(`pendienteConciliacionDeposito: ${r.__diagnostico.pendienteConciliacionDeposito}`);
  }

  fs.writeFileSync(outTxt, lines.join("\n"), "utf8");

  const riesgos = rows.filter((r) => r.__diagnostico.riesgoLecturaVieja);
  const pendientes = rows.filter((r) => r.__diagnostico.pendienteConciliacionDeposito);
  const conRef = rows.filter((r) => r.__diagnostico.tieneReferenciaIqDeposito);
  const sinRef = rows.filter((r) => !r.__diagnostico.tieneReferenciaIqDeposito);

  console.log("OK audit JSON:", outJson);
  console.log("OK audit TXT:", outTxt);
  console.log("");
  console.log(`Pagos revisados: ${rows.length}`);
  console.log(`Con referencia IQ deposito: ${conRef.length}`);
  console.log(`Sin referencia IQ deposito: ${sinRef.length}`);
  console.log(`Riesgo lectura vieja: ${riesgos.length}`);
  console.log(`Pendientes conciliacion deposito: ${pendientes.length}`);

  if (riesgos.length) {
    console.log("");
    console.log("Pagos con riesgo de lectura vieja:");
    for (const r of riesgos.slice(0, 10)) {
      console.log(`- ${r.id} | ${r.folio || ""} | monto=${r.monto ?? r.amount ?? r.total ?? ""} | uploadedAt=${r.iqPagoReceiptUploadedAt || ""}`);
    }
  }

  process.exit(0);
} catch (error) {
  const message = error?.stack || error?.message || String(error);
  console.error("AUDIT_FAILED");
  console.error(message);
  writeFile("pagos-recentes-iq-audit-error.txt", message);
  process.exit(1);
}