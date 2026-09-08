import * as crypto from "node:crypto";
import {
  HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { FieldValue,
  type DocumentData,
  type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import {
  IQ_CANONICAL_TIME_ZONE,
  parseIqDateTimeMs,
} from "../iq/iqDateTime";
import type { PaymentApplicationActor } from "./service";
import {
  PAYMENT_APPLICATION_IQ_EXECUTION_VERSION,
  buildPaymentApplicationIqExecutionAttemptId,
  } from "./domain";
type IqPaymentApplicationFieldCheck = {
  field:
    | "ASOCIADO"
    | "CLIENTE"
    | "EMPRESA"
    | "DEPOSITO"
    | "FACTURA"
    | "MONTO";
  expected: string;
  selected: string;
  ok: boolean;
  message: string;
};

type IqPaymentApplicationItemResult = {
  key: string;
  solicitudIqFolio: string;
  expectedAmount: number;
  rowMatched: boolean;
  amountMatched: number;
  status:
    | "PENDING"
    | "VERIFIED"
    | "SUCCEEDED"
    | "REJECTED"
    | "UNKNOWN";
  message: string;
};

type IqPaymentApplicationBrowserResult = {
  authenticated: boolean;
  routeAccessible: boolean;
  formOpened: boolean;
  depositMatched: string;
  verified: boolean;
  submitClicked: boolean;
  confirmationClicked: boolean;
  iqActionExecuted: boolean;
  outcome:
    | "NOT_SUBMITTED"
    | "SUCCEEDED"
    | "REJECTED"
    | "UNKNOWN";
  status: string;
  message: string;
  finalPath: string;
  iqApplicationId: string;
  responseStatus: number;
  responseMessage: string;
  fieldChecks: IqPaymentApplicationFieldCheck[];
  diagnosticMethod?: string;
  itemResults: IqPaymentApplicationItemResult[];
  errors: string[];
};

// H4_D87_A56_A7_LOCAL_HTTP_RESULT_CONTRACT
import { evaluateIqCompanyDespachoGate } from "./iqBusinessGate";
import {
  loginIqHttpDirect,
  toIqAuthContext,
} from "../iq/iqHttpAuth";

export const IQ_PAYMENT_APPLICATION_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
export const IQ_PAYMENT_APPLICATION_SECRETS = [IQ_PAYMENT_APPLICATION_CREDENTIALS_KEY];

const DEFAULT_IQ_ERP_URL = "https://sistema-3-erp.vercel.app";
const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

function resolveIqApiOrigin(): string {
  const raw =
    cleanText(process.env.PAY0_IQ_API_ORIGIN) ||
    DEFAULT_IQ_API_ORIGIN;

  try {
    return new URL(raw).origin;
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "La URL API de IQ es invalida.",
    );
  }
}

export type IqAccess = {
  profileId: string;
  profileAlias: string;
  username: string;
  password: string;
  erpUrl: string;
  apiOrigin: string;
};

type StoredPlanItem = {
  planItemId: string;
  lockId: string;
  applicationId: string;
  solicitudId: string;
  solicitudFolio: string;
  solicitudIqFolio: string;
  invoiceType: "PUE" | "PPD";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  requiresComplement: boolean;
  requiresSameMonthSettlement: boolean;
  pueSettlementStatus: string;
  settlementPolicy: string;
  nextStep: string;
};

type ClaimedExecution = {
  reused: false;
  planId: string;
  planHash: string;
  reservationId: string;
  pagoId: string;
  pagoIqFolio: string;
  asociadoName: string;
  clienteName: string;
  empresaName: string;
  attemptId: string;
  attemptNumber: number;
  items: StoredPlanItem[];
};

type ReusedExecution = {
  reused: true;
  result: PaymentApplicationIqExecutionResult;
};

export type PaymentApplicationIqExecutionResult = {
  ok: true;
  reused: boolean;
  planId: string;
  planHash: string;
  reservationId: string;
  attemptId: string;
  attemptNumber: number;
  status:
    | "IQ_APPLIED"
    | "PREVALIDATED"
    | "IQ_REJECTED_REVIEW_REQUIRED"
    | "IQ_UNKNOWN_REVIEW_REQUIRED";
  iqExecutionStatus:
    | "SUCCEEDED"
    | "FAILED_SAFE"
    | "REJECTED_REVIEW_REQUIRED"
    | "UNKNOWN_REVIEW_REQUIRED";
  iqActionExecuted: boolean;
  iqApplicationId: string;
  message: string;
  browserResult: Record<string, unknown>;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanUpper(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function money2(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function timestampToMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (
      value as {
        toMillis?: unknown;
      }
    ).toMillis === "function"
  ) {
    return (
      value as {
        toMillis: () => number;
      }
    ).toMillis();
  }

  return Number(value) || 0;
}

type IqPaymentApplicationFolioResolution = {
  iqApplicationId: string;
  matchedCount: number;
  message: string;
};

function iqMexicoDateFromMs(valueMs: number): string {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: IQ_CANONICAL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(new Date(valueMs));

  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${map.year}-${map.month}-${map.day}`;
}

async function resolveIqPaymentApplicationFolioReadOnly(params: {
  auth: ReturnType<typeof toIqAuthContext>;
  pagoIqFolio: string;
  solicitudIqFolio: string;
  amount: number;
  asociadoName: string;
  clienteName: string;
  empresaName: string;
  lowerBoundMs: number;
}): Promise<IqPaymentApplicationFolioResolution> {
  const normalizeName = (value: unknown): string =>
    cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

  const backoffs = [0, 750, 1500, 2500];
  const temporalLowerBoundMs =
    params.lowerBoundMs - 15_000;

  for (const delay of backoffs) {
    if (delay > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, delay),
      );
    }

    const url = new URL(
      "/payment_applications",
      params.auth.apiOrigin,
    );

    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", "0");
    url.searchParams.set("pending", "false");
    url.searchParams.set("cancelled", "false");
    url.searchParams.set("rejected", "false");
    url.searchParams.set(
      "start_date",
      iqMexicoDateFromMs(temporalLowerBoundMs),
    );

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      30000,
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization:
            `Bearer ${params.auth.bearerToken}`,
        },
        signal: controller.signal,
      });

      const payload = await response
        .json()
        .catch(() => []);

      if (!response.ok) {
        return {
          iqApplicationId: "",
          matchedCount: 0,
          message:
            `IQ_PAYMENT_APPLICATION_LIST_HTTP_${response.status}`,
        };
      }

      const rows = Array.isArray(payload)
        ? payload.map((row) => asRecord(row))
        : [];

      const matches = rows.filter((row) => {
        const createdAtMs =
          parseIqDateTimeMs(row.created_at);

        return (
          cleanText(row.deposit_id) ===
            cleanText(params.pagoIqFolio) &&
          cleanText(row.invoice_id) ===
            cleanText(params.solicitudIqFolio) &&
          money2(row.sum) === money2(params.amount) &&
          normalizeName(row.partner) ===
            normalizeName(params.asociadoName) &&
          normalizeName(row.client) ===
            normalizeName(params.clienteName) &&
          normalizeName(row.company) ===
            normalizeName(params.empresaName) &&
          createdAtMs !== null &&
          Number.isFinite(createdAtMs) &&
          createdAtMs >= temporalLowerBoundMs
        );
      });

      if (matches.length > 1) {
        return {
          iqApplicationId: "",
          matchedCount: matches.length,
          message:
            "IQ_PAYMENT_APPLICATION_FOLIO_AMBIGUOUS",
        };
      }

      if (matches.length === 1) {
        const iqApplicationId =
          cleanText(matches[0].id);

        if (!/^\d+$/.test(iqApplicationId)) {
          return {
            iqApplicationId: "",
            matchedCount: 1,
            message:
              "IQ_PAYMENT_APPLICATION_FOLIO_INVALID",
          };
        }

        return {
          iqApplicationId,
          matchedCount: 1,
          message:
            "IQ_PAYMENT_APPLICATION_FOLIO_RESOLVED",
        };
      }
    } catch (error) {
      return {
        iqApplicationId: "",
        matchedCount: 0,
        message:
          cleanText(
            error instanceof Error
              ? error.message
              : error,
          ) ||
          "IQ_PAYMENT_APPLICATION_FOLIO_READ_FAILED",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    iqApplicationId: "",
    matchedCount: 0,
    message:
      "IQ_PAYMENT_APPLICATION_FOLIO_NOT_FOUND",
  };
}
function normalizeErpUrl(value: unknown): string {
  const raw = cleanText(value) || DEFAULT_IQ_ERP_URL;
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    throw new HttpsError("failed-precondition", "La cuenta IQ tiene una URL ERP invalida.");
  }
}

function getEncryptionKey(): Buffer {
  const raw = IQ_PAYMENT_APPLICATION_CREDENTIALS_KEY.value();
  if (!raw || raw.trim().length < 16) {
    throw new HttpsError("failed-precondition", "IQ_CREDENTIALS_KEY no esta configurada.");
  }
  const value = raw.trim();
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const base64 = Buffer.from(value, "base64");
    if (base64.length === 32) return base64;
  } catch {
    // SHA-256 fallback below.
  }
  return crypto.createHash("sha256").update(value).digest();
}

function decryptPassword(profile: Record<string, unknown>): string {
  const ciphertext = cleanText(profile.passwordCiphertext);
  const iv = cleanText(profile.passwordIv);
  const tag = cleanText(profile.passwordTag);
  if (!ciphertext || !iv || !tag) {
    throw new HttpsError("failed-precondition", "La cuenta IQ no tiene contrasena configurada.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function resolveIqAccess(
  actor: PaymentApplicationActor,
  options?: { capability?: "PAYMENT_APPLICATIONS" | "CLIENTS" },
): Promise<IqAccess> {
  const accessSnap = await db.collection("iqUserAccess").doc(actor.uid).get();
  if (!accessSnap.exists) {
    throw new HttpsError("failed-precondition", "El usuario no tiene acceso IQ asignado.");
  }
  const access = asRecord(accessSnap.data());
  if (cleanText(access.rootId) !== actor.rootId || access.active !== true || access.iqEnabled !== true) {
    throw new HttpsError("permission-denied", "El acceso IQ del usuario esta inactivo o fuera de alcance.");
  }
  const allowedModules = asRecord(access.allowedModules);
  const capability = options?.capability || "PAYMENT_APPLICATIONS";
  if (
    capability === "PAYMENT_APPLICATIONS" &&
    allowedModules.conciliacion !== true &&
    allowedModules.pagos !== true
  ) {
    throw new HttpsError("permission-denied", "El usuario no tiene habilitada Aplicacion de pagos IQ.");
  }
  const profileId = cleanText(access.iqCredentialProfileId);
  if (!profileId) {
    throw new HttpsError("failed-precondition", "El usuario no tiene cuenta IQ asignada.");
  }
  const profileSnap = await db.collection("iqCredentialProfiles").doc(profileId).get();
  if (!profileSnap.exists) {
    throw new HttpsError("failed-precondition", "La cuenta IQ asignada no existe.");
  }
  const profile = asRecord(profileSnap.data());
  if (cleanText(profile.rootId) !== actor.rootId || profile.active !== true || profile.hasPassword !== true) {
    throw new HttpsError("permission-denied", "La cuenta IQ esta inactiva, incompleta o fuera de alcance.");
  }
  const username = cleanText(profile.username);
  if (!username) {
    throw new HttpsError("failed-precondition", "La cuenta IQ no tiene usuario configurado.");
  }
  return {
    profileId,
    profileAlias: cleanText(profile.alias),
    username,
    password: decryptPassword(profile),
    erpUrl: normalizeErpUrl(profile.erpUrl),
    apiOrigin: resolveIqApiOrigin(),
  };
}

function validateExecutionRequest(input: {
  planId: unknown;
  planHash: unknown;
  confirmExecution: unknown;
}): { planId: string; planHash: string } {
  const planId = cleanText(input.planId);
  const planHash = cleanText(input.planHash).toLowerCase();
  if (!/^paiqp_[a-f0-9]{52}$/.test(planId)) {
    throw new HttpsError("invalid-argument", "planId IQ invalido.");
  }
  if (!/^[a-f0-9]{64}$/.test(planHash)) {
    throw new HttpsError("invalid-argument", "planHash IQ invalido.");
  }
  if (input.confirmExecution !== true) {
    throw new HttpsError("failed-precondition", "La ejecucion IQ requiere confirmacion explicita.");
  }
  return { planId, planHash };
}

function parseStoredItems(plan: DocumentData): StoredPlanItem[] {
  const items = Array.isArray(plan?.plan?.items) ? plan.plan.items : [];
  return items.map((item: any) => ({
    planItemId: cleanText(item?.planItemId),
    lockId: cleanText(item?.lockId),
    applicationId: cleanText(item?.applicationId),
    solicitudId: cleanText(item?.solicitudId),
    solicitudFolio: cleanText(item?.solicitudFolio),
    solicitudIqFolio: cleanText(item?.solicitudIqFolio),
    invoiceType: cleanUpper(item?.invoiceType) === "PPD" ? "PPD" : "PUE",
    amount: money2(item?.amount),
    balanceBefore: money2(item?.balanceBefore),
    balanceAfter: money2(item?.balanceAfter),
    requiresComplement: item?.requiresComplement === true,
    requiresSameMonthSettlement: item?.requiresSameMonthSettlement === true,
    pueSettlementStatus: cleanText(item?.pueSettlementStatus),
    settlementPolicy: cleanText(item?.settlementPolicy),
    nextStep: cleanText(item?.nextStep),
  }));
}

function assertPlanOwnership(plan: DocumentData, actor: PaymentApplicationActor): void {
  if (cleanText(plan?.rootId) !== actor.rootId) {
    throw new HttpsError("permission-denied", "Plan IQ fuera del alcance autorizado.");
  }
  const createdBy = cleanText(plan?.createdBy);
  if (createdBy && createdBy !== actor.uid && actor.role !== "superadmin") {
    throw new HttpsError("permission-denied", "El plan IQ pertenece a otro usuario.");
  }
}

function executionResultFromPlan(planId: string, plan: DocumentData): PaymentApplicationIqExecutionResult {
  const status = cleanUpper(plan?.status);
  const iqExecutionStatus = cleanUpper(plan?.iqExecutionStatus);
  if (status !== "IQ_APPLIED" || iqExecutionStatus !== "SUCCEEDED") {
    throw new HttpsError("failed-precondition", "El plan IQ no tiene un resultado reutilizable confirmado.");
  }
  return {
    ok: true,
    reused: true,
    planId,
    planHash: cleanText(plan?.planHash),
    reservationId: cleanText(plan?.reservationId),
    attemptId: cleanText(plan?.iqExecutionAttemptId),
    attemptNumber: Number(plan?.actualIqAttemptCount || 1),
    status: "IQ_APPLIED",
    iqExecutionStatus: "SUCCEEDED",
    iqActionExecuted: true,
    iqApplicationId: cleanText(plan?.iqApplicationId),
    message: cleanText(plan?.iqExecutionMessage) || "Aplicacion IQ ya confirmada.",
    browserResult: asRecord(plan?.iqExecutionResult),
  };
}

async function claimExecution(params: {
  actor: PaymentApplicationActor;
  planId: string;
  planHash: string;
  access: IqAccess;
}): Promise<ClaimedExecution | ReusedExecution> {
  const { actor, planId, planHash, access } = params;
  const planRef = db.collection("pagoApplicationIqPlans").doc(planId);

  return db.runTransaction(async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) {
      throw new HttpsError("not-found", "Plan de Aplicacion de pagos IQ no existe.");
    }
    const plan = planSnap.data() || {};
    assertPlanOwnership(plan, actor);
    if (cleanText(plan?.planHash).toLowerCase() !== planHash) {
      throw new HttpsError("already-exists", "El hash del plan IQ no coincide con el plan prevalidado.");
    }

    const executionStatus = cleanUpper(plan?.iqExecutionStatus);
    if (executionStatus === "SUCCEEDED") {
      return { reused: true, result: executionResultFromPlan(planId, plan) };
    }
    if (["UNKNOWN_REVIEW_REQUIRED", "REJECTED_REVIEW_REQUIRED"].includes(executionStatus)) {
      throw new HttpsError("failed-precondition", "El plan IQ requiere revision manual antes de cualquier reintento.");
    }
    if (executionStatus === "IN_PROGRESS") {
      throw new HttpsError("aborted", "El plan IQ ya esta en ejecucion. No se permite un segundo envio.");
    }
    if (!["NOT_EXECUTED", "FAILED_SAFE"].includes(executionStatus)) {
      throw new HttpsError("failed-precondition", "El plan IQ no esta disponible para ejecucion controlada.");
    }
    if (cleanUpper(plan?.prevalidationStatus) !== "PASSED") {
      throw new HttpsError("failed-precondition", "El plan IQ no tiene prevalidacion aprobada.");
    }

    const reservationId = cleanText(plan?.reservationId);
    const pagoId = cleanText(plan?.pagoId);
    const pagoIqFolio = cleanText(plan?.plan?.pagoIqFolio);
    const items = parseStoredItems(plan);
    if (!reservationId || !pagoId || !/^\d{3,20}$/.test(pagoIqFolio) || items.length === 0) {
      throw new HttpsError("failed-precondition", "El plan IQ almacenado esta incompleto.");
    }
    for (const item of items) {
      if (!item.planItemId || !item.lockId || !item.applicationId || !item.solicitudId || !/^\d{3,20}$/.test(item.solicitudIqFolio) || item.amount <= 0) {
        throw new HttpsError("failed-precondition", "El plan IQ contiene una aplicacion incompleta.");
      }
    }

    const reservationRef = db.collection("pagoApplicationReservations").doc(reservationId);
    const pagoRef = db.collection("pagos").doc(pagoId);
    const itemRefs = items.map((item) => db.collection("pagoApplicationIqPlanItems").doc(item.planItemId));
    const lockRefs = items.map((item) => db.collection("pagoApplicationIqLocks").doc(item.lockId));
    const applicationRefs = items.map((item) => db.collection("pagoAplicaciones").doc(item.applicationId));

    const reservationSnap = await tx.get(reservationRef);
    const pagoSnap = await tx.get(pagoRef);
    const itemSnaps: DocumentSnapshot[] = [];
    const lockSnaps: DocumentSnapshot[] = [];
    const applicationSnaps: DocumentSnapshot[] = [];
    for (const ref of itemRefs) itemSnaps.push(await tx.get(ref));
    for (const ref of lockRefs) lockSnaps.push(await tx.get(ref));
    for (const ref of applicationRefs) applicationSnaps.push(await tx.get(ref));

    if (!reservationSnap.exists || !pagoSnap.exists) {
      throw new HttpsError("failed-precondition", "Reserva o pago base del plan IQ no existe.");
    }
    const reservation = reservationSnap.data() || {};
    const pago = pagoSnap.data() || {};
    if (cleanText(reservation?.rootId) !== actor.rootId || cleanText(reservation?.iqPlanId) !== planId) {
      throw new HttpsError("failed-precondition", "La reserva no coincide con el plan IQ.");
    }
    if (cleanUpper(reservation?.status) !== "APPLIED") {
      throw new HttpsError("failed-precondition", "Primero debe completarse la aplicacion atomica PAY0.");
    }
    if (cleanText(pago?.rootId) !== actor.rootId) {
      throw new HttpsError("permission-denied", "Pago fuera del alcance autorizado.");
    }
    const despachoId = cleanText(pago?.despachoId ?? pago?.dispatchId);
    const pagoCompanyId = cleanText(pago?.companyId ?? pago?.empresaId);
    const gateCompanyUsages = new Map<string, string>();
    if (pagoCompanyId) gateCompanyUsages.set(pagoCompanyId, "el pago");

    const gateSolicitudRefs = items.map((item) => db.collection("solicitudes").doc(item.solicitudId));
    const gateSolicitudSnaps: DocumentSnapshot[] = [];
    for (const ref of gateSolicitudRefs) gateSolicitudSnaps.push(await tx.get(ref));
    for (let index = 0; index < items.length; index += 1) {
      const solicitudSnap = gateSolicitudSnaps[index];
      const item = items[index];
      if (!solicitudSnap.exists) {
        throw new HttpsError("failed-precondition", `Solicitud canonica no encontrada: ${item.solicitudFolio || item.solicitudId}.`);
      }
      const solicitud = solicitudSnap.data() || {};
      if (cleanText(solicitud?.rootId ?? solicitud?.ownerRootId) !== actor.rootId) {
        throw new HttpsError("permission-denied", `Solicitud fuera del scope autorizado: ${item.solicitudFolio || item.solicitudId}.`);
      }
      const solicitudCompanyId = cleanText(solicitud?.companyId ?? solicitud?.empresaId);
      if (!solicitudCompanyId) {
        throw new HttpsError("failed-precondition", `La solicitud ${item.solicitudFolio || item.solicitudId} no tiene empresa emisora canonica.`);
      }
      gateCompanyUsages.set(solicitudCompanyId, `la solicitud ${item.solicitudFolio || item.solicitudId}`);
    }
    if (!pagoCompanyId) {
      throw new HttpsError("failed-precondition", "El pago no tiene empresa emisora canonica.");
    }
    if (!despachoId) {
      throw new HttpsError("failed-precondition", "El pago no tiene despacho definido para ejecutar IQ.");
    }

    const gateCompanyEntries = [...gateCompanyUsages.entries()];
    const gateCompanySnaps: DocumentSnapshot[] = [];
    for (const [companyId] of gateCompanyEntries) {
      gateCompanySnaps.push(await tx.get(db.collection("companies").doc(companyId)));
    }
    for (let index = 0; index < gateCompanyEntries.length; index += 1) {
      const [companyId, sourceLabel] = gateCompanyEntries[index];
      const companySnap = gateCompanySnaps[index];
      if (!companySnap.exists) {
        throw new HttpsError("failed-precondition", `Empresa emisora canonica no encontrada para ${sourceLabel}.`);
      }
      const gate = evaluateIqCompanyDespachoGate({
        rootId: actor.rootId,
        despachoId,
        companyId,
        company: companySnap.data() || {},
        sourceLabel,
      });
      if (!gate.ok) {
        throw new HttpsError("failed-precondition", `[${gate.code}] ${gate.message}`);
      }
    }

    if (actor.role !== "superadmin") {
      if (!despachoId) {
        throw new HttpsError("failed-precondition", "El pago no tiene despacho definido para ejecutar IQ.");
      }
      const despachoAccessRef = db
        .collection("userDespachoAccess")
        .doc(actor.uid)
        .collection("despachos")
        .doc(despachoId);
      const despachoAccessSnap = await tx.get(despachoAccessRef);
      if (!despachoAccessSnap.exists || despachoAccessSnap.data()?.active !== true) {
        throw new HttpsError("permission-denied", "El usuario no tiene acceso activo al despacho del pago.");
      }
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemSnap = itemSnaps[index];
      const lockSnap = lockSnaps[index];
      const applicationSnap = applicationSnaps[index];
      if (!itemSnap.exists || !lockSnap.exists || !applicationSnap.exists) {
        throw new HttpsError("failed-precondition", `Faltan registros atomicos para ${item.solicitudFolio || item.solicitudId}.`);
      }
      const itemData = itemSnap.data() || {};
      const lockData = lockSnap.data() || {};
      const application = applicationSnap.data() || {};
      if (cleanText(itemData?.planId) !== planId || cleanText(itemData?.applicationId) !== item.applicationId) {
        throw new HttpsError("failed-precondition", "Item IQ no coincide con el plan.");
      }
      if (cleanText(lockData?.planId) !== planId || !["PREVALIDATED", "FAILED_SAFE"].includes(cleanUpper(lockData?.status))) {
        throw new HttpsError("aborted", `La solicitud ${item.solicitudFolio || item.solicitudId} no conserva su lock IQ.`);
      }
      if (cleanText(application?.batchReservationId) !== reservationId || money2(application?.montoAplicado) !== item.amount) {
        throw new HttpsError("failed-precondition", "La aplicacion PAY0 ya no coincide con el plan IQ.");
      }
      if (application?.iqActionExecuted === true || ["SUCCEEDED", "UNKNOWN_REVIEW_REQUIRED", "REJECTED_REVIEW_REQUIRED"].includes(cleanUpper(application?.iqExecutionStatus))) {
        throw new HttpsError("failed-precondition", "Una aplicacion del lote ya fue enviada o requiere revision IQ.");
      }
    }

    const attemptNumber = Math.max(1, Number(plan?.actualIqAttemptCount || 0) + 1);
    const attemptId = buildPaymentApplicationIqExecutionAttemptId(planId, attemptNumber);
    const attemptRef = db.collection("pagoApplicationIqAttempts").doc(attemptId);

    tx.set(attemptRef, {
      version: PAYMENT_APPLICATION_IQ_EXECUTION_VERSION,
      rootId: actor.rootId,
      adminId: actor.adminId,
      createdBy: actor.uid,
      createdByRole: actor.role,
      createdByName: actor.displayName,
      planId,
      planHash,
      reservationId,
      pagoId,
      attemptId,
      attemptNumber,
      attemptType: "IQ_EXECUTION",
      profileId: access.profileId,
      profileAlias: access.profileAlias,
      status: "IN_PROGRESS",
      iqExecutionStatus: "IN_PROGRESS",
      iqActionExecuted: false,
      submitClicked: false,
      startedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(planRef, {
      status: "IQ_IN_PROGRESS",
      iqExecutionStatus: "IN_PROGRESS",
      iqActionExecuted: false,
      iqExecutionAttemptId: attemptId,
      actualIqAttemptCount: attemptNumber,
      iqExecutionStartedAt: FieldValue.serverTimestamp(),
      iqExecutionProfileId: access.profileId,
      iqExecutionProfileAlias: access.profileAlias,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(reservationRef, {
      iqPlanStatus: "IQ_IN_PROGRESS",
      iqExecutionStatus: "IN_PROGRESS",
      iqActionExecuted: false,
      iqExecutionAttemptId: attemptId,
      iqExecutionStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(pagoRef, {
      iqPaymentApplicationPlanId: planId,
      iqPaymentApplicationStatus: "IQ_IN_PROGRESS",
      iqPaymentApplicationAttemptId: attemptId,
      iqPaymentApplicationUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      tx.set(itemRefs[index], {
        status: "IQ_IN_PROGRESS",
        iqExecutionStatus: "IN_PROGRESS",
        iqActionExecuted: false,
        iqExecutionAttemptId: attemptId,
        actualIqAttemptCount: attemptNumber,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(lockRefs[index], {
        status: "IQ_IN_PROGRESS",
        iqExecutionStatus: "IN_PROGRESS",
        iqActionExecuted: false,
        iqExecutionAttemptId: attemptId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(applicationRefs[index], {
        iqPlanId: planId,
        iqPlanItemId: item.planItemId,
        iqExecutionAttemptId: attemptId,
        iqExecutionStatus: "IN_PROGRESS",
        iqActionExecuted: false,
        iqApplicationUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return {
      reused: false,
      planId,
      planHash,
      reservationId,
      pagoId,
      pagoIqFolio,
      asociadoName: access.username,
      clienteName: cleanText(pago?.clienteNombre),
      empresaName: cleanText(pago?.empresaNombre),
      attemptId,
      attemptNumber,
      items,
    };
  });
}

function compactBrowserResult(result: IqPaymentApplicationBrowserResult): Record<string, unknown> {
  return {
    authenticated: result.authenticated,
    routeAccessible: result.routeAccessible,
    formOpened: result.formOpened,
    depositMatched: result.depositMatched,
    verified: result.verified,
    submitClicked: result.submitClicked,
    confirmationClicked: result.confirmationClicked,
    outcome: result.outcome,
    status: result.status,
    message: result.message,
    finalPath: result.finalPath,
    iqApplicationId: result.iqApplicationId,
    responseStatus: result.responseStatus,
    responseMessage: cleanText(result.responseMessage).slice(0, 2500),
    fieldChecks: result.fieldChecks,
    itemResults: result.itemResults,
    errors: result.errors.slice(0, 20),
  };
}

async function finalizeExecution(params: {
  actor: PaymentApplicationActor;
  claimed: ClaimedExecution;
  browserResult: IqPaymentApplicationBrowserResult;
}): Promise<PaymentApplicationIqExecutionResult> {
  const { actor, claimed, browserResult } = params;
  const succeeded = browserResult.outcome === "SUCCEEDED";
  const failedSafe = browserResult.outcome === "NOT_SUBMITTED" && browserResult.submitClicked === false;
  const rejected = browserResult.outcome === "REJECTED";
  const status: PaymentApplicationIqExecutionResult["status"] = succeeded
    ? "IQ_APPLIED"
    : failedSafe
      ? "PREVALIDATED"
      : rejected
        ? "IQ_REJECTED_REVIEW_REQUIRED"
        : "IQ_UNKNOWN_REVIEW_REQUIRED";
  const executionStatus: PaymentApplicationIqExecutionResult["iqExecutionStatus"] = succeeded
    ? "SUCCEEDED"
    : failedSafe
      ? "FAILED_SAFE"
      : rejected
        ? "REJECTED_REVIEW_REQUIRED"
        : "UNKNOWN_REVIEW_REQUIRED";
  const actionExecuted = succeeded || browserResult.submitClicked || browserResult.iqActionExecuted;

  // H4_D80_A1C_CANONICAL_PLAN_LIFECYCLE
  const canonicalIqApplicationId =
    cleanText(browserResult.iqApplicationId);

  const iqApplicationFolioResolved =
    /^\d+$/.test(canonicalIqApplicationId);

  const iqApplicationLifecycleStatus =
    succeeded
      ? iqApplicationFolioResolved
        ? "CREATED_CONFIRMED"
        : "CREATED_PENDING_FOLIO"
      : "NOT_CREATED";

  const iqApplicationFolioStatus =
    succeeded
      ? iqApplicationFolioResolved
        ? "RESOLVED"
        : "PENDING"
      : "NOT_APPLICABLE";

  const iqApplicationFolioResolveRequired =
    succeeded && !iqApplicationFolioResolved;

  const planRef = db.collection("pagoApplicationIqPlans").doc(claimed.planId);
  const reservationRef = db.collection("pagoApplicationReservations").doc(claimed.reservationId);
  const pagoRef = db.collection("pagos").doc(claimed.pagoId);
  const attemptRef = db.collection("pagoApplicationIqAttempts").doc(claimed.attemptId);
  const browserSummary = compactBrowserResult(browserResult);
  const byKey = new Map(browserResult.itemResults.map((item) => [cleanText(item.key), item]));

  await db.runTransaction(async (tx) => {
    const planSnap = await tx.get(planRef);
    const attemptSnap = await tx.get(attemptRef);
    if (!planSnap.exists || !attemptSnap.exists) {
      throw new HttpsError("internal", "No se encontraron los registros de ejecucion IQ.");
    }
    const plan = planSnap.data() || {};
    if (cleanText(plan?.iqExecutionAttemptId) !== claimed.attemptId) {
      throw new HttpsError("aborted", "Otro intento IQ reemplazo el intento actual.");
    }
    if (cleanUpper(plan?.iqExecutionStatus) !== "IN_PROGRESS") {
      if (cleanUpper(plan?.iqExecutionStatus) === "SUCCEEDED") return;
      throw new HttpsError("aborted", "El plan IQ ya no esta en estado de ejecucion.");
    }

    const itemRefs = claimed.items.map((item) => db.collection("pagoApplicationIqPlanItems").doc(item.planItemId));
    const applicationRefs = claimed.items.map((item) => db.collection("pagoAplicaciones").doc(item.applicationId));
    const solicitudRefs = claimed.items.map((item) => db.collection("solicitudes").doc(item.solicitudId));
    const lockRefs = claimed.items.map((item) => db.collection("pagoApplicationIqLocks").doc(item.lockId));

    const lockSnaps: DocumentSnapshot[] = [];
    for (const ref of lockRefs) lockSnaps.push(await tx.get(ref));
    for (let index = 0; index < lockSnaps.length; index += 1) {
      if (!lockSnaps[index].exists || cleanText(lockSnaps[index].data()?.iqExecutionAttemptId) !== claimed.attemptId) {
        throw new HttpsError("aborted", "Un lock IQ cambio durante la ejecucion.");
      }
    }

    const updatedPlanObject = {
      ...asRecord(plan?.plan),
      iqExecutionStatus: executionStatus,
      iqActionExecuted: actionExecuted,
      iqApplicationId: canonicalIqApplicationId,
      iqApplicationLifecycleStatus,
      iqApplicationFolioStatus,
      iqApplicationFolioResolveRequired,
      iqExecutionAttemptId: claimed.attemptId,
      iqExecutionMessage: cleanText(browserResult.message),
    };

    tx.set(planRef, {
      status,
      iqExecutionStatus: executionStatus,
      iqActionExecuted: actionExecuted,
      iqApplicationId: canonicalIqApplicationId || null,
      iqApplicationLifecycleStatus,
      iqApplicationFolioStatus,
      iqApplicationFolioResolveRequired,
      iqApplicationFolioResolutionSource:
        iqApplicationFolioResolved
          ? "POST_SESSION_LISTING"
          : succeeded
            ? "POST_ACCEPTED_FIELDS_VERIFIED"
            : null,
      iqApplicationCanonicalVersion:
        "H4_D80_A1C",
      iqExecutionMessage: cleanText(browserResult.message),
      iqExecutionResult: browserSummary,
      plan: updatedPlanObject,
      iqExecutionCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(attemptRef, {
      status: executionStatus,
      resultCode: browserResult.status,
      resultMessage: cleanText(browserResult.message),
      iqExecutionStatus: executionStatus,
      iqActionExecuted: actionExecuted,
      submitClicked: browserResult.submitClicked,
      confirmationClicked: browserResult.confirmationClicked,
      iqApplicationId: cleanText(browserResult.iqApplicationId) || null,
      browserResult: browserSummary,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(reservationRef, {
      iqPlanStatus: status,
      iqExecutionStatus: executionStatus,
      iqActionExecuted: actionExecuted,
      iqApplicationId: cleanText(browserResult.iqApplicationId) || null,
      iqExecutionMessage: cleanText(browserResult.message),
      iqExecutionCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(pagoRef, {
      iqPaymentApplicationPlanId: claimed.planId,
      iqPaymentApplicationStatus: status,
      iqPaymentApplicationExecutionStatus: executionStatus,
      iqPaymentApplicationActionExecuted: actionExecuted,
      iqPaymentApplicationId: cleanText(browserResult.iqApplicationId) || null,
      iqPaymentApplicationMessage: cleanText(browserResult.message),
      iqPaymentApplicationUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (let index = 0; index < claimed.items.length; index += 1) {
      const item = claimed.items[index];
      const browserItem = byKey.get(item.planItemId);
      const itemResult = browserItem ? {
        rowMatched: browserItem.rowMatched,
        amountMatched: browserItem.amountMatched,
        status: browserItem.status,
        message: browserItem.message,
      } : null;
      const lockStatus = succeeded ? "COMPLETED" : failedSafe ? "PREVALIDATED" : "REVIEW_REQUIRED";
      const itemStatus = succeeded ? "IQ_APPLIED" : failedSafe ? "PREVALIDATED" : status;

      tx.set(itemRefs[index], {
        status: itemStatus,
        iqExecutionStatus: executionStatus,
        iqActionExecuted: actionExecuted,
        iqApplicationId: cleanText(browserResult.iqApplicationId) || null,
        iqExecutionResult: itemResult,
        iqExecutionMessage: cleanText(browserItem?.message || browserResult.message),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(lockRefs[index], {
        status: lockStatus,
        iqExecutionStatus: executionStatus,
        iqActionExecuted: actionExecuted,
        iqApplicationId: cleanText(browserResult.iqApplicationId) || null,
        completedAt: succeeded ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(applicationRefs[index], {
        iqPlanId: claimed.planId,
        iqPlanItemId: item.planItemId,
        iqExecutionAttemptId: claimed.attemptId,
        iqExecutionStatus: executionStatus,
        iqActionExecuted: actionExecuted,
        iqApplicationId: cleanText(browserResult.iqApplicationId) || null,
        iqApplicationStatus: itemStatus,
        iqApplicationResult: itemResult,
        requiresPaymentComplement: item.requiresComplement,
        requiresSameMonthPueSettlement: item.requiresSameMonthSettlement,
        pueSettlementStatus: item.pueSettlementStatus,
        iqApplicationUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(solicitudRefs[index], {
        iqPaymentApplicationPlanId: claimed.planId,
        iqPaymentApplicationItemId: item.planItemId,
        iqPaymentApplicationStatus: itemStatus,
        iqPaymentApplicationExecutionStatus: executionStatus,
        iqPaymentApplicationActionExecuted: actionExecuted,
        iqPaymentApplicationId: cleanText(browserResult.iqApplicationId) || null,
        iqPaymentAppliedAmount: item.amount,
        iqPaymentApplicationMessage: cleanText(browserItem?.message || browserResult.message),
        requiresPaymentComplement: item.requiresComplement,
        requiresSameMonthPueSettlement: item.requiresSameMonthSettlement,
        pueSettlementStatus: item.pueSettlementStatus,
        iqPaymentApplicationUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  return {
    ok: true,
    reused: false,
    planId: claimed.planId,
    planHash: claimed.planHash,
    reservationId: claimed.reservationId,
    attemptId: claimed.attemptId,
    attemptNumber: claimed.attemptNumber,
    status,
    iqExecutionStatus: executionStatus,
    iqActionExecuted: actionExecuted,
    iqApplicationId: cleanText(browserResult.iqApplicationId),
    message: cleanText(browserResult.message),
    browserResult: browserSummary,
  };
}

// H4_D85_A10_A33_HTTP_DIRECT_PAYMENT_APPLICATION_EXECUTION
async function runIqPaymentApplicationHttpDirect(params: {
  access: IqAccess;
  planId: string;
  pagoIqFolio: string;
  asociadoName: string;
  clienteName: string;
  empresaName: string;
  items: Array<{
    key: string;
    solicitudIqFolio: string;
    amount: number;
  }>;
}): Promise<IqPaymentApplicationBrowserResult> {
  const baseResult = (
    overrides: Partial<IqPaymentApplicationBrowserResult>,
  ): IqPaymentApplicationBrowserResult => ({
    authenticated: false,
    routeAccessible: false,
    formOpened: false,
    depositMatched: "",
    verified: false,
    submitClicked: false,
    confirmationClicked: false,
    iqActionExecuted: false,
    outcome: "NOT_SUBMITTED",
    status: "HTTP_DIRECT_NOT_SUBMITTED",
    message:
      "La Aplicacion de pagos IQ no fue enviada.",
    finalPath: "/payment_applications/new",
    iqApplicationId: "",
    responseStatus: 0,
    responseMessage: "",
    fieldChecks: [],
    diagnosticMethod:
      "HTTP_DIRECT_EXACT_PAYMENT_APPLICATION_EXECUTION",
    itemResults: params.items.map((item) => ({
      key: item.key,
      solicitudIqFolio: item.solicitudIqFolio,
      expectedAmount: money2(item.amount),
      rowMatched: false,
      amountMatched: 0,
      status: "PENDING",
      message: "Pendiente de validacion HTTP directa.",
    })),
    errors: [],
    ...overrides,
  });

  if (params.items.length !== 1) {
    return baseResult({
      status: "HTTP_DIRECT_SINGLE_ITEM_REQUIRED",
      message:
        "El ejecutor HTTP directo solo permite una factura por intento para evitar aplicaciones parciales.",
      errors: [
        "HTTP_DIRECT_SINGLE_ITEM_REQUIRED",
      ],
    });
  }

  const item = params.items[0];
  const expectedAmount = money2(item.amount);

  if (
    !/^\d{3,20}$/.test(params.pagoIqFolio) ||
    !/^\d{3,20}$/.test(item.solicitudIqFolio) ||
    expectedAmount <= 0
  ) {
    return baseResult({
      status: "HTTP_DIRECT_INVALID_INPUT",
      message:
        "El deposito, la factura o el monto del plan IQ son invalidos.",
      errors: ["HTTP_DIRECT_INVALID_INPUT"],
    });
  }

  const normalizeName = (value: unknown): string =>
    cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

  const catalogArray = (
    value: unknown,
  ): Array<Record<string, unknown>> =>
    Array.isArray(value)
      ? value.map((row) => asRecord(row))
      : [];

  const oneByName = (
    value: unknown,
    expectedName: string,
  ): Record<string, unknown> | null => {
    const expected = normalizeName(expectedName);
    const matches = catalogArray(value).filter(
      (row) => normalizeName(row.name) === expected,
    );
    return matches.length === 1 ? matches[0] : null;
  };

  let auth:
    | ReturnType<typeof toIqAuthContext>
    | null = null;

  const getCatalog = async (
    query: Record<string, string>,
  ): Promise<Record<string, unknown>> => {
    if (!auth) {
      throw new Error("IQ_HTTP_AUTH_NOT_READY");
    }

    const url = new URL(
      "/payment_applications/new",
      auth.apiOrigin,
    );

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      30000,
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization:
            `Bearer ${auth.bearerToken}`,
        },
        signal: controller.signal,
      });

      const payload = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          `IQ_PAYMENT_APPLICATION_CATALOG_HTTP_${response.status}`,
        );
      }

      return asRecord(payload);
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    const session = await loginIqHttpDirect({
      apiOrigin: params.access.apiOrigin,
      credentials: {
        username: params.access.username,
        password: params.access.password,
      },
    });

    auth = toIqAuthContext(session);

    const rootCatalog = await getCatalog({});
    const partner = oneByName(
      rootCatalog.partner,
      params.asociadoName,
    );

    if (!partner) {
      return baseResult({
        authenticated: true,
        routeAccessible: true,
        status: "HTTP_DIRECT_PARTNER_NOT_MATCHED",
        message:
          `No se encontro el asociado ${params.asociadoName} en IQ.`,
        errors: ["HTTP_DIRECT_PARTNER_NOT_MATCHED"],
      });
    }

    const partnerId = cleanText(partner.id);
    const partnerCatalog = await getCatalog({
      partner_id: partnerId,
    });

    const client = oneByName(
      partnerCatalog.client,
      params.clienteName,
    );

    if (!client) {
      return baseResult({
        authenticated: true,
        routeAccessible: true,
        status: "HTTP_DIRECT_CLIENT_NOT_MATCHED",
        message:
          `No se encontro el cliente ${params.clienteName} en IQ.`,
        errors: ["HTTP_DIRECT_CLIENT_NOT_MATCHED"],
      });
    }

    const clientId = cleanText(client.id);
    const clientCatalog = await getCatalog({
      partner_id: partnerId,
      client_id: clientId,
    });

    const company = oneByName(
      clientCatalog.company,
      params.empresaName,
    );

    if (!company) {
      return baseResult({
        authenticated: true,
        routeAccessible: true,
        status: "HTTP_DIRECT_COMPANY_NOT_MATCHED",
        message:
          `No se encontro la empresa ${params.empresaName} en IQ.`,
        errors: ["HTTP_DIRECT_COMPANY_NOT_MATCHED"],
      });
    }

    const companyId = cleanText(company.id);
    const scopedCatalog = await getCatalog({
      partner_id: partnerId,
      client_id: clientId,
      company_id: companyId,
    });

    const deposits = catalogArray(
      scopedCatalog.deposits,
    );

    const invoices = catalogArray(
      scopedCatalog.invoices,
    );

    const depositMatches = deposits.filter(
      (row) =>
        cleanText(row.id) === params.pagoIqFolio,
    );

    const invoiceMatches = invoices.filter(
      (row) =>
        cleanText(row.id) ===
        item.solicitudIqFolio,
    );

    if (
      depositMatches.length !== 1 ||
      invoiceMatches.length !== 1
    ) {
      return baseResult({
        authenticated: true,
        routeAccessible: true,
        depositMatched:
          depositMatches.length === 1
            ? params.pagoIqFolio
            : "",
        status: "HTTP_DIRECT_INPUTS_NOT_AVAILABLE",
        message:
          "El deposito o la factura ya no estan disponibles para una nueva Aplicacion de pagos IQ.",
        fieldChecks: [
          {
            field: "ASOCIADO",
            expected: params.asociadoName,
            selected: cleanText(partner.name),
            ok:
              normalizeName(partner.name) ===
              normalizeName(params.asociadoName),
            message: "Asociado validado por HTTP.",
          },
          {
            field: "CLIENTE",
            expected: params.clienteName,
            selected: cleanText(client.name),
            ok:
              normalizeName(client.name) ===
              normalizeName(params.clienteName),
            message: "Cliente validado por HTTP.",
          },
          {
            field: "EMPRESA",
            expected: params.empresaName,
            selected: cleanText(company.name),
            ok:
              normalizeName(company.name) ===
              normalizeName(params.empresaName),
            message: "Empresa validada por HTTP.",
          },
          {
            field: "DEPOSITO",
            expected: params.pagoIqFolio,
            selected:
              depositMatches.length === 1
                ? cleanText(depositMatches[0].id)
                : "",
            ok: depositMatches.length === 1,
            message:
              "Disponibilidad de deposito validada por HTTP.",
          },
          {
            field: "FACTURA",
            expected: item.solicitudIqFolio,
            selected:
              invoiceMatches.length === 1
                ? cleanText(invoiceMatches[0].id)
                : "",
            ok: invoiceMatches.length === 1,
            message:
              "Disponibilidad de factura validada por HTTP.",
          },
          {
            field: "MONTO",
            expected: expectedAmount.toFixed(2),
            selected: "0.00",
            ok: false,
            message:
              "No se valido monto porque los folios no estan disponibles.",
          },
        ],
        errors: ["HTTP_DIRECT_INPUTS_NOT_AVAILABLE"],
      });
    }

    const selectedCatalog = await getCatalog({
      partner_id: partnerId,
      client_id: clientId,
      company_id: companyId,
      deposit_id: params.pagoIqFolio,
      invoice_id: item.solicitudIqFolio,
    });

    const depositBalance = money2(
      selectedCatalog.deposit_balance,
    );

    const invoiceToPay = money2(
      selectedCatalog.invoice_to_pay,
    );

    const balancesValid =
      depositBalance >= expectedAmount &&
      invoiceToPay >= expectedAmount;

    const fieldChecks:
      IqPaymentApplicationBrowserResult["fieldChecks"] = [
        {
          field: "ASOCIADO",
          expected: params.asociadoName,
          selected: cleanText(partner.name),
          ok:
            normalizeName(partner.name) ===
            normalizeName(params.asociadoName),
          message: "Asociado validado por HTTP.",
        },
        {
          field: "CLIENTE",
          expected: params.clienteName,
          selected: cleanText(client.name),
          ok:
            normalizeName(client.name) ===
            normalizeName(params.clienteName),
          message: "Cliente validado por HTTP.",
        },
        {
          field: "EMPRESA",
          expected: params.empresaName,
          selected: cleanText(company.name),
          ok:
            normalizeName(company.name) ===
            normalizeName(params.empresaName),
          message: "Empresa validada por HTTP.",
        },
        {
          field: "DEPOSITO",
          expected: params.pagoIqFolio,
          selected: cleanText(depositMatches[0].id),
          ok: true,
          message:
            "Deposito disponible validado por HTTP.",
        },
        {
          field: "FACTURA",
          expected: item.solicitudIqFolio,
          selected: cleanText(invoiceMatches[0].id),
          ok: true,
          message:
            "Factura disponible validada por HTTP.",
        },
        {
          field: "MONTO",
          expected: expectedAmount.toFixed(2),
          selected:
            `${depositBalance.toFixed(2)} / ${invoiceToPay.toFixed(2)}`,
          ok: balancesValid,
          message:
            "Saldos de deposito y factura validados por HTTP.",
        },
      ];

    if (
      !fieldChecks.every((check) => check.ok) ||
      !balancesValid
    ) {
      return baseResult({
        authenticated: true,
        routeAccessible: true,
        depositMatched: params.pagoIqFolio,
        verified: false,
        status: "HTTP_DIRECT_PREVALIDATION_FAILED",
        message:
          "La revalidacion inmediata de IQ no autoriza el envio.",
        fieldChecks,
        itemResults: [
          {
            key: item.key,
            solicitudIqFolio:
              item.solicitudIqFolio,
            expectedAmount,
            rowMatched: true,
            amountMatched: 0,
            status: "REJECTED",
            message:
              "Los saldos IQ no cubren el monto exacto.",
          },
        ],
        errors: [
          "HTTP_DIRECT_PREVALIDATION_FAILED",
        ],
      });
    }

    const postUrl = new URL(
      "/payment_applications",
      auth.apiOrigin,
    );

    const postController = new AbortController();
    const postTimeout = setTimeout(
      () => postController.abort(),
      30000,
    );

    let postResponse: Response;
    const dispatchedAtMs = Date.now();

    try {
      postResponse = await fetch(postUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${auth.bearerToken}`,
        },
        body: JSON.stringify({
          deposit_id: Number(params.pagoIqFolio),
          invoice_id:
            Number(item.solicitudIqFolio),
          sum: expectedAmount,
        }),
        signal: postController.signal,
      });
    } catch (error) {
      return baseResult({
        authenticated: true,
        routeAccessible: true,
        depositMatched: params.pagoIqFolio,
        verified: true,
        submitClicked: true,
        iqActionExecuted: true,
        outcome: "UNKNOWN",
        status: "HTTP_DIRECT_POST_UNKNOWN",
        message:
          "IQ pudo recibir la Aplicacion de pagos, pero PAY0 no obtuvo una respuesta concluyente. Requiere revision; no se debe reintentar automaticamente.",
        finalPath: "/payment_applications",
        fieldChecks,
        itemResults: [
          {
            key: item.key,
            solicitudIqFolio:
              item.solicitudIqFolio,
            expectedAmount,
            rowMatched: true,
            amountMatched: expectedAmount,
            status: "UNKNOWN",
            message:
              "Resultado HTTP desconocido despues de iniciar el POST.",
          },
        ],
        errors: [
          cleanText(
            error instanceof Error
              ? error.message
              : error,
          ).slice(0, 700),
        ],
      });
    } finally {
      clearTimeout(postTimeout);
    }

    const responseText = await postResponse
      .text()
      .catch(() => "");

    if (
      postResponse.status === 200 ||
      postResponse.status === 201
    ) {
      const folioResolution =
        await resolveIqPaymentApplicationFolioReadOnly({
          auth,
          pagoIqFolio: params.pagoIqFolio,
          solicitudIqFolio:
            item.solicitudIqFolio,
          amount: expectedAmount,
          asociadoName: params.asociadoName,
          clienteName: params.clienteName,
          empresaName: params.empresaName,
          lowerBoundMs: dispatchedAtMs,
        });

      return baseResult({
        authenticated: true,
        routeAccessible: true,
        formOpened: false,
        depositMatched: params.pagoIqFolio,
        verified: true,
        submitClicked: true,
        confirmationClicked: false,
        iqActionExecuted: true,
        outcome: "SUCCEEDED",
        status: "HTTP_DIRECT_CREATED",
        iqApplicationId:
          folioResolution.iqApplicationId,
        message:
          "Aplicacion de pagos IQ creada por HTTP directo.",
        finalPath: "/payment_applications",
        responseStatus: postResponse.status,
        responseMessage:
          responseText.slice(0, 2500),
        fieldChecks,
        itemResults: [
          {
            key: item.key,
            solicitudIqFolio:
              item.solicitudIqFolio,
            expectedAmount,
            rowMatched: true,
            amountMatched: expectedAmount,
            status: "SUCCEEDED",
            message:
              "Aplicacion de pagos IQ creada por HTTP directo.",
          },
        ],
      });
    }

    return baseResult({
      authenticated: true,
      routeAccessible: true,
      depositMatched: params.pagoIqFolio,
      verified: true,
      submitClicked: true,
      iqActionExecuted: true,
      outcome:
        postResponse.status >= 400 &&
        postResponse.status < 500
          ? "REJECTED"
          : "UNKNOWN",
      status:
        `HTTP_DIRECT_POST_${postResponse.status}`,
      message:
        postResponse.status >= 400 &&
        postResponse.status < 500
          ? "IQ rechazo expresamente la Aplicacion de pagos."
          : "IQ devolvio un resultado no concluyente despues del POST.",
      finalPath: "/payment_applications",
      responseStatus: postResponse.status,
      responseMessage:
        responseText.slice(0, 2500),
      fieldChecks,
      itemResults: [
        {
          key: item.key,
          solicitudIqFolio:
            item.solicitudIqFolio,
          expectedAmount,
          rowMatched: true,
          amountMatched: expectedAmount,
          status:
            postResponse.status >= 400 &&
            postResponse.status < 500
              ? "REJECTED"
              : "UNKNOWN",
          message:
            `IQ respondio HTTP ${postResponse.status}.`,
        },
      ],
      errors: [
        `HTTP_DIRECT_POST_${postResponse.status}`,
      ],
    });
  } catch (error) {
    return baseResult({
      status: "HTTP_DIRECT_FAILED_SAFE",
      message:
        "La Aplicacion de pagos IQ no fue enviada porque fallo la preparacion HTTP.",
      errors: [
        cleanText(
          error instanceof Error
            ? error.message
            : error,
        ).slice(0, 700),
      ],
    });
  }
}

