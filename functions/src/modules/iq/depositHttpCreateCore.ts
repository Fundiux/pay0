import { parseIqDateTimeMs } from "./iqDateTime";
import { createHash } from "node:crypto";

export const IQ_DEPOSIT_HTTP_CREATE_FLAG =
  "PAY0_IQ_DEPOSIT_HTTP_CREATE_ENABLED";

export type IqDepositAttemptState =
  | "PREVALIDATED"
  | "POST_IN_PROGRESS"
  | "POST_ACKNOWLEDGED_PENDING_IQ_ID"
  | "OUTCOME_UNKNOWN"
  | "POST_REJECTED"
  | "IQ_ID_LINKED"
  | "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED"
  | "CLOCK_CONTRADICTION_REVIEW_REQUIRED"
  | "FAILED_BEFORE_POST";

export interface IqAuthContext {
  apiOrigin: string;
  bearerToken: string;
}

export interface DepositIdentity {
  pay0PagoId: string;
  iqAttemptId: string;
  pay0CreatedAtIso: string;
  partnerId: number;
  partnerName: string;
  clientId: number;
  clientName: string;
  companyId: number;
  companyName: string;
  operationTypeId: number;
  operationTypeName: string;
  saleType: string;
  sum: number;
  currency: string;
  expectedSalePercentageId?: number;
  expectedBasePercentage?: string;
  expectedSalePercentage?: string;
}

export interface VoucherInput {
  bytes: Uint8Array;
  originalName: string;
  mimeType: string;
}

export interface VoucherIdentity {
  voucherSha256: string;
  voucherSizeBytes: number;
  voucherMimeType: string;
  voucherOriginalName: string;
}

export interface DepositPrevalidationResult {
  salePercentageId: number;
  basePercentage: string;
  salePercentage: string;
}

export interface DepositPostReceipt {
  state:
    | "POST_ACKNOWLEDGED_PENDING_IQ_ID"
    | "OUTCOME_UNKNOWN"
    | "POST_REJECTED";
  postDispatchedAt: string;
  postAcknowledgedAt?: string;
  httpStatus?: number;
  responseMessage?: string;
}

export interface IqDepositRow {
  id: number;
  created_at: string;
  operation_status: string;
  conciliation_status: string;
  sum: string | number;
  currency: string;
  partner: string;
  company: string;
  client: string;
  operation_type: string;
  sale_type: string;
  base_percentage: string | number;
  sale_percentage: string | number;
  voucher?: boolean;
}

export interface AttemptLockLease {
  lockKey: string;
  lockedAtIso: string;
  leaseExpiresAtIso: string;
}

export interface AttemptLockAdapter {
  acquire(input: {
    pay0PagoId: string;
    iqAttemptId: string;
    leaseMs: number;
  }): Promise<AttemptLockLease>;
  release(lease: AttemptLockLease): Promise<void>;
}

export interface AttemptJournal {
  transition(input: {
    pay0PagoId: string;
    iqAttemptId: string;
    state: IqDepositAttemptState;
    patch?: Record<string, unknown>;
  }): Promise<void>;
  linkIqIdWriteOnce(input: {
    pay0PagoId: string;
    iqAttemptId: string;
    iqId: number;
    verifiedPayload: IqDepositRow;
  }): Promise<void>;
}

export interface RecoveryOptions {
  pollingBackoffMs?: readonly number[];
  pageSize?: number;
  maxPages?: number;
}

export interface CreateDepositInput {
  auth: IqAuthContext;
  identity: DepositIdentity;
  voucher: VoucherInput;
  lock: AttemptLockAdapter;
  journal: AttemptJournal;
  allowHttpPost: boolean;
  recovery?: RecoveryOptions;
}

export interface CreateDepositResult {
  state: IqDepositAttemptState;
  iqId?: number;
  voucher: VoucherIdentity;
  post: DepositPostReceipt;
  verifiedRow?: IqDepositRow;
}

const DEFAULT_BACKOFF_MS = [0, 1200, 3500, 8000] as const;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;
const LOCK_LEASE_MS = 120000;

