import { access } from "node:fs/promises";
import {
  loginIqHttpDirect,
  type IqHttpAuthSession,
} from "./iqHttpAuth";

const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

type InvoiceType = "PUE" | "PPD";

type JsonRecord = Record<string, any>;

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalized(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function apiOrigin(): string {
  return DEFAULT_IQ_API_ORIGIN;
}

function authHeaders(
  session: IqHttpAuthSession,
): Record<string, string> {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: "application/json",
  };
}

async function jsonGet(
  session: IqHttpAuthSession,
  path: string,
): Promise<{
  status: number;
  body: JsonRecord;
}> {
  const response = await fetch(
    new URL(path, session.apiOrigin),
    {
      method: "GET",
      headers: authHeaders(session),
    },
  );

  let body: JsonRecord = {};
  try {
    body = (await response.json()) as JsonRecord;
  } catch {
    body = {};
  }

  return {
    status: response.status,
    body,
  };
}

function exactUniqueByName(
  rows: unknown[],
  expected: string,
  label: string,
): JsonRecord {
  const wanted = normalized(expected);

  const matches = rows
    .filter((row): row is JsonRecord =>
      Boolean(row) &&
      typeof row === "object" &&
      !Array.isArray(row),
    )
    .filter(
      (row) =>
        normalized(row.name) === wanted,
    );

  if (matches.length === 0) {
    throw new Error(
      `${label}_EXACT_NOT_FOUND`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `${label}_EXACT_AMBIGUOUS`,
    );
  }

  return matches[0];
}

export type IqSolicitudHttpPrepareResultA56 = {
  authenticated: boolean;
  formOpened: boolean;
  verified: boolean;
  finalPath: string;
  associatedMatched: string;
  clientMatched: string;
  clientMatchStrategy: string;
  companyMatched: string;
  invoiceTypeMatched: string;
  amountMatched: number;
  orderFileUploaded: boolean;
  orderFileName: string;
  commentsFilled: boolean;
  createActionFound: boolean;
  submitClicked: boolean;
  errors: string[];
  message: string;
  httpContractCapture: null;
  transport: "HTTP_DIRECT";
};

export async function runIqPrepareInvoiceFormHttpA56(input: {
  erpUrl?: string;
  apiOrigin?: string;
  username: string;
  password: string;
  associatedName: string;
  clientName: string;
  companyName: string;
  invoiceType: InvoiceType;
  amount: number;
  orderFilePath: string;
  orderFileName: string;
  comments?: string;
}): Promise<IqSolicitudHttpPrepareResultA56> {
  const result: IqSolicitudHttpPrepareResultA56 = {
    authenticated: false,
    formOpened: false,
    verified: false,
    finalPath: "/invoices/new",
    associatedMatched: "",
    clientMatched: "",
    clientMatchStrategy:
      "HTTP_CATALOG_EXACT",
    companyMatched: "",
    invoiceTypeMatched: "",
    amountMatched: 0,
    orderFileUploaded: false,
    orderFileName:
      clean(input.orderFileName),
    commentsFilled:
      Boolean(clean(input.comments)),
    createActionFound: false,
    submitClicked: false,
    errors: [],
    message: "",
    httpContractCapture: null,
    transport: "HTTP_DIRECT",
  };

  try {
    if (!clean(input.username) ||
        !clean(input.password)) {
      throw new Error(
        "IQ_AUTH_CREDENTIALS_REQUIRED",
      );
    }

    if (!["PUE", "PPD"].includes(
      input.invoiceType,
    )) {
      throw new Error(
        "IQ_INVOICE_TYPE_INVALID",
      );
    }

    if (!Number.isFinite(input.amount) ||
        input.amount <= 0) {
      throw new Error(
        "IQ_INVOICE_AMOUNT_INVALID",
      );
    }

    await access(input.orderFilePath);
    result.orderFileUploaded = true;

    const session =
      await loginIqHttpDirect({
        apiOrigin:
          clean(input.apiOrigin) ||
          apiOrigin(),
        credentials: {
          username:
            clean(input.username),
          password:
            clean(input.password),
        },
      });

    result.authenticated = true;

    const base =
      await jsonGet(
        session,
        "/invoices/new",
      );

    if (base.status !== 200) {
      throw new Error(
        `IQ_INVOICE_CATALOG_HTTP_${base.status}`,
      );
    }

    result.formOpened = true;

    const partners =
      Array.isArray(base.body?.partners)
        ? base.body.partners
        : [];

    const partner =
      exactUniqueByName(
        partners,
        input.associatedName,
        "IQ_PARTNER",
      );

    const partnerId =
      Number(partner.id);

    if (!Number.isFinite(partnerId) ||
        partnerId <= 0) {
      throw new Error(
        "IQ_PARTNER_ID_INVALID",
      );
    }

    const detailed =
      await jsonGet(
        session,
        `/invoices/new?partner_id=${
          encodeURIComponent(
            String(partnerId),
          )
        }`,
      );

    if (detailed.status !== 200) {
      throw new Error(
        `IQ_INVOICE_CATALOG_DETAIL_HTTP_${detailed.status}`,
      );
    }

    const clients =
      Array.isArray(
        detailed.body?.clients,
      )
        ? detailed.body.clients
        : [];

    const companies =
      Array.isArray(
        detailed.body?.companies,
      )
        ? detailed.body.companies
        : [];

    const client =
      exactUniqueByName(
        clients,
        input.clientName,
        "IQ_CLIENT",
      );

    const company =
      exactUniqueByName(
        companies,
        input.companyName,
        "IQ_COMPANY",
      );

    result.associatedMatched =
      clean(partner.name);
    result.clientMatched =
      clean(client.name);
    result.companyMatched =
      clean(company.name);
    result.invoiceTypeMatched =
      input.invoiceType;
    result.amountMatched =
      input.amount;
    result.createActionFound = true;
    result.verified = true;
    result.finalPath =
      `/invoices/new?partner_id=${
        encodeURIComponent(
          String(partnerId),
        )
      }`;
    result.message =
      "Formulario IQ validado por HTTP directo. No se envio ninguna solicitud.";

    return result;
  } catch (error) {
    const message =
      clean(
        error instanceof Error
          ? error.message
          : error,
      ) ||
      "IQ_SOLICITUD_HTTP_PREPARE_ERROR";

    result.errors = [message];
    result.message = message;
    return result;
  }
}