export async function resolvePaymentApplicationIqFolio(params: {
  actor: PaymentApplicationActor;
  planId: unknown;
}): Promise<PaymentApplicationIqExecutionResult> {
  const planId = cleanText(params.planId);

  if (!/^paiqp_[a-f0-9]{52}$/.test(planId)) {
    throw new HttpsError(
      "invalid-argument",
      "planId IQ invalido para resolver el folio.",
    );
  }

  const planRef =
    db.collection("pagoApplicationIqPlans").doc(planId);

  const planSnap = await planRef.get();

  if (!planSnap.exists) {
    throw new HttpsError(
      "not-found",
      "Plan de Aplicacion de pagos IQ no existe.",
    );
  }

  const plan = planSnap.data() || {};
  assertPlanOwnership(plan, params.actor);

  if (
    cleanUpper(plan?.status) !== "IQ_APPLIED" ||
    cleanUpper(plan?.iqExecutionStatus) !== "SUCCEEDED"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El plan IQ no esta confirmado para resolver su folio.",
    );
  }

  const currentIqApplicationId =
    cleanText(plan?.iqApplicationId);

  if (/^\d+$/.test(currentIqApplicationId)) {
    return executionResultFromPlan(planId, plan);
  }

  if (currentIqApplicationId) {
    throw new HttpsError(
      "failed-precondition",
      "El plan IQ contiene un folio de Aplicacion invalido.",
    );
  }

  const items = parseStoredItems(plan);

  if (items.length !== 1) {
    throw new HttpsError(
      "failed-precondition",
      "El resolver de folio IQ requiere exactamente una factura aplicada.",
    );
  }

  const item = items[0];
  const attemptId =
    cleanText(plan?.iqExecutionAttemptId);
  const reservationId =
    cleanText(plan?.reservationId);
  const pagoId =
    cleanText(plan?.pagoId);
  const pagoIqFolio =
    cleanText(plan?.plan?.pagoIqFolio);

  if (
    !attemptId ||
    !reservationId ||
    !pagoId ||
    !/^\d{3,20}$/.test(pagoIqFolio) ||
    !/^\d{3,20}$/.test(item.solicitudIqFolio) ||
    item.amount <= 0
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El plan IQ esta incompleto para resolver el folio.",
    );
  }

  const attemptRef =
    db.collection("pagoApplicationIqAttempts").doc(attemptId);
  const pagoRef =
    db.collection("pagos").doc(pagoId);

  const [attemptSnap, pagoSnap] =
    await Promise.all([
      attemptRef.get(),
      pagoRef.get(),
    ]);

  if (!attemptSnap.exists || !pagoSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "No se encontro el intento o pago original de la Aplicacion IQ.",
    );
  }

  const attempt = attemptSnap.data() || {};
  const pago = pagoSnap.data() || {};

  if (
    cleanText(attempt?.planId) !== planId ||
    cleanText(attempt?.rootId) !== params.actor.rootId ||
    cleanText(pago?.rootId) !== params.actor.rootId
  ) {
    throw new HttpsError(
      "permission-denied",
      "Los registros de la Aplicacion IQ estan fuera del alcance autorizado.",
    );
  }

  const lowerBoundMs =
    timestampToMillis(attempt?.startedAt) ||
    timestampToMillis(plan?.iqExecutionStartedAt);

  if (!(lowerBoundMs > 0)) {
    throw new HttpsError(
      "failed-precondition",
      "El intento IQ no conserva una fecha de inicio valida.",
    );
  }

  const access = await resolveIqAccess(params.actor);

  const session = await loginIqHttpDirect({
    apiOrigin: access.apiOrigin,
    credentials: {
      username: access.username,
      password: access.password,
    },
  });

  const auth = toIqAuthContext(session);

  const resolution =
    await resolveIqPaymentApplicationFolioReadOnly({
      auth,
      pagoIqFolio,
      solicitudIqFolio: item.solicitudIqFolio,
      amount: item.amount,
      asociadoName: access.username,
      clienteName: cleanText(pago?.clienteNombre),
      empresaName: cleanText(pago?.empresaNombre),
      lowerBoundMs,
    });

  if (!resolution.iqApplicationId) {
    return executionResultFromPlan(planId, plan);
  }

  const resolvedIqApplicationId =
    resolution.iqApplicationId;

  const reservationRef =
    db.collection("pagoApplicationReservations").doc(reservationId);
  const itemRef =
    db.collection("pagoApplicationIqPlanItems").doc(item.planItemId);
  const lockRef =
    db.collection("pagoApplicationIqLocks").doc(item.lockId);
  const applicationRef =
    db.collection("pagoAplicaciones").doc(item.applicationId);
  const solicitudRef =
    db.collection("solicitudes").doc(item.solicitudId);

  await db.runTransaction(async (tx) => {
    const currentPlanSnap = await tx.get(planRef);

    if (!currentPlanSnap.exists) {
      throw new HttpsError(
        "not-found",
        "El plan IQ desaparecio durante la resolucion del folio.",
      );
    }

    const currentPlan = currentPlanSnap.data() || {};

    if (
      cleanUpper(currentPlan?.status) !== "IQ_APPLIED" ||
      cleanUpper(currentPlan?.iqExecutionStatus) !== "SUCCEEDED"
    ) {
      throw new HttpsError(
        "aborted",
        "El estado del plan IQ cambio durante la resolucion del folio.",
      );
    }

    const existingIqApplicationId =
      cleanText(currentPlan?.iqApplicationId);

    if (
      existingIqApplicationId &&
      existingIqApplicationId !== resolvedIqApplicationId
    ) {
      throw new HttpsError(
        "already-exists",
        "El folio IQ ya fue resuelto con un valor diferente.",
      );
    }

    if (existingIqApplicationId === resolvedIqApplicationId) {
      return;
    }

    const updatedPlanObject = {
      ...asRecord(currentPlan?.plan),
      iqApplicationId: resolvedIqApplicationId,
      iqApplicationLifecycleStatus:
        "CREATED_CONFIRMED",
      iqApplicationFolioStatus:
        "RESOLVED",
      iqApplicationFolioResolveRequired:
        false,
    };

    const updatedExecutionResult = {
      ...asRecord(currentPlan?.iqExecutionResult),
      iqApplicationId: resolvedIqApplicationId,
    };

    const updatedAttemptBrowserResult = {
      ...asRecord(attempt?.browserResult),
      iqApplicationId: resolvedIqApplicationId,
    };

    tx.set(planRef, {
      iqApplicationId:
        resolvedIqApplicationId,
      iqApplicationLifecycleStatus:
        "CREATED_CONFIRMED",
      iqApplicationFolioStatus:
        "RESOLVED",
      iqApplicationFolioResolveRequired:
        false,
      iqApplicationFolioResolutionSource:
        "POST_SESSION_LISTING",
      iqExecutionResult:
        updatedExecutionResult,
      plan:
        updatedPlanObject,
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(attemptRef, {
      iqApplicationId:
        resolvedIqApplicationId,
      browserResult:
        updatedAttemptBrowserResult,
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(reservationRef, {
      iqApplicationId:
        resolvedIqApplicationId,
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(pagoRef, {
      iqPaymentApplicationId:
        resolvedIqApplicationId,
      iqPaymentApplicationUpdatedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(itemRef, {
      iqApplicationId:
        resolvedIqApplicationId,
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(lockRef, {
      iqApplicationId:
        resolvedIqApplicationId,
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(applicationRef, {
      iqApplicationId:
        resolvedIqApplicationId,
      iqApplicationUpdatedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(solicitudRef, {
      iqPaymentApplicationId:
        resolvedIqApplicationId,
      iqPaymentApplicationUpdatedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  const resolvedPlanSnap = await planRef.get();

  if (!resolvedPlanSnap.exists) {
    throw new HttpsError(
      "internal",
      "No se pudo releer el plan IQ despues de resolver el folio.",
    );
  }

  return executionResultFromPlan(
    planId,
    resolvedPlanSnap.data() || {},
  );
}

export async function executePaymentApplicationIqPlan(params: {
  actor: PaymentApplicationActor;
  planId: unknown;
  planHash: unknown;
  confirmExecution: unknown;
}): Promise<PaymentApplicationIqExecutionResult> {
  const request = validateExecutionRequest(params);
  const access = await resolveIqAccess(params.actor);
  const claimed = await claimExecution({
    actor: params.actor,
    planId: request.planId,
    planHash: request.planHash,
    access,
  });
  if (claimed.reused) return claimed.result;

  const browserResult =
    await runIqPaymentApplicationHttpDirect({
      access,
      planId: claimed.planId,
      pagoIqFolio: claimed.pagoIqFolio,
      asociadoName: access.username,
      clienteName: claimed.clienteName,
      empresaName: claimed.empresaName,
      items: claimed.items.map((item) => ({
        key: item.planItemId,
        solicitudIqFolio:
          item.solicitudIqFolio,
        amount: item.amount,
      })),
    });

  return finalizeExecution({
    actor: params.actor,
    claimed,
    browserResult,
  });
}


export type PaymentApplicationIqMethodsDiagnosticResult = {
  ok: true;
  planId: string;
  planHash: string;
  pagoIqFolio: string;
  transport: "HTTP_DIRECT";
  deposit: Record<string, unknown>;
  validations: Array<Record<string, unknown>>;
  networkCapture: {
    routeAccessible: boolean;
    formOpened: boolean;
    finalPath: string;
    captures: Array<Record<string, unknown>>;
    blockedMutations: Array<Record<string, unknown>>;
    selectionSteps: Array<Record<string, unknown>>;
    message: string;
  };
  methods: Array<Record<string, unknown>>;
  bestMethod: string;
  message: string;
};

export async function diagnosePaymentApplicationIqMethods(params: {
  actor: PaymentApplicationActor;
  planId: unknown;
  planHash: unknown;
}): Promise<PaymentApplicationIqMethodsDiagnosticResult> {
  const request = validateExecutionRequest({
    planId: params.planId,
    planHash: params.planHash,
    confirmExecution: true,
  });
  const access = await resolveIqAccess(params.actor);
  const planSnap = await db.collection("pagoApplicationIqPlans").doc(request.planId).get();
  if (!planSnap.exists) {
    throw new HttpsError("not-found", "Plan de Aplicacion de pagos IQ no existe.");
  }
  const plan = planSnap.data() || {};
  assertPlanOwnership(plan, params.actor);
  if (cleanText(plan?.planHash).toLowerCase() !== request.planHash) {
    throw new HttpsError("already-exists", "El hash del plan IQ no coincide con el plan prevalidado.");
  }
  const executionStatus = cleanUpper(plan?.iqExecutionStatus);
  if (["IN_PROGRESS", "UNKNOWN_REVIEW_REQUIRED", "REJECTED_REVIEW_REQUIRED", "SUCCEEDED"].includes(executionStatus)) {
    throw new HttpsError("failed-precondition", "El plan no esta disponible para diagnostico seguro de metodos.");
  }
  let items = parseStoredItems(plan);
  let pagoIqFolio = cleanText(plan?.plan?.pagoIqFolio);

  if (!/^\d{3,20}$/.test(pagoIqFolio) || items.length === 0) {
    throw new HttpsError("failed-precondition", "El plan IQ almacenado esta incompleto para diagnostico.");
  }

  // H4_D85_A10_A25_HTTP_READ_ONLY_PAYMENT_APPLICATION_DIAGNOSTIC
  const session = await loginIqHttpDirect({
    apiOrigin: access.apiOrigin,
    credentials: {
      username: access.username,
      password: access.password,
    },
  });

  const auth = toIqAuthContext(session);
  const url = new URL("/deposits", auth.apiOrigin);
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");
  url.searchParams.set("order_by_field", "id");
  url.searchParams.set("order_by_direction", "asc");
  url.searchParams.set("filter[id]", pagoIqFolio);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.bearerToken}`,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => []);

  if (!response.ok) {
    throw new HttpsError(
      "unavailable",
      `IQ_DEPOSIT_HTTP_${response.status}`,
    );
  }

  const rows = Array.isArray(payload) ? payload : [];
  const exactRows = rows.filter(
    (row) => cleanText(asRecord(row).id) === pagoIqFolio,
  );

  const expectedAmount = money2(
    items.reduce(
      (sum, item) => sum + money2(item.amount),
      0,
    ),
  );

  const deposit = exactRows.length === 1
    ? asRecord(exactRows[0])
    : {};

  const validations = [
    {
      field: "DEPOSITO",
      expected: pagoIqFolio,
      actual: cleanText(deposit.id),
      ok:
        exactRows.length === 1 &&
        cleanText(deposit.id) === pagoIqFolio,
    },
    {
      field: "ASOCIADO",
      expected: access.username,
      actual: cleanText(deposit.partner),
      ok:
        cleanUpper(deposit.partner) ===
        cleanUpper(access.username),
    },
    {
      field: "MONTO",
      expected: expectedAmount,
      actual: money2(deposit.sum),
      ok:
        expectedAmount > 0 &&
        money2(deposit.sum) === expectedAmount,
    },
    {
      field: "CONCILIACION",
      expected: "Conciliado",
      actual: cleanText(deposit.conciliation_status),
      ok:
        cleanUpper(deposit.conciliation_status) ===
        "CONCILIADO",
    },
    {
      field: "OPERACION",
      expected: "En Operacion",
      actual: cleanText(deposit.operation_status),
      ok:
        cleanUpper(deposit.operation_status) ===
        "EN OPERACION",
    },
  ];

  const allValid =
    exactRows.length === 1 &&
    validations.every((validation) => validation.ok === true);

  // H4_D85_A10_A29_HTTP_DIRECT_PAYMENT_APPLICATION_CATALOG
  type CatItem={id?:unknown;name?:unknown;sum?:unknown};
  type Cat={partner?:unknown;client?:unknown;company?:unknown;deposits?:unknown;invoices?:unknown;deposit_balance?:unknown;invoice_to_pay?:unknown};

  const norm=(v:unknown):string=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toUpperCase();
  const arr=(v:unknown):CatItem[]=>Array.isArray(v)?v.map(x=>asRecord(x)):[];
  const oneByName=(v:unknown,name:string):CatItem|null=>{
    const m=arr(v).filter(x=>norm(x.name)===norm(name));
    return m.length===1?m[0]:null;
  };
  const getCat=async(q:Record<string,string>):Promise<{status:number;cat:Cat}>=>{
    const u=new URL("/payment_applications/new",auth.apiOrigin);
    Object.entries(q).forEach(([k,v])=>u.searchParams.set(k,v));
    const c=new AbortController();
    const t=setTimeout(()=>c.abort(),30000);
    let r:Response;
    try{
      r=await fetch(u,{method:"GET",headers:{Accept:"application/json",Authorization:`Bearer ${auth.bearerToken}`},signal:c.signal});
    }finally{clearTimeout(t)}
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new HttpsError("unavailable",`IQ_PAYMENT_APPLICATION_CATALOG_HTTP_${r.status}`);
    return {status:r.status,cat:asRecord(j) as Cat};
  };

  const captures:Array<Record<string,unknown>>=[];
  const targetClientName=cleanText(deposit.client);
  const targetCompanyName=cleanText(deposit.company);

  if(!targetClientName){
    throw new HttpsError("failed-precondition","El deposito IQ no devolvio nombre operativo de cliente.");
  }

  if(!targetCompanyName){
    throw new HttpsError("failed-precondition","El deposito IQ no devolvio nombre operativo de empresa.");
  }

  const c0=await getCat({});
  const partner=oneByName(c0.cat.partner,access.username);
  if(!partner)throw new HttpsError("failed-precondition",`No se encontro el asociado ${access.username} en IQ.`);
  const partnerId=cleanText(partner.id);

  const c1=await getCat({partner_id:partnerId});
  const client=oneByName(c1.cat.client,targetClientName);
  if(!client)throw new HttpsError("failed-precondition",`No se encontro el cliente ${targetClientName} para ${access.username} en IQ.`);
  const clientId=cleanText(client.id);

  const c2=await getCat({partner_id:partnerId,client_id:clientId});
  const company=oneByName(c2.cat.company,targetCompanyName);
  if(!company)throw new HttpsError("failed-precondition",`No se encontro la empresa ${targetCompanyName} para ${targetClientName} en IQ.`);
  const companyId=cleanText(company.id);

  const c3=await getCat({partner_id:partnerId,client_id:clientId,company_id:companyId});
  const deposits=arr(c3.cat.deposits);
  const invoices=arr(c3.cat.invoices);
  const depositMatches=deposits.filter(x=>cleanText(x.id)===pagoIqFolio);
  const invoiceFolios=Array.from(new Set(items.map(x=>cleanText(x.solicitudIqFolio)).filter(Boolean)));
  const invoiceMatches=invoiceFolios.map(f=>({folio:f,count:invoices.filter(x=>cleanText(x.id)===f).length}));

  captures.push(
    {method:"GET",path:"/payment_applications/new",query:{},status:c0.status},
    {method:"GET",path:"/payment_applications/new",query:{partner_id:partnerId},status:c1.status,clientCount:arr(c1.cat.client).length},
    {method:"GET",path:"/payment_applications/new",query:{partner_id:partnerId,client_id:clientId},status:c2.status,companyCount:arr(c2.cat.company).length},
    {method:"GET",path:"/payment_applications/new",query:{partner_id:partnerId,client_id:clientId,company_id:companyId},status:c3.status,depositFound:depositMatches.length===1,invoiceMatches}
  );

  const balances:Array<Record<string,unknown>>=[];
  for(const f of invoiceFolios){
    const cx=await getCat({partner_id:partnerId,client_id:clientId,company_id:companyId,deposit_id:pagoIqFolio,invoice_id:f});
    const depositBalance=money2(cx.cat.deposit_balance);
    const invoiceToPay=money2(cx.cat.invoice_to_pay);
    const storedExpected=money2(items.filter(x=>cleanText(x.solicitudIqFolio)===f).reduce((a,x)=>a+money2(x.amount),0));
    const expected=storedExpected;
    balances.push({invoiceFolio:f,expectedAmount:expected,depositBalance,invoiceToPay,depositBalanceEnough:depositBalance>=expected&&expected>0,invoiceBalanceEnough:invoiceToPay>=expected&&expected>0});
    captures.push({method:"GET",path:"/payment_applications/new",query:{partner_id:partnerId,client_id:clientId,company_id:companyId,deposit_id:pagoIqFolio,invoice_id:f},status:cx.status,depositBalance,invoiceToPay});
  }

  const catalogValidations=[
    {field:"ASOCIADO",expected:access.username,actual:cleanText(partner.name),ok:norm(partner.name)===norm(access.username)},
    {field:"CLIENTE",expected:targetClientName,actual:cleanText(client.name),ok:norm(client.name)===norm(targetClientName)},
    {field:"EMPRESA",expected:targetCompanyName,actual:cleanText(company.name),ok:norm(company.name)===norm(targetCompanyName)},
    {field:"DEPOSITO_DISPONIBLE",expected:pagoIqFolio,actual:depositMatches.length===1?cleanText(depositMatches[0].id):"",ok:depositMatches.length===1},
    {field:"FACTURAS_DISPONIBLES",expected:invoiceFolios,actual:invoiceMatches,ok:invoiceFolios.length>0&&invoiceMatches.every(x=>x.count===1)},
    {field:"SALDOS_SUFICIENTES",expected:true,actual:balances,ok:balances.length===invoiceFolios.length&&balances.every((x:any)=>x.depositBalanceEnough===true&&x.invoiceBalanceEnough===true)}
  ];
  const catalogAllValid=catalogValidations.every(x=>x.ok===true);

  const networkCapture={
    routeAccessible:true,
    formOpened:false,
    finalPath:"/payment_applications/new",
    captures,
    blockedMutations:[],
    selectionSteps:catalogValidations.map(x=>({field:x.field,expected:x.expected,selected:x.actual,ok:x.ok,source:"HTTP_DIRECT",message:x.ok?`${x.field}: OK`:`${x.field}: NO COINCIDE`})),
    message:catalogAllValid
      ?"Catalogos, deposito, facturas y saldos IQ validados por HTTP directo. No se ejecuto Aplicacion de pagos IQ."
      :"La lectura HTTP directa termino con diferencias. No se ejecuto Aplicacion de pagos IQ."
  };

  return {
    ok: true,
    planId: request.planId,
    planHash: request.planHash,
    pagoIqFolio,
    transport: "HTTP_DIRECT",
    deposit: {
      id: cleanText(deposit.id),
      partner: cleanText(deposit.partner),
      client: cleanText(deposit.client),
      company: cleanText(deposit.company),
      sum: money2(deposit.sum),
      currency: cleanText(deposit.currency),
      conciliationStatus:
        cleanText(deposit.conciliation_status),
      operationStatus:
        cleanText(deposit.operation_status),
      operationType:
        cleanText(deposit.operation_type),
    },
    validations,
    networkCapture: {
      routeAccessible:
        networkCapture.routeAccessible,
      formOpened:
        networkCapture.formOpened,
      finalPath:
        networkCapture.finalPath,
      captures:
        networkCapture.captures,
      blockedMutations:
        networkCapture.blockedMutations,
      selectionSteps:
        networkCapture.selectionSteps,
      message:
        networkCapture.message,
    },
    methods: [],
    bestMethod:
      allValid && catalogAllValid
        ? "HTTP_DIRECT_EXACT_PAYMENT_APPLICATION_INPUTS"
        : "",
    message:
      allValid && catalogAllValid
        ? `Deposito IQ ${pagoIqFolio}, cliente, empresa, facturas y saldos validados por HTTP directo. No se ejecuto Aplicacion de pagos IQ.`
        : `La lectura HTTP directa de IQ termino con diferencias. No se ejecuto Aplicacion de pagos IQ.`,
  };}
