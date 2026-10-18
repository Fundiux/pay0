import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { getAuth } from "firebase/auth";

export const IQ_MODULES = [
  "solicitudes",
  "pagos",
  "conciliacion",
  "reportes",
  "clientes",
  "materialidad",
] as const;

export type IqModule = (typeof IQ_MODULES)[number];

export const IQ_MODULE_LABELS: Record<IqModule, string> = {
  solicitudes: "Solicitudes",
  pagos: "Pagos",
  conciliacion: "Conciliacion",
  reportes: "Reportes",
  clientes: "Clientes",
  materialidad: "Materialidad",
};

export type IqCredentialProfile = {
  id: string;
  alias: string;
  username: string;
  usernameMasked: string;
  active: boolean;
  hasPassword: boolean;
  erpUrl?: string | null;
  lastTestAt?: number | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export type IqUserAccess = {
  id: string;
  pay0UserId: string;
  iqEnabled: boolean;
  iqCredentialProfileId: string | null;
  iqCredentialAlias?: string | null;
  allowedModules: Record<string, boolean>;
  active: boolean;
  assignedAt?: number | null;
  updatedAt?: number | null;
};

type CallableResult<T> = {
  ok: boolean;
  data?: T;
  message?: string;
};

async function callIq<TReq extends Record<string, unknown>, TRes>(
  name: string,
  data: TReq,
  timeoutMs = 70_000,
): Promise<TRes> {
  const fn = httpsCallable<TReq, TRes>(functions, name, {
    timeout: timeoutMs,
  });
  const res = await fn(data);
  return res.data;
}

export async function listIqCredentialProfiles(): Promise<IqCredentialProfile[]> {
  const res = await callIq<Record<string, never>, CallableResult<IqCredentialProfile[]>>(
    "listIqCredentialProfiles",
    {},
  );
  return res.data ?? [];
}

export async function createIqCredentialProfile(input: {
  alias: string;
  username: string;
  password?: string;
  erpUrl?: string;
}): Promise<IqCredentialProfile> {
  const res = await callIq<typeof input, CallableResult<IqCredentialProfile>>(
    "createIqCredentialProfile",
    input,
  );

  if (!res.data) {
    throw new Error(res.message || "No se pudo crear la cuenta IQ.");
  }

  return res.data;
}

export async function updateIqCredentialProfile(input: {
  profileId: string;
  alias?: string;
  username?: string;
  password?: string;
  erpUrl?: string;
  active?: boolean;
}): Promise<IqCredentialProfile> {
  const res = await callIq<typeof input, CallableResult<IqCredentialProfile>>(
    "updateIqCredentialProfile",
    input,
  );

  if (!res.data) {
    throw new Error(res.message || "No se pudo actualizar la cuenta IQ.");
  }

  return res.data;
}

export async function deactivateIqCredentialProfile(profileId: string): Promise<void> {
  await callIq<{ profileId: string }, CallableResult<null>>(
    "deactivateIqCredentialProfile",
    { profileId },
  );
}

export async function deleteIqCredentialProfile(profileId: string): Promise<void> {
  await callIq<{ profileId: string }, CallableResult<null>>(
    "deleteIqCredentialProfile",
    { profileId },
  );
}

export async function testIqConnection(profileId: string): Promise<{
  ok: boolean;
  message: string;
  mode: string;
}> {
  const res = await callIq<{ profileId: string }, CallableResult<{
    ok: boolean;
    message: string;
    mode: string;
  }>>("testIqConnection", { profileId });

  if (!res.data) {
    return {
      ok: false,
      message: res.message || "No se pudo probar la conexion IQ.",
      mode: "unknown",
    };
  }

  return res.data;
}

export async function listUserIqAccess(): Promise<IqUserAccess[]> {
  const res = await callIq<Record<string, never>, CallableResult<IqUserAccess[]>>(
    "listUserIqAccess",
    {},
  );
  return res.data ?? [];
}

export async function updateUserIqAccess(input: {
  pay0UserId: string;
  iqEnabled: boolean;
  iqCredentialProfileId: string | null;
  allowedModules: Record<IqModule, boolean>;
}): Promise<IqUserAccess> {
  const res = await callIq<typeof input, CallableResult<IqUserAccess>>(
    "updateUserIqAccess",
    input,
  );

  if (!res.data) {
    throw new Error(res.message || "No se pudo actualizar el acceso IQ.");
  }

  return res.data;
}

export async function removeUserIqAccess(pay0UserId: string): Promise<void> {
  await callIq<{ pay0UserId: string }, CallableResult<null>>(
    "removeUserIqAccess",
    { pay0UserId },
  );
}

export async function getCurrentUserIqAccess(): Promise<IqUserAccess | null> {
  const res = await callIq<Record<string, never>, CallableResult<IqUserAccess | null>>(
    "getCurrentUserIqAccess",
    {},
  );
  return res.data ?? null;
}

export type IqSolicitudInvoiceType =
  | "PUE"
  | "PPD";

// H4_D87_A57_A78_FRONTEND_SOLICITUD_LEGACY_PREVALIDATE_PREPARE_REMOVED
// Solicitudes usa createSolicitudIq directo; validaciones sensibles permanecen en backend.
export type IqSolicitudCreationResult = {
  solicitudId: string;
  solicitudFolio: string;
  status:
    | "CREATED"
    | "FAILED_RETRYABLE"
    | "OUTCOME_UNKNOWN";
  created: boolean;
  reused: boolean;
  iqId: string | null;
  attemptCount: number;
  durationMs: number;
  submitClicked: boolean;
  outcome: string;
  retryBlocked: boolean;
  resultPath?: string | null;
  responseMessage?: string | null;
  errors?: string[];
};

export async function createSolicitudIq(
  solicitudId: string,
): Promise<{
  data: IqSolicitudCreationResult;
  message: string;
}> {
  const res = await callIq<
    {
      solicitudId: string;
    },
    CallableResult<IqSolicitudCreationResult>
  >(
    "createSolicitudIq",
    {
      solicitudId,
    },
    330_000,
  );

  if (!res.data) {
    throw new Error(
      res.message ||
        "No se pudo crear la solicitud en IQ.",
    );
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}

export type IqSolicitudReconciliationResult = {
  solicitudId: string;
  status:
    | "LINKED"
    | "NOT_FOUND"
    | "WAITING_FOR_OPERATING_WINDOW"
    | "LOCKED"
    | "REVIEW_REQUIRED";
  linked: boolean;
  iqId: string | null;
  marker: string;
  nextRunAt?: number | null;
  operatingWindowReason?: string | null;
};

export async function reconcileSolicitudIq(
  solicitudId: string,
  force = false,
): Promise<{
  data: IqSolicitudReconciliationResult;
  message: string;
}> {
  const res = await callIq<
    {
      solicitudId: string;
      force: boolean;
    },
    CallableResult<IqSolicitudReconciliationResult>
  >(
    "reconcileSolicitudIq",
    {
      solicitudId,
      force,
    },
    210_000,
  );

  if (!res.data) {
    throw new Error(
      res.message ||
        "No se pudo sincronizar la solicitud con IQ.",
    );
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}

export type IqOperatingWindow = {
  start: string;
  end: string;
};

export type IqAutomationProcessConfig = {
  solicitudes: boolean;
  pagos: boolean;
  aplicacionPagos: boolean;
  dispersiones: boolean;
  crearCliente: boolean;
  cancelarSolicitud: boolean;
};

// H4_D87_A58_A9_PROCESS_INTERVALS_FRONTEND
// H4_D87_A58_A14_MIN_INTERVAL_5_MINUTES
export type IqAutomationProcessIntervals = {
  discovery: number;
  invoiceImport: number;
  statusMonitor: number;
  solicitudCreate: number;
  solicitudReconciliation: number;
  pagoCreate: number;
  pagoReconciliation: number;
  dispersionCreate: number;
  paymentApplicationExecution: number;
};

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
export type IqOperatingCalendar = {
  enabled: boolean;
  timezone: string;
  weeklyWindows: Record<string, IqOperatingWindow[]>;
  holidays: string[];
  dateOverrides: Record<
    string,
    {
      closed?: boolean;
      windows?: IqOperatingWindow[];
    }
  >;
  creationCutoffMinutes: number;
  reconciliationCutoffMinutes: number;
  invoiceCutoffMinutes: number;
  queueDrainSeconds: number;
  automation: IqAutomationProcessConfig;
  intervalMinutes: IqAutomationProcessIntervals;
  configured?: boolean;
  decisions?: Record<string, unknown>;
};

export async function getIqOperatingCalendar(): Promise<{
  data: IqOperatingCalendar;
  message: string;
}> {
  const res = await callIq<
    Record<string, never>,
    CallableResult<IqOperatingCalendar>
  >("getIqOperatingCalendar", {});

  if (!res.data) {
    throw new Error(
      res.message ||
        "No se pudo cargar el calendario IQ.",
    );
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}

export async function updateIqOperatingCalendar(
  input: IqOperatingCalendar,
): Promise<{
  data: IqOperatingCalendar;
  message: string;
}> {
  const res = await callIq<
    IqOperatingCalendar,
    CallableResult<IqOperatingCalendar>
  >("updateIqOperatingCalendar", input);

  if (!res.data) {
    throw new Error(
      res.message ||
        "No se pudo actualizar el calendario IQ.",
    );
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}


export async function setIqAutomationMasterEnabled(
  enabled: boolean,
): Promise<{
  data: {
    enabled: boolean;
  };
  message: string;
}> {
  const res = await callIq<
    {
      enabled: boolean;
    },
    CallableResult<{
      enabled: boolean;
    }>
  >(
    "setIqAutomationMasterEnabled",
    {
      enabled,
    },
  );

  if (!res.data) {
    throw new Error(
      res.message ||
        "No se pudo actualizar el Master IQ.",
    );
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}


export type IqCreationQueueResult = {
  batchId: string | null;
  total: number;
  queued: number;
  results: Array<{
    queued: boolean;
    jobId: string;
    batchId: string;
    reused: boolean;
    message: string;
  }>;
};

export async function enqueueSolicitudIqCreation(
  solicitudIds: string | string[],
): Promise<{
  data: IqCreationQueueResult;
  message: string;
}> {
  const ids = Array.isArray(solicitudIds) ? solicitudIds : [solicitudIds];
  const res = await callIq<
    {
      solicitudIds: string[];
    },
    CallableResult<IqCreationQueueResult>
  >(
    "enqueueSolicitudIqCreation",
    {
      solicitudIds: ids,
    },
    70_000,
  );

  if (!res.data) {
    throw new Error(
      res.message ||
        "No se pudo encolar la solicitud para envio automatico.",
    );
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}

export type IqSolicitudStatusSyncResult = {
  ok: boolean;
  status: string;
};

export async function syncIqSolicitudStatus(
  solicitudId: string,
): Promise<IqSolicitudStatusSyncResult> {
  return callIq<
    {
      solicitudId: string;
    },
    IqSolicitudStatusSyncResult
  >(
    "syncIqSolicitudStatus",
    {
      solicitudId,
    },
    210_000,
  );
}

export type IqSolicitudInvoiceSyncResult = {
  ok: boolean;
  status: string;
};

export async function syncIqSolicitudInvoice(
  solicitudId: string,
  options?: { force?: boolean },
): Promise<IqSolicitudInvoiceSyncResult> {
  return callIq<
    {
      solicitudId: string;
      force?: boolean;
    },
    IqSolicitudInvoiceSyncResult
  >(
    "syncIqSolicitudInvoice",
    {
      solicitudId,
      force: options?.force === true,
    },
    330_000,
  );
}

export type ExistingIqFolioInvoiceImportQueueResult = {
  ok: boolean;
  data?: {
    dryRun: boolean;
    total: number;
    queued: number;
    skipped: number;
    results: Array<Record<string, unknown>>;
  };
  message?: string;
};

export async function enqueueExistingIqFolioInvoiceImports(input: {
  solicitudIds: string[];
  dryRun?: boolean;
  confirm?: boolean;
}): Promise<ExistingIqFolioInvoiceImportQueueResult> {
  return callIq<
    {
      solicitudIds: string[];
      dryRun?: boolean;
      confirm?: boolean;
    },
    ExistingIqFolioInvoiceImportQueueResult
  >(
    "enqueueExistingIqFolioInvoiceImports",
    input,
    330_000,
  );
}

export type IqAutomationDashboardJobRow = {
  id: string;
  status: string;
  solicitudId: string | null;
  folio: string | null;
  iqFolio: string | null;
  profileId: string | null;
  profileAlias: string | null;
  attempts: number;
  nextRunAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  error: string | null;
};

export type IqAutomationDashboardSummary = {
  totalSampled: number;
  active: number;
  due: number;
  failed: number;
  imported: number;
  created: number;
  nextDueAt: string | null;
  byStatus: Record<string, number>;
};

export type IqAutomationDashboard = {
  rootId: string;
  generatedAt: string;
  summary: {
    invoices: IqAutomationDashboardSummary;
    creations: IqAutomationDashboardSummary;
    statuses: IqAutomationDashboardSummary;
    discovery: {
      status: string;
      updatedAt: string | null;
      cursorCreatedAt: string | null;
      lastRun: Record<string, unknown>;
    };
  };
  recent: {
    invoiceJobs: IqAutomationDashboardJobRow[];
    createJobs: IqAutomationDashboardJobRow[];
    statusJobs: IqAutomationDashboardJobRow[];
    queueRuns: Array<{
      id: string;
      type: string | null;
      version: string | null;
      createdAt: string | null;
      summary: Record<string, unknown>;
    }>;
  };
};

export async function getIqAutomationDashboard(): Promise<{
  data: IqAutomationDashboard;
  message: string;
}> {
  const res = await callIq<
    Record<string, never>,
    CallableResult<IqAutomationDashboard>
  >("getIqAutomationDashboard", {}, 70_000);

  if (!res.data) {
    throw new Error(res.message || "No se pudo cargar el diagnostico IQ.");
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}

export type IqPagoSyncRequestResult = {
  pagoId: string;
  operation: "CREATE" | "RECONCILE";
  queued: boolean;
  generation: string;
};

export async function requestPagoIqSync(
  pagoId: string,
): Promise<{
  data: IqPagoSyncRequestResult;
  message: string;
}> {
  const res = await callIq<
    { pagoId: string },
    CallableResult<IqPagoSyncRequestResult>
  >(
    "requestPagoIqSync",
    { pagoId },
    60_000,
  );

  if (!res.data) {
    throw new Error(
      res.message ||
        "No se pudo iniciar la sincronizacion IQ.",
    );
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}
export type IqPagoDepositCandidate = {
  iqId: string;
  score: number;
  matchReasons: string[];
  amountOk: boolean;
  clientOk: boolean;
  companyOk: boolean;
  markerOk: boolean;
  idOk: boolean;
  client: string;
  company: string;
  partner: string;
  operationType: string;
  operationStatus: string;
  reconciliationStatus: string;
  amount: number | null;
  sum: number | null;
  subtotal: number | null;
  totalReturn: number | null;
  createdAt: string;
  rowText: string;
};

export type DebugPagoIqDepositCandidatesResult = {
  pagoId: string;
  inputPagoReference?: string;
  expected: {
    iqId: string | null;
    marker: string;
    clientName: string;
    companyName: string;
    amount: number;
    targetDateIso: string | null;
  };
  authenticated: boolean;
  finalPath: string;
  pagesFetched: number;
  rowsFetched: number;
  candidates: IqPagoDepositCandidate[];
  errors: string[];
};

export async function debugFindPagoIqDepositCandidates(
  pagoId: string,
  options?: { limit?: number; maxRows?: number },
): Promise<{
  data: DebugPagoIqDepositCandidatesResult;
  message: string;
}> {
  const res = await callIq<
    { pagoId: string; limit?: number; maxRows?: number },
    CallableResult<DebugPagoIqDepositCandidatesResult>
  >(
    "debugFindPagoIqDepositCandidates",
    { pagoId, limit: options?.limit ?? 15, maxRows: options?.maxRows ?? 1000 },
    240_000,
  );

  if (!res.data) {
    throw new Error(res.message || "No se pudieron buscar candidatos IQ.");
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}

export type IqDepositHttpShadowMatch = {
  key: string;
  browser: {
    found: boolean;
    iqId: string;
    operationStatus: string;
    reconciliationStatus: string;
    matchStrategy: string;
  };
  http: {
    found: boolean;
    iqId: string;
    operationStatus: string;
    reconciliationStatus: string;
    matchStrategy: string;
  };
  parity: {
    sameFound: boolean;
    sameIqId: boolean;
    sameOperationStatus: boolean;
    sameReconciliationStatus: boolean;
    equivalent: boolean;
  };
};

export type DebugPagoIqDepositHttpShadowResult = {
  pagoFolio: string;
  clientName: string;
  companyName: string;
  amount: number;
  expectedIqFolio: string | null;
  searchMode: "EXACT_IQ_ID" | "RECOVERY_START_DATE";
  createdAtLowerBoundIso: string;
  profileAlias: string;
  shadow: {
    mode: "READ_ONLY_HTTP_SHADOW";
    authenticated: boolean;
    browserClosedBeforeHttp: boolean;
    finalPath: string;
    finalRequestPath: string;
    session: {
      cookieCount: number;
      cookieNames: string[];
      forwardedHeaderNames: string[];
      sensitiveValuesReturned: false;
    };
    browserReference: {
      ok: boolean;
      httpStatus: number;
      contentType: string;
      pagesFetched: number;
      rowsFetched: number;
      elapsedMs: number;
      responseShape: string;
      error: string;
    };
    directHttp: {
      ok: boolean;
      httpStatus: number;
      contentType: string;
      pagesFetched: number;
      rowsFetched: number;
      elapsedMs: number;
      responseShape: string;
      error: string;
    };
    comparisons: IqDepositHttpShadowMatch[];
    summary: {
      compared: number;
      browserFound: number;
      httpFound: number;
      equivalent: number;
      mismatched: number;
      readyForOperationalPilot: boolean;
    };
    guarantees: {
      methods: ["GET"];
      iqWrites: false;
      pay0OperationalWrites: false;
      cookiesPersisted: false;
      tokensPersisted: false;
    };
    errors: string[];
  };
};

export async function debugPagoIqDepositHttpShadow(
  pagoId: string,
  options?: { maxRows?: number },
): Promise<{
  data: DebugPagoIqDepositHttpShadowResult;
  message: string;
}> {
  const res = await callIq<
    { pagoId: string; maxRows?: number },
    CallableResult<DebugPagoIqDepositHttpShadowResult>
  >(
    "debugPagoIqDepositHttpShadow",
    { pagoId, maxRows: options?.maxRows ?? 300 },
    180_000,
  );

  if (!res.data) {
    throw new Error(res.message || "No se pudo ejecutar HTTP sombra de depositos IQ.");
  }

  return {
    data: res.data,
    message: res.message || "",
  };
}

// H4_D85_A1_SERVICE_DEPOSIT_HTTP_READ_ONLY_SHADOW

// H4_D61A_SERVICE_DEBUG_PAGO_IQ_DEPOSIT_CANDIDATES
// H4_D61B_SERVICE_PAGO_FOLIO_FIRST

const IQ_PAGOS_HTTP_BASE_H4_D50F = "https://us-central1-pay-0-system.cloudfunctions.net";

async function callIqPagosHttpH4D50F<T>(name: string, payload: unknown): Promise<CallableResult<T>> {
  const token = await getAuth().currentUser?.getIdToken();

  if (!token) {
    throw new Error("Sesion requerida.");
  }

  const response = await fetch(IQ_PAGOS_HTTP_BASE_H4_D50F + "/" + name, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const res = (await response.json().catch(() => null)) as CallableResult<T> | null;

  if (!response.ok || !res?.ok) {
    throw new Error(res?.message || ("No se pudo ejecutar " + name + "."));
  }

  return res;
}

// IQ2G_H4_D50F_FRONTEND_HTTP_HELPER
export type ManualLinkPagoIqDepositResult = {
  pagoId: string;
  iqDepositId: string;
  linked: boolean;
  conciliated: boolean;
  pay0StatusUpdated: boolean;
};

export async function manualLinkPagoIqDeposit(params: {
  pagoId: string;
  iqDepositId: string;
  reconciliationStatus?: string;
  operationStatus?: string;
  note?: string;
  updatePagoStatus?: boolean;
}) {
  return callIqPagosHttpH4D50F<ManualLinkPagoIqDepositResult>("manualLinkPagoIqDepositHttp", params);
}

export type OmitPagoIqDepositAutomationResult = {
  pagoId: string;
  omitted: boolean;
};

export async function omitPagoIqDepositAutomation(params: {
  pagoId: string;
  reason: string;
  comment?: string;
}) {
  return callIqPagosHttpH4D50F<OmitPagoIqDepositAutomationResult>("omitPagoIqDepositAutomationHttp", params);
}


export type OmitIqAutomationArea =
  | "invoice"
  | "create"
  | "status"
  | "pagoReceipt"
  | "pagoDepositStatus"
  | "all";

export type OmitIqAutomationJobResult = {
  area: string;
  omittedCount: number;
  omitted: Array<{
    collection: string;
    id: string;
    folio: string;
    pagoId: string;
    solicitudId: string;
  }>;
};

export async function omitIqAutomationJob(params: {
  area?: OmitIqAutomationArea;
  jobId?: string;
  folio?: string;
  pagoId?: string;
  solicitudId?: string;
  reason?: string;
  comment?: string;
}): Promise<{
  data: OmitIqAutomationJobResult;
  message: string;
}> {
  const res = await callIq<
    Record<string, unknown>,
    CallableResult<OmitIqAutomationJobResult>
  >("omitIqAutomationJob", params as Record<string, unknown>, 180_000);

  if (!res.data) {
    throw new Error(res.message || "No se pudo omitir seguimiento IQ.");
  }

  return {
    data: res.data,
    message: res.message || "Seguimiento IQ omitido.",
  };
}

// IQ2G_H4_D57B_FRONTEND_OMIT_IQ_AUTOMATION_JOB

// IQ2G_H4_D50B_FRONTEND_SERVICES
// IQ2G_H4_D50F_FRONTEND_HTTP_CALLS

export type IqDispersionDiagnosticRow = {
  id: string;
  folio: string;
  status: string;
  clientId: string | null;
  clientName: string | null;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  methodType: string | null;
  destinationKind: string | null;
  bankName: string | null;
  destinationMasked: string | null;
  amount: number;
  documentCount: number;
  hasReceipt: boolean;
  iqFolio: string | null;
  iqStatus: string | null;
  integrationState: "LINKED" | "BLOCKED" | "READY_FOR_IQ_MAPPING";
  blockers: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type IqDispersionDiagnosticResult = {
  version: string;
  mode: "READ_ONLY";
  summary: {
    total: number;
    ready: number;
    linked: number;
    blocked: number;
    withReceipt: number;
    terminal: number;
  };
  rows: IqDispersionDiagnosticRow[];
};

export async function getIqDispersionDiagnostic(limit = 100): Promise<{
  data: IqDispersionDiagnosticResult;
  message: string;
}> {
  const res = await callIq<{ limit: number }, CallableResult<IqDispersionDiagnosticResult>>(
    "getIqDispersionDiagnostic",
    { limit },
    90_000,
  );

  if (!res.data) {
    throw new Error(res.message || "No se pudo cargar diagnostico de dispersiones.");
  }

  return {
    data: res.data,
    message: res.message || "Diagnostico de dispersiones cargado.",
  };
}
export type IqDispersionModuleProbeField = {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  required: boolean;
  disabled: boolean;
  options: Array<{ value: string; text: string }>;
};

export type IqDispersionModuleProbeResult = {
  version: string;
  mode: "READ_ONLY";
  businessWrites: 0;
  submitAfterLogin: false;
  profileId: string;
  profileAlias: string;
  associatedName: string | null;
  authenticated: boolean;
  landingPath: string;
  candidateLinks: Array<{
    path: string;
    text: string;
    score: number;
  }>;
  pages: Array<{
    path: string;
    title: string;
    httpStatus: number;
    bodySnippet: string;
    formsCount: number;
    tablesCount: number;
    fields: IqDispersionModuleProbeField[];
    actions: Array<{
      tag: string;
      type: string;
      name: string;
      id: string;
      text: string;
    }>;
  }>;
  networkGetPaths: Array<{
    path: string;
    status: number;
    contentType: string;
  }>;
};

export async function probeIqDispersionModule(): Promise<{
  data: IqDispersionModuleProbeResult;
  message: string;
}> {
  const res = await callIq<Record<string, never>, CallableResult<IqDispersionModuleProbeResult>>(
    "probeIqDispersionModule",
    {},
    240_000,
  );

  if (!res.data) {
    throw new Error(res.message || "No se pudo explorar el modulo IQ de dispersiones.");
  }

  return {
    data: res.data,
    message: res.message || "Exploracion IQ terminada.",
  };
}

