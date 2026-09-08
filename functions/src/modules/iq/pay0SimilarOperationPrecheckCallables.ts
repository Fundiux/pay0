import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertIqAuthorized } from "./authorization";

type OperationTypeH4D58F = "PAGO" | "SOLICITUD";

interface SimilarCandidateH4D58F {
  id: string;
  folio: string;
  status: string;
  amount: number;
  amountCents: number;
  clientName: string;
  companyName: string;
  clientId: string;
  companyId: string;
  createdDay: string;
  createdAtMs: number;
  isTerminalCancelled: boolean;
  matchesClient: boolean;
  matchesCompany: boolean;
  matchesAmount: boolean;
  inWindow: boolean;
  isSimilar: boolean;
}

function ensureAdminH4D58F() {
  if (!getApps().length) initializeApp();
}

function cleanTextH4D58F(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactKeyH4D58F(value: unknown): string {
  return cleanTextH4D58F(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, "")
    .toUpperCase();
}

function numberFromMoneyH4D58F(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const raw = String(value).replace(/[^0-9.-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function centsH4D58F(value: unknown): number {
  const n = numberFromMoneyH4D58F(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function msFromUnknownH4D58F(value: unknown): number {
  if (!value) return 0;

  const anyValue = value as any;

  if (typeof anyValue.toMillis === "function") {
    const n = Number(anyValue.toMillis());
    return Number.isFinite(n) ? n : 0;
  }

  if (typeof anyValue.toDate === "function") {
    const d = anyValue.toDate();
    return d instanceof Date ? d.getTime() : 0;
  }

  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const parsed = Date.parse(cleanTextH4D58F(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayKeyH4D58F(value: unknown): string {
  const ms = msFromUnknownH4D58F(value);
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function shiftDayH4D58F(day: string, delta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + delta * 86400000).toISOString().slice(0, 10);
}

function dayDistanceH4D58F(a: string, b: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 999999;
  const ams = Date.parse(`${a}T00:00:00.000Z`);
  const bms = Date.parse(`${b}T00:00:00.000Z`);
  if (!Number.isFinite(ams) || !Number.isFinite(bms)) return 999999;
  return Math.abs(Math.round((ams - bms) / 86400000));
}

function operationTypeH4D58F(value: unknown): OperationTypeH4D58F {
  const key = compactKeyH4D58F(value);
  if (key === "SOLICITUD" || key === "SOLICITUDES") return "SOLICITUD";
  return "PAGO";
}

function collectionForOperationH4D58F(type: OperationTypeH4D58F): string {
  return type === "SOLICITUD" ? "solicitudes" : "pagos";
}

function pickFirstH4D58F(data: Record<string, unknown>, fields: string[]): unknown {
  for (const field of fields) {
    const value = data[field];
    if (value !== null && value !== undefined && cleanTextH4D58F(value) !== "") return value;
  }
  return "";
}

function pickAmountCentsH4D58F(data: Record<string, unknown>, fallback: Record<string, unknown>): { amountCents: number; source: string } {
  const override = centsH4D58F(fallback.amountOverride ?? fallback.amount);
  if (override > 0) return { amountCents: override, source: "REQUEST_OVERRIDE" };

  const centsFields = [
    "amountCents",
    "montoCents",
    "totalCents",
    "iqDepositAmountCents",
    "iqPagoDepositAmountCents",
    "iqDepositHistoricalAmountCents",
  ];

  for (const field of centsFields) {
    const n = Number(data[field] ?? 0);
    if (Number.isFinite(n) && n > 0) return { amountCents: Math.round(n), source: field };
  }

  const amountFields = [
    "monto",
    "montoPago",
    "montoDepositado",
    "montoRecibido",
    "importe",
    "total",
    "amount",
    "suma",
    "depositAmount",
    "paymentAmount",
    "totalAmount",
    "iqDepositAmount",
    "iqPagoDepositAmount",
    "iqDepositHistoricalAmount",
  ];

  for (const field of amountFields) {
    const c = centsH4D58F(data[field]);
    if (c > 0) return { amountCents: c, source: field };
  }

  return { amountCents: 0, source: "NOT_FOUND" };
}

function extractOperationContextH4D58F(
  id: string,
  type: OperationTypeH4D58F,
  data: Record<string, unknown>,
  input: Record<string, unknown>
) {
  const amountPick = pickAmountCentsH4D58F(data, input);

  const clientId = cleanTextH4D58F(
    pickFirstH4D58F(data, ["clienteId", "clientId", "customerId"])
      || pickFirstH4D58F(input, ["clienteId", "clientId", "customerId"])
  );

  const companyId = cleanTextH4D58F(
    pickFirstH4D58F(data, ["companyId", "empresaId", "companyUid"])
      || pickFirstH4D58F(input, ["companyId", "empresaId", "companyUid"])
  );

  const clientName = cleanTextH4D58F(
    pickFirstH4D58F(data, ["clienteNombre", "clientName", "cliente", "customerName", "iqClientName"])
      || pickFirstH4D58F(input, ["clienteNombre", "clientName", "cliente", "customerName", "iqClientName"])
  );

  const companyName = cleanTextH4D58F(
    pickFirstH4D58F(data, ["empresaNombre", "companyName", "empresa", "iqCompanyName"])
      || pickFirstH4D58F(input, ["empresaNombre", "companyName", "empresa", "iqCompanyName"])
  );

  const createdAt = pickFirstH4D58F(data, ["createdAt", "fecha", "createdAtIso", "date", "createdDate"])
    || pickFirstH4D58F(input, ["createdAt", "fecha", "createdAtIso", "date", "createdDate"])
    || new Date();

  const createdAtMs = msFromUnknownH4D58F(createdAt) || Date.now();
  const createdDay = dayKeyH4D58F(createdAtMs);

  const folio = cleanTextH4D58F(
    pickFirstH4D58F(data, ["folio", "folioPago", "folioSolicitud", "pay0Folio", "displayFolio", "nFolio"])
      || id
  );

  const status = cleanTextH4D58F(pickFirstH4D58F(data, ["status", "estado", "paymentStatus", "solicitudStatus"]));

  return {
    id,
    type,
    amountCents: amountPick.amountCents,
    amount: amountPick.amountCents / 100,
    amountSource: amountPick.source,
    clientId,
    companyId,
    clientName,
    companyName,
    clientKey: compactKeyH4D58F(clientName),
    companyKey: compactKeyH4D58F(companyName),
    createdAtMs,
    createdDay,
    folio,
    status,
  };
}

function isTerminalCancelledH4D58F(status: unknown): boolean {
  const key = compactKeyH4D58F(status);
  return key.includes("CANCELAD") || key.includes("ELIMINAD") || key.includes("DELETED");
}

function summarizeCandidateH4D58F(
  id: string,
  type: OperationTypeH4D58F,
  data: Record<string, unknown>,
  current: ReturnType<typeof extractOperationContextH4D58F>,
  minDay: string,
  maxDay: string
): SimilarCandidateH4D58F {
  const ctx = extractOperationContextH4D58F(id, type, data, {});
  const candidateClientId = ctx.clientId;
  const candidateCompanyId = ctx.companyId;

  const matchesClient =
    Boolean(current.clientId && candidateClientId && current.clientId === candidateClientId) ||
    Boolean(current.clientKey && ctx.clientKey && current.clientKey === ctx.clientKey);

  const matchesCompany =
    Boolean(current.companyId && candidateCompanyId && current.companyId === candidateCompanyId) ||
    Boolean(current.companyKey && ctx.companyKey && current.companyKey === ctx.companyKey);

  const matchesAmount = current.amountCents > 0 && ctx.amountCents === current.amountCents;
  const inWindow = Boolean(ctx.createdDay && minDay && maxDay && ctx.createdDay >= minDay && ctx.createdDay <= maxDay);
  const terminal = isTerminalCancelledH4D58F(ctx.status);

  return {
    id,
    folio: ctx.folio,
    status: ctx.status,
    amount: ctx.amount,
    amountCents: ctx.amountCents,
    clientName: ctx.clientName,
    companyName: ctx.companyName,
    clientId: ctx.clientId,
    companyId: ctx.companyId,
    createdDay: ctx.createdDay,
    createdAtMs: ctx.createdAtMs,
    isTerminalCancelled: terminal,
    matchesClient,
    matchesCompany,
    matchesAmount,
    inWindow,
    isSimilar: id !== current.id && matchesClient && matchesCompany && matchesAmount && inWindow && !terminal,
  };
}

async function fetchPotentialDocsH4D58F(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  current: ReturnType<typeof extractOperationContextH4D58F>
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const col = db.collection(collectionName);
  const found = new Map<string, Record<string, unknown>>();

  async function addQuery(query: FirebaseFirestore.Query) {
    const snap = await query.get();
    for (const doc of snap.docs) {
      found.set(doc.id, doc.data() || {});
    }
  }

  if (current.clientId) {
    await addQuery(col.where("clienteId", "==", current.clientId).limit(200));
  }

  if (current.clientId) {
    await addQuery(col.where("clientId", "==", current.clientId).limit(200));
  }

  if (current.clientKey && found.size < 20) {
    await addQuery(col.orderBy("createdAt", "desc").limit(300));
  }

  return Array.from(found.entries()).map(([id, data]) => ({ id, data }));
}

export async function precheckSimilarPay0OperationInternalH4D58F(inputRaw: Record<string, unknown>) {
  ensureAdminH4D58F();

  const db = getFirestore();
  const input = inputRaw || {};
  const type = operationTypeH4D58F(input.operationType || input.kind || input.type);
  const collectionName = collectionForOperationH4D58F(type);

  const operationId = cleanTextH4D58F(
    input.operationId ||
    input.pagoId ||
    input.solicitudId ||
    input.id
  );

  const windowDaysRaw = Number(input.windowDays ?? 3);
  const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw >= 0 && windowDaysRaw <= 15
    ? Math.round(windowDaysRaw)
    : 3;

  let operationData: Record<string, unknown> = {};
  let operationExists = false;

  if (operationId) {
    const snap = await db.collection(collectionName).doc(operationId).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", `${collectionName}/${operationId} no existe`);
    }

    operationData = snap.data() || {};
    operationExists = true;
  } else {
    operationData = (input.operationDraft || input.draft || input) as Record<string, unknown>;
  }

  const current = extractOperationContextH4D58F(operationId || "DRAFT", type, operationData, input);

  if (!current.amountCents || !current.clientKey || !current.companyKey || !current.createdDay) {
    return {
      ok: true,
      operationType: type,
      collectionName,
      operationExists,
      current,
      requiresConfirmation: false,
      shouldBlock: false,
      warningOnly: true,
      reason: "INSUFFICIENT_DATA_FOR_SIMILAR_PRECHECK",
      candidates: [],
    };
  }

  const minDay = shiftDayH4D58F(current.createdDay, -windowDays);
  const maxDay = shiftDayH4D58F(current.createdDay, windowDays);

  const docs = await fetchPotentialDocsH4D58F(db, collectionName, current);

  const candidates = docs
    .map((item) => summarizeCandidateH4D58F(item.id, type, item.data, current, minDay, maxDay))
    .filter((candidate) => candidate.isSimilar)
    .sort((a, b) => {
      const dayDiff = dayDistanceH4D58F(a.createdDay, current.createdDay) - dayDistanceH4D58F(b.createdDay, current.createdDay);
      if (dayDiff !== 0) return dayDiff;
      return b.createdAtMs - a.createdAtMs;
    })
    .slice(0, 20);

  return {
    ok: true,
    operationType: type,
    collectionName,
    operationExists,
    current,
    windowDays,
    minDay,
    maxDay,
    requiresConfirmation: candidates.length > 0,
    shouldBlock: false,
    warningOnly: true,
    message: candidates.length > 0
      ? "Existen operaciones PAY0 parecidas. Confirmar si esta es una operacion nueva antes de crear en IQ."
      : "No se encontraron operaciones PAY0 parecidas.",
    candidates,
  };
}

export async function assertSimilarPay0OperationConfirmedForIqCreateH4D58F(inputRaw: Record<string, unknown>) {
  const input = inputRaw || {};
  const result = await precheckSimilarPay0OperationInternalH4D58F({
    ...input,
    windowDays: input.windowDays ?? 3,
  });

  const current = (result as any).current || {};
  const operationId = cleanTextH4D58F(
    input.operationId ||
    input.pagoId ||
    input.solicitudId ||
    input.id ||
    current.id
  );

  if (!operationId || !(result as any).requiresConfirmation) {
    return {
      ok: true,
      requiresConfirmation: false,
      confirmed: true,
      result,
    };
  }

  const type = operationTypeH4D58F(input.operationType || input.kind || input.type);
  const collectionName = collectionForOperationH4D58F(type);
  const db = getFirestore();
  const snap = await db.collection(collectionName).doc(operationId).get();
  const data = snap.exists ? (snap.data() || {}) : {};

  const alreadyConfirmed =
    data.similarPay0OperationConfirmedNew === true ||
    data.duplicateCheckConfirmed === true ||
    data.iqCreationAllowedDespiteSimilarPay0 === true;

  if (alreadyConfirmed) {
    return {
      ok: true,
      requiresConfirmation: true,
      confirmed: true,
      result,
    };
  }

  return {
    ok: false,
    requiresConfirmation: true,
    confirmed: false,
    shouldBlock: true,
    warningOnly: true,
    errorCode: "SIMILAR_PAY0_OPERATION_CONFIRMATION_REQUIRED",
    message: "Existen operaciones PAY0 parecidas. Confirma si esta es una operacion nueva antes de crear en IQ.",
    result,
  };
}
export const precheckSimilarPay0Operation = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    const data = (request.data || {}) as Record<string, unknown>;
    const type = operationTypeH4D58F(data.operationType || data.kind || data.type);
    await assertIqAuthorized(request, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: type === "PAGO" ? "pagos" : "solicitudes", requiredAction: "create" });
    return precheckSimilarPay0OperationInternalH4D58F(data);
  }
);

export const confirmSimilarPay0OperationAsNew = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    const data = (request.data || {}) as Record<string, unknown>;
    const type = operationTypeH4D58F(data.operationType || data.kind || data.type);
    await assertIqAuthorized(request, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: type === "PAGO" ? "pagos" : "solicitudes", requiredAction: "create" });
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Sesion requerida.");
    const collectionName = collectionForOperationH4D58F(type);

    const operationId = cleanTextH4D58F(
      data.operationId ||
      data.pagoId ||
      data.solicitudId ||
      data.id
    );

    if (!operationId) {
      throw new HttpsError("invalid-argument", "operationId requerido.");
    }

    const candidateIds = Array.isArray(data.candidateIds)
      ? data.candidateIds.map(cleanTextH4D58F).filter(Boolean).slice(0, 50)
      : [];

    const reason = cleanTextH4D58F(data.reason || "Operacion nueva confirmada en PAY0.");

    const db = getFirestore();
    const ref = db.collection(collectionName).doc(operationId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", `${collectionName}/${operationId} no existe`);
    }

    const patch = {
      similarPay0OperationConfirmedNew: true,
      similarPay0OperationConfirmedAt: FieldValue.serverTimestamp(),
      similarPay0OperationConfirmedBy: callerUid,
      similarPay0OperationCandidateIds: candidateIds,
      similarPay0OperationDecision: "NEW_OPERATION",
      similarPay0OperationScope: "IQ_CREATE_PRECHECK",
      similarPay0OperationReason: reason,

      duplicateCheckConfirmed: true,
      duplicateCheckConfirmedAt: FieldValue.serverTimestamp(),
      duplicateCheckConfirmedBy: callerUid,
      duplicateCheckExistingFolios: candidateIds,
      duplicateCheckDecision: "NEW_OPERATION",

      iqCreationAllowedDespiteSimilarPay0: true,
      iqCreationAllowedDespiteSimilarPay0At: FieldValue.serverTimestamp(),
      iqCreationAllowedDespiteSimilarPay0By: callerUid,
    };

    await ref.set(patch, { merge: true });

    return {
      ok: true,
      operationType: type,
      collectionName,
      operationId,
      candidateIds,
      decision: "NEW_OPERATION",
      shouldBlock: false,
      iqCreationAllowedDespiteSimilarPay0: true,
    };
  }
);
