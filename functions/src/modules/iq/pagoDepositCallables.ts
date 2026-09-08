import {
  loadIqCanonicalUserAccess,
} from "./iqCanonicalAccess";
import { DEFAULT_IQ_ERP_URL } from "./config";
import { evaluateIqDispatchGate } from "../dispatches/iqGate";
import * as crypto from "crypto";
import { assertSimilarPay0OperationConfirmedForIqCreateH4D58F } from "./pay0SimilarOperationPrecheckCallables";

import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import * as admin from "firebase-admin";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/tasks";
import { enqueueIqOnDemandTaskH4D64 } from "./iqOnDemandTaskQueue";
import { defineSecret } from "firebase-functions/params";
import { notifyIqPagoTelegramH4D59B } from "./pagoTelegramNotifications";
import { postCanonicalPagoFinancials } from "../deposits/financial";
import { evaluateIqCompanyDespachoGate } from "../paymentApplications/iqBusinessGate";
import { assertIqAuthorized } from "./authorization";
import { assertAuthorized } from "../../utils/authGuard";

import { loadEnabledIqAutomationRoots } from "./automationRuntime";
import { runPagoDepositHttpCreateFlow } from "./pagoDepositHttpCreateFlow";
import {
  loginIqHttpDirect,
  toIqAuthContext,
} from "./iqHttpAuth";
import {
  resolveIqDepositCatalogHttp,
} from "./iqDepositHttpCatalogResolver";
import {
  runPagoDepositHttpFindByRefsA52,
  runPagoDepositHttpFindCandidatesA52,
} from "./pagoDepositHttpReconcileA52";
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

const IQ_PAGO_DEPOSIT_PREVALIDATION_VERSION = "IQ-PAGO-DEPOSIT-PREVALIDATION-1";
const IQ_PAGO_DEPOSIT_CREATION_VERSION = "IQ-PAGO-DEPOSIT-CREATION-1";
const IQ_PAGO_DEPOSIT_RECONCILIATION_VERSION = "IQ-PAGO-DEPOSIT-RECONCILIATION-1";

const DEFAULT_IQ_TIME_ZONE = "America/Mexico_City";
const ACTIVE_LOCK_WINDOW_MS = 10 * 60 * 1000;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
};

type IqAccess = {
  profileId: string;
  profileAlias: string;
  associatedName: string;
  username: string;
  password: string;
  erpUrl: string;
};

type IqCreateDepositBatchItem = Record<string, any>;

