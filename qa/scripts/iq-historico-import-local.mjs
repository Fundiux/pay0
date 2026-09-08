import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

function loadXlsx() {
  try {
    return require(require.resolve("xlsx", { paths: [root, path.join(root, "functions")] }));
  } catch (error) {
    console.error("NO_XLSX_PACKAGE");
    console.error("No encontre paquete 'xlsx' en root ni functions.");
    console.error("Si falla aqui, dime y lo resolvemos sin dejar dependencia permanente.");
    process.exit(2);
  }
}

const XLSX = loadXlsx();

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function money(value) {
  if (typeof value === "number") return value;
  const text = clean(value).replace(/[^0-9.-]/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function iso(dateValue, timeValue) {
  const d = clean(dateValue);
  const t = clean(timeValue || "00:00:00");

  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return `${d}T${t || "00:00:00"}.000Z`;
  }

  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const dd = String(Number(m[1])).padStart(2, "0");
    const mm = String(Number(m[2])).padStart(2, "0");
    const yyyy = m[3];
    const hh = String(Number(m[4] || "0")).padStart(2, "0");
    const mi = String(Number(m[5] || "0")).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00.000Z`;
  }

  return "";
}

function readRows(filePath) {
  const wb = XLSX.readFile(filePath, { raw: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
}

function normalizeDeposits(filePath) {
  const rows = readRows(filePath);
  return rows.slice(1).filter((row) => row.some((v) => clean(v))).map((row) => ({
    operationStatus: clean(row[0]),
    reconciliationStatus: clean(row[1]),
    iqDepositId: clean(row[2]),
    associate: clean(row[3]),
    companyName: clean(row[4]),
    clientName: clean(row[5]),
    operationType: clean(row[6]),
    saleType: clean(row[7]),
    basePct: clean(row[8]),
    salePct: clean(row[9]),
    subtotal: money(row[10]),
    amount: money(row[11]),
    currency: clean(row[12]).toUpperCase(),
    receipt: clean(row[13]),
    totalReturn: money(row[14]),
    createdDate: clean(row[15]),
    createdTime: clean(row[16]),
    createdAtIso: iso(row[15], row[16]),
    source: path.basename(filePath),
  })).filter((row) => /^\d+$/.test(row.iqDepositId));
}

function normalizeSolicitudes(filePath) {
  const rows = readRows(filePath);
  return rows.slice(1).filter((row) => row.some((v) => clean(v))).map((row) => ({
    iqSolicitudId: clean(row[0]),
    operationStatus: clean(row[1]),
    invoiceType: clean(row[2]),
    amount: money(row[3]),
    comments: clean(row[4]),
    rejectionComments: clean(row[5]),
    folio: clean(row[6]),
    serie: clean(row[7]),
    createdAtText: clean(row[8]),
    associate: clean(row[9]),
    companyName: clean(row[10]),
    clientName: clean(row[11]),
    purchaseOrder: clean(row[12]),
    invoice: clean(row[13]),
    paidAmount: money(row[14]),
    createdDate: clean(row[15]),
    createdTime: clean(row[16]),
    createdAtIso: iso(row[15], row[16]),
    source: path.basename(filePath),
  })).filter((row) => /^\d+$/.test(row.iqSolicitudId));
}

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [k, ...rest] = arg.replace(/^--/, "").split("=");
  return [k, rest.join("=")];
}));

const depositsPath = args.deposits;
const solicitudesPath = args.solicitudes;
const url = args.url;
const token = args.token;

if (!depositsPath || !fs.existsSync(depositsPath)) {
  console.error(`Depositos no encontrado: ${depositsPath}`);
  process.exit(1);
}
if (!solicitudesPath || !fs.existsSync(solicitudesPath)) {
  console.error(`Solicitudes no encontrado: ${solicitudesPath}`);
  process.exit(1);
}
if (!url || !token) {
  console.error("Falta --url o --token");
  process.exit(1);
}

const deposits = normalizeDeposits(depositsPath);
const solicitudes = normalizeSolicitudes(solicitudesPath);

console.log("DEPOSITS_ROWS", deposits.length);
console.log("SOLICITUDES_ROWS", solicitudes.length);

const payload = {
  snapshotName: `IQ Historico ${new Date().toISOString()}`,
  deposits,
  solicitudes,
};

const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-pay0-iq-history-token": token,
  },
  body: JSON.stringify(payload),
});

const text = await response.text();

console.log("HTTP_STATUS", response.status);
console.log(text);

if (!response.ok) {
  process.exit(1);
}