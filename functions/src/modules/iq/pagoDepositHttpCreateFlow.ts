import { createHash, randomUUID } from "node:crypto";
import {
  createIqDepositHttpControlled,
  type CreateDepositResult,
} from "./depositHttpCreateCore";
import {
  buildPagoDepositFingerprint,
  createPagoAttemptJournal,
  createPagoAttemptLockAdapter,
  downloadPagoVoucherFromStorage,
  type PagoReceiptDescriptor,
} from "./depositHttpCreateFirebaseAdapters";
import {
  loginIqHttpDirect,
  toIqAuthContext,
  type IqHttpCredentials,
} from "./iqHttpAuth";
import {
  resolveIqDepositCatalogHttp,
  type IqDepositCatalogTarget,
} from "./iqDepositHttpCatalogResolver";

export interface PagoDepositHttpCreateFlowInput {
  pagoId: string;
  actorUid: string;
  source: string;
  pay0CreatedAtIso: string;
  apiOrigin: string;
  credentials: IqHttpCredentials;
  catalogTarget: IqDepositCatalogTarget;
  receipt: PagoReceiptDescriptor;
  sum: number;
  iqAttemptId?: string;
  allowHttpPost: boolean;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function assertIsoDate(value: string): string {
  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    throw new Error("PAY0_CREATED_AT_INVALID");
  }

  return new Date(parsed).toISOString();
}

function assertPositiveAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("PAGO_AMOUNT_INVALID");
  }

  return value;
}

function voucherSha256(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

export async function runPagoDepositHttpCreateFlow(
  input: PagoDepositHttpCreateFlowInput,
): Promise<CreateDepositResult> {
  const pagoId = cleanText(input.pagoId);
  const actorUid = cleanText(input.actorUid);
  const source = cleanText(input.source) || "PAY0_HTTP";
  const pay0CreatedAtIso = assertIsoDate(
    input.pay0CreatedAtIso,
  );
  const sum = assertPositiveAmount(input.sum);
  const iqAttemptId =
    cleanText(input.iqAttemptId) || randomUUID();

  if (!pagoId) {
    throw new Error("PAGO_ID_REQUIRED");
  }

  if (!actorUid) {
    throw new Error("ACTOR_UID_REQUIRED");
  }

  /*
   * El comprobante es independiente de IQ.
   * Descargarlo en paralelo evita sumar Storage despues de
   * completar login + resolucion secuencial del catalogo IQ.
   */
  const [voucher, iqContext] = await Promise.all([
    downloadPagoVoucherFromStorage(
      input.receipt,
    ),
    (async () => {
      const session = await loginIqHttpDirect({
        apiOrigin: input.apiOrigin,
        credentials: input.credentials,
      });

      const catalog = await resolveIqDepositCatalogHttp(
        session,
        input.catalogTarget,
      );

      return {
        session,
        catalog,
      };
    })(),
  ]);

  const { session, catalog } = iqContext;

  const sha256 = voucherSha256(voucher.bytes);

  const fingerprint = buildPagoDepositFingerprint({
    partnerId: catalog.partnerId,
    clientId: catalog.clientId,
    companyId: catalog.companyId,
    operationTypeId: catalog.operationTypeId,
    saleType: catalog.saleTypeValue,
    sum,
    currency: catalog.currencyValue,
    voucherSha256: sha256,
  });

  const adapterContext = {
    pagoId,
    actorUid,
    source,
    fingerprint,
  };

  return createIqDepositHttpControlled({
    auth: toIqAuthContext(session),
    identity: {
      pay0PagoId: pagoId,
      iqAttemptId,
      pay0CreatedAtIso,
      partnerId: catalog.partnerId,
      partnerName: catalog.partnerName,
      clientId: catalog.clientId,
      clientName: catalog.clientName,
      companyId: catalog.companyId,
      companyName: catalog.companyName,
      operationTypeId: catalog.operationTypeId,
      operationTypeName: catalog.operationTypeName,
      saleType: catalog.saleTypeValue,
      sum,
      currency: catalog.currencyValue,
      expectedSalePercentageId:
        catalog.salePercentageId,
      expectedBasePercentage:
        catalog.basePercentage,
      expectedSalePercentage:
        catalog.salePercentage,
    },
    voucher,
    lock: createPagoAttemptLockAdapter(
      adapterContext,
    ),
    journal: createPagoAttemptJournal(
      adapterContext,
    ),
    allowHttpPost: input.allowHttpPost,
  });
}