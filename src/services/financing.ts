import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

function createClientIdempotencyKey(operation: string) {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  const randomPart = cryptoObj?.randomUUID
    ? cryptoObj.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${operation}:${randomPart}`;
}

function withClientIdempotencyKey<T extends { idempotencyKey?: string }>(
  operation: string,
  input: T
): T {
  const current = String(input.idempotencyKey || "").trim();
  if (current) return input;

  return {
    ...input,
    idempotencyKey: createClientIdempotencyKey(operation),
  };
}

export interface GrantClientAdvanceInput {
  idempotencyKey?: string;
  clienteId: string;
  amount: number;
  reason?: string;
  note?: string;
  reference?: string;
  empresaId?: string;
  asociadoId?: string;
}

export interface GrantClientAdvanceResult {
  ok: boolean;
  advanceId: string | null;
  movementId: string | null;
  clienteId: string;
  clienteNombre: string | null;
  amount: number;
  beforeBalance: number | null;
  afterBalance: number | null;
  status: "OTORGADO";
}

export async function grantClientAdvance(input: GrantClientAdvanceInput) {
  const callable = httpsCallable<GrantClientAdvanceInput, GrantClientAdvanceResult>(
    functions,
    "grantClientAdvance"
  );
  const result = await callable(withClientIdempotencyKey("grantClientAdvance", input));
  return result.data;
}

export async function listScopedClientDispersions(limit = 500): Promise<{ rows: any[]; limit: number }> {
  const callable = httpsCallable<{ limit: number }, { rows: any[]; limit: number }>(functions, "listScopedClientDispersions");
  return (await callable({ limit })).data;
}

export interface CreateClientDispersionInput {
  idempotencyKey?: string;
  clienteId: string;
  beneficiaryId: string;
  methodId: string;
  despachoId: string;
  amount: number;
  note?: string;
  reference?: string;
  empresaId?: string;
  asociadoId?: string;
}

export interface CreateClientDispersionResult {
  ok: boolean;
  dispersionId: string | null;
  movementId: string | null;
  folio: string | null;
  clienteId: string;
  beneficiaryId: string;
  methodId: string;
  despachoId: string;
  operationTypeKey: string;
  amount: number;
  clientChargeAmount: number;
  totalClientDebitAmount: number;
  despachoCostAmount: number;
  superadminEarningAmount: number;
  adminEarningAmount: number;
  operadorEarningAmount: number;
  totalEarningsAmount: number;
  commissionMovementId: string | null;
  beforeBalance: number | null;
  afterBalance: number | null;
  status: "REGISTRADA";
}

export interface PreviewClientDispersionPricingInput {
  clienteId: string;
  methodId: string;
  despachoId: string;
  amount: number;
}

export interface PreviewClientDispersionPricingResult {
  ok: boolean;
  operationTypeKey: string;
  operationTypeName: string;
  despachoId: string;
  amount: number;
  clientRate: number;
  pricingMode: "PERCENT" | "FIXED";
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  clientChargeAmount: number;
  totalClientDebitAmount: number;
  despachoCostAmount: number;
  superadminEarningAmount: number;
  adminEarningAmount: number;
  operadorEarningAmount: number;
  totalEarningsAmount: number;
  beforeBalance: number;
  afterBalance: number;
  canCreate: boolean;
  currency: string;
}

export async function previewClientDispersionPricing(
  input: PreviewClientDispersionPricingInput
) {
  const callable = httpsCallable<
    PreviewClientDispersionPricingInput,
    PreviewClientDispersionPricingResult
  >(functions, "previewClientDispersionPricing");

  const result = await callable(input);
  return result.data;
}

export async function createClientDispersion(input: CreateClientDispersionInput) {
  const callable = httpsCallable<CreateClientDispersionInput, CreateClientDispersionResult>(
    functions,
    "createClientDispersion"
  );
  const result = await callable(withClientIdempotencyKey("createClientDispersion", input));
  return result.data;
}


export interface CreateClientDispersionsMassiveItemInput {
  rowNumber?: number;
  beneficiaryId?: string;
  methodId?: string;
  beneficiaryName?: string;
  nombre?: string;
  banco?: string;
  bankName?: string;
  bankCode?: string;
  clabe?: string;
  numeroTarjeta?: string;
  cardNumber?: string;
  tarjeta?: string;
  destinationKind?: "CLABE" | "TARJETA" | "EFECTIVO";
  methodTipo?: "DEBITO" | "TDC" | "AMEX";
  tipo?: "DEBITO" | "TDC" | "AMEX";
  amount: number;
  monto?: number;
  note?: string;
  reference?: string;
  referencia?: string;
  referenciaOperativa?: string;
  empresaId?: string;
  asociadoId?: string;
}

// H4_D87_A58_A33_MASSIVE_DESPACHO_CONTRACT
export interface CreateClientDispersionsMassiveInput {
  idempotencyKey?: string;
  clienteId: string;
  despachoId: string;
  items: CreateClientDispersionsMassiveItemInput[];
  methodTipo?: "DEBITO" | "TDC" | "AMEX";
  empresaId?: string;
  asociadoId?: string;
}

export interface CreateClientDispersionsMassiveResult {
  ok: boolean;
  batchId: string;
  clienteId: string;
  totalRows: number;
  createdCount: number;
  skippedCount: number;
  beneficiariesCreated: number;
  methodsCreated: number;
  totalAmount: number;
  beforeBalance: number | null;
  afterBalance: number | null;
  sequenceStart: number | null;
  sequenceEnd: number | null;
  sequenceCounterPath: string | null;
  dispersions: Array<{
    rowNumber: number;
    dispersionId: string;
    movementId: string;
    folio: string;
    amount: number;
    beforeBalance: number;
    afterBalance: number;
  }>;
  skippedRows: Array<{
    rowNumber: number;
    nombre: string;
    amount: number;
    reason: string;
  }>;
}

export async function createClientDispersionsMassive(input: CreateClientDispersionsMassiveInput) {
  const callable = httpsCallable<
    CreateClientDispersionsMassiveInput,
    CreateClientDispersionsMassiveResult
  >(functions, "createClientDispersionsMassive");

  const result = await callable(withClientIdempotencyKey("createClientDispersionsMassive", input));
  return result.data;
}
export type DispersionIncidentType = "DEVOLUCION" | "CANCELACION";

export interface RequestClientDispersionIncidentInput {
  dispersionId: string;
  incidentType: DispersionIncidentType;
  reason?: string;
  note?: string;
}

export interface RequestClientDispersionIncidentResult {
  ok: boolean;
  dispersionId: string;
  status: "REGISTRADA";
  incidentStatus: "SOLICITADA";
  incidentType: DispersionIncidentType;
}

export async function requestClientDispersionIncident(
  input: RequestClientDispersionIncidentInput
) {
  const callable = httpsCallable<
    RequestClientDispersionIncidentInput,
    RequestClientDispersionIncidentResult
  >(functions, "requestClientDispersionIncident");

  const result = await callable(input);
  return result.data;
}

export type ResolveClientDispersionIncidentDecision =
  | "RECHAZADA"
 
  | "DEVOLUCION_APLICADA"
  | "CANCELACION_APLICADA";

export interface ResolveClientDispersionIncidentInput {
  dispersionId: string;
  decision: ResolveClientDispersionIncidentDecision;
  resolutionNote?: string;
}

export interface ResolveClientDispersionIncidentResult {
  ok: boolean;
  dispersionId: string;
  decision: ResolveClientDispersionIncidentDecision;
  reintegrated: boolean;
  reintegrationMovementId: string | null;
  beforeBalance: number | null;
  afterBalance: number | null;
}

export async function resolveClientDispersionIncident(
  input: ResolveClientDispersionIncidentInput
) {
  const callable = httpsCallable<
    ResolveClientDispersionIncidentInput,
    ResolveClientDispersionIncidentResult
  >(functions, "resolveClientDispersionIncident");

  const result = await callable(input);
  return result.data;
}

export interface AddClientDispersionNotaInput {
  dispersionId: string;
  text: string;
}

export interface AddClientDispersionNotaResult {
  ok: boolean;
  dispersionId: string;
  noteId: string;
}

export async function addClientDispersionNota(input: AddClientDispersionNotaInput) {
  const callable = httpsCallable<AddClientDispersionNotaInput, AddClientDispersionNotaResult>(
    functions,
    "addClientDispersionNota"
  );

  const result = await callable(input);
  return result.data;
}

export interface GenerateClientDispersionIqInput {
  dispersionId: string;
  confirm: true;
}

export interface GenerateClientDispersionIqLegResult {
  legId: string;
  despachoId?: string;
  status: string;
  reused?: boolean;
  iqId?: string | null;
  submitClicked?: boolean;
  postAccepted?: boolean;
  message?: string | null;
  reason?: string | null;
  errors?: string[];
}

export interface GenerateClientDispersionIqResult {
  version: "H4_D82_A4_A1";
  dispersionId: string;
  folio: string | null;
  eligibleCount: number;
  aggregateStatus: string;
  legCount: number;
  createdCount: number;
  reviewCount: number;
  failedCount: number;
  results: GenerateClientDispersionIqLegResult[];
}

export async function generateClientDispersionIq(
  input: GenerateClientDispersionIqInput,
): Promise<GenerateClientDispersionIqResult> {
  const fn = httpsCallable(
    functions,
    "createClientDispersionIq",
  );
  const response: any = await fn(input);

  return (
    response?.data?.data ??
    response?.data
  ) as GenerateClientDispersionIqResult;
}

export interface PreviewClientDispersionIqLeg {
  legId: string;
  legIndex: number;
  despachoId?: string;
  despachoName?: string;
  status:
    | "READY"
    | "NON_IQ_CHANNEL"
    | "BLOCKED"
    | "SKIPPED";
  reason?: string;
  amount?: number;
  currency?: string;
  operationTypeKey?: string;
  percentageLabel?: string;
  destinationKind?: string;
  destinationLast4?: string;
  associatedName?: string;
  iqCredentialProfileId?: string;
  iqCredentialProfileAlias?: string;
  diagnostic?: {
    despachoNombre?: string;
    exists?: boolean | null;
    active?: boolean | null;
    rootMatch?: boolean | null;
    iqEnabled?: boolean;
    iqEnabledFlag?: boolean;
    usesIq?: boolean;
    iqDispersionEnabled?: boolean;
    integrationMarker?: string;
    credentialProfileConfigured?: boolean;
  };
}

export interface PreviewClientDispersionIqResult {
  version: "H4_D82_A4_A1";
  previewOnly: true;
  dispersionId: string;
  folio: string | null;
  operationTypeKey: string;
  destination: {
    kind: string;
    last4: string;
  };
  eligibleCount: number;
  legs: PreviewClientDispersionIqLeg[];
}

export async function previewClientDispersionIq(
  dispersionId: string,
): Promise<PreviewClientDispersionIqResult> {
  const fn = httpsCallable(
    functions,
    "createClientDispersionIq",
  );
  const response: any = await fn({
    dispersionId,
    previewOnly: true,
  });

  return (
    response?.data?.data ??
    response?.data
  ) as PreviewClientDispersionIqResult;
}