type PagoIqDepositContext = {
  pagoId: string;
  pagoRef: admin.firestore.DocumentReference;
  pago: Record<string, unknown>;
  access: IqAccess;
  ready: boolean;
  status: "READY" | "PREVALIDATION_ERROR";
  errors: string[];
  profileId: string;
  profileAlias: string;
  iqAssociatedName: string;
  iqClientName: string | null;
  iqClientId: string | null;
  iqCompanyName: string | null;
  operationTypeName: string | null;
  saleTypeName: string | null;
  percentageName: string | null;
  currencyName: string | null;
  despachoId: string | null;
  despachoAccessVerified: boolean;
  amount: number;
  receiptUploadId: string | null;
  receiptFileName: string | null;
  receiptStoragePath: string | null;
  receiptExists: boolean;
  marker: string;
  targetDateIso: string | null;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanUpper(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function canonicalOperationKey(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function money(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function toMillis(value: unknown): number {
  if (!value) return 0;

  const candidate = value as {
    toMillis?: () => number;
    seconds?: number;
  };

  if (typeof candidate.toMillis === "function") {
    return candidate.toMillis();
  }

  if (typeof candidate.seconds === "number") {
    return candidate.seconds * 1000;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return 0;
}

function normalizeErpUrl(value: string): string {
  const raw = value.trim() || DEFAULT_IQ_ERP_URL;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new HttpsError("failed-precondition", "La cuenta IQ tiene una URL ERP invalida.");
  }
}

function getEncryptionKey(): Buffer {
  const raw = IQ_CREDENTIALS_KEY.value();

  if (!raw || raw.trim().length < 16) {
    throw new HttpsError("failed-precondition", "IQ_CREDENTIALS_KEY no esta configurada.");
  }

  const trimmed = raw.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const fromBase64 = Buffer.from(trimmed, "base64");
    if (fromBase64.length === 32) {
      return fromBase64;
    }
  } catch {
    // fallback below
  }

  return crypto.createHash("sha256").update(trimmed).digest();
}

function decryptSecret(data: Record<string, unknown>): string {
  const ciphertext = cleanText(data.passwordCiphertext);
  const iv = cleanText(data.passwordIv);
  const tag = cleanText(data.passwordTag);

  if (!ciphertext || !iv || !tag) {
    throw new HttpsError("failed-precondition", "La cuenta IQ no tiene contrasena configurada.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function getAuthContext(request: {
  auth?: {
    uid?: string;
    token?: Record<string, unknown>;
  } | null;
}): Promise<AuthContext> {
  const uid = cleanText(request.auth?.uid);

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Usuario PAY0 no encontrado.");
  }

  const user = asRecord(userSnap.data());
  const token = asRecord(request.auth?.token);

  const role = cleanText(
    token.role ??
    token.userRole ??
    user.role,
  ).toLowerCase();

  const rootId = cleanText(
    token.rootId ??
    token.root_id ??
    user.rootId ??
    uid,
  );

  return {
    uid,
    role,
    rootId: rootId || uid,
    user,
  };
}

function canUsePagos(auth: AuthContext): boolean {
  if (auth.role === "superadmin") return true;

  const modules = asRecord(auth.user.modules);
  const pagos = asRecord(modules.pagos);

  return pagos.create === true || pagos.conciliate === true || pagos.view === true;
}

async function getIqAccessForPagos(
  auth: AuthContext,
  includePassword: boolean,
): Promise<IqAccess> {
  const canonical = await loadIqCanonicalUserAccess({
    uid: auth.uid,
    rootId: auth.rootId,
    role: auth.role,
    moduleKey: "pagos",
    encryptionSecret: IQ_CREDENTIALS_KEY.value(),
    includePassword,
  });

  return {
    profileId: canonical.profileId,
    profileAlias: canonical.profileAlias,
    associatedName:
      canonical.associatedName ||
      canonical.username,
    username: canonical.username,
    password: canonical.password,
    erpUrl: canonical.erpUrl,
  };
}
function assertSameRoot(data: Record<string, unknown>, rootId: string, label: string): void {
  const dataRootId = cleanText(data.rootId);

  if (dataRootId && dataRootId !== rootId) {
    throw new HttpsError("permission-denied", `${label} fuera de scope.`);
  }
}

async function verifyDespachoAccess(auth: AuthContext, despachoId: string): Promise<boolean> {
  const providerGateH4D73A6 = await evaluateIqDispatchGate({ db, despachoId });
  if (!providerGateH4D73A6.ok) return false;
  if (!despachoId) return false;
  if (auth.role === "superadmin") return true;

  const snap = await db
    .collection("userDespachoAccess")
    .doc(auth.uid)
    .collection("despachos")
    .doc(despachoId)
    .get();

  if (!snap.exists) return false;

  const data = asRecord(snap.data());
  return data.active === true;
}

// H4_D63A_STRICT_AUTOMATION_DISPATCH_ACCESS
async function verifyPagoIqAutomaticDespachoAccessH4D63A(
  uid: string,
  despachoId: string,
): Promise<boolean> {
  const resolvedUid = cleanText(uid);
  const resolvedDespachoId = cleanText(despachoId);

  if (!resolvedUid || !resolvedDespachoId) {
    return false;
  }

  /*
   * La automatizacion no usa el bypass de superadmin.
   * Debe comportarse como Solicitudes: usuario real +
   * acceso explicito al despacho.
   */
  const snap = await db
    .collection("userDespachoAccess")
    .doc(resolvedUid)
    .collection("despachos")
    .doc(resolvedDespachoId)
    .get();

  if (!snap.exists) {
    return false;
  }

  const data = asRecord(snap.data());

  return data.active === true;
}
// H4_D63A_STRICT_AUTOMATION_DISPATCH_ACCESS_END

function getEntityName(data: Record<string, unknown>, fallback: string): string {
  return cleanText(
    data.nombre ??
    data.razonSocial ??
    data.name ??
    data.alias ??
    fallback,
  );
}

function normalizePercentLabel(value: number): string {
  const fixed = Math.round(value * 10000) / 10000;
  if (Number.isInteger(fixed)) return String(fixed);
  return String(fixed).replace(/0+$/, "").replace(/\.$/, "");
}

function mapPay0OperationToIqOperation(value: unknown): string {
  const upper = cleanUpper(value);

  if (
    upper === "FACTURA SUBTOTAL" ||
    upper === "FACTURA_SUBTOTAL" ||
    upper === "SUBTOTAL" ||
    upper.includes("FACTURA SUBTOTAL")
  ) {
    return "CRUCE";
  }

  if (
    upper === "FACTURA TOTAL" ||
    upper === "FACTURA_TOTAL" ||
    upper.includes("FACTURA TOTAL")
  ) {
    return "CRUCE";
  }

  if (upper === "CRUCE" || upper.includes("CRUCE")) {
    return "CRUCE";
  }

  const clean = cleanText(value);
  return clean || "CRUCE";
}

function mapPay0BaseToIqSaleType(value: unknown): string {
  const upper = cleanUpper(value);

  if (
    upper === "SUBTOTAL" ||
    upper === "SUB_TOTAL" ||
    upper.includes("SUBTOTAL") ||
    upper.includes("SUB_TOTAL")
  ) {
    return "Subtotal";
  }

  if (upper === "TOTAL") {
    return "Total";
  }

  return "Subtotal";
}

function resolveCostRate(data: Record<string, unknown>): number {
  const candidates = [
    data.baseCost,
    data.iqBaseCost,
    data.iqCost,
    data.costoIq,
    data.costoIQ,
    data.costo,
    data.cost,
    data.rate,
    data.percent,
    data.percentage,
    data.porcentaje,
  ];

  for (const candidate of candidates) {
    const n = money(candidate);
    if (n > 0) return n;
  }

  return 0;
}

function buildIqPercentageNameFromRate(rate: number): string {
  const label = normalizePercentLabel(rate);
  return `Base: ${label} % - Venta: ${label} %`;
}

async function findDespachoOperationCost(input: {
  rootId: string;
  despachoId: string;
  operationTypeKey: string;
  operationTypeName: string;
}): Promise<Record<string, unknown> | null> {
  const despachoId = cleanText(input.despachoId);
  const operationTypeKey = cleanUpper(input.operationTypeKey);
  const operationTypeName = cleanUpper(input.operationTypeName);

  if (!despachoId) return null;

  const candidates: Record<string, unknown>[] = [];

  async function collect(query: FirebaseFirestore.Query): Promise<void> {
    const snap = await query.limit(20).get();
    snap.docs.forEach((doc) => candidates.push({ id: doc.id, ...asRecord(doc.data()) }));
  }

  await Promise.all([
    collect(
      db
        .collection("despachoOperationCosts")
        .where("despachoId", "==", despachoId),
    ).catch(() => undefined),

    collect(
      db
        .collection("dispatchOperationCosts")
        .where("despachoId", "==", despachoId),
    ).catch(() => undefined),

    collect(
      db
        .collection("despachos")
        .doc(despachoId)
        .collection("operationCosts"),
    ).catch(() => undefined),

    collect(
      db
        .collection("despachos")
        .doc(despachoId)
        .collection("costosOperacion"),
    ).catch(() => undefined),

    collect(
      db
        .collection("despachos")
        .doc(despachoId)
        .collection("costos"),
    ).catch(() => undefined),
  ]);

  const active = candidates.filter((row) => {
    if (row.active === false) return false;

    const rowRootId = cleanText(row.rootId);
    if (rowRootId && rowRootId !== input.rootId) return false;

    const rowDespachoId = cleanText(row.despachoId ?? row.dispatchId);
    if (rowDespachoId && rowDespachoId !== despachoId) return false;

    return true;
  });

  const scored = active
    .map((row) => {
      const rowKey = cleanUpper(
        row.operationTypeKey ??
        row.tipoOperacionKey ??
        row.typeKey ??
        row.operationTypeId ??
        row.id,
      );

      const rowName = cleanUpper(
        row.operationTypeName ??
        row.tipoOperacionNombre ??
        row.tipo ??
        row.typeName ??
        row.name ??
        row.nombre,
      );

      let score = 0;

      if (operationTypeKey && rowKey && rowKey === operationTypeKey) score += 100;
      if (operationTypeName && rowName && rowName === operationTypeName) score += 80;
      if (operationTypeName && rowName && rowName.includes(operationTypeName)) score += 40;
      if (operationTypeName && rowName && operationTypeName.includes(rowName)) score += 30;

      return { row, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.row ?? null;
}

function getCostBase(
  cost: Record<string, unknown>,
  pago: Record<string, unknown>,
  operationType: Record<string, unknown>,
): string {
  void pago;
  void operationType;

  return cleanText(
    cost.calculationBaseType ??
    cost.base ??
    cost.calculationBase ??
    cost.baseCalculo ??
    "SUBTOTAL",
  );
}

function resolveSaleTypeName(
  pago: Record<string, unknown>,
  operationType: Record<string, unknown>,
  despachoCost: Record<string, unknown> | null,
): string {
  return mapPay0BaseToIqSaleType(getCostBase(despachoCost || {}, pago, operationType));
}

function resolvePercentageName(
  pago: Record<string, unknown>,
  despachoCost: Record<string, unknown> | null,
): string {
  void pago;

  const costRate = despachoCost ? resolveCostRate(despachoCost) : 0;

  if (costRate > 0) {
    return buildIqPercentageNameFromRate(costRate);
  }

  return "";
}

function targetDateIso(value: unknown): string | null {
  const ms = toMillis(value);
  if (!ms) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_IQ_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));

    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // fallback below
  }

  return new Date(ms).toISOString().slice(0, 10);
}

function buildMarker(pagoId: string, pago: Record<string, unknown>): string {
  const folio = cleanText(
    pago.folio ??
    pago.referenceFolio ??
    pago.pagoFolio ??
    pagoId,
  );

  return `PAY0 PAGO ${folio}`.slice(0, 140);
}

function buildFingerprint(input: {
  pagoId: string;
  amount: number;
  clientName: string | null;
  companyName: string | null;
  operationTypeName: string | null;
  saleTypeName: string | null;
  receiptStoragePath: string | null;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function buildPagoFoundationOnConciliation(data: Record<string, unknown>) {
  const total = money(
    data.montoTotal ??
    data.total ??
    data.amount ??
    0,
  );

  const applied = money(
    data.montoAplicadoSolicitudes ??
    data.montoAplicado ??
    0,
  );

  const available = money(Math.max(0, total - applied));

  return {
    montoAplicado: applied,
    montoDisponible: available,
    montoAplicadoSolicitudes: applied,
    montoDisponibleSolicitudes: available,
    coverageVersion: 1,
    walletVersion: 1,
    statementVersion: 1,
    roundingVersion: "money2_v1",
  };
}

type IqPagoFinancialPostingResultH4D65A0 = {
  attempted: true;
  ok: boolean;
  status: string;
  snapshotId: string | null;
  errorMessage: string | null;
};

export function shouldPostPagoFinancialsAfterIqConciliationH4D65A0(input: {
  conciliated: boolean;
  currentStatus: unknown;
}): boolean {
  const currentStatus = cleanUpper(input.currentStatus);
  return input.conciliated &&
    (currentStatus === "CONCILIACION_PENDIENTE" || currentStatus === "CONCILIADO");
}

async function postPagoFinancialsAfterIqConciliationH4D65A0(input: {
  auth: AuthContext;
  actor: PagoIqOperationalActorH4D87;
  pagoId: string;
  pagoRef: admin.firestore.DocumentReference;
  source: string;
}): Promise<IqPagoFinancialPostingResultH4D65A0> {
  const actorUsername = input.actor.name;

  const result = await postCanonicalPagoFinancials({
    db,
    rootId: input.auth.rootId,
    pagoId: input.pagoId,
    actorUid: input.actor.uid,
    actorUsername,
    actorRole: input.actor.role,
    sourceChannel: "IQ",
  });

  const errorMessage = result.ok
    ? null
    : cleanText(result.errorMessage || result.status || "POSTEO_FINANCIERO_NO_COMPLETADO");

  await input.pagoRef.set(
    {
      iqDepositFinancialPostingAttemptedAt: FieldValue.serverTimestamp(),
      iqDepositFinancialPostingSource: input.source,
      iqDepositFinancialPostingOk: result.ok,
      iqDepositFinancialPostingStatus: result.status,
      iqDepositFinancialSnapshotId: result.snapshotId || null,
      iqDepositFinancialPostingError: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    attempted: true,
    ok: result.ok,
    status: result.status,
    snapshotId: result.snapshotId || null,
    errorMessage,
  };
}

function financialPostingMessageH4D65A0(
  result: IqPagoFinancialPostingResultH4D65A0 | null,
): string {
  if (!result) return "";
  if (result.ok && result.status === "POSTED") {
    return "Posteo financiero PAY0 completado; saldo cliente e ingresos procesados con idempotencia.";
  }

  return `Pago conciliado; posteo financiero no completado (${result.status}). Revisa configuracion financiera del pago.`;
}
// H4_D65_A0_IQ_USES_CANONICAL_FINANCIAL_POSTING

async function findActiveReceipt(pagoId: string, rootId: string): Promise<{
  id: string;
  data: Record<string, unknown>;
} | null> {
  const snap = await db
    .collection("uploads")
    .where("pagoId", "==", pagoId)
    .get();

  const rows = snap.docs
    .map((doc) => ({
      id: doc.id,
      data: asRecord(doc.data()),
    }))
    .filter((row) => {
      const rowRootId = cleanText(row.data.rootId);
      if (rowRootId && rowRootId !== rootId) return false;

      return (
        cleanText(row.data.entityType) === "pagos" &&
        cleanUpper(row.data.documentType) === "COMPROBANTE_PAGO" &&
        row.data.active === true &&
        cleanUpper(row.data.status || "READY") !== "REPLACED" &&
        cleanUpper(row.data.status || "READY") !== "INACTIVE"
      );
    })
    .sort((a, b) => {
      const at =
        toMillis(a.data.finalizedAt) ||
        toMillis(a.data.updatedAt) ||
        toMillis(a.data.createdAt);

      const bt =
        toMillis(b.data.finalizedAt) ||
        toMillis(b.data.updatedAt) ||
        toMillis(b.data.createdAt);

      return bt - at;
    });

  return rows[0] ?? null;
}

async function buildPagoIqDepositContext(input: {
  auth: AuthContext;
  pagoId: string;
  includePassword: boolean;
  persist: boolean;
}): Promise<PagoIqDepositContext> {
  if (!canUsePagos(input.auth)) {
    throw new HttpsError("permission-denied", "No autorizado para operar pagos.");
  }

  const resolvedPagoH4D61B = await resolvePagoByIdOrFolioH4D50G(input.pagoId, input.auth.rootId);
  const pagoRef = resolvedPagoH4D61B.ref;
  const pagoSnap = resolvedPagoH4D61B.snap;
  const pago = resolvedPagoH4D61B.data;
  const resolvedPagoIdH4D61B = cleanText(pagoSnap.id ?? pagoRef.id ?? input.pagoId); // H4_D61B_BUILD_CONTEXT_RESOLVE_PAY0_FOLIO

  const access = await getIqAccessForPagos(input.auth, input.includePassword);

  const clienteId = cleanText(pago.clienteId ?? pago.clientId);
  const companyId = cleanText(pago.companyId ?? pago.empresaId);
  const despachoId = cleanText(pago.despachoId);
  const amount = money(
    pago.montoTotal ??
    pago.amount ??
    pago.total,
  );
  const statusPago = cleanUpper(pago.status);
  const operationTypeKey = canonicalOperationKey(pago.operationTypeKey ?? pago.tipoOperacionKey ?? pago.operationTypeName ?? pago.tipoOperacion);
  const errors: string[] = [];

  if (!clienteId) errors.push("Pago sin cliente.");
  if (!companyId) errors.push("Pago sin empresa.");
  if (!despachoId) errors.push("Pago sin despacho.");
  if (!(amount > 0)) errors.push("Monto de pago invalido.");
  if (!operationTypeKey) errors.push("Pago sin tipo de operacion.");
  if (["RECHAZADO", "CANCELADO"].includes(statusPago)) {
    errors.push("Pago en estado terminal; no se puede crear deposito IQ.");
  }

  const despachoAccessVerified = await verifyDespachoAccess(input.auth, despachoId);

  if (!despachoAccessVerified) {
    errors.push("El usuario no tiene habilitado el despacho del pago.");
  }

  const [clientSnap, companySnap, operationTypeSnap] = await Promise.all([
    clienteId ? db.collection("clients").doc(clienteId).get() : Promise.resolve(null),
    companyId ? db.collection("companies").doc(companyId).get() : Promise.resolve(null),
    operationTypeKey ? db.collection("operationTypes").doc(operationTypeKey).get() : Promise.resolve(null),
  ]);

  const client = clientSnap?.exists ? asRecord(clientSnap.data()) : {};
  const company = companySnap?.exists ? asRecord(companySnap.data()) : {};
  const operationType = operationTypeSnap?.exists ? asRecord(operationTypeSnap.data()) : {};

  if (clienteId && !clientSnap?.exists) errors.push("Cliente PAY0 no encontrado.");
  if (companyId && !companySnap?.exists) errors.push("Empresa PAY0 no encontrada.");
  if (operationTypeKey && !operationTypeSnap?.exists) errors.push("Tipo de operacion PAY0 no encontrado.");

  if (clientSnap?.exists) assertSameRoot(client, input.auth.rootId, "Cliente");
  if (companySnap?.exists) assertSameRoot(company, input.auth.rootId, "Empresa");

  if (companySnap?.exists) {
    const companyGate = evaluateIqCompanyDespachoGate({
      rootId: input.auth.rootId,
      despachoId,
      companyId,
      company,
      sourceLabel: "el pago",
    });
    if (!companyGate.ok) errors.push(`[${companyGate.code}] ${companyGate.message}`);
  }

  const iqClientName =
    cleanText(pago.clienteNombre ?? pago.clientName) ||
    getEntityName(client, clienteId);

  const clientIqLink = asRecord(client.iqLink);
  const iqClientId = cleanText(
    clientIqLink.clientId ??
      client.iqClientId,
  );

  const iqCompanyName =
    cleanText(pago.empresaNombre ?? pago.companyName) ||
    getEntityName(company, companyId);

  const pay0OperationTypeName =
    cleanText(
      pago.operationTypeName ??
      operationType.name ??
      operationType.nombre ??
      operationTypeKey,
    ) || operationTypeKey;

  const canonicalCostKey = canonicalOperationKey(operationTypeKey || pay0OperationTypeName);
  let despachoCost: Record<string, unknown> | null = null;

  if (despachoId && canonicalCostKey) {
    const directCostSnap = await db
      .collection("despachos")
      .doc(despachoId)
      .collection("costos")
      .doc(canonicalCostKey)
      .get();

    if (directCostSnap.exists) {
      despachoCost = {
        id: directCostSnap.id,
        ...asRecord(directCostSnap.data()),
      };
    }
  }

  if (!despachoCost) {
    despachoCost = await findDespachoOperationCost({
      rootId: input.auth.rootId,
      despachoId,
      operationTypeKey: canonicalCostKey || operationTypeKey,
      operationTypeName: pay0OperationTypeName,
    });
  }

  const operationTypeName = mapPay0OperationToIqOperation(
    cleanText(
      despachoCost?.iqOperationTypeName ??
      despachoCost?.iqTipoOperacion ??
      despachoCost?.operationTypeIqName ??
      despachoCost?.tipoOperacionIq ??
      pay0OperationTypeName,
    ),
  );

  if (!despachoCost) {
    errors.push(`No se encontro costo IQ activo del despacho para ${pay0OperationTypeName || operationTypeKey}. Configura Despachos/Costos antes de enviar a IQ.`);
  }

  const saleTypeName = resolveSaleTypeName(pago, operationType, despachoCost);
  const percentageName = resolvePercentageName(pago, despachoCost);

  if (!percentageName) {
    errors.push("El costo IQ del despacho no tiene baseCost/costo valido.");
  }

  const currencyName = cleanText(pago.moneda ?? pago.currency ?? "mxn").toLowerCase() || "mxn";

  if (!iqClientName) errors.push("No fue posible resolver el nombre del Cliente IQ.");
  if (!iqCompanyName) errors.push("No fue posible resolver el nombre de la Empresa IQ.");
  if (!operationTypeName) errors.push("No fue posible resolver el tipo de operacion IQ.");

  const activeReceipt = await findActiveReceipt(resolvedPagoIdH4D61B, input.auth.rootId);

  let receiptFileName = "";
  let receiptStoragePath = "";
  let receiptExists = false;

  if (!activeReceipt) {
    errors.push("No existe comprobante de pago activo.");
  } else {
    receiptFileName = cleanText(
      activeReceipt.data.originalName ??
      activeReceipt.data.filename ??
      activeReceipt.data.fileName,
    );

    receiptStoragePath = cleanText(activeReceipt.data.storagePath);

    if (!receiptStoragePath) {
      errors.push("El comprobante activo no tiene storagePath.");
    }

    if (receiptStoragePath) {
      try {
        const [exists] = await admin.storage().bucket().file(receiptStoragePath).exists();
        receiptExists = exists === true;

        if (!receiptExists) {
          errors.push("El comprobante activo no existe en Storage.");
        }
      } catch {
        errors.push("No fue posible verificar el comprobante en Storage.");
      }
    }
  }

  const marker = buildMarker(resolvedPagoIdH4D61B, pago);
  const ready = errors.length === 0;
  const prevalidationStatus = ready ? "READY" : "PREVALIDATION_ERROR";
  const existingIqSync = asRecord(pago.iqDepositSync);
  const now = FieldValue.serverTimestamp();

  if (input.persist) {
    await pagoRef.set(
      {
        iqDepositSyncStatus: prevalidationStatus,
        iqDepositSync: {
          ...existingIqSync,
          status: prevalidationStatus,
          version: IQ_PAGO_DEPOSIT_PREVALIDATION_VERSION,
          profileId: access.profileId,
          profileAlias: access.profileAlias || null,
          iqAssociatedName: access.associatedName,
          iqClientName: iqClientName || null,
          iqClientId: iqClientId || null,
          iqCompanyName: iqCompanyName || null,
          operationTypeName: operationTypeName || null,
          saleTypeName: saleTypeName || null,
          percentageName: percentageName || null,
          currencyName: currencyName || null,
          despachoId: despachoId || null,
          despachoAccessVerified,
          amount,
          receiptUploadId: activeReceipt?.id || null,
          receiptFileName: receiptFileName || null,
          receiptStoragePath: receiptStoragePath || null,
          receiptExists,
          marker,
          targetDateIso: targetDateIso(pago.createdAt ?? pago.fechaPago), // IQ2G_H4_D48H_TARGET_DATE_FROM_PAY0_CREATED_AT
          errors,
          prevalidatedAt: now,
          requestedBy: input.auth.uid,
        },
        iqDepositUpdatedAt: now,
      },
      { merge: true },
    );
  }

  return {
    pagoId: resolvedPagoIdH4D61B,
    pagoRef,
    pago,
    access,
    ready,
    status: prevalidationStatus,
    errors,
    profileId: access.profileId,
    profileAlias: access.profileAlias,
    iqAssociatedName: access.associatedName,
    iqClientName: iqClientName || null,
    iqClientId: iqClientId || null,
    iqCompanyName: iqCompanyName || null,
    operationTypeName: operationTypeName || null,
    saleTypeName: saleTypeName || null,
    percentageName: percentageName || null,
    currencyName: currencyName || null,
    despachoId: despachoId || null,
    despachoAccessVerified,
    amount,
    receiptUploadId: activeReceipt?.id || null,
    receiptFileName: receiptFileName || null,
    receiptStoragePath: receiptStoragePath || null,
    receiptExists,
    marker,
    targetDateIso: targetDateIso(pago.createdAt ?? pago.fechaPago), // IQ2G_H4_D48H_TARGET_DATE_FROM_PAY0_CREATED_AT
  };
}

async function downloadReceiptToTemp(ctx: PagoIqDepositContext): Promise<{
  tmpDir: string;
  filePath: string;
  fileName: string;
}> {
  if (!ctx.receiptStoragePath) {
    throw new HttpsError("failed-precondition", "Comprobante sin storagePath.");
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pay0-iq-pago-"));
  const safeName = cleanText(ctx.receiptFileName).replace(/[^a-zA-Z0-9._-]/g, "_") || "comprobante";
  const filePath = path.join(tmpDir, safeName);

  await admin.storage().bucket().file(ctx.receiptStoragePath).download({
    destination: filePath,
  });

  return {
    tmpDir,
    filePath,
    fileName: safeName,
  };
}

function buildBatchItem(ctx: PagoIqDepositContext, receiptFilePath: string, submit: boolean): IqCreateDepositBatchItem {
  return {
    key: ctx.pagoId,
    associatedName: ctx.iqAssociatedName,
    clientName: ctx.iqClientName || "",
    companyName: ctx.iqCompanyName || "",
    operationTypeName: ctx.operationTypeName || "CRUCE",
    saleTypeName: ctx.saleTypeName || "Subtotal",
    percentageName: ctx.percentageName || "Base: 2.0 % - Venta: 2.0 %",
    currencyName: ctx.currencyName || "mxn",
    amount: ctx.amount,
    receiptFilePath,
    receiptFileName: ctx.receiptFileName || "comprobante",
    comments: ctx.marker,
    targetDateIso: ctx.targetDateIso || undefined,
    submit,
  };
}

function activeLockStillValid(pago: Record<string, unknown>): boolean {
  const status = cleanUpper(pago.iqDepositCreationStatus);
  if (status !== "PROCESSING") return false;

  const startedAt =
    toMillis(pago.iqDepositCreationStartedAt) ||
    toMillis(pago.iqDepositUpdatedAt);

  if (!startedAt) return false;

  return Date.now() - startedAt < ACTIVE_LOCK_WINDOW_MS;
}

// H4_D87_A57_A49_LEGACY_PAGO_PREVALIDATE_PREPARE_REMOVED
// Prevalidar/Preparar separados retirados. La creacion valida internamente
// y continua desde IQ_DEPOSIT_HTTP_CREATE_FLAG_H4D85.
const IQ_DEPOSIT_HTTP_CREATE_FLAG_H4D85 =
  "PAY0_IQ_DEPOSIT_HTTP_CREATE_ENABLED";
const IQ_DEPOSIT_HTTP_TEST_PAGO_ID_H4D85 =
  "PAY0_IQ_DEPOSIT_HTTP_CREATE_TEST_PAGO_ID";
const IQ_API_ORIGIN_H4D85 =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

function isPagoDepositHttpCreateEnabledH4D85(
  _pagoId: string,
): boolean {
  return true;
}

function pagoCreatedAtIsoH4D85(
  pago: Record<string, unknown>,
): string {
  const milliseconds =
    toMillis(pago.createdAt) ||
    toMillis(pago.fechaPago);

  if (
    !Number.isFinite(milliseconds) ||
    Number(milliseconds) <= 0
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El pago no tiene createdAt valido para establecer el limite temporal IQ.",
    );
  }

  return new Date(Number(milliseconds)).toISOString();
}

// H4_D87_A57_A66_CLEAR_LEGACY_PREVALIDATION_ON_MANUAL_CREATE_EARLY_RETURN
async function clearLegacyPagoIqPrevalidationOnManualCreateEarlyReturnH4D87A66(
  pagoRef: admin.firestore.DocumentReference,
  pago: Record<string, unknown>,
): Promise<void> {
  const legacyIqSyncH4D87A66 = asRecord(pago.iqDepositSync);
  const legacyIqSyncStatusH4D87A66 = cleanUpper(
    legacyIqSyncH4D87A66.status ?? pago.iqDepositSyncStatus,
  );
  const legacyIqSyncVersionH4D87A66 = cleanText(
    legacyIqSyncH4D87A66.version,
  );
  const clearLegacyIqSyncH4D87A66 =
    legacyIqSyncVersionH4D87A66 === IQ_PAGO_DEPOSIT_PREVALIDATION_VERSION &&
    (
      legacyIqSyncStatusH4D87A66 === "READY" ||
      legacyIqSyncStatusH4D87A66 === "PREVALIDATION_ERROR"
    );

  await pagoRef.set(
    {
      iqDepositForm: FieldValue.delete(),
      iqDepositFormStatus: FieldValue.delete(),
      ...(clearLegacyIqSyncH4D87A66
        ? {
            iqDepositSync: FieldValue.delete(),
            iqDepositSyncStatus: FieldValue.delete(),
          }
        : {}),
      iqDepositUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// H4_D62C_PAGO_IQ_AUTO_CREATE_QUEUE_HELPERS
function shouldProcessPagoIqCreateQueueH4D62C(pago: Record<string, unknown>): boolean {
  const status = cleanUpper(pago.status);
  const creationStatus = cleanUpper(pago.iqDepositCreationStatus);

  if (status !== "CONCILIACION_PENDIENTE") return false;
  if (creationStatus !== "QUEUED") return false;
  if (isPagoIqAutomationOmittedH4D44(pago)) return false;
  if (isPagoIqTerminalLockedH4D58H(pago)) return false;

  return true;
}

// H4_D87_A58_MANUAL_CREATE_ELIGIBILITY
function shouldProcessPagoIqManualCreateH4D87(
  pago: Record<string, unknown>,
): boolean {
  const status = cleanUpper(pago.status);
  const creationStatus = cleanUpper(
    pago.iqDepositCreationStatus,
  );

  if (status !== "CONCILIACION_PENDIENTE") return false;
  if (isPagoIqTerminalLockedH4D58H(pago)) return false;

  const existingIqId = normalizeIqDepositNumericRefH4D58B(
    pago.iqDepositId ??
    pago.iqDepositFolio ??
    pago.iqPagoDepositId ??
    pago.iqPagoDepositFolio,
  );

  if (existingIqId) return false;

  if (pago.iqDepositCreationRetryBlocked === true) {
    return false;
  }

  const protectedStatuses = new Set([
    "PROCESSING_HTTP",
    "POST_ACKNOWLEDGED_PENDING_IQ_ID",
    "OUTCOME_UNKNOWN",
    "AMBIGUOUS",
    "CLOCK_CONTRADICTION_REVIEW_REQUIRED",
    "CREATED",
    "CREATED_RECOVERED",
    "TERMINAL_CANCELLED",
    "TERMINAL_REJECTED",
  ]);

  if (protectedStatuses.has(creationStatus)) {
    return false;
  }

  return true;
}
// H4_D87_A58_MANUAL_CREATE_ELIGIBILITY_END


// H4_D63A_AUTOMATION_SCOPE_SKIP_HELPERS
function isPagoIqAutomationScopeErrorH4D63A(
  error: unknown,
): boolean {
  const message = cleanText(
    (error as any)?.message ??
    error,
  );

  return message.includes("H4_D63A_AUTOMATION_SCOPE:");
}

// H4_D63A1C_FORWARD_ONLY_SCOPE_SKIP
function logPagoIqAutomationScopeSkipH4D63A1C(input: {
  pagoId: string;
  error: unknown;
  source: string;
}): void {
  const message = cleanText(
    (input.error as any)?.message ??
    input.error,
  ) || "Pago fuera del alcance del despacho IQ.";

  /*
   * No modifica el pago.
   * No hace backfill.
   * No cambia registros historicos.
   * No genera notificacion Telegram.
   */
  console.warn("H4_D63A1C_SCOPE_SKIP", {
    pagoId: input.pagoId,
    source: input.source,
    message,
  });
}
// H4_D63A_AUTOMATION_SCOPE_SKIP_HELPERS_END
async function markPagoIqAutoCreateErrorH4D62C(input: {
  pagoId: string;
  error: unknown;
  source: string;
}) {
  const message = cleanText((input.error as any)?.message ?? input.error) || "Error desconocido.";

  await db.collection("pagos").doc(input.pagoId).set(
    {
      iqDepositCreationStatus: "ERROR_RETRYABLE",
      iqDepositFollowupStatus: "ERROR_RETRYABLE",
      iqDepositAutoCreateLastError: message,
      iqDepositAutoCreateLastErrorAt: FieldValue.serverTimestamp(),
      iqDepositAutoCreateLastErrorSource: input.source,
      iqDepositUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  ).catch(() => undefined);
}

type PagoIqOperationalActorH4D87 = {
  uid: string;
  name: string;
  role: string;
};

async function createPagoIqDepositFromQueueCoreH4D62C(input: {
  auth: AuthContext;
  actor: PagoIqOperationalActorH4D87;
  pagoId: string;
  source: "SCHEDULER" | "TASK";
}) {
  const pagoId = cleanText(input.pagoId);
  const reconcileSource = input.source;
  const pagoRef = db.collection("pagos").doc(pagoId);
  const existingPagoSnap = await pagoRef.get();

  if (!existingPagoSnap.exists) {
    throw new HttpsError("not-found", "Pago PAY0 no encontrado.");
  }

  const existingPago = asRecord(existingPagoSnap.data());
  assertSameRoot(existingPago, input.auth.rootId, "Pago");

  const createEligible =
    input.source === "TASK"
      ? shouldProcessPagoIqManualCreateH4D87(existingPago)
      : shouldProcessPagoIqCreateQueueH4D62C(existingPago);

  if (!createEligible) {
    return {
      ok: true,
      pagoId,
      status: "SKIPPED",
      created: false,
      linked: false,
      message:
        input.source === "TASK"
          ? "Pago no esta listo para creacion IQ manual."
          : "Pago no esta listo para creacion IQ automatica.",
    };
  }

  const existingIqId = cleanText(
    existingPago.iqDepositId ??
    existingPago.iqPagoDepositId ??
    existingPago.iqDepositFolio ??
    existingPago.iqPagoDepositFolio,
  );

  if (existingIqId) {
    const reconciled = await reconcilePagoIqDepositCoreH4D44(input.auth, pagoId, reconcileSource, input.actor);

    return {
      ok: true,
      pagoId,
      status: "ALREADY_LINKED",
      created: false,
      linked: true,
      iqId: existingIqId,
      reconciliation: reconciled,
      message: `Deposito IQ ya vinculado: ${existingIqId}. Solo se reconcilio.`,
    };
  }

  // H4_D85_A51: la creacion automatica no hace pre-reconciliacion por
  // navegador. El core HTTP controlado ya ejecuta recuperacion previa,
  // bloqueo por intento, fingerprint y busqueda temporal exacta antes del POST.
  // La conciliacion posterior permanece separada y sera retirada del browser en A52.

  const ctx = await buildPagoIqDepositContext({
    auth: input.auth,
    pagoId,
    includePassword: true,
    persist: true,
  });

  if (!ctx.ready) {
    throw new HttpsError(
      "failed-precondition",
      ctx.errors.join(" ") ||
        "Prevalidacion IQ incompleta para creacion automatica HTTP.",
    );
  }

  if (!ctx.receiptStoragePath || !ctx.receiptFileName) {
    throw new HttpsError(
      "failed-precondition",
      "El comprobante activo no tiene identidad de Storage completa.",
    );
  }

  const httpResult = await runPagoDepositHttpCreateFlow({
    pagoId: ctx.pagoId,
    actorUid: input.actor.uid,
    source: `CREATE_PAGO_IQ_DEPOSIT_HTTP_${input.source}`,
    pay0CreatedAtIso: pagoCreatedAtIsoH4D85(
      ctx.pago as Record<string, unknown>,
    ),
    apiOrigin:
      cleanText(process.env.PAY0_IQ_API_ORIGIN) ||
      IQ_API_ORIGIN_H4D85,
    credentials: {
      username: ctx.access.username,
      password: ctx.access.password,
    },
    catalogTarget: {
      partnerName: ctx.iqAssociatedName,
      clientName: ctx.iqClientName || "",
      iqClientId: ctx.iqClientId || undefined,
      companyName: ctx.iqCompanyName || "",
      operationTypeName: ctx.operationTypeName || "",
      saleTypeName: ctx.saleTypeName || "Subtotal",
      percentageName: ctx.percentageName || "",
      currencyName: ctx.currencyName || "mxn",
    },
    receipt: {
      storagePath: ctx.receiptStoragePath,
      originalName: ctx.receiptFileName,
      mimeType: "",
    },
    sum: ctx.amount,
    allowHttpPost: true,
  });

  const httpIqId = cleanText(httpResult.iqId);
  const httpCreated =
    httpResult.state === "IQ_ID_LINKED" && Boolean(httpIqId);
  const httpRetryBlocked =
    httpResult.state === "OUTCOME_UNKNOWN" ||
    httpResult.state === "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED" ||
    httpResult.state === "CLOCK_CONTRADICTION_REVIEW_REQUIRED";
  const httpResponseMessage =
    cleanText(httpResult.post.responseMessage);

  // Adaptador de compatibilidad: conserva el contrato interno H4-D62C
  // mientras el transporte real queda unificado en HTTP directo.
  const result = { ctx };
  const item = {
    iqId: httpIqId || null,
    created: httpCreated,
    submitClicked:
      httpResult.post.state !== "POST_REJECTED" ||
      Boolean(httpResult.post.postDispatchedAt),
    outcome: httpResult.state.toLowerCase(),
    responseMessage: httpResponseMessage || null,
    message:
      httpResponseMessage || `Resultado HTTP IQ: ${httpResult.state}`,
    errors: httpCreated
      ? []
      : [httpResponseMessage || `Resultado HTTP IQ: ${httpResult.state}`],
    retryBlocked: httpRetryBlocked,
    transport: "HTTP_DIRECT",
  } as any;
  const iqId = cleanText(item.iqId);
  const created = item.created === true && !!iqId;
  const outcomeUnknown = item.retryBlocked === true && !iqId;
  const status = created
    ? "CREATED"
    : outcomeUnknown
      ? "OUTCOME_UNKNOWN"
      : "FAILED_RETRYABLE";
  const now = FieldValue.serverTimestamp();

  const patch: Record<string, unknown> = {
    iqDepositAutomationMode: input.source === "TASK" ? "MANUAL" : "AUTO",
    iqDepositCreateSource: input.source,
    iqDepositCreateFinishedAt: now,

    iqDepositCreationStatus: status,
    iqDepositCreationVersion: IQ_PAGO_DEPOSIT_CREATION_VERSION,
    iqDepositCreationFinishedAt: now,
    iqDepositCreationFinishedBy: input.actor.uid,
    iqDepositCreationOutcome: item.outcome || null,
    iqDepositCreationResponseMessage: item.responseMessage || item.message || null,
    iqDepositCreationSubmitClicked: item.submitClicked === true,
    iqDepositCreationLastError: created ? null : item.message || (item.errors || []).join(" ") || null,
    iqDepositCreationRetryBlocked: outcomeUnknown,
    iqDepositFollowupStatus: created ? "CREATED" : outcomeUnknown ? "OUTCOME_UNKNOWN" : "ERROR_RETRYABLE",
    iqDepositUpdatedAt: now,
    updatedAt: now,
  };

  if (created) {
    patch.iqDepositId = iqId;
    patch.iqDepositFolio = iqId;
    patch.iqPagoDepositId = iqId;
    patch.iqPagoDepositFolio = iqId;
    patch.iqDepositCreatedAt = now;
    patch.iqDepositCreatedBy = input.actor.uid;
    patch.iqDepositStatus = "CREATED";
    patch.iqDepositReconciliationStatus = "PENDING";
  }

  await result.ctx.pagoRef.set(patch, { merge: true });

  if (created) {
    await result.ctx.pagoRef.collection("notas").add({
      rootId: input.auth.rootId,
      text: input.source === "SCHEDULER" ? `Deposito IQ creado automaticamente y vinculado: ${iqId}` : `Deposito IQ creado manualmente y vinculado: ${iqId}`,
      createdBy: input.actor.uid,
      createdByName: input.actor.name,
      createdByRole: input.actor.role,
      createdAt: FieldValue.serverTimestamp(),
      system: input.source === "SCHEDULER",
    }).catch(() => undefined);

    await notifyIqPagoTelegramH4D59B({
      botToken: TELEGRAM_BOT_TOKEN.value(),
      auth: input.auth,
      event: "IQ_PAGO_CREADO",
      pagoId,
      pago: result.ctx.pago as Record<string, unknown>,
      iqId,
      source: `H4_D62C_CREATE_${input.source}`,
      message: input.source === "SCHEDULER" ? `Deposito IQ creado automaticamente y vinculado: ${iqId}` : `Deposito IQ creado manualmente y vinculado: ${iqId}`,
    }).catch(() => undefined);

    const reconciled = await reconcilePagoIqDepositCoreH4D44(input.auth, pagoId, reconcileSource, input.actor).catch((error: any) => ({
      status: "RECONCILE_AFTER_CREATE_ERROR",
      linked: true,
      conciliated: false,
      iqId,
      reconciliationStatus: "ERROR",
      operationStatus: "",
      message: cleanText(error?.message ?? error),
    }));

    return {
      ok: true,
      pagoId,
      status: "CREATED",
      created: true,
      linked: true,
      iqId,
      reconciliation: reconciled,
      message: input.source === "SCHEDULER" ? `Deposito IQ creado automaticamente: ${iqId}.` : `Deposito IQ creado manualmente: ${iqId}.`,
    };
  }

  if (!created && outcomeUnknown) {
    const recoveredH4D62C = await reconcilePagoIqDepositCoreH4D44(input.auth, pagoId, reconcileSource, input.actor).catch((error: any) => ({
      status: "RECOVERY_ERROR",
      linked: false,
      conciliated: false,
      iqId: null,
      reconciliationStatus: "ERROR",
      operationStatus: "",
      message: cleanText(error?.message ?? error),
    }));

    const recoveredIqIdH4D62C = cleanText(
      (recoveredH4D62C as any)?.iqId ||
      (recoveredH4D62C as any)?.data?.iqId ||
      (recoveredH4D62C as any)?.iqDepositId ||
      "",
    );

    if ((recoveredH4D62C as any)?.linked === true && recoveredIqIdH4D62C) {
      await pagoRef.set(
        {
          iqDepositCreationStatus: "CREATED_RECOVERED",
          iqDepositCreationRecoveredAt: FieldValue.serverTimestamp(),
          iqDepositCreationRecoveredBy: input.actor.uid,
          iqDepositCreationRecoveredSource: `H4_D62C_RECOVER_${input.source}`,
          iqDepositCreationLastError: null,
          iqDepositFollowupStatus: "LINKED",
          iqDepositId: recoveredIqIdH4D62C,
          iqDepositFolio: recoveredIqIdH4D62C,
          iqPagoDepositId: recoveredIqIdH4D62C,
          iqPagoDepositFolio: recoveredIqIdH4D62C,
          iqDepositUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      await pagoRef.collection("notas").add({
        rootId: input.auth.rootId,
        text: input.source === "SCHEDULER" ? `Folio IQ recuperado automaticamente despues de resultado incierto: ${recoveredIqIdH4D62C}` : `Folio IQ recuperado manualmente despues de resultado incierto: ${recoveredIqIdH4D62C}`,
        createdBy: input.actor.uid,
        createdByName: input.actor.name,
        createdByRole: input.actor.role,
        createdAt: FieldValue.serverTimestamp(),
        system: input.source === "SCHEDULER",
      }).catch(() => undefined);

      return {
        ok: true,
        pagoId,
        status: "CREATED_RECOVERED",
        created: true,
        linked: true,
        recovered: true,
        iqId: recoveredIqIdH4D62C,
        reconciliation: recoveredH4D62C,
        message: input.source === "SCHEDULER" ? `Deposito IQ creado y folio recuperado automaticamente: ${recoveredIqIdH4D62C}.` : `Deposito IQ creado y folio recuperado manualmente: ${recoveredIqIdH4D62C}.`,
      };
    }
  }

  return {
    ok: true,
    pagoId,
    status,
    created,
    linked: false,
    iqId: iqId || null,
    submitClicked: item.submitClicked === true,
    retryBlocked: outcomeUnknown,
    message: item.message || (created ? "Deposito IQ creado." : "IQ no confirmo el deposito."),
    errors: item.errors || [],
  };
}
// H4_D62C_PAGO_IQ_AUTO_CREATE_QUEUE_HELPERS_END
type IqDepositNormalizedMatchH4D45 = {
  iqId: string | null;
  operationStatus: string;
  reconciliationStatus: string;
  debugText: string;
};

// IQ2G_H4_D45B_NORMALIZE_DEPOSIT_MATCH_COLUMNS
// IQ2G_H4_D49B_NO_OLD_IQ_ID_FALLBACK
// IQ2G_H4_D48H_NO_OLD_IQ_ID_FALLBACK
// IQ2G_H4_D47A_NO_EXISTING_IQ_ID_FALLBACK
// IQ2G_H4_D46C_FALSE_POSITIVE_MIN_GUARD
function normalizeIqDepositMatchColumnsH4D45(
  match: unknown,
  rawOperationStatus: string,
  rawReconciliationStatus: string,
): IqDepositNormalizedMatchH4D45 {
  const record = asRecord(match);

  let jsonText = "";
  try {
    jsonText = JSON.stringify(record);
  } catch {
    jsonText = "";
  }

  const textParts = [
    record.rowText,
    record.rawText,
    record.text,
    record.fullText,
    record.tableRowText,
    record.debugText,
    record.lineText,
    record.htmlText,
    jsonText,
  ]
    .map((value) => cleanText(value))
    .filter(Boolean);

  const debugText = textParts.join(" | ");
  const upper = cleanUpper(debugText);
  const rawOpUpper = cleanUpper(rawOperationStatus);
  const rawRecUpper = cleanUpper(rawReconciliationStatus);

  const looksLikeDate =
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(rawOperationStatus) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(rawOperationStatus) ||
    /\b\d{1,2}:\d{2}\b/.test(rawOperationStatus);

  const looksLikeSaleType =
    /^(SUBTOTAL|TOTAL|PUE|PPD|MXN|USD)$/i.test(rawReconciliationStatus) ||
    /TIPO\s+DE\s+VENTA|SUBTOTAL/.test(rawRecUpper);

  const rawRecLooksValid =
    /SIN\s*CONCILIAR|CONCILIAD|RECHAZAD|CANCELAD|PENDIENTE/.test(rawRecUpper);

  let operationStatus = rawOperationStatus;
  let reconciliationStatus = rawReconciliationStatus;

  if (/PENDIENTE\s*CANCELACI/.test(upper)) {
    operationStatus = "Pendiente Cancelacion";
  } else if (/EN\s*OPERACI/.test(upper)) {
    operationStatus = "En Operacion";
  } else if (/CANCELAD/.test(upper) && !/CONCILIAD/.test(upper)) {
    operationStatus = "Cancelado";
  } else if (looksLikeDate) {
    operationStatus = "";
  }

  if (/SIN\s*CONCILIAR/.test(upper)) {
    reconciliationStatus = "Sin Conciliar";
  } else if (/RECHAZAD/.test(upper)) {
    reconciliationStatus = "Rechazado";
  } else if (/CONCILIAD/.test(upper)) {
    reconciliationStatus = "Conciliado";
  } else if (!rawRecLooksValid || looksLikeSaleType || looksLikeDate) {
    reconciliationStatus = "";
  }

  const rawIqId = cleanText(
    record.iqId ??
    record.id ??
    record.depositId ??
    record.folio ??
    record.depositFolio,
  );

  let iqId: string | null = /^\d{6,}$/.test(rawIqId) ? rawIqId : null;

  if (!iqId) {
    const idMatch = debugText.match(/\b([1-9]\d{5,8})\b/);
    if (idMatch) {
      iqId = idMatch[1];
    }
  }

  return {
    iqId,
    operationStatus,
    reconciliationStatus,
    debugText,
  };
}


function compactIqHistoricalKeyH4D58E(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, "")
    .toUpperCase();
}

function centsH4D58E(value: unknown): number {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function dateMsH4D58E(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as any).toDate === "function") return (value as any).toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const ms = Date.parse(cleanText(value));
  return Number.isFinite(ms) ? ms : 0;
}

const IQ_MANUAL_ADOPTION_LOOKBACK_DAYS_H4D58F = 3;

function shiftDayKeyH4D58F(dayKey: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return "";
  const ms = Date.parse(`${dayKey}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + deltaDays * 86400000).toISOString().slice(0, 10);
}
function dayKeyH4D58E(value: unknown): string {
  const ms = dateMsH4D58E(value);
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function dayKeyFromHistoricalRowH4D58E(row: Record<string, unknown>): string {
  const explicit = cleanText(row.createdDay);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  const ms = Number(row.createdAtMs || 0);
  if (Number.isFinite(ms) && ms > 0) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  return dayKeyH4D58E(row.createdAtIso);
}
function isIqHistoricalRejectedH4D58E(row: Record<string, unknown>): boolean {
  const text = `${cleanText(row.operationStatus)} ${cleanText(row.reconciliationStatus)} ${cleanText(row.operationStatusKey)} ${cleanText(row.reconciliationStatusKey)}`;
  const key = compactIqHistoricalKeyH4D58E(text);
  return row.isRejected === true || row.isCancelled === true || key.includes("RECHAZ") || key.includes("REJECT") || key.includes("CANCEL");
}

function isIqHistoricalConciliatedH4D58E(row: Record<string, unknown>): boolean {
  const text = `${cleanText(row.operationStatus)} ${cleanText(row.reconciliationStatus)} ${cleanText(row.operationStatusKey)} ${cleanText(row.reconciliationStatusKey)}`;
  const key = compactIqHistoricalKeyH4D58E(text);
  return row.isConciliated === true || key.includes("CONCILIAD") || key.includes("CONCILIATED");
}

async function resolvePagoIqDepositHistoricalH4D58E(
  ctx: any,
  auth: AuthContext,
  source: "MANUAL_BATCH" | "SCHEDULER" | "TASK",
  actor: PagoIqOperationalActorH4D87,
): Promise<PagoIqAutoReconcileResult | null> {
  const amountCents = centsH4D58E(ctx.amount);

  if (!amountCents) {
    return null;
  }

  const clientKey = compactIqHistoricalKeyH4D58E(ctx.iqClientName || ctx.pago?.clienteNombre || ctx.pago?.clientName);
  const companyKey = compactIqHistoricalKeyH4D58E(ctx.iqCompanyName || ctx.pago?.empresaNombre || ctx.pago?.companyName);
  const pay0CreatedMs = dateMsH4D58E(ctx.pago?.createdAt || ctx.targetDateIso);
  const pay0CreatedDay = dayKeyH4D58E(ctx.pago?.createdAt || ctx.targetDateIso);
  const manualAdoptionMinDayH4D58F = shiftDayKeyH4D58F(pay0CreatedDay, -IQ_MANUAL_ADOPTION_LOOKBACK_DAYS_H4D58F);

  if (!clientKey || !companyKey || !pay0CreatedDay || !manualAdoptionMinDayH4D58F) {
    return null;
  }

  const snap = await db
    .collection("iqHistoricalDeposits")
    .where("amountCents", "==", amountCents)
    .limit(100)
    .get();

  const candidates = snap.docs
    .map((doc): Record<string, unknown> => ({ id: doc.id, ...asRecord(doc.data()) }))
    .filter((row) => {
      const rowClientKey = compactIqHistoricalKeyH4D58E(row.clientKey || row.clientName);
      const rowCompanyKey = compactIqHistoricalKeyH4D58E(row.companyKey || row.companyName);
      const rowCreatedDay = dayKeyFromHistoricalRowH4D58E(row);

      return rowClientKey === clientKey &&
        rowCompanyKey === companyKey &&
        rowCreatedDay >= manualAdoptionMinDayH4D58F;
    })
    .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));

  if (!candidates.length) {
    return null;
  }

  const rejected = candidates.find((row) => isIqHistoricalRejectedH4D58E(row));
  const conciliated = candidates.find((row) => isIqHistoricalConciliatedH4D58E(row));
  const selected = rejected || conciliated || candidates[0];

  const iqDepositId = normalizeIqDepositNumericRefH4D58B(selected.iqDepositId);
  if (!iqDepositId) {
    return null;
  }

  const now = FieldValue.serverTimestamp();
  const operationStatus = cleanText(selected.operationStatus);
  const reconciliationStatus = cleanText(selected.reconciliationStatus);
  const currentPagoStatus = cleanUpper(ctx.pago?.status);
  const selectedTerminal = isIqHistoricalRejectedH4D58E(selected);
  const selectedTerminalOutcomeH4D64A6 = selectedTerminal
    ? getPagoIqTerminalOutcomeH4D64A6(`${operationStatus || ""} ${reconciliationStatus || ""}`) || "REJECTED"
    : null;
  const selectedCancelled = selectedTerminalOutcomeH4D64A6 === "CANCELLED";
  const selectedConciliated = !selectedTerminal && isIqHistoricalConciliatedH4D58E(selected);

  const patch: Record<string, unknown> = {
    iqDepositId,
    iqDepositFolio: iqDepositId,
    iqPagoDepositId: iqDepositId,
    iqPagoDepositFolio: iqDepositId,
    iqDepositOperationStatus: operationStatus || null,
    iqDepositReconciliationStatus: selectedTerminalOutcomeH4D64A6 || (selectedConciliated ? "CONCILIATED" : (reconciliationStatus || "LINKED")),
    iqDepositStatus: selectedTerminalOutcomeH4D64A6 || (selectedConciliated ? "CONCILIATED" : "LINKED"),
    iqDepositReconciliationMatchStrategy: selectedTerminalOutcomeH4D64A6 ? `MANUAL_IQ_VALID_${selectedTerminalOutcomeH4D64A6}` : selectedConciliated ? "MANUAL_IQ_VALID_CONCILIATED" : "MANUAL_IQ_VALID_LINKED",
    iqDepositReconciliationIdSourceH4D58C: "HISTORICAL_NUMERIC",
    iqDepositLinkSource: "MANUAL_IQ_ADOPTED",
    iqDepositCreatedByPay0: false,
    iqDepositHistoricalResolution: true,
    iqDepositManualAdoptedAt: now,
    iqDepositManualAdoptionLookbackDays: IQ_MANUAL_ADOPTION_LOOKBACK_DAYS_H4D58F,
    iqDepositManualAdoptionMinDay: manualAdoptionMinDayH4D58F,
    iqDepositManualAdoptionPay0Day: pay0CreatedDay,
    iqDepositHistoricalSnapshotId: cleanText(selected.snapshotId),
    iqDepositHistoricalMatchedAt: now,
    iqDepositHistoricalMatchedSource: source,
    iqDepositHistoricalCreatedAtIso: cleanText(selected.createdAtIso),
    iqDepositHistoricalAmount: Number(selected.amount || 0),
    iqDepositHistoricalClientName: cleanText(selected.clientName),
    iqDepositHistoricalCompanyName: cleanText(selected.companyName),
    iqDepositReconciliationLastError: null,
    iqDepositUpdatedAt: now,
  };

  let pay0StatusUpdated = false;
  let resultStatus = "LINKED";
  let message = "Registro IQ adoptado localizado; aun no aparece conciliado.";

  if (selectedTerminalOutcomeH4D64A6) {
    Object.assign(
      patch,
      buildPagoIqTerminalLockPatchH4D58H({
        pago: ctx.pago as Record<string, unknown>,
        iqId: iqDepositId,
        operationStatus,
        reconciliationStatus: reconciliationStatus || (selectedCancelled ? "Cancelado" : "Rechazado"),
        authUid: actor.uid,
        source: "HISTORICAL_TERMINAL_H4_D64_A6",
      }),
    );
    // H4_D64_A6_HISTORICAL_TERMINAL_LOCK_AND_CLOSE
    pay0StatusUpdated = currentPagoStatus !== (selectedCancelled ? "CANCELADO" : "RECHAZADO");
    resultStatus = selectedTerminalOutcomeH4D64A6;
    message = selectedCancelled
      ? "Registro IQ adoptado cancelado; pago PAY0 actualizado y tareas cerradas."
      : "Registro IQ adoptado rechazado; pago PAY0 actualizado y tareas cerradas.";
  } else if (selectedConciliated) {
    patch.status = "CONCILIADO";
    patch.conciliatedAt = now;
    patch.conciliatedBy = actor.uid;
    patch.conciliationNote = (source === "SCHEDULER" ? `Conciliado automaticamente por adopcion de registro IQ ${iqDepositId}` : `Conciliado manualmente por adopcion de registro IQ ${iqDepositId}`).trim();
    Object.assign(patch, buildPagoFoundationOnConciliation(ctx.pago));
    pay0StatusUpdated = currentPagoStatus === "CONCILIACION_PENDIENTE";
    resultStatus = "CONCILIATED";
    message = "Registro IQ adoptado conciliado; pago PAY0 actualizado.";
  }

  await ctx.pagoRef.set(patch, { merge: true });

  const financialPostingH4D65A0 = selectedConciliated
    ? await postPagoFinancialsAfterIqConciliationH4D65A0({
        auth,
        actor,
        pagoId: ctx.pagoId,
        pagoRef: ctx.pagoRef,
        source: `HISTORICAL_IQ_RECONCILE_${source}`,
      })
    : null;
  // H4_D65_A0_HISTORICAL_RECONCILE_POSTS_FINANCIALS

  await ctx.pagoRef.collection("notas").add({
    rootId: auth.rootId,
    text: selectedTerminalOutcomeH4D64A6
      ? `Pago ${selectedCancelled ? "cancelado" : "rechazado"} ${source === "SCHEDULER" ? "automaticamente" : "manualmente"} por adopcion de registro IQ ${iqDepositId}: ${patch.iqDepositTerminalReason || ""}`.trim()
      : `Pago actualizado ${source === "SCHEDULER" ? "automaticamente" : "manualmente"} por adopcion de registro IQ ${iqDepositId}`.trim(),
    createdBy: actor.uid,
    createdByName: actor.name,
    createdByRole: actor.role,
    createdAt: FieldValue.serverTimestamp(),
    source: "IQ_DEPOSIT_HISTORICAL_RESOLUTION_H4_D64_A6",
  }).catch(() => undefined);

  if (selectedTerminalOutcomeH4D64A6) {
    await notifyIqPagoTelegramH4D59B({
      botToken: TELEGRAM_BOT_TOKEN.value(),
      auth,
      event: selectedCancelled ? "IQ_PAGO_CANCELADO" : "IQ_PAGO_RECHAZADO",
      pagoId: ctx.pagoId,
      pago: ctx.pago as Record<string, unknown>,
      iqId: iqDepositId,
      source: "HISTORICAL_TERMINAL_H4_D64_A6",
      dedupeKey: `${selectedTerminalOutcomeH4D64A6.toLowerCase()}-${iqDepositId}`,
      message,
    }).catch(() => undefined);
  }

  return {
    pagoId: ctx.pagoId,
    status: resultStatus,
    linked: true,
    conciliated: selectedConciliated,
    pay0StatusUpdated,
    iqId: iqDepositId,
    operationStatus,
    reconciliationStatus: selectedTerminalOutcomeH4D64A6 || (selectedConciliated ? "CONCILIATED" : (reconciliationStatus || "LINKED")),
    financialPostingAttempted: financialPostingH4D65A0?.attempted || false,
    financialPostingOk: financialPostingH4D65A0?.ok || false,
    financialPostingStatus: financialPostingH4D65A0?.status || null,
    financialSnapshotId: financialPostingH4D65A0?.snapshotId || null,
    financialPostingError: financialPostingH4D65A0?.errorMessage || null,
    message: [message, financialPostingMessageH4D65A0(financialPostingH4D65A0)].filter(Boolean).join(" "),
  };
}
function buildOutcomeUnknownRecoveredPatchH4D58G5(
  pago: Record<string, unknown>,
  source: string,
): Record<string, unknown> {
  const creationStatus = cleanText(pago.iqDepositCreationStatus);
  if (creationStatus !== "OUTCOME_UNKNOWN") {
    return {};
  }

  return {
    iqDepositCreationStatus: "CREATED_RECOVERED",
    iqDepositCreationRecoveredAt: FieldValue.serverTimestamp(),
    iqDepositCreationRecoveredSource: source,
    iqDepositCreationLastError: null,
  };
}
function isIqDepositTerminalTextH4D58H(value: unknown): boolean {
  const upper = cleanUpper(value);
  return /RECHAZ|REJECT|CANCEL/.test(upper);
}

function isPagoIqTerminalLockedH4D58H(pago: Record<string, unknown>): boolean {
  if (pago.iqDepositTerminalLocked === true) return true;

  const statusText = [
    pago.iqDepositStatus,
    pago.iqDepositReconciliationStatus,
    pago.iqDepositOperationStatus,
    pago.iqDepositTerminalStatus,
  ].map((value) => cleanText(value)).join(" ");

  return isIqDepositTerminalTextH4D58H(statusText);
}

export function getPagoIqTerminalOutcomeH4D64A6(value: unknown): "REJECTED" | "CANCELLED" | null {
  const upper = cleanUpper(value);
  if (/CANCEL/.test(upper)) return "CANCELLED";
  if (/RECHAZ|REJECT/.test(upper)) return "REJECTED";
  return null;
}

export function buildPagoIqTerminalLockPatchH4D58H(input: {
  pago: Record<string, unknown>;
  iqId: string | null;
  operationStatus: string;
  reconciliationStatus: string;
  authUid: string;
  source: string;
}): Record<string, unknown> {
  const terminalText = `${input.operationStatus || ""} ${input.reconciliationStatus || ""}`;
  const terminalStatus = getPagoIqTerminalOutcomeH4D64A6(terminalText) || "REJECTED";
  const pay0Status = terminalStatus === "CANCELLED" ? "CANCELADO" : "RECHAZADO";
  const reason = cleanText(input.reconciliationStatus || input.operationStatus) ||
    (terminalStatus === "CANCELLED" ? "Deposito cancelado en IQ." : "Deposito rechazado en IQ.");
  const terminalGeneration = [
    "terminal",
    input.iqId || "sin-folio",
    terminalStatus.toLowerCase(),
  ].join("-");
  const previousQueuedUploadId = cleanText(input.pago.iqDepositCreationQueuedUploadId);
  const previousTaskId = cleanText(input.pago.iqDepositOnDemandTaskId);

  return {
    status: pay0Status,
    iqDepositStatus: terminalStatus,
    iqDepositReconciliationStatus: terminalStatus,
    iqDepositTerminalLocked: true,
    iqDepositTerminalStatus: terminalStatus,
    iqDepositTerminalLockedAt: FieldValue.serverTimestamp(),
    iqDepositTerminalLockedBy: input.authUid,
    iqDepositTerminalLockedSource: input.source,
    iqDepositTerminalLockedIqId: input.iqId || null,
    iqDepositTerminalReason: reason,
    iqDepositTerminalUnlockRequiredDocumentType: "COMPROBANTE_PAGO",

    iqDepositAutomationOmitted: true,
    iqDepositFollowupStatus: "COMPLETED_TERMINAL",
    iqDepositReconciliationLastError: null,
    iqDepositReconciliationNextCheckAt: null,

    iqDepositCreationStatus:
      terminalStatus === "CANCELLED" ? "TERMINAL_CANCELLED" : "TERMINAL_REJECTED",
    iqDepositCreationRetryBlocked: true,
    iqDepositCreationLastError: reason,
    iqDepositTerminalPreviousQueuedUploadId: previousQueuedUploadId || null,
    iqDepositCreationQueuedUploadId: FieldValue.delete(),

    iqDepositOnDemandStatus: "COMPLETED_TERMINAL",
    iqDepositOnDemandGeneration: terminalGeneration,
    iqDepositOnDemandNextAttemptAt: null,
    iqDepositOnDemandCompletedAt: FieldValue.serverTimestamp(),
    iqDepositOnDemandLastMessage: reason,
    iqDepositTerminalPreviousOnDemandTaskId: previousTaskId || null,
    iqDepositOnDemandTaskId: FieldValue.delete(),

    iqDepositUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),

    ...(terminalStatus === "CANCELLED"
      ? {
          cancellationReason: reason,
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: input.authUid,
        }
      : {
          iqDepositRejectedAt: FieldValue.serverTimestamp(),
          iqDepositRejectionReason: reason,
          rejectionReason: reason,
          rejectedAt: FieldValue.serverTimestamp(),
          rejectedBy: input.authUid,
        }),
  };
}
// H4_D58H_B1_TERMINAL_LOCK_HELPERS
function normalizeIqDepositNumericRefH4D58B(value: unknown): string {
  const text = cleanText(value);

  if (!text) {
    return "";
  }

  if (/^\d{5,9}$/.test(text)) {
    return text;
  }

  const match = text.match(/\b([1-9]\d{4,8})\b/);
  return match ? match[1] : "";
}
type PagoIqAutoReconcileResult = {
  pagoId: string;
  status: string;
  linked: boolean;
  conciliated: boolean;
  pay0StatusUpdated: boolean;
  iqId: string | null;
  operationStatus: string;
  reconciliationStatus: string;
  financialPostingAttempted?: boolean;
  financialPostingOk?: boolean;
  financialPostingStatus?: string | null;
  financialSnapshotId?: string | null;
  financialPostingError?: string | null;
  message: string;
};

// IQ2G_H4_D44A_PAGO_IQ_AUTO_RECONCILE_CORE
function isPagoIqAutomationOmittedH4D44(pago: Record<string, unknown>): boolean {
  return pago.iqDepositOmitted === true ||
    pago.iqDepositAutomationOmitted === true ||
    cleanUpper(pago.iqDepositStatus) === "OMITTED" ||
    cleanUpper(pago.iqDepositSyncStatus) === "OMITTED" ||
    cleanUpper(pago.iqDepositUploadStatus) === "OMITTED" ||
    cleanUpper(pago.iqDepositFollowupStatus) === "OMITTED" ||
    cleanUpper(pago.iqDepositReconciliationStatus) === "OMITTED";
}

function shouldTryPagoIqAutoReconcileH4D44(pago: Record<string, unknown>): boolean {
  const status = cleanUpper(pago.status);

  if (status !== "CONCILIACION_PENDIENTE") return false;
  if (isPagoIqAutomationOmittedH4D44(pago)) return false;
  if (isPagoIqTerminalLockedH4D58H(pago)) return false; // H4_D58H_B1_SKIP_TERMINAL_AUTO_RECONCILE

  const iqId = normalizeIqDepositNumericRefH4D58B(
    pago.iqDepositId ??
    pago.iqDepositFolio ??
    pago.iqPagoDepositId ??
    pago.iqPagoDepositFolio,
  );

  const creationStatus = cleanUpper(pago.iqDepositCreationStatus);
  const retryBlocked = pago.iqDepositCreationRetryBlocked === true;

  return Boolean(iqId) ||
    creationStatus === "CREATED" ||
    creationStatus === "OUTCOME_UNKNOWN" ||
    retryBlocked;
}

async function buildPagoIqSystemAuthH4D44(pago: Record<string, unknown>): Promise<AuthContext> {
  // H4_D63A_REAL_AUTOMATION_AUTH
  const rootId = cleanText(pago.rootId);

  /*
   * Nunca usar rootId como sustituto del usuario creador.
   * Ese fallback hacia que pagos de otros despachos usaran
   * la cuenta IQ del superadmin/root.
   */
  const uid = cleanText(
    pago.createdBy ??
    pago.adminId ??
    pago.userId ??
    pago.usuarioId ??
    pago.createdByUid ??
    pago.requestedBy,
  );

  const despachoId = cleanText(
    pago.despachoId ??
    pago.firmId ??
    pago.dispatchId,
  );

  if (!rootId) {
    throw new HttpsError(
      "failed-precondition",
      "H4_D63A_AUTOMATION_SCOPE: Pago sin rootId.",
    );
  }

  if (!uid) {
    throw new HttpsError(
      "failed-precondition",
      "H4_D63A_AUTOMATION_SCOPE: Pago sin usuario creador real; no se permite usar el root como reemplazo.",
    );
  }

  if (!despachoId) {
    throw new HttpsError(
      "failed-precondition",
      "H4_D63A_AUTOMATION_SCOPE: Pago sin despacho.",
    );
  }

  let user: Record<string, unknown> = {};
  let userFound = false;

  for (const collectionName of ["users", "usuarios"]) {
    const snap = await db
      .collection(collectionName)
      .doc(uid)
      .get()
      .catch(() => null);

    if (snap?.exists) {
      user = asRecord(snap.data());
      userFound = true;
      break;
    }
  }

  if (!userFound) {
    throw new HttpsError(
      "failed-precondition",
      "H4_D63A_AUTOMATION_SCOPE: El usuario creador del pago no existe.",
    );
  }

  const userRootId = cleanText(
    user.rootId ??
    rootId,
  );

  if (userRootId && userRootId !== rootId) {
    throw new HttpsError(
      "permission-denied",
      "H4_D63A_AUTOMATION_SCOPE: El usuario creador no pertenece al root del pago.",
    );
  }

  const role = cleanText(
    user.role ??
    user.userRole,
  ).toLowerCase();

  if (!role) {
    throw new HttpsError(
      "failed-precondition",
      "H4_D63A_AUTOMATION_SCOPE: El usuario creador no tiene rol.",
    );
  }

  const explicitDespachoAccess =
    await verifyPagoIqAutomaticDespachoAccessH4D63A(
      uid,
      despachoId,
    );

  if (!explicitDespachoAccess) {
    throw new HttpsError(
      "permission-denied",
      "H4_D63A_AUTOMATION_SCOPE: El usuario creador no tiene acceso explicito al despacho del pago.",
    );
  }

  return {
    uid,
    role,
    rootId,
    user: {
      ...user,
      uid,
      role,
      username: cleanText(
        user.username ??
        user.name ??
        uid,
      ),
      name: cleanText(
        user.name ??
        user.username ??
        uid,
      ),
    },
  };
}
// H4_D63A_REAL_AUTOMATION_AUTH_END

async function reconcilePagoIqDepositCoreH4D44(
  auth: AuthContext,
  pagoId: string,
  source: "MANUAL_BATCH" | "SCHEDULER" | "TASK",
  actor: PagoIqOperationalActorH4D87,
): Promise<PagoIqAutoReconcileResult> {
  const ctx = await buildPagoIqDepositContext({
    auth,
    pagoId,
    includePassword: true,
    persist: true,
  });

  if (isPagoIqAutomationOmittedH4D44(ctx.pago)) {
    return {
      pagoId,
      status: "OMITTED",
      linked: false,
      conciliated: false,
      pay0StatusUpdated: false,
      iqId: null,
      operationStatus: "",
      reconciliationStatus: "OMITTED",
      message: "Seguimiento IQ de deposito omitido.",
    };
  }

  const existingIqId = normalizeIqDepositNumericRefH4D58B(
    ctx.pago.iqDepositId ??
    ctx.pago.iqDepositFolio ??
    ctx.pago.iqPagoDepositId ??
    ctx.pago.iqPagoDepositFolio,
  );

  const lookup = await runPagoDepositHttpFindByRefsA52({
    apiOrigin: cleanText(process.env.PAY0_IQ_API_ORIGIN) || IQ_API_ORIGIN_H4D85,
    username: ctx.access.username,
    password: ctx.access.password,
    items: [
      {
        key: ctx.pagoId,
        iqId: existingIqId || undefined, // IQ2G_H4_D58B_USE_STORED_IQ_ID_ON_RECONCILE
        marker: ctx.marker,
        clientName: ctx.iqClientName || "",
        companyName: ctx.iqCompanyName || "",
        expectedAmount: ctx.amount,
        targetDateIso: ctx.targetDateIso || undefined,
      },
    ],
    maxPages: 5,
    refreshDelaysMs: [0, 2500, 10000],
  });

  let match: any = lookup.matches.find((row) => row.key === ctx.pagoId) || lookup.matches[0];
  const now = FieldValue.serverTimestamp();

  if (!match || match.found !== true) {
    // H4_D61B25A_MIN_BACKEND_AUTO_ADOPT
    // Metodo validado en diagnostico: /deposits exacto + sort fecha reciente B23 + filtro anti-reuso B24.
    // Solo auto-adopta si queda exactamente 1 candidato libre.
    const candidateLookupH4D61B25A = await runPagoDepositHttpFindCandidatesA52({
      apiOrigin: cleanText(process.env.PAY0_IQ_API_ORIGIN) || IQ_API_ORIGIN_H4D85,
      username: ctx.access.username,
      password: ctx.access.password,
      item: {
        key: ctx.pagoId,
        iqId: existingIqId || undefined,
        marker: ctx.marker,
        clientName: ctx.iqClientName || "",
        companyName: ctx.iqCompanyName || "",
        expectedAmount: ctx.amount,
        targetDateIso: ctx.targetDateIso || undefined,
      },
      maxRows: 80,
      limit: 8,
    }).catch((error) => ({
      candidates: [] as Array<Record<string, unknown>>,
      errors: [`H4_D61B25A_CANDIDATE_LOOKUP_ERROR:${cleanText((error as any)?.message ?? error)}`],
      rowsFetched: 0,
      pagesFetched: 0,
      finalPath: "",
    }));

    await applyUsedPagoIqDepositCandidateFilterH4D61B24({
      ctx,
      lookup: candidateLookupH4D61B25A as {
        candidates?: Array<Record<string, unknown>>;
        errors?: string[];
      },
    }).catch((error) => {
      candidateLookupH4D61B25A.errors.unshift(`H4_D61B25A_USED_FILTER_ERROR:${cleanText((error as any)?.message ?? error)}`.slice(0, 1000));
    });

    const freeCandidatesH4D61B25A = Array.isArray(candidateLookupH4D61B25A.candidates)
      ? candidateLookupH4D61B25A.candidates
      : [];

    if (freeCandidatesH4D61B25A.length === 1) {
      const candidateH4D61B25A = freeCandidatesH4D61B25A[0] as Record<string, unknown>;
      const candidateIqIdH4D61B25A = normalizeIqDepositNumericRefH4D58B(candidateH4D61B25A.iqId);

      match = {
        ...candidateH4D61B25A,
        key: ctx.pagoId,
        found: true,
        iqId: candidateIqIdH4D61B25A,
        operationStatus: cleanText(candidateH4D61B25A.operationStatus),
        reconciliationStatus: cleanText(candidateH4D61B25A.reconciliationStatus),
        rowText: cleanText(candidateH4D61B25A.rowText ?? candidateH4D61B25A.debugText ?? JSON.stringify(candidateH4D61B25A)),
        matchStrategy: `AUTO_CANDIDATE_FREE_H4_D61B25A ${cleanText(candidateH4D61B25A.matchStrategy)}`.trim(),
      };
    } else {
      const historicalResolutionH4D58E = await resolvePagoIqDepositHistoricalH4D58E(ctx, auth, source, actor);
      if (historicalResolutionH4D58E) {
        return historicalResolutionH4D58E;
      }

      const freeIdsH4D61B25A = freeCandidatesH4D61B25A
        .map((candidate) => normalizeIqDepositNumericRefH4D58B((candidate as Record<string, unknown>).iqId))
        .filter(Boolean)
        .slice(0, 8);

      const notFoundReasonH4D61B25A = freeCandidatesH4D61B25A.length > 1
        ? `H4_D61B25A_AMBIGUOUS_FREE_CANDIDATES:${freeIdsH4D61B25A.join("|")}`
        : `H4_D61B25A_NOT_FOUND_AFTER_USED_FILTER:${(candidateLookupH4D61B25A.errors || []).slice(0, 3).join(" ")}`;

      await ctx.pagoRef.set(
        {
          iqDepositStatus: freeCandidatesH4D61B25A.length > 1 ? "AMBIGUOUS" : "NOT_FOUND",
          iqDepositReconciliationStatus: freeCandidatesH4D61B25A.length > 1 ? "AMBIGUOUS" : "NOT_FOUND",
          iqDepositReconciliationLastError: notFoundReasonH4D61B25A.slice(0, 1000),
          iqDepositReconciliationVersion: IQ_PAGO_DEPOSIT_RECONCILIATION_VERSION,
          iqDepositReconcileSource: source,
          iqDepositAutomationMode: source === "SCHEDULER" ? "AUTO" : "MANUAL",
          iqDepositUpdatedAt: now,
        },
        { merge: true },
      );

      return {
        pagoId,
        status: "NOT_FOUND",
        linked: false,
        conciliated: false,
        pay0StatusUpdated: false,
        iqId: existingIqId || null,
        operationStatus: "",
        reconciliationStatus: freeCandidatesH4D61B25A.length > 1 ? "AMBIGUOUS" : "NOT_FOUND",
        message: freeCandidatesH4D61B25A.length > 1
          ? `Multiples depositos IQ libres coinciden: ${freeIdsH4D61B25A.join(", ")}`
          : "No se encontro deposito IQ libre para este pago.",
      };
    }
  }

  const operationStatus = cleanText(match.operationStatus);
  const reconciliationStatus = cleanText(match.reconciliationStatus);
  // IQ2G_H4_D45D_SCOPE_NORMALIZED_MATCH
  const normalizedMatchH4D45 = normalizeIqDepositMatchColumnsH4D45(
    match,
    operationStatus,
    reconciliationStatus,
  );
  const operationStatusH4D45 = normalizedMatchH4D45.operationStatus || operationStatus;
  const reconciliationStatusH4D45 = normalizedMatchH4D45.reconciliationStatus || reconciliationStatus;
  const matchedIqDepositIdH4D58C = normalizeIqDepositNumericRefH4D58B(normalizedMatchH4D45.iqId || match.iqId);
  const iqDepositIdForPatch = matchedIqDepositIdH4D58C || existingIqId || null;
  const upperReconciliation = cleanUpper(reconciliationStatusH4D45);
  const upperOperation = cleanUpper(operationStatusH4D45);

  const conciliated =
    Boolean(iqDepositIdForPatch) &&
    (
      /CONCILIAD|CONCILIATED/.test(upperReconciliation) ||
      /CONCILIAD|CONCILIATED/.test(upperOperation)
    );

  const currentPagoStatus = cleanUpper(ctx.pago.status);

  const patch: Record<string, unknown> = {
      ...buildOutcomeUnknownRecoveredPatchH4D58G5(ctx.pago as Record<string, unknown>, "RECONCILE_LINKED_AFTER_OUTCOME_UNKNOWN"),
    iqDepositId: iqDepositIdForPatch,
    iqDepositFolio: iqDepositIdForPatch,
    iqDepositStatus: conciliated ? "CONCILIATED" : "LINKED",
    iqDepositOperationStatus: operationStatusH4D45 || operationStatus || null,
    iqDepositReconciliationStatus: reconciliationStatusH4D45 || reconciliationStatus || (conciliated ? "CONCILIATED" : "LINKED"),
    iqDepositReconciliationVersion: IQ_PAGO_DEPOSIT_RECONCILIATION_VERSION,
    iqDepositReconciliationMatchedAt: now,
    iqDepositReconciliationMatchStrategy: match.matchStrategy || null,
      iqDepositReconciliationIdSourceH4D58C: matchedIqDepositIdH4D58C ? "MATCH_NUMERIC" : existingIqId ? "EXISTING_NUMERIC" : "NONE",
    iqDepositReconciliationLastError: null,
      iqDepositReconciliationRawDebugText: normalizedMatchH4D45.debugText.slice(0, 1800),
    iqDepositReconcileSource: source,
    iqDepositAutomationMode: source === "SCHEDULER" ? "AUTO" : "MANUAL",
    iqDepositReconcileLastRunAt: now,
    iqDepositUpdatedAt: now,
  };

  const terminalRejectedH4D58H = Boolean(iqDepositIdForPatch) &&
    isIqDepositTerminalTextH4D58H(`${operationStatusH4D45 || operationStatus || ""} ${reconciliationStatusH4D45 || reconciliationStatus || ""}`);
  const terminalOutcomeH4D64A6 = terminalRejectedH4D58H
    ? getPagoIqTerminalOutcomeH4D64A6(`${operationStatusH4D45 || operationStatus || ""} ${reconciliationStatusH4D45 || reconciliationStatus || ""}`) || "REJECTED"
    : null;
  const effectiveConciliatedH4D64A6 = conciliated && !terminalOutcomeH4D64A6;
  const shouldPostFinancialsH4D65A0 = shouldPostPagoFinancialsAfterIqConciliationH4D65A0({
    conciliated: effectiveConciliatedH4D64A6,
    currentStatus: currentPagoStatus,
  });
  const pay0StatusUpdated = terminalOutcomeH4D64A6
    ? currentPagoStatus !== (terminalOutcomeH4D64A6 === "CANCELLED" ? "CANCELADO" : "RECHAZADO")
    : effectiveConciliatedH4D64A6 && currentPagoStatus === "CONCILIACION_PENDIENTE";

  if (terminalRejectedH4D58H) {
    Object.assign(
      patch,
      buildPagoIqTerminalLockPatchH4D58H({
        pago: ctx.pago as Record<string, unknown>,
        iqId: iqDepositIdForPatch,
        operationStatus: operationStatusH4D45 || operationStatus || "",
        reconciliationStatus: reconciliationStatusH4D45 || reconciliationStatus || "",
        authUid: actor.uid,
        source: `RECONCILE_${source}_TERMINAL_H4_D64_A6`,
      }),
    );
  }
  // H4_D64_A6_CORE_RECONCILE_TERMINAL_LOCK_AND_CLOSE
  if (effectiveConciliatedH4D64A6 && pay0StatusUpdated) {
    patch.status = "CONCILIADO";
    patch.conciliatedBy = actor.uid;
    patch.conciliatedAt = now;
    patch.conciliationNote = (source === "SCHEDULER" ? `Conciliado automaticamente por IQ Depositos ${iqDepositIdForPatch || ""}` : `Conciliado manualmente por IQ Depositos ${iqDepositIdForPatch || ""}`).trim();

    Object.assign(patch, buildPagoFoundationOnConciliation(ctx.pago));
  }

  await ctx.pagoRef.set(patch, { merge: true });

  const financialPostingH4D65A0 = shouldPostFinancialsH4D65A0
    ? await postPagoFinancialsAfterIqConciliationH4D65A0({
        auth,
        actor,
        pagoId,
        pagoRef: ctx.pagoRef,
        source: `RECONCILE_${source}`,
      })
    : null;
  // H4_D65_A0_CORE_RECONCILE_POSTS_FINANCIALS

  if (terminalOutcomeH4D64A6) {
    await ctx.pagoRef.collection("notas").add({
      rootId: auth.rootId,
      text: `Pago ${terminalOutcomeH4D64A6 === "CANCELLED" ? "cancelado" : "rechazado"} ${source === "SCHEDULER" ? "automaticamente" : "manualmente"} por IQ Depositos ${iqDepositIdForPatch || ""}; tareas de seguimiento cerradas.`.trim(),
      createdBy: actor.uid,
      createdByName: actor.name,
      createdByRole: actor.role,
      createdAt: FieldValue.serverTimestamp(),
      source: "IQ_DEPOSIT_TERMINAL_H4_D64_A6",
    }).catch(() => undefined);

    await notifyIqPagoTelegramH4D59B({
      botToken: TELEGRAM_BOT_TOKEN.value(),
      auth,
      event: terminalOutcomeH4D64A6 === "CANCELLED"
        ? "IQ_PAGO_CANCELADO"
        : "IQ_PAGO_RECHAZADO",
      pagoId,
      pago: ctx.pago as Record<string, unknown>,
      iqId: iqDepositIdForPatch,
      source: `RECONCILE_${source}_TERMINAL_H4_D64_A6`,
      dedupeKey: `${terminalOutcomeH4D64A6.toLowerCase()}-${iqDepositIdForPatch || "sin-folio"}`,
      message: `Deposito IQ ${terminalOutcomeH4D64A6 === "CANCELLED" ? "cancelado" : "rechazado"}; pago cerrado y tareas de seguimiento detenidas.`,
    }).catch(() => undefined);
  }

  if (effectiveConciliatedH4D64A6 && pay0StatusUpdated) {
    await ctx.pagoRef.collection("notas").add({
      rootId: auth.rootId,
      text: (source === "SCHEDULER" ? `Pago conciliado automaticamente por IQ Depositos ${match.iqId || ""}` : `Pago conciliado manualmente por IQ Depositos ${match.iqId || ""}`).trim(),
      createdBy: actor.uid,
      createdByName: actor.name,
      createdByRole: actor.role,
      createdAt: FieldValue.serverTimestamp(),
      source: "IQ_DEPOSIT_RECONCILE",
    }).catch(() => undefined);

    await notifyIqPagoTelegramH4D59B({
      botToken: TELEGRAM_BOT_TOKEN.value(),
      auth,
      event: "IQ_PAGO_CONCILIADO",
      pagoId,
      pago: ctx.pago as Record<string, unknown>,
      iqId: iqDepositIdForPatch,
      source,
      message: (source === "SCHEDULER" ? `Pago conciliado automaticamente por IQ Depositos ${iqDepositIdForPatch || ""}` : `Pago conciliado manualmente por IQ Depositos ${iqDepositIdForPatch || ""}`).trim(),
    }).catch(() => undefined);
  }
  // H4_D59B_NOTIFY_IQ_PAGO_CONCILIATED_CORE

  return {
    pagoId,
    status: terminalOutcomeH4D64A6 || (effectiveConciliatedH4D64A6 ? "CONCILIATED" : "LINKED"),
    linked: true,
    conciliated: effectiveConciliatedH4D64A6,
    pay0StatusUpdated,
    iqId: iqDepositIdForPatch,
    operationStatus: operationStatusH4D45 || operationStatus,
    reconciliationStatus: terminalOutcomeH4D64A6 || reconciliationStatusH4D45 || reconciliationStatus || (effectiveConciliatedH4D64A6 ? "CONCILIATED" : "LINKED"),
    financialPostingAttempted: financialPostingH4D65A0?.attempted || false,
    financialPostingOk: financialPostingH4D65A0?.ok || false,
    financialPostingStatus: financialPostingH4D65A0?.status || null,
    financialSnapshotId: financialPostingH4D65A0?.snapshotId || null,
    financialPostingError: financialPostingH4D65A0?.errorMessage || null,
    message: terminalOutcomeH4D64A6
      ? `Deposito IQ ${terminalOutcomeH4D64A6 === "CANCELLED" ? "cancelado" : "rechazado"}; pago cerrado y tareas detenidas.`
      : effectiveConciliatedH4D64A6
        ? [
            pay0StatusUpdated
              ? "Deposito IQ conciliado y pago PAY0 actualizado."
              : "Deposito IQ conciliado; PAY0 ya no estaba pendiente.",
            financialPostingMessageH4D65A0(financialPostingH4D65A0),
          ].filter(Boolean).join(" ")
        : "Deposito IQ localizado; aun no aparece conciliado.",
  };
}

export const reconcilePendingPagoIqDepositsNow = onCall(
  {
    cors: true,
    timeoutSeconds: 540,
    memory: "2GiB",
    concurrency: 1,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);

    if (cleanUpper(auth.role) !== "SUPERADMIN") {
      throw new HttpsError("permission-denied", "Solo Super Admin puede ejecutar conciliacion IQ masiva.");
    }

    const data = asRecord(request.data);
    const limitRaw = Number(data.limit ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, Math.floor(limitRaw))) : 10;

    const snap = await db.collection("pagos")
      .where("rootId", "==", auth.rootId)
      .where("status", "==", "CONCILIACION_PENDIENTE")
      .limit(100)
      .get();

    const candidates = snap.docs
      .map((doc): Record<string, unknown> => ({ id: doc.id, ...asRecord(doc.data()) }))
      .filter((row) => shouldTryPagoIqAutoReconcileH4D44(row))
      .slice(0, limit);

    const results: PagoIqAutoReconcileResult[] = [];

    for (const row of candidates) {
      try {
        results.push(await reconcilePagoIqDepositCoreH4D44(
          auth,
          cleanText(row.id),
          "MANUAL_BATCH",
          {
            uid: auth.uid,
            name: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
            role: auth.role,
          },
        ));
      } catch (error: any) {
        results.push({
          pagoId: cleanText(row.id),
          status: "ERROR",
          linked: false,
          conciliated: false,
          pay0StatusUpdated: false,
          iqId: cleanText((row as Record<string, unknown>).iqDepositId ?? (row as Record<string, unknown>).iqDepositFolio) || null,
          operationStatus: "",
          reconciliationStatus: "ERROR",
          message: error?.message || "Error desconocido.",
        });
      }
    }

    return {
      ok: true,
      data: {
        scanned: snap.size,
        candidates: candidates.length,
        results,
        updated: results.filter((row) => row.pay0StatusUpdated).length,
        conciliated: results.filter((row) => row.conciliated).length,
        linked: results.filter((row) => row.linked).length,
      },
      message: `Conciliacion IQ Pagos revisada: ${results.length}. Actualizados: ${results.filter((row) => row.pay0StatusUpdated).length}.`,
    };
  },
);

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
// H4_D62A_PAGO_IQ_RECONCILE_SCHEDULER_ENABLED
export const processIqPagoDepositReconciliationQueue = onSchedule(
  {
    schedule: "every 5 minutes", // H4_D87_A58_A15_HEARTBEAT_5_MIN
    timeZone: DEFAULT_IQ_TIME_ZONE,
    timeoutSeconds: 540,
    memory: "2GiB",
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
  },
  async () => {
    const enabledRoots = await loadEnabledIqAutomationRoots({
      process: "pagoReconciliation",
      purpose: "RECONCILIATION",
    });

    if (enabledRoots.size === 0) {
      return;
    }

    const snap = await db.collection("pagos")
      .where("status", "==", "CONCILIACION_PENDIENTE")
      .limit(100)
      .get();

    const candidates = snap.docs
      .map((doc): Record<string, unknown> => ({ id: doc.id, ...asRecord(doc.data()) }))
      .filter((row) => enabledRoots.has(cleanText(row.rootId)))
      .filter((row) => shouldTryPagoIqAutoReconcileH4D44(row))
      .slice(0, 10);

    for (const row of candidates) {
      const pagoId = cleanText(row.id);

      try {
        const auth = await buildPagoIqSystemAuthH4D44(row);
        await reconcilePagoIqDepositCoreH4D44(
          auth,
          pagoId,
          "SCHEDULER",
          {
            uid: "system",
            name: "System",
            role: "system",
          },
        );
      } catch (error: any) {
        // H4_D63A_RECONCILE_SCOPE_CATCH
        if (isPagoIqAutomationScopeErrorH4D63A(error)) {
          logPagoIqAutomationScopeSkipH4D63A1C({
            pagoId,
            error,
            source: "AUTO_RECONCILE_SCHEDULER",
          });

          continue;
        }

        await db.collection("pagos").doc(pagoId).set(
          {
            iqDepositAutoReconcileLastError: error?.message || "Error desconocido.",
            iqDepositAutoReconcileLastErrorAt: FieldValue.serverTimestamp(),
            iqDepositUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ).catch(() => undefined);
      }
    }

    // H4_D87_A58_AUTO_FINANCIAL_POSTING_RETRY
    // Si IQ ya concilio el pago pero el posteo financiero fallo por un
    // error tecnico/transitorio, se reintenta automaticamente.
    // Los estados SKIPPED_* no se reintentan para evitar consumo inutil.
    const financialRetrySnap = await db
      .collection("pagos")
      .where("financialPostingStatus", "==", "ERROR")
      .limit(50)
      .get();

    const financialRetryNowMs = Date.now();

    const financialRetryCandidates = financialRetrySnap.docs
      .map(
        (doc): Record<string, unknown> => ({
          id: doc.id,
          ...asRecord(doc.data()),
        }),
      )
      .filter(
        (row) =>
          cleanUpper(row.status) === "CONCILIADO",
      )
      .filter(
        (row) =>
          enabledRoots.has(cleanText(row.rootId)),
      )
      .filter((row) => {
        const lastAttemptMs = toMillis(
          row.iqDepositFinancialPostingAttemptedAt,
        );

        return (
          lastAttemptMs <= 0 ||
          financialRetryNowMs - lastAttemptMs >=
            15 * 60 * 1000
        );
      })
      .slice(0, 5);

    for (const row of financialRetryCandidates) {
      const pagoId = cleanText(row.id);

      try {
        const auth =
          await buildPagoIqSystemAuthH4D44(row);

        await postPagoFinancialsAfterIqConciliationH4D65A0({
          auth,
          actor: {
            uid: "system",
            name: "System",
            role: "system",
          },
          pagoId,
          pagoRef: db.collection("pagos").doc(pagoId),
          source:
            "AUTO_FINANCIAL_RETRY_SCHEDULER",
        });
      } catch (error) {
        console.error(
          "H4_D87_A58_AUTO_FINANCIAL_POSTING_RETRY_ERROR",
          {
            pagoId,
            error:
              error instanceof Error
                ? error.message
                : String(error || "Error desconocido."),
          },
        );
      }
    }
    // H4_D87_A58_AUTO_FINANCIAL_POSTING_RETRY_END
  },
);
// H4_D62A_PAGO_IQ_RECONCILE_SCHEDULER_ENABLED_END

// H4_D64_A2_PAGO_IQ_ON_DEMAND
type PagoIqOnDemandOperationH4D64 =
  | "CREATE"
  | "RECONCILE";

type PagoIqOnDemandSourceH4D64 =
  | "MANUAL";

type PagoIqOnDemandPayloadH4D64 = {
  pagoId: string;
  operation: PagoIqOnDemandOperationH4D64;
  attempt: number;
  generation: string;
  source: PagoIqOnDemandSourceH4D64;
  requestedByUid: string;
  requestedByName: string;
  requestedByRole: string;
};

const PAGO_IQ_ON_DEMAND_TASK_H4D64 =
  "processIqPagoDepositOnDemandTask";

const PAGO_IQ_MAX_CREATE_ATTEMPTS_H4D64 = 3;
const PAGO_IQ_MAX_RECONCILE_ATTEMPTS_H4D64 = 3;

function pagoIqOnDemandDelaySecondsH4D64(
  operation: PagoIqOnDemandOperationH4D64,
  attempt: number,
): number {
  const safeAttempt = Math.max(
    0,
    Math.floor(Number(attempt) || 0),
  );

  if (operation === "CREATE") {
    if (safeAttempt <= 0) return 0;
    if (safeAttempt === 1) return 5 * 60;
    return 15 * 60;
  }

  if (safeAttempt <= 0) return 0;
  if (safeAttempt <= 3) return 10 * 60;
  if (safeAttempt <= 8) return 20 * 60;
  if (safeAttempt <= 15) return 60 * 60;

  return 2 * 60 * 60;
}

function pagoIqOnDemandTaskIdH4D64(
  payload: PagoIqOnDemandPayloadH4D64,
): string {
  return [
    "iq",
    "pago",
    payload.operation.toLowerCase(),
    payload.pagoId,
    payload.generation,
    String(payload.attempt),
  ].join("-");
}

async function setPagoIqOnDemandStateH4D64(
  pagoId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .collection("pagos")
    .doc(pagoId)
    .set(
      {
        iqDepositOnDemandVersion: "H4-D64-A2",
        ...patch,
        iqDepositOnDemandUpdatedAt:
          FieldValue.serverTimestamp(),
        iqDepositUpdatedAt:
          FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

async function enqueuePagoIqOnDemandTaskH4D64(
  payload: PagoIqOnDemandPayloadH4D64,
): Promise<void> {
  const delaySeconds =
    pagoIqOnDemandDelaySecondsH4D64(
      payload.operation,
      payload.attempt,
    );

  // Persistir primero la generacion manual. La Cloud Task puede arrancar
  // inmediatamente y debe encontrar esta misma generacion al leer el pago.
  await setPagoIqOnDemandStateH4D64(
    payload.pagoId,
    {
      iqDepositOnDemandStatus: "QUEUED",
      iqDepositAutomationMode: "MANUAL",
      iqDepositOnDemandRequestedByUid: payload.requestedByUid,
      iqDepositOnDemandRequestedByName: payload.requestedByName,
      iqDepositOnDemandRequestedByRole: payload.requestedByRole,
      iqDepositOnDemandOperation: payload.operation,
      iqDepositOnDemandAttempt: payload.attempt,
      iqDepositOnDemandGeneration: payload.generation,
      iqDepositOnDemandNextAttemptAt:
        new Date(Date.now() + delaySeconds * 1000),
      iqDepositOnDemandCompletedAt: null,
    },
  );

  const enqueueResult =
    await enqueueIqOnDemandTaskH4D64({
      functionName: PAGO_IQ_ON_DEMAND_TASK_H4D64,
      taskId: pagoIqOnDemandTaskIdH4D64(payload),
      data: payload as unknown as Record<string, unknown>,
      scheduleDelaySeconds: delaySeconds,
      dispatchDeadlineSeconds: 540,
    });

  // No volver a escribir QUEUED aqui: la tarea puede haber cambiado
  // ya el estado a PROCESSING mientras el enqueue regresaba.
  await setPagoIqOnDemandStateH4D64(
    payload.pagoId,
    {
      iqDepositOnDemandTaskId:
        enqueueResult.taskId,
      iqDepositOnDemandTaskDuplicate:
        enqueueResult.duplicate,
    },
  );
}

async function stopPagoIqOnDemandH4D64(
  pagoId: string,
  status: string,
  message: string,
): Promise<void> {
  await setPagoIqOnDemandStateH4D64(
    pagoId,
    {
      iqDepositOnDemandStatus: status,
      iqDepositOnDemandLastMessage: message,
      iqDepositOnDemandNextAttemptAt: null,
      iqDepositOnDemandCompletedAt:
        FieldValue.serverTimestamp(),
    },
  );
}

function pagoIqResultIsConciliatedH4D64(
  result: Record<string, unknown>,
): boolean {
  const status = cleanUpper(result.status);
  const reconciliationStatus = cleanUpper(
    result.reconciliationStatus,
  );

  return (
    result.conciliated === true ||
    result.pay0StatusUpdated === true ||
    status === "CONCILIATED" ||
    /CONCILIAD|CONCILIATED/.test(reconciliationStatus)
  );
}

function pagoIqResultRequiresReviewH4D64(
  result: Record<string, unknown>,
): boolean {
  const combined = cleanUpper(
    [
      result.status,
      result.reconciliationStatus,
      result.operationStatus,
    ].join(" "),
  );

  return (
    combined.includes("AMBIGUOUS") ||
    combined.includes("REVIEW_REQUIRED")
  );
}

export function pagoIqResultIsTerminalH4D64(
  result: Record<string, unknown>,
): boolean {
  const combined = cleanUpper(
    [
      result.status,
      result.reconciliationStatus,
      result.operationStatus,
    ].join(" "),
  );

  return (
    combined.includes("OMITTED") ||
    combined.includes("REJECTED") ||
    combined.includes("RECHAZAD") ||
    combined.includes("CANCELLED") ||
    combined.includes("CANCELED") ||
    combined.includes("CANCELAD") ||
    combined.includes("TERMINAL")
  );
}

// H4_D87_A58_MANUAL_PAGO_IQ_SYNC_REQUEST
export const requestPagoIqSync = onCall(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    const auth = await getAuthContext(request);

    assertAuthorized(request.auth, auth.user, {
      allowedRoles: ["superadmin", "admin", "operador"],
    });
    const data = asRecord(request.data);
    const pagoId = cleanText(data.pagoId);

    if (!pagoId) {
      throw new HttpsError(
        "invalid-argument",
        "pagoId es obligatorio.",
      );
    }

    const pagoRef = db.collection("pagos").doc(pagoId);
    const pagoSnap = await pagoRef.get();

    if (!pagoSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Pago PAY0 no encontrado.",
      );
    }

    const pago = asRecord(pagoSnap.data());

    assertSameRoot(pago, auth.rootId, "Pago");

    const pagoStatus = cleanUpper(pago.status);

    if (pagoStatus !== "CONCILIACION_PENDIENTE") {
      throw new HttpsError(
        "failed-precondition",
        "El pago ya no esta pendiente de conciliacion IQ.",
      );
    }

    if (isPagoIqAutomationOmittedH4D44(pago)) {
      throw new HttpsError(
        "failed-precondition",
        "El seguimiento IQ de este pago fue omitido.",
      );
    }

    if (isPagoIqTerminalLockedH4D58H(pago)) {
      throw new HttpsError(
        "failed-precondition",
        "El deposito IQ esta rechazado/cancelado. Sube un nuevo comprobante para generar un nuevo intento.",
      );
    }

    const creationStatus = cleanUpper(
      pago.iqDepositCreationStatus,
    );

    const shouldReconcile =
      shouldTryPagoIqAutoReconcileH4D44(pago) ||
      creationStatus === "CREATED_RECOVERED";

    const operation: PagoIqOnDemandOperationH4D64 =
      shouldReconcile
        ? "RECONCILE"
        : "CREATE";

    if (
      operation === "CREATE" &&
      !shouldProcessPagoIqManualCreateH4D87(pago)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El pago no esta listo para crear un deposito IQ de forma segura.",
      );
    }

    assertAuthorized(request.auth, auth.user, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "pagos",
      requiredAction:
        operation === "CREATE"
          ? "create"
          : "conciliate",
    });

    if (operation === "CREATE") {
      const similarGate =
        await assertSimilarPay0OperationConfirmedForIqCreateH4D58F({
          operationType: "PAGO",
          operationId: pagoId,
          pagoId,
          amountOverride:
            data.amountOverride ??
            data.amount ??
            data.monto,
          windowDays: 3,
        });

      if (similarGate && similarGate.ok === false) {
        throw new HttpsError(
          "failed-precondition",
          similarGate.message ||
            "Existen operaciones PAY0 parecidas. Confirma si esta es una operacion nueva antes de crear en IQ.",
          {
            code:
              similarGate.errorCode ||
              "SIMILAR_PAY0_OPERATION_CONFIRMATION_REQUIRED",
            requiresConfirmation: true,
            shouldBlock: true,
            warningOnly: true,
            precheck: similarGate.result || null,
          },
        );
      }
    }

    const generation = [
      "manual",
      pagoId,
      auth.uid,
      Date.now(),
    ].join("-");

    await enqueuePagoIqOnDemandTaskH4D64({
      pagoId,
      operation,
      attempt: 0,
      generation,
      source: "MANUAL",
      requestedByUid: auth.uid,
      requestedByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
      requestedByRole: auth.role,
    });

    return {
      ok: true,
      data: {
        pagoId,
        operation,
        queued: true,
        generation,
      },
      message:
        operation === "CREATE"
          ? "Creacion IQ enviada para procesamiento."
          : "Sincronizacion IQ enviada para procesamiento.",
    };
  },
);
// H4_D87_A58_MANUAL_PAGO_IQ_SYNC_REQUEST_END
export const processIqPagoDepositOnDemandTask =
  onTaskDispatched(
    {
      region: "us-central1",
      timeoutSeconds: 540,
      memory: "2GiB",
      maxInstances: 1,
      concurrency: 1,
      secrets: [
        IQ_CREDENTIALS_KEY,
        TELEGRAM_BOT_TOKEN,
      ],
      retryConfig: {
        maxAttempts: 1,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 300,
      },
      rateLimits: {
        maxConcurrentDispatches: 1,
        maxDispatchesPerSecond: 1,
      },
    },
    async (request) => {
      const data = asRecord(request.data);

      const pagoId = cleanText(data.pagoId);
      const operation = cleanUpper(
        data.operation,
      ) as PagoIqOnDemandOperationH4D64;

      const attempt = Math.max(
        0,
        Math.floor(Number(data.attempt) || 0),
      );

      const generation = cleanText(
        data.generation,
      );

      const source = cleanUpper(
        data.source,
      ) as PagoIqOnDemandSourceH4D64;

      const requestedByUid = cleanText(data.requestedByUid);
      const requestedByName = cleanText(data.requestedByName);
      const requestedByRole = cleanText(data.requestedByRole);

      // H4_D87_A58_MANUAL_ON_DEMAND_ONLY
      // Las Cloud Tasks on-demand quedan reservadas al flujo manual.
      // Las tareas legacy/sin source se descartan sin leer el pago ni tocar IQ.
      if (source !== "MANUAL") {
        console.warn(
          "H4_D87_A58_LEGACY_ON_DEMAND_TASK_OMITTED",
          {
            pagoId,
            operation,
            attempt,
            generation,
            source: source || null,
          },
        );

        return;
      }
      // H4_D87_A58_MANUAL_ON_DEMAND_ONLY_END

      if (
        !pagoId ||
        !generation ||
        !requestedByUid ||
        !requestedByName ||
        !requestedByRole ||
        !["CREATE", "RECONCILE"].includes(operation)
      ) {
        console.warn(
          "H4_D64_A2_INVALID_TASK",
          {
            pagoId,
            operation,
            attempt,
            generation,
          },
        );

        return;
      }

      const pagoRef = db
        .collection("pagos")
        .doc(pagoId);

      const pagoSnap = await pagoRef.get();

      if (!pagoSnap.exists) {
        console.warn(
          "H4_D64_A2_PAGO_NOT_FOUND",
          { pagoId, operation, attempt },
        );

        return;
      }

      const pago = asRecord(pagoSnap.data());

      const currentGeneration = cleanText(
        pago.iqDepositOnDemandGeneration ??
        pago.iqDepositCreationQueuedUploadId,
      );

      if (
        currentGeneration &&
        currentGeneration !== generation
      ) {
        console.warn(
          "H4_D64_A2_STALE_TASK",
          {
            pagoId,
            operation,
            attempt,
            generation,
            currentGeneration,
          },
        );

        return;
      }

      const pagoStatus = cleanUpper(pago.status);

      if (
        pagoStatus !== "CONCILIACION_PENDIENTE" ||
        isPagoIqAutomationOmittedH4D44(pago) ||
        isPagoIqTerminalLockedH4D58H(pago)
      ) {
        await stopPagoIqOnDemandH4D64(
          pagoId,
          "COMPLETED_NO_LONGER_PENDING",
          "El pago ya no requiere seguimiento IQ.",
        );

        return;
      }

      await setPagoIqOnDemandStateH4D64(
        pagoId,
        {
          iqDepositOnDemandStatus: "PROCESSING",
          iqDepositOnDemandOperation: operation,
          iqDepositOnDemandAttempt: attempt,
          iqDepositOnDemandGeneration: generation,
          iqDepositOnDemandStartedAt:
            FieldValue.serverTimestamp(),
          iqDepositOnDemandLastError: null,
        },
      );

      try {
        const auth =
          await buildPagoIqSystemAuthH4D44(pago);

        if (operation === "CREATE") {
          if (
            !shouldProcessPagoIqManualCreateH4D87(
              pago,
            )
          ) {
            if (
              shouldTryPagoIqAutoReconcileH4D44(pago)
            ) {
              await enqueuePagoIqOnDemandTaskH4D64({
                pagoId,
                operation: "RECONCILE",
                attempt: 0,
                generation,
                source: "MANUAL",
                requestedByUid,
                requestedByName,
                requestedByRole,
              });

              return;
            }

            await stopPagoIqOnDemandH4D64(
              pagoId,
              "COMPLETED_NOT_ELIGIBLE",
              "El pago ya no esta listo para creacion IQ.",
            );

            return;
          }

          const creationResult = asRecord(
            await createPagoIqDepositFromQueueCoreH4D62C({
              auth,
              pagoId,
              actor: {
                uid: requestedByUid,
                name: requestedByName,
                role: requestedByRole,
              },
              source: "TASK",
            }),
          );

          const embeddedReconciliation = asRecord(
            creationResult.reconciliation,
          );

          const latestPagoSnap = await pagoRef.get();
          const latestPago = asRecord(
            latestPagoSnap.data(),
          );

          if (
            cleanUpper(latestPago.status) !==
              "CONCILIACION_PENDIENTE" ||
            pagoIqResultIsConciliatedH4D64(
              embeddedReconciliation,
            )
          ) {
            await stopPagoIqOnDemandH4D64(
              pagoId,
              "COMPLETED",
              "Creacion y conciliacion IQ completadas.",
            );

            return;
          }

          if (
            pagoIqResultRequiresReviewH4D64(
              creationResult,
            )
          ) {
            await stopPagoIqOnDemandH4D64(
              pagoId,
              "REVIEW_REQUIRED",
              cleanText(creationResult.message) ||
                "La creacion requiere revision.",
            );

            return;
          }

          const creationStatus = cleanUpper(
            creationResult.status,
          );

          if (
            creationStatus === "FAILED_RETRYABLE"
          ) {
            const nextAttempt = attempt + 1;

            if (
              nextAttempt >=
              PAGO_IQ_MAX_CREATE_ATTEMPTS_H4D64
            ) {
              await stopPagoIqOnDemandH4D64(
                pagoId,
                "REVIEW_REQUIRED",
                "Se agotaron los intentos de creacion IQ.",
              );

              return;
            }

            await enqueuePagoIqOnDemandTaskH4D64({
              pagoId,
              operation: "CREATE",
              attempt: nextAttempt,
              generation,
              source: "MANUAL",
              requestedByUid,
              requestedByName,
              requestedByRole,
            });

            return;
          }

          await enqueuePagoIqOnDemandTaskH4D64({
            pagoId,
            operation: "RECONCILE",
            attempt: 0,
            generation,
            source: "MANUAL",
            requestedByUid,
            requestedByName,
            requestedByRole,
          });

          return;
        }

        if (
          !shouldTryPagoIqAutoReconcileH4D44(pago)
        ) {
          await stopPagoIqOnDemandH4D64(
            pagoId,
            "COMPLETED_NOT_ELIGIBLE",
            "El pago ya no cumple las condiciones de conciliacion IQ.",
          );

          return;
        }

        const reconciliationResult = asRecord(
          await reconcilePagoIqDepositCoreH4D44(
            auth,
            pagoId,
            "TASK",
            {
              uid: requestedByUid,
              name: requestedByName,
              role: requestedByRole,
            },
          ),
        );

        if (
          pagoIqResultIsConciliatedH4D64(
            reconciliationResult,
          )
        ) {
          await stopPagoIqOnDemandH4D64(
            pagoId,
            "COMPLETED",
            cleanText(reconciliationResult.message) ||
              "Pago conciliado manualmente.",
          );

          return;
        }

        if (
          pagoIqResultRequiresReviewH4D64(
            reconciliationResult,
          )
        ) {
          await stopPagoIqOnDemandH4D64(
            pagoId,
            "REVIEW_REQUIRED",
            cleanText(reconciliationResult.message) ||
              "La conciliacion requiere revision.",
          );

          return;
        }

        if (
          pagoIqResultIsTerminalH4D64(
            reconciliationResult,
          )
        ) {
          await stopPagoIqOnDemandH4D64(
            pagoId,
            "COMPLETED_TERMINAL",
            cleanText(reconciliationResult.message) ||
              "El seguimiento termino en estado terminal.",
          );

          return;
        }

        const nextAttempt = attempt + 1;

        if (
          nextAttempt >=
          PAGO_IQ_MAX_RECONCILE_ATTEMPTS_H4D64
        ) {
          await stopPagoIqOnDemandH4D64(
            pagoId,
            "REVIEW_REQUIRED",
            "Se agoto la ventana automatica de conciliacion IQ.",
          );

          return;
        }

        await enqueuePagoIqOnDemandTaskH4D64({
          pagoId,
          operation: "RECONCILE",
          attempt: nextAttempt,
          generation,
          source: "MANUAL",
          requestedByUid,
          requestedByName,
          requestedByRole,
        });
      } catch (error) {
        if (
          isPagoIqAutomationScopeErrorH4D63A(error)
        ) {
          logPagoIqAutomationScopeSkipH4D63A1C({
            pagoId,
            error,
            source:
              `H4_D64_A2_TASK_${operation}`,
          });

          await stopPagoIqOnDemandH4D64(
            pagoId,
            "SKIPPED_SCOPE",
            "Pago fuera del alcance de la cuenta IQ asignada.",
          ).catch(() => undefined);

          return;
        }

        const message = cleanText(
          (error as any)?.message ??
          error,
        ) || "Error desconocido en tarea IQ.";

        await setPagoIqOnDemandStateH4D64(
          pagoId,
          {
            iqDepositOnDemandStatus:
              "ERROR_RETRYABLE",
            iqDepositOnDemandOperation: operation,
            iqDepositOnDemandAttempt: attempt,
            iqDepositOnDemandGeneration: generation,
            iqDepositOnDemandLastError: message,
            iqDepositOnDemandLastErrorAt:
              FieldValue.serverTimestamp(),
          },
        ).catch(() => undefined);

        if (operation === "CREATE") {
          const latestPagoSnapAfterError =
            await pagoRef.get().catch(() => null);

          const latestPagoAfterError = asRecord(
            latestPagoSnapAfterError?.data(),
          );

          const latestCreationStatusAfterError =
            cleanUpper(
              latestPagoAfterError.iqDepositCreationStatus,
            );

          const postMayHaveBeenDispatched =
            [
              "PROCESSING_HTTP",
              "POST_ACKNOWLEDGED_PENDING_IQ_ID",
              "OUTCOME_UNKNOWN",
            ].includes(latestCreationStatusAfterError) ||
            latestPagoAfterError.iqDepositCreationRetryBlocked === true;

          console.error(
            "H4_D87_A58_MANUAL_CREATE_ERROR",
            {
              pagoId,
              attempt,
              generation,
              message,
              creationStatus:
                latestCreationStatusAfterError || null,
              postMayHaveBeenDispatched,
            },
          );

          /*
           * Si sigue QUEUED (o cualquier estado anterior al POST),
           * no conciliar algo que nunca fue enviado a IQ.
           * Se conserva el error real para diagnostico/reintento manual.
           */
          if (!postMayHaveBeenDispatched) {
            return;
          }

          /*
           * Solo si existe evidencia de que el POST pudo haber salido,
           * pasar a recuperacion para evitar duplicados.
           */
          await enqueuePagoIqOnDemandTaskH4D64({
            pagoId,
            operation: "RECONCILE",
            attempt: 0,
            generation,
            source: "MANUAL",
            requestedByUid,
            requestedByName,
            requestedByRole,
          });

          return;
        }

        const nextAttempt = attempt + 1;

        if (
          nextAttempt >=
          PAGO_IQ_MAX_RECONCILE_ATTEMPTS_H4D64
        ) {
          await stopPagoIqOnDemandH4D64(
            pagoId,
            "REVIEW_REQUIRED",
            message,
          );

          return;
        }

        await enqueuePagoIqOnDemandTaskH4D64({
          pagoId,
          operation: "RECONCILE",
          attempt: nextAttempt,
          generation,
          source: "MANUAL",
          requestedByUid,
          requestedByName,
          requestedByRole,
        });
      }
    },
  );
// H4_D64_A2_PAGO_IQ_ON_DEMAND_END
// H4_D62C_PAGO_IQ_AUTO_CREATE_QUEUE_SCHEDULER
export const processIqPagoDepositCreateQueue = onSchedule(
  {
    schedule: "every 5 minutes", // H4_D87_A58_A15_HEARTBEAT_5_MIN
    timeZone: DEFAULT_IQ_TIME_ZONE,
    timeoutSeconds: 540,
    memory: "2GiB",
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
  },
  async () => {
    const enabledRoots = await loadEnabledIqAutomationRoots({
      process: "pagoCreate",
      purpose: "CREATION",
      respectWindow: false,
    });

    if (enabledRoots.size === 0) {
      return;
    }

    const snap = await db.collection("pagos")
      .where("status", "==", "CONCILIACION_PENDIENTE")
      .limit(100)
      .get();

    const candidates = snap.docs
      .map((doc): Record<string, unknown> => ({ id: doc.id, ...asRecord(doc.data()) }))
      .filter((row) => enabledRoots.has(cleanText(row.rootId)))
      .filter((row) => shouldProcessPagoIqCreateQueueH4D62C(row))
      .slice(0, 3);

    for (const row of candidates) {
      const pagoId = cleanText(row.id);

      try {
        const auth = await buildPagoIqSystemAuthH4D44(row);
        await createPagoIqDepositFromQueueCoreH4D62C({
          auth,
          pagoId,
          actor: {
            uid: "system",
            name: "System",
            role: "system",
          },
          source: "SCHEDULER",
        });
      } catch (error: any) {
        // H4_D63A_CREATE_SCHEDULER_SCOPE_CATCH
        if (isPagoIqAutomationScopeErrorH4D63A(error)) {
          logPagoIqAutomationScopeSkipH4D63A1C({
            pagoId,
            error,
            source: "AUTO_CREATE_SCHEDULER",
          });

          continue;
        }

        await markPagoIqAutoCreateErrorH4D62C({
          pagoId,
          error,
          source: "SCHEDULER",
        });
      }
    }
  },
);
// H4_D62C_PAGO_IQ_AUTO_CREATE_QUEUE_END



type UsedPagoIqDepositRefH4D61B24 = {
  iqId: string;
  pagoId: string;
  pagoFolio: string;
  status: string;
};

function getPagoPay0FolioH4D61B24(pago: Record<string, unknown>, fallbackId: string): string {
  return cleanText(
    pago.folio ??
    pago.folioPago ??
    pago.pagoFolio ??
    pago.pay0Folio ??
    pago.folioPay0 ??
    pago.codigo ??
    pago.key ??
    fallbackId
  );
}

function getPagoIqIdFieldsH4D61B24(pago: Record<string, unknown>): string[] {
  return [
    pago.iqDepositId,
    pago.iqDepositFolio,
    pago.iqPagoDepositId,
    pago.iqPagoDepositFolio,
  ]
    .map((value) => normalizeIqDepositNumericRefH4D58B(value))
    .filter(Boolean);
}

async function findUsedPagoIqDepositRefsH4D61B24(input: {
  ctx: PagoIqDepositContext;
  iqIds: string[];
}): Promise<Map<string, UsedPagoIqDepositRefH4D61B24>> {
  const ctxAny = input.ctx as any;
  const currentPagoId = cleanText(ctxAny.pagoId ?? ctxAny.pagoRef?.id ?? ctxAny.id);
  const currentRootId = cleanText(ctxAny.rootId ?? ctxAny.pago?.rootId);
  const ids = Array.from(new Set(input.iqIds.map(normalizeIqDepositNumericRefH4D58B).filter(Boolean))).slice(0, 30);
  const used = new Map<string, UsedPagoIqDepositRefH4D61B24>();

  if (!ids.length) return used;

  const fields = ["iqDepositId", "iqDepositFolio", "iqPagoDepositId", "iqPagoDepositFolio"];

  for (const field of fields) {
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      if (!chunk.length) continue;

      const snap = await db.collection("pagos").where(field, "in", chunk).get();

      for (const doc of snap.docs) {
        if (doc.id === currentPagoId) continue;

        const data = doc.data() as Record<string, unknown>;
        const docRootId = cleanText(data.rootId);
        if (currentRootId && docRootId && docRootId !== currentRootId) continue;

        const iqRefs = getPagoIqIdFieldsH4D61B24(data);
        const status = cleanUpper(
          data.iqDepositReconciliationStatus ??
          data.iqPagoDepositReconciliationStatus ??
          data.iqDepositStatus ??
          data.iqPagoDepositStatus ??
          data.status
        );

        for (const iqRef of iqRefs) {
          if (!ids.includes(iqRef)) continue;
          if (used.has(iqRef)) continue;

          used.set(iqRef, {
            iqId: iqRef,
            pagoId: doc.id,
            pagoFolio: getPagoPay0FolioH4D61B24(data, doc.id),
            status,
          });
        }
      }
    }
  }

  return used;
}

async function applyUsedPagoIqDepositCandidateFilterH4D61B24(input: {
  ctx: PagoIqDepositContext;
  lookup: {
    candidates?: Array<Record<string, unknown>>;
    errors?: string[];
  };
}): Promise<void> {
  const candidates = Array.isArray(input.lookup.candidates) ? input.lookup.candidates : [];
  const candidateIqIds = candidates
    .map((candidate) => normalizeIqDepositNumericRefH4D58B(candidate.iqId))
    .filter(Boolean);

  const used = await findUsedPagoIqDepositRefsH4D61B24({
    ctx: input.ctx,
    iqIds: candidateIqIds,
  });

  const kept: Array<Record<string, unknown>> = [];
  const discarded: string[] = [];

  for (const candidate of candidates) {
    const iqId = normalizeIqDepositNumericRefH4D58B(candidate.iqId);
    const usedBy = iqId ? used.get(iqId) : null;

    if (usedBy) {
      discarded.push(`${iqId}->${usedBy.pagoFolio || usedBy.pagoId}`);
      continue;
    }

    kept.push(candidate);
  }

  input.lookup.candidates = kept;

  const message = `H4_D61B24_USED_IQ_FILTER:used=${used.size}:kept=${kept.length}:discarded=${discarded.length}:discardedIds=${discarded.slice(0, 8).join("|")}`;
  if (Array.isArray(input.lookup.errors)) {
    input.lookup.errors.unshift(message.slice(0, 1200));
  } else {
    input.lookup.errors = [message.slice(0, 1200)];
  }
}

export const debugFindPagoIqDepositCandidates = onCall(
  {
    cors: [
      "https://pay-0-system.web.app",
      "https://pay-0-system.firebaseapp.com",
      /^https:\/\/pay-0-system--.*\.web\.app$/,
      /^http:\/\/localhost:\d+$/,
    ],
    timeoutSeconds: 240,
    memory: "2GiB",
    concurrency: 1,
    secrets: [IQ_CREDENTIALS_KEY],
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    const data = asRecord(request.data);

    if (cleanUpper(auth.role) !== "SUPERADMIN") {
      throw new HttpsError("permission-denied", "Solo Super Admin puede diagnosticar depositos IQ.");
    }

    const pagoId = cleanText(data.pagoId);
    const limitRaw = Number(data.limit ?? 15);
    const maxRowsRaw = Number(data.maxRows ?? 1000);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 15;
    const maxRows = Number.isFinite(maxRowsRaw) ? Math.max(100, Math.min(2000, Math.floor(maxRowsRaw))) : 1000;

    if (!pagoId) {
      throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
    }

    const ctx = await buildPagoIqDepositContext({
      auth,
      pagoId,
      includePassword: true,
      persist: false,
    });

    const existingIqId = normalizeIqDepositNumericRefH4D58B(
      ctx.pago.iqDepositId ??
      ctx.pago.iqDepositFolio ??
      ctx.pago.iqPagoDepositId ??
      ctx.pago.iqPagoDepositFolio,
    );

    const lookup = await runPagoDepositHttpFindCandidatesA52({
      apiOrigin: cleanText(process.env.PAY0_IQ_API_ORIGIN) || IQ_API_ORIGIN_H4D85,
      username: ctx.access.username,
      password: ctx.access.password,
      item: {
        key: ctx.pagoId,
        iqId: existingIqId || undefined,
        marker: ctx.marker,
        clientName: ctx.iqClientName || "",
        companyName: ctx.iqCompanyName || "",
        expectedAmount: ctx.amount,
        targetDateIso: ctx.targetDateIso || undefined,
      },
      maxRows,
      limit,
    });

    await applyUsedPagoIqDepositCandidateFilterH4D61B24({
      ctx,
      lookup: lookup as {
        candidates?: Array<Record<string, unknown>>;
        errors?: string[];
      },
    }).catch((error) => {
      lookup.errors.unshift(`H4_D61B24_USED_IQ_FILTER_ERROR:${cleanText((error as any)?.message ?? error)}`.slice(0, 1000));
    });

    await ctx.pagoRef.set(
      {
        iqDepositCandidateLookupLastRunAt: FieldValue.serverTimestamp(),
        iqDepositCandidateLookupRowsFetched: lookup.rowsFetched,
        iqDepositCandidateLookupPagesFetched: lookup.pagesFetched,
        iqDepositCandidateLookupErrors: lookup.errors.slice(0, 5),
        iqDepositCandidateLookupTop: lookup.candidates.slice(0, 5),
        iqDepositUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      ok: true,
      data: {
        pagoId: ctx.pagoId,
        inputPagoReference: pagoId,
        expected: {
          iqId: existingIqId || null,
          marker: ctx.marker,
          clientName: ctx.iqClientName || "",
          companyName: ctx.iqCompanyName || "",
          amount: ctx.amount,
          targetDateIso: ctx.targetDateIso || null,
        },
        authenticated: lookup.authenticated,
        finalPath: lookup.finalPath,
        pagesFetched: lookup.pagesFetched,
        rowsFetched: lookup.rowsFetched,
        candidates: lookup.candidates,
        errors: lookup.errors,
      },
      message: lookup.candidates.length
        ? `Candidatos IQ encontrados: ${lookup.candidates.length}.`
        : `No se encontraron candidatos IQ en ${lookup.rowsFetched} depositos revisados.`,
    };
  },
);

// H4_D61A_DEBUG_FIND_PAGO_IQ_DEPOSIT_CANDIDATES
// H4_D61B_PAGO_FOLIO_FIRST_DIAGNOSTICS

export const manualLinkPagoIqDeposit = onCall(
  {
    cors: [
      "https://pay-0-system.web.app",
      "https://pay-0-system.firebaseapp.com",
      /^https:\/\/pay-0-system--.*\.web\.app$/,
      /^http:\/\/localhost:\d+$/,
    ],
    timeoutSeconds: 240,
    memory: "2GiB",
    concurrency: 1,
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    const data = asRecord(request.data);

    if (auth.role !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo superadmin puede vincular manualmente depositos IQ.");
    }

    const pagoId = cleanText(data.pagoId);
    const iqDepositId = cleanText(data.iqDepositId ?? data.iqId ?? data.folioIq);
    const operationStatus = cleanText(data.operationStatus ?? "En Operacion");
    const reconciliationStatusInput = cleanText(data.reconciliationStatus ?? "CONCILIADO");
    const note = cleanText(data.note ?? data.motivo ?? "");
    const updatePagoStatus = data.updatePagoStatus !== false;

    if (!pagoId) {
      throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
    }

    if (!/^\d{5,9}$/.test(iqDepositId)) {
      throw new HttpsError("invalid-argument", "Folio IQ invalido.");
    }

    const resolvedPagoH4D61B = await resolvePagoByIdOrFolioH4D50G(pagoId, auth.rootId);
    const pagoRef = resolvedPagoH4D61B.ref;
    const pagoSnap = resolvedPagoH4D61B.snap;
    const pago = resolvedPagoH4D61B.data;
    const resolvedPagoIdH4D61B = cleanText(pagoSnap.id ?? pagoRef.id ?? pagoId);

    const now = FieldValue.serverTimestamp();
    const upperReconciliation = cleanUpper(reconciliationStatusInput);
    const conciliated = /CONCILIAD|CONCILIATED/.test(upperReconciliation);

    const patch: Record<string, unknown> = {
      iqDepositId,
      iqDepositFolio: iqDepositId,
      iqPagoDepositId: iqDepositId,
      iqPagoDepositFolio: iqDepositId,
      iqDepositStatus: conciliated ? "CONCILIATED" : "LINKED",
      iqDepositOperationStatus: operationStatus || null,
      iqDepositReconciliationStatus: reconciliationStatusInput || (conciliated ? "CONCILIATED" : "LINKED"),
      iqDepositReconciliationMatchStrategy: "MANUAL_DIAGNOSTICO",
      iqDepositReconciliationLastError: null,
      iqDepositReconciliationMatchedAt: now,
      iqDepositManualLinkedAt: now,
      iqDepositManualLinkedBy: auth.uid,
      iqDepositManualLinkedByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
      iqDepositManualLinkedByRole: auth.role,
      iqDepositManualLinkNote: note || null,
      iqDepositCreationRetryBlocked: false,
      iqDepositAutomationOmitted: false,
      iqDepositUpdatedAt: now,
    };

    const currentStatus = cleanUpper(pago.status);

    if (conciliated && updatePagoStatus && currentStatus === "CONCILIACION_PENDIENTE") {
      patch.status = "CONCILIADO";
      patch.conciliatedAt = now;
      patch.conciliatedBy = auth.uid;
      Object.assign(patch, buildPagoFoundationOnConciliation(pago));
    }

    await pagoRef.set(patch, { merge: true });

    const shouldPostFinancialsH4D65A0 = updatePagoStatus &&
      shouldPostPagoFinancialsAfterIqConciliationH4D65A0({
        conciliated,
        currentStatus,
      });
    const financialPostingH4D65A0 = shouldPostFinancialsH4D65A0
      ? await postPagoFinancialsAfterIqConciliationH4D65A0({
          auth,
          actor: {
            uid: auth.uid,
            name: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
            role: auth.role,
          },
          pagoId: resolvedPagoIdH4D61B,
          pagoRef,
          source: "MANUAL_LINK_PAGO_IQ_DEPOSIT",
        })
      : null;
    // H4_D65_A0_MANUAL_LINK_POSTS_FINANCIALS

    await pagoRef.collection("notas").add({
      rootId: auth.rootId,
      text: `Deposito IQ vinculado manualmente: ${iqDepositId}${note ? ` | ${note}` : ""}`,
      createdBy: auth.uid,
      createdByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
      createdByRole: auth.role,
      createdAt: now,
    }).catch(() => undefined);

    if (conciliated && updatePagoStatus && currentStatus === "CONCILIACION_PENDIENTE") {
      await notifyIqPagoTelegramH4D59B({
        botToken: TELEGRAM_BOT_TOKEN.value(),
        auth,
        event: "IQ_PAGO_CONCILIADO",
        pagoId: resolvedPagoIdH4D61B,
        pago,
        iqId: iqDepositId,
        source: "MANUAL_LINK_PAGO_IQ_DEPOSIT",
        message: `Deposito IQ vinculado manualmente y pago actualizado: ${iqDepositId}`,
      }).catch(() => undefined);
    }
    // H4_D59B_NOTIFY_IQ_PAGO_CONCILIATED_MANUAL_LINK

    return {
      ok: true,
      data: {
        pagoId: resolvedPagoIdH4D61B,
        inputPagoReference: pagoId,
        iqDepositId,
        linked: true,
        conciliated,
        pay0StatusUpdated: conciliated && updatePagoStatus && currentStatus === "CONCILIACION_PENDIENTE",
        financialPostingAttempted: financialPostingH4D65A0?.attempted || false,
        financialPostingOk: financialPostingH4D65A0?.ok || false,
        financialPostingStatus: financialPostingH4D65A0?.status || null,
        financialSnapshotId: financialPostingH4D65A0?.snapshotId || null,
        financialPostingError: financialPostingH4D65A0?.errorMessage || null,
      },
      message: conciliated
        ? [
            "Deposito IQ vinculado manualmente y pago actualizado.",
            financialPostingMessageH4D65A0(financialPostingH4D65A0),
          ].filter(Boolean).join(" ")
        : "Deposito IQ vinculado manualmente.",
    };
  },
);

export const omitPagoIqDepositAutomation = onCall(
  {
    cors: [
      "https://pay-0-system.web.app",
      "https://pay-0-system.firebaseapp.com",
      /^https:\/\/pay-0-system--.*\.web\.app$/,
      /^http:\/\/localhost:\d+$/,
    ],
    timeoutSeconds: 240,
    memory: "2GiB",
    concurrency: 1,
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    const data = asRecord(request.data);

    if (auth.role !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo superadmin puede omitir seguimiento IQ de pagos.");
    }

    const pagoId = cleanText(data.pagoId);
    const reason = cleanText(data.reason ?? data.motivo ?? "");

    if (!pagoId) {
      throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
    }

    if (!reason) {
      throw new HttpsError("invalid-argument", "Motivo obligatorio.");
    }

    const pagoRef = db.collection("pagos").doc(pagoId);
    const pagoSnap = await pagoRef.get();

    if (!pagoSnap.exists) {
      throw new HttpsError("not-found", "Pago PAY0 no encontrado.");
    }

    const pago = asRecord(pagoSnap.data());
    assertSameRoot(pago, auth.rootId, "Pago");

    const now = FieldValue.serverTimestamp();

    await pagoRef.set(
      {
        iqDepositAutomationOmitted: true,
        iqDepositFollowupStatus: "OMITTED",
        iqDepositReconciliationStatus: "OMITTED",
        iqDepositReconciliationLastError: null,
        iqDepositCreationRetryBlocked: true,
        iqDepositManualOmittedAt: now,
        iqDepositManualOmittedBy: auth.uid,
        iqDepositManualOmittedByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
        iqDepositManualOmittedByRole: auth.role,
        iqDepositManualOmitReason: reason,
        iqDepositUpdatedAt: now,
      },
      { merge: true },
    );

    await pagoRef.collection("notas").add({
      rootId: auth.rootId,
      text: `Seguimiento IQ Pagos omitido manualmente: ${reason}`,
      createdBy: auth.uid,
      createdByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
      createdByRole: auth.role,
      createdAt: now,
    }).catch(() => undefined);

    return {
      ok: true,
      data: {
        pagoId,
        omitted: true,
      },
      message: "Seguimiento IQ Pagos omitido.",
    };
  },
);

// IQ2G_H4_D50B_MANUAL_LINK_PAGO_IQ_DEPOSIT
// IQ2G_H4_D50C_HEALTHCHECK_MEMORY_2GIB
// IQ2G_H4_D50D_EXPLICIT_CORS_MANUAL_IQ_PAGOS


const setManualIqPagosCorsH4D50F = (req: any, res: any): boolean => {
  const origin = cleanText(req.headers?.origin ?? "");
  const allowed =
    origin === "https://pay-0-system.web.app" ||
    origin === "https://pay-0-system.firebaseapp.com" ||
    /^https:\/\/pay-0-system--.*\.web\.app$/.test(origin) ||
    /^http:\/\/localhost:\d+$/.test(origin);

  res.set("Access-Control-Allow-Origin", allowed ? origin : "https://pay-0-system.web.app");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Max-Age", "3600");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }

  return false;
};

const httpErrorStatusH4D50F = (err: any): number => {
  const code = cleanText(err?.code).toLowerCase();

  if (code.includes("unauthenticated")) return 401;
  if (code.includes("permission-denied")) return 403;
  if (code.includes("not-found")) return 404;
  if (code.includes("invalid-argument")) return 400;
  if (code.includes("failed-precondition")) return 412;

  return 500;
};

const getHttpAuthContextH4D50F = async (req: any): Promise<{
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
}> => {
  const authorization = cleanText(req.headers?.authorization ?? req.get?.("authorization") ?? "");
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const decoded = await admin.auth().verifyIdToken(token);
  const uid = cleanText(decoded.uid);

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion invalida.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  const user = asRecord(userSnap.data());
  const role = cleanText(user.role ?? (decoded as any).role).toLowerCase();
  const rootId = cleanText(user.rootId ?? (decoded as any).rootId ?? (role === "superadmin" ? uid : ""));

  if (!role) {
    throw new HttpsError("permission-denied", "Usuario sin rol.");
  }

  if (!rootId) {
    throw new HttpsError("permission-denied", "Usuario sin rootId.");
  }

  return { uid, role, rootId, user };
};


const resolvePagoByIdOrFolioH4D50G = async (
  input: string,
  rootId: string,
): Promise<{ ref: any; snap: any; data: Record<string, unknown>; resolvedBy: string }> => {
  const value = cleanText(input);
  const upperValue = cleanUpper(value);

  if (!value) {
    throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
  }

  const directRef = db.collection("pagos").doc(value);
  const directSnap = await directRef.get();

  if (directSnap.exists) {
    const data = asRecord(directSnap.data());
    assertSameRoot(data, rootId, "Pago");
    return { ref: directRef, snap: directSnap, data, resolvedBy: "DOC_ID" };
  }

  const fields = [
    "folio",
    "referenceFolio",
    "pagoFolio",
    "folioPago",
    "displayFolio",
    "pagoId",
    "id",
  ];

  for (const field of fields) {
    for (const candidate of [value, upperValue]) {
      if (!candidate) continue;

      const querySnap = await db
        .collection("pagos")
        .where(field, "==", candidate)
        .limit(10)
        .get()
        .catch(() => null);

      if (!querySnap || querySnap.empty) continue;

      for (const doc of querySnap.docs) {
        const data = asRecord(doc.data());

        try {
          assertSameRoot(data, rootId, "Pago");
        } catch {
          continue;
        }

        const candidateValues = [
          data.folio,
          data.referenceFolio,
          data.pagoFolio,
          data.folioPago,
          data.displayFolio,
          data.pagoId,
          data.id,
          doc.id,
        ].map((item) => cleanUpper(item));

        if (candidateValues.includes(upperValue)) {
          return {
            ref: doc.ref,
            snap: doc,
            data,
            resolvedBy: `FIELD_${field}`,
          };
        }
      }
    }
  }

  throw new HttpsError("not-found", "Pago PAY0 no encontrado.");
};

// IQ2G_H4_D50G_RESOLVE_PAGO_BY_ID_OR_FOLIO
export const manualLinkPagoIqDepositHttp = onRequest(
  {
    cors: false,
    timeoutSeconds: 240,
    memory: "2GiB",
    concurrency: 1,
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (req, res) => {
    if (setManualIqPagosCorsH4D50F(req, res)) return;

    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, message: "Metodo no permitido." });
        return;
      }

      const auth = await getHttpAuthContextH4D50F(req);
      const data = asRecord(req.body);

      if (auth.role !== "superadmin") {
        throw new HttpsError("permission-denied", "Solo superadmin puede vincular manualmente depositos IQ.");
      }

      const pagoId = cleanText(data.pagoId);
      const iqDepositId = cleanText(data.iqDepositId ?? data.iqId ?? data.folioIq);
      const operationStatus = cleanText(data.operationStatus ?? "En Operacion");
      const reconciliationStatusInput = cleanText(data.reconciliationStatus ?? "CONCILIADO");
      const note = cleanText(data.note ?? data.motivo ?? "");
      const updatePagoStatus = data.updatePagoStatus !== false;

      if (!pagoId) {
        throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
      }

      if (!/^\d{5,9}$/.test(iqDepositId)) {
        throw new HttpsError("invalid-argument", "Folio IQ invalido.");
      }

      const resolvedPagoH4D50G = await resolvePagoByIdOrFolioH4D50G(pagoId, auth.rootId);
      const pagoRef = resolvedPagoH4D50G.ref;
      const pagoSnap = resolvedPagoH4D50G.snap;
      const pago = resolvedPagoH4D50G.data;

      const now = FieldValue.serverTimestamp();
      const upperReconciliation = cleanUpper(reconciliationStatusInput);
      const conciliated = /CONCILIAD|CONCILIATED/.test(upperReconciliation);

      const patch: Record<string, unknown> = {
        iqDepositId,
        iqDepositFolio: iqDepositId,
        iqPagoDepositId: iqDepositId,
        iqPagoDepositFolio: iqDepositId,
        iqDepositStatus: conciliated ? "CONCILIATED" : "LINKED",
        iqDepositOperationStatus: operationStatus || null,
        iqDepositReconciliationStatus: reconciliationStatusInput || (conciliated ? "CONCILIATED" : "LINKED"),
        iqDepositReconciliationMatchStrategy: "MANUAL_DIAGNOSTICO_HTTP",
        iqDepositReconciliationLastError: null,
        iqDepositReconciliationMatchedAt: now,
        iqDepositManualLinkedAt: now,
        iqDepositManualLinkedBy: auth.uid,
        iqDepositManualLinkedByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
        iqDepositManualLinkedByRole: auth.role,
        iqDepositManualLinkNote: note || null,
        iqDepositCreationRetryBlocked: false,
        iqDepositAutomationOmitted: false,
        iqDepositUpdatedAt: now,
      };

      const currentStatus = cleanUpper(pago.status);

      if (conciliated && updatePagoStatus && currentStatus === "CONCILIACION_PENDIENTE") {
        patch.status = "CONCILIADO";
        patch.conciliatedAt = now;
        patch.conciliatedBy = auth.uid;
        Object.assign(patch, buildPagoFoundationOnConciliation(pago));
      }

      await pagoRef.set(patch, { merge: true });

      const shouldPostFinancialsH4D65A0 = updatePagoStatus &&
        shouldPostPagoFinancialsAfterIqConciliationH4D65A0({
          conciliated,
          currentStatus,
        });
      const financialPostingH4D65A0 = shouldPostFinancialsH4D65A0
        ? await postPagoFinancialsAfterIqConciliationH4D65A0({
            auth,
            actor: {
              uid: auth.uid,
              name: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
              role: auth.role,
            },
            pagoId,
            pagoRef,
            source: "MANUAL_LINK_PAGO_IQ_DEPOSIT_HTTP",
          })
        : null;
      // H4_D65_A0_MANUAL_LINK_HTTP_POSTS_FINANCIALS

      await pagoRef.collection("notas").add({
        rootId: auth.rootId,
        text: `Deposito IQ vinculado manualmente: ${iqDepositId}${note ? ` | ${note}` : ""}`,
        createdBy: auth.uid,
        createdByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
        createdByRole: auth.role,
        createdAt: now,
      }).catch(() => undefined);

      if (conciliated && updatePagoStatus && currentStatus === "CONCILIACION_PENDIENTE") {
        await notifyIqPagoTelegramH4D59B({
          botToken: TELEGRAM_BOT_TOKEN.value(),
          auth,
          event: "IQ_PAGO_CONCILIADO",
          pagoId,
          pago,
          iqId: iqDepositId,
          source: "MANUAL_LINK_PAGO_IQ_DEPOSIT_HTTP",
          message: `Deposito IQ vinculado manualmente y pago actualizado: ${iqDepositId}`,
        }).catch(() => undefined);
      }
      // H4_D59B_NOTIFY_IQ_PAGO_CONCILIATED_MANUAL_LINK_HTTP

      res.status(200).json({
        ok: true,
        data: {
          pagoId,
          iqDepositId,
          linked: true,
          conciliated,
          pay0StatusUpdated: conciliated && updatePagoStatus && currentStatus === "CONCILIACION_PENDIENTE",
          financialPostingAttempted: financialPostingH4D65A0?.attempted || false,
          financialPostingOk: financialPostingH4D65A0?.ok || false,
          financialPostingStatus: financialPostingH4D65A0?.status || null,
          financialSnapshotId: financialPostingH4D65A0?.snapshotId || null,
          financialPostingError: financialPostingH4D65A0?.errorMessage || null,
        },
        message: conciliated
          ? [
              "Deposito IQ vinculado manualmente y pago actualizado.",
              financialPostingMessageH4D65A0(financialPostingH4D65A0),
            ].filter(Boolean).join(" ")
          : "Deposito IQ vinculado manualmente.",
      });
    } catch (err: any) {
      res.status(httpErrorStatusH4D50F(err)).json({
        ok: false,
        message: cleanText(err?.message) || "internal",
        code: cleanText(err?.code) || "internal",
      });
    }
  },
);

export const omitPagoIqDepositAutomationHttp = onRequest(
  {
    cors: false,
    timeoutSeconds: 240,
    memory: "2GiB",
    concurrency: 1,
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (req, res) => {
    if (setManualIqPagosCorsH4D50F(req, res)) return;

    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, message: "Metodo no permitido." });
        return;
      }

      const auth = await getHttpAuthContextH4D50F(req);
      const data = asRecord(req.body);

      if (auth.role !== "superadmin") {
        throw new HttpsError("permission-denied", "Solo superadmin puede omitir seguimiento IQ de pagos.");
      }

      const pagoId = cleanText(data.pagoId);
      const reason = cleanText(data.reason ?? data.motivo ?? "");

      if (!pagoId) {
        throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
      }

      if (!reason) {
        throw new HttpsError("invalid-argument", "Motivo obligatorio.");
      }

      const resolvedPagoH4D50G = await resolvePagoByIdOrFolioH4D50G(pagoId, auth.rootId);
      const pagoRef = resolvedPagoH4D50G.ref;
      const pagoSnap = resolvedPagoH4D50G.snap;
      const pago = resolvedPagoH4D50G.data;

      const now = FieldValue.serverTimestamp();

      await pagoRef.set(
        {
          iqDepositAutomationOmitted: true,
          iqDepositFollowupStatus: "OMITTED",
          iqDepositReconciliationStatus: "OMITTED",
          iqDepositReconciliationLastError: null,
          iqDepositCreationRetryBlocked: true,
          iqDepositManualOmittedAt: now,
          iqDepositManualOmittedBy: auth.uid,
          iqDepositManualOmittedByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
          iqDepositManualOmittedByRole: auth.role,
          iqDepositManualOmitReason: reason,
          iqDepositUpdatedAt: now,
        },
        { merge: true },
      );

      await pagoRef.collection("notas").add({
        rootId: auth.rootId,
        text: `Seguimiento IQ Pagos omitido manualmente: ${reason}`,
        createdBy: auth.uid,
        createdByName: cleanText(auth.user.username ?? auth.user.name ?? auth.uid),
        createdByRole: auth.role,
        createdAt: now,
      }).catch(() => undefined);

      res.status(200).json({
        ok: true,
        data: {
          pagoId,
          omitted: true,
        },
        message: "Seguimiento IQ Pagos omitido.",
      });
    } catch (err: any) {
      res.status(httpErrorStatusH4D50F(err)).json({
        ok: false,
        message: cleanText(err?.message) || "internal",
        code: cleanText(err?.code) || "internal",
      });
    }
  },
);

// IQ2G_H4_D50F_HTTP_MANUAL_IQ_PAGOS
// IQ2G_H4_D50G_MANUAL_RESOLVES_FOLIO
// H4_D61B24_USED_IQ_CANDIDATE_FILTER_PATCH

// H4_D61B25A_MIN_BACKEND_AUTO_ADOPT_PATCH