function cleanText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function amountOf(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertFeatureFlag(input: CreateDepositInput): void {
  /*
   * La autorizacion operativa del POST pertenece al orquestador.
   * Manual y automatico reutilizan este mismo core; el automatico
   * ya esta gobernado por su configuracion maestra/scheduler.
   */
  if (input.allowHttpPost !== true) {
    throw new Error(
      "IQ_DEPOSIT_HTTP_CREATE_DISABLED: explicit runtime approval is required.",
    );
  }
}

function authHeaders(auth: IqAuthContext): Record<string, string> {
  const token = String(auth.bearerToken ?? "").trim();
  if (!token) {
    throw new Error("Missing IQ bearer token.");
  }

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

function apiUrl(auth: IqAuthContext, path: string): URL {
  const origin = new URL(auth.apiOrigin);
  return new URL(path, origin.origin);
}

export function computeVoucherIdentity(
  voucher: VoucherInput,
): VoucherIdentity {
  if (!(voucher.bytes instanceof Uint8Array) || voucher.bytes.byteLength < 1) {
    throw new Error("Voucher bytes are required.");
  }

  const originalName = String(voucher.originalName ?? "").trim();
  const mimeType = String(voucher.mimeType ?? "").trim();

  if (!originalName) {
    throw new Error("Voucher original name is required.");
  }

  if (!mimeType) {
    throw new Error("Voucher MIME type is required.");
  }

  return {
    voucherSha256: createHash("sha256")
      .update(voucher.bytes)
      .digest("hex"),
    voucherSizeBytes: voucher.bytes.byteLength,
    voucherMimeType: mimeType,
    voucherOriginalName: originalName,
  };
}

// H4_D87_A57_A61_DEAD_HTTP_PREVALIDATE_DEPOSIT_REMOVED
// El porcentaje IQ se resuelve antes de entrar al core de creacion.
// No existe GET /deposits/new separado en este modulo.
async function dispatchDepositPost(
  input: CreateDepositInput,
  salePercentageId: number,
): Promise<DepositPostReceipt> {
  assertFeatureFlag(input);
  assertFinitePositive(input.identity.sum, "Deposit sum");

  const form = new FormData();
  form.set("sum", String(input.identity.sum));
  form.set("client_id", String(input.identity.clientId));
  form.set("company_id", String(input.identity.companyId));
  form.set("currency", cleanText(input.identity.currency));
  form.set("sale_percentage_id", String(salePercentageId));

  const voucherBytes = new Uint8Array(input.voucher.bytes);
  const voucherBlob = new Blob([voucherBytes], {
    type: input.voucher.mimeType,
  });
  form.set("voucher", voucherBlob, input.voucher.originalName);

  const postDispatchedAt = new Date().toISOString();

  await input.journal.transition({
    pay0PagoId: input.identity.pay0PagoId,
    iqAttemptId: input.identity.iqAttemptId,
    state: "POST_IN_PROGRESS",
    patch: {
      postDispatchedAt,
    },
  });

  try {
    const response = await fetch(apiUrl(input.auth, "/deposits"), {
      method: "POST",
      headers: authHeaders(input.auth),
      body: form,
    });

    const postAcknowledgedAt = new Date().toISOString();
    const body = (await response.json().catch(() => ({}))) as {
      message?: unknown;
    };
    const responseMessage = String(body.message ?? "");

    if (response.status !== 201 || responseMessage !== "success") {
      return {
        state: "POST_REJECTED",
        postDispatchedAt,
        postAcknowledgedAt,
        httpStatus: response.status,
        responseMessage:
          responseMessage ||
          `IQ deposit POST returned HTTP ${response.status}.`,
      };
    }

    return {
      state: "POST_ACKNOWLEDGED_PENDING_IQ_ID",
      postDispatchedAt,
      postAcknowledgedAt,
      httpStatus: response.status,
      responseMessage,
    };
  } catch (error) {
    return {
      state: "OUTCOME_UNKNOWN",
      postDispatchedAt,
      responseMessage:
        error instanceof Error ? error.message : String(error),
    };
  }
}

function localDateInIqOffset(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid PAY0 createdAt timestamp.");
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

function rowMatches(
  row: IqDepositRow,
  identity: DepositIdentity,
  prevalidation: DepositPrevalidationResult,
): boolean {
  const createdAtMs = parseIqDateTimeMs(row.created_at);
  const lowerBoundMs = Date.parse(identity.pay0CreatedAtIso);
  const rowAmount = amountOf(row.sum);

  return (
    createdAtMs !== null && Number.isFinite(createdAtMs) &&
    Number.isFinite(lowerBoundMs) &&
    createdAtMs >= lowerBoundMs &&
    rowAmount !== null &&
    Math.abs(rowAmount - identity.sum) < 0.01 &&
    cleanText(row.currency) === cleanText(identity.currency) &&
    cleanText(row.partner) === cleanText(identity.partnerName) &&
    cleanText(row.client) === cleanText(identity.clientName) &&
    cleanText(row.company) === cleanText(identity.companyName) &&
    cleanText(row.operation_type) ===
      cleanText(identity.operationTypeName) &&
    cleanText(row.sale_type) === cleanText(identity.saleType) &&
    cleanText(row.base_percentage) ===
      cleanText(prevalidation.basePercentage) &&
    cleanText(row.sale_percentage) ===
      cleanText(prevalidation.salePercentage)
  );
}

async function fetchRecoveryCandidates(
  auth: IqAuthContext,
  identity: DepositIdentity,
  prevalidation: DepositPrevalidationResult,
  pageSize: number,
  maxPages: number,
): Promise<IqDepositRow[]> {
  const startDate = localDateInIqOffset(identity.pay0CreatedAtIso);
  const matches: IqDepositRow[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = apiUrl(auth, "/deposits");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(page * pageSize));
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("order_by_field", "id");
    url.searchParams.set("order_by_direction", "desc");

    const response = await fetch(url, {
      method: "GET",
      headers: authHeaders(auth),
    });

    if (!response.ok) {
      throw new Error(
        `IQ deposit recovery failed with HTTP ${response.status}.`,
      );
    }

    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) {
      throw new Error("IQ deposit recovery returned a non-array payload.");
    }

    const typedRows = rows as IqDepositRow[];
    for (const row of typedRows) {
      if (rowMatches(row, identity, prevalidation)) {
        matches.push(row);
      }
    }

    if (typedRows.length < pageSize) {
      break;
    }

    const oldestTimestamp = Math.min(
      ...typedRows
        .map((row) => parseIqDateTimeMs(row.created_at))
        .filter(
          (value): value is number =>
            value !== null && Number.isFinite(value),
        ),
    );
    const lowerBoundMs = Date.parse(identity.pay0CreatedAtIso);

    if (
      Number.isFinite(oldestTimestamp) &&
      Number.isFinite(lowerBoundMs) &&
      oldestTimestamp < lowerBoundMs
    ) {
      break;
    }
  }

  const unique = new Map<number, IqDepositRow>();
  for (const row of matches) {
    unique.set(Number(row.id), row);
  }

  return [...unique.values()];
}

async function verifyByExactIqId(
  auth: IqAuthContext,
  expected: IqDepositRow,
  identity: DepositIdentity,
  prevalidation: DepositPrevalidationResult,
): Promise<IqDepositRow> {
  const url = apiUrl(auth, "/deposits");
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");
  url.searchParams.set("order_by_field", "id");
  url.searchParams.set("order_by_direction", "asc");
  url.searchParams.set("filter[id]", String(expected.id));

  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(auth),
  });

  if (!response.ok) {
    throw new Error(
      `IQ exact deposit verification failed with HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("IQ exact verification returned a non-array payload.");
  }

  const exact = (payload as IqDepositRow[]).filter(
    (row) => Number(row.id) === Number(expected.id),
  );

  if (exact.length !== 1) {
    throw new Error(
      `IQ exact verification expected one row and received ${exact.length}.`,
    );
  }

  const verified = exact[0];
  if (!rowMatches(verified, identity, prevalidation)) {
    throw new Error(
      "IQ exact verification returned the expected ID with a mismatched operational payload.",
    );
  }

  return verified;
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function recoverCreatedDeposit(
  input: CreateDepositInput,
  prevalidation: DepositPrevalidationResult,
): Promise<
  | { state: "IQ_ID_LINKED"; row: IqDepositRow }
  | {
      state:
        | "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED"
        | "OUTCOME_UNKNOWN";
    }
> {
  const backoff =
    input.recovery?.pollingBackoffMs ?? DEFAULT_BACKOFF_MS;
  const pageSize =
    input.recovery?.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages =
    input.recovery?.maxPages ?? DEFAULT_MAX_PAGES;

  for (const delayMs of backoff) {
    await wait(delayMs);

    const candidates = await fetchRecoveryCandidates(
      input.auth,
      input.identity,
      prevalidation,
      pageSize,
      maxPages,
    );

    if (candidates.length > 1) {
      return {
        state: "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED",
      };
    }

    if (candidates.length === 1) {
      const verified = await verifyByExactIqId(
        input.auth,
        candidates[0],
        input.identity,
        prevalidation,
      );

      return {
        state: "IQ_ID_LINKED",
        row: verified,
      };
    }
  }

  return {
    state: "OUTCOME_UNKNOWN",
  };
}

export async function createIqDepositHttpControlled(
  input: CreateDepositInput,
): Promise<CreateDepositResult> {
  const voucherIdentity = computeVoucherIdentity(input.voucher);
  const lease = await input.lock.acquire({
    pay0PagoId: input.identity.pay0PagoId,
    iqAttemptId: input.identity.iqAttemptId,
    leaseMs: LOCK_LEASE_MS,
  });

  try {
    // H4_D87_A57_A34_NO_DUPLICATE_HTTP_PREVALIDATION
    // El catalogo IQ ya fue resuelto por pagoDepositHttpCreateFlow antes
    // de entrar al core. No repetir GET /deposits/new.
    const salePercentageId = Number(
      input.identity.expectedSalePercentageId,
    );

    if (
      !Number.isInteger(salePercentageId) ||
      salePercentageId <= 0
    ) {
      const reason =
        "IQ_DEPOSIT_CANONICAL_SALE_PERCENTAGE_ID_REQUIRED";

      await input.journal.transition({
        pay0PagoId: input.identity.pay0PagoId,
        iqAttemptId: input.identity.iqAttemptId,
        state: "FAILED_BEFORE_POST",
        patch: {
          reason,
          voucherSha256: voucherIdentity.voucherSha256,
        },
      });

      throw new Error(reason);
    }

    const resolvedPercentage: DepositPrevalidationResult = {
      salePercentageId,
      basePercentage: String(
        input.identity.expectedBasePercentage ?? "",
      ),
      salePercentage: String(
        input.identity.expectedSalePercentage ?? "",
      ),
    };

    const post = await dispatchDepositPost(
      input,
      resolvedPercentage.salePercentageId,
    );

    await input.journal.transition({
      pay0PagoId: input.identity.pay0PagoId,
      iqAttemptId: input.identity.iqAttemptId,
      state: post.state,
      patch: {
        postDispatchedAt: post.postDispatchedAt,
        postAcknowledgedAt: post.postAcknowledgedAt ?? null,
        postHttpStatus: post.httpStatus ?? null,
        postResponseMessage: post.responseMessage ?? null,
      },
    });

    if (post.state === "POST_REJECTED") {
      await input.journal.transition({
        pay0PagoId: input.identity.pay0PagoId,
        iqAttemptId: input.identity.iqAttemptId,
        state: "POST_REJECTED",
        patch: {
          reason:
            post.responseMessage ||
            "IQ rejected the deposit creation request.",
        },
      });

      return {
        state: "POST_REJECTED",
        voucher: voucherIdentity,
        post,
      };
    }

    let recovered:
      | { state: "IQ_ID_LINKED"; row: IqDepositRow }
      | {
          state:
            | "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED"
            | "OUTCOME_UNKNOWN";
        };

    try {
      recovered = await recoverCreatedDeposit(
        input,
        resolvedPercentage,
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error);

      await input.journal.transition({
        pay0PagoId: input.identity.pay0PagoId,
        iqAttemptId: input.identity.iqAttemptId,
        state: "OUTCOME_UNKNOWN",
        patch: {
          reason:
            `IQ deposit recovery failed after POST dispatch: ${reason}`,
        },
      });

      return {
        state: "OUTCOME_UNKNOWN",
        voucher: voucherIdentity,
        post,
      };
    }

    if (recovered.state === "AMBIGUOUS_CANDIDATES_REVIEW_REQUIRED") {
      await input.journal.transition({
        pay0PagoId: input.identity.pay0PagoId,
        iqAttemptId: input.identity.iqAttemptId,
        state: recovered.state,
        patch: {
          reason:
            "More than one IQ deposit matched the immutable operational identity. Voucher metadata is not available in the IQ list endpoint.",
        },
      });

      return {
        state: recovered.state,
        voucher: voucherIdentity,
        post,
      };
    }

    if (recovered.state === "OUTCOME_UNKNOWN") {
      await input.journal.transition({
        pay0PagoId: input.identity.pay0PagoId,
        iqAttemptId: input.identity.iqAttemptId,
        state: recovered.state,
        patch: {
          reason:
            "IQ deposit ID was not recovered within the controlled polling window. The POST must not be repeated automatically.",
        },
      });

      return {
        state: recovered.state,
        voucher: voucherIdentity,
        post,
      };
    }

    if (recovered.state !== "IQ_ID_LINKED") {
      throw new Error(
        `Unexpected IQ deposit recovery state: ${recovered.state}`,
      );
    }

    const recoveredRow = recovered.row;

    await input.journal.linkIqIdWriteOnce({
      pay0PagoId: input.identity.pay0PagoId,
      iqAttemptId: input.identity.iqAttemptId,
      iqId: recoveredRow.id,
      verifiedPayload: recoveredRow,
    });

    await input.journal.transition({
      pay0PagoId: input.identity.pay0PagoId,
      iqAttemptId: input.identity.iqAttemptId,
      state: "IQ_ID_LINKED",
      patch: {
        iqId: recoveredRow.id,
      },
    });

    return {
      state: "IQ_ID_LINKED",
      iqId: recoveredRow.id,
      voucher: voucherIdentity,
      post,
      verifiedRow: recoveredRow,
    };
  } finally {
    await input.lock.release(lease);
  }
}