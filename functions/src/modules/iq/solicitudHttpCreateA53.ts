import { parseIqDateTimeMs } from "./iqDateTime";
import { readFile } from "node:fs/promises";
import {
  loginIqHttpDirect,
  type IqHttpAuthSession,
  type IqHttpCredentials,
} from "./iqHttpAuth";
import { fetchIq } from "./iqHttpClient";

const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

type InvoiceType = "PUE" | "PPD";

export type IqSolicitudHttpItemA53 = {
  key?: string;
  associatedName: string;
  clientName: string;
  iqClientId?: string;
  companyName: string;
  invoiceType: InvoiceType;
  amount: number;
  orderFilePath: string;
  orderFileName: string;
  comments?: string;
  targetDateIso?: string;
  createdAtLowerBoundMs?: number;
};

export type IqSolicitudHttpResultA53 = {
  key: string;
  marker?: string;
  httpContractCapture: {
    method: string;
    path: string;
    status: number;
    contentType: string;
    requestFieldNames: string[];
    responseBodyPreview: string;
    origin?: string;
    resourceType?: string;
  } | null;
  status: string;
  message: string;
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
  created: boolean;
  iqId: string;
  resultPath: string;
  responseMessage: string;
  outcome:
    | "NOT_SUBMITTED"
    | "CREATED"
    | "CREATED_ID_MISSING"
    | "REJECTED"
    | "UNKNOWN";
  errors: string[];
  postAccepted: boolean;
  transport: "HTTP_DIRECT";
  httpStatus: number;
};

export type IqSolicitudHttpBatchResultA53 = {
  authenticated: boolean;
  finalPath: string;
  createdCount: number;
  linkedCount: number;
  failedCount: number;
  pagesInspected: number;
  searchDiagnostics: string[];
  items: IqSolicitudHttpResultA53[];
  errors: string[];
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function apiOrigin(): string {
  return clean(process.env.PAY0_IQ_API_ORIGIN) || DEFAULT_IQ_API_ORIGIN;
}

function money(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function parseIqLocalCreatedAtMs(value: unknown): number | null {
  return parseIqDateTimeMs(value);
}

function startDate(item: IqSolicitudHttpItemA53): string {
  const target = clean(item.targetDateIso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(target)) return target;

  const lower = Number(item.createdAtLowerBoundMs ?? 0);
  if (lower > 0) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(lower));
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function authHeaders(
  session: IqHttpAuthSession,
): Promise<Record<string, string>> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
}

async function jsonGet(
  session: IqHttpAuthSession,
  path: string,
): Promise<{ status: number; body: any }> {
  const response = await fetchIq(new URL(path, session.apiOrigin), {
    method: "GET",
    headers: await authHeaders(session),
  }, { operation: `solicitud_catalog:${path}` });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function exactUniqueByName(
  rows: Array<Record<string, unknown>>,
  expected: string,
  label: string,
): Record<string, unknown> {
  const target = normalized(expected);
  const matches = rows.filter((row) => normalized(row.name) === target);
  if (matches.length !== 1) {
    if (label === "IQ_COMPANY" && matches.length === 0) {
      throw new Error(`${expected} NO DISPONIBLE ACTUALMENTE.`);
    }

    throw new Error(
      `${label}_NO_UNICO:${expected}:coincidencias=${matches.length}`,
    );
  }
  return matches[0];
}

async function resolveCatalog(
  session: IqHttpAuthSession,
  item: IqSolicitudHttpItemA53,
): Promise<{
  partnerId: number;
  partnerName: string;
  clientId: number;
  clientName: string;
  iqClientId?: string;
  companyId: number;
  companyName: string;
}> {
  const base = await jsonGet(session, "/invoices/new");
  if (base.status !== 200) {
    throw new Error(`IQ_INVOICE_CATALOG_HTTP_${base.status}`);
  }

  const partners = Array.isArray(base.body?.partners)
    ? base.body.partners
    : [];
  const partner = exactUniqueByName(
    partners,
    item.associatedName,
    "IQ_PARTNER",
  );
  const partnerId = Number(partner.id);
  if (!Number.isFinite(partnerId) || partnerId <= 0) {
    throw new Error("IQ_PARTNER_ID_INVALID");
  }

  const detailed = await jsonGet(
    session,
    `/invoices/new?partner_id=${encodeURIComponent(String(partnerId))}`,
  );
  if (detailed.status !== 200) {
    throw new Error(`IQ_INVOICE_CATALOG_DETAIL_HTTP_${detailed.status}`);
  }

  const clients = Array.isArray(detailed.body?.clients)
    ? detailed.body.clients
    : [];
  const companies = Array.isArray(detailed.body?.companies)
    ? detailed.body.companies
    : [];
const requestedClientId = Number(
  clean(item.iqClientId),
);

const client =
  Number.isFinite(requestedClientId) &&
  requestedClientId > 0
    ? clients.find(
        (row: Record<string, unknown>) => Number(row.id) === requestedClientId,
      )
    : exactUniqueByName(
        clients,
        item.clientName,
        "IQ_CLIENT",
      );

if (!client) {
  throw new Error(
    `IQ_CLIENT_ID_NO_ENCONTRADO:${clean(item.iqClientId)}`,
  );
}
  const company = exactUniqueByName(
    companies,
    item.companyName,
    "IQ_COMPANY",
  );

  const clientId = Number(client.id);
  const companyId = Number(company.id);

  if (!Number.isFinite(clientId) || clientId <= 0) {
    throw new Error("IQ_CLIENT_ID_INVALID");
  }
  if (!Number.isFinite(companyId) || companyId <= 0) {
    throw new Error("IQ_COMPANY_ID_INVALID");
  }

  return {
    partnerId,
    partnerName: clean(partner.name),
    clientId,
    clientName: clean(client.name),
    companyId,
    companyName: clean(company.name),
  };
}

async function buildFormData(
  item: IqSolicitudHttpItemA53,
  catalog: {
    clientId: number;
    companyId: number;
  },
): Promise<FormData> {
  const bytes = await readFile(item.orderFilePath);
  const form = new FormData();
  form.append("client_id", String(catalog.clientId));
  form.append("company_id", String(catalog.companyId));
  form.append("invoice_type", item.invoiceType);
  form.append("sum", String(item.amount));
  form.append(
    "purchase_order",
    new Blob([bytes]),
    clean(item.orderFileName) || "orden-compra",
  );

  const marker = clean(item.comments);
  if (marker) {
    form.append("comments", marker);
  }

  return form;
}

async function postOnce(
  session: IqHttpAuthSession,
  item: IqSolicitudHttpItemA53,
  catalog: { clientId: number; companyId: number },
): Promise<{ status: number; bodyText: string }> {
  const form = await buildFormData(item, catalog);
  const response = await fetchIq(new URL("/invoices", session.apiOrigin), {
    method: "POST",
    headers: await authHeaders(session),
    body: form,
  }, { operation: "solicitud_create" });

  return {
    status: response.status,
    bodyText: await response.text(),
  };
}

function rowMatches(
  row: Record<string, unknown>,
  item: IqSolicitudHttpItemA53,
  catalog: {
    clientName: string;
  iqClientId?: string;
    companyName: string;
  },
  lowerBoundMs: number,
): boolean {
  const marker = clean(item.comments);
  if (!marker || clean(row.comments) !== marker) return false;
  if (normalized(row.client) !== normalized(catalog.clientName)) return false;
  if (normalized(row.company) !== normalized(catalog.companyName)) return false;
  if (normalized(row.invoice_type) !== normalized(item.invoiceType)) return false;
  if (Math.abs(money(row.sum) - money(item.amount)) > 0.009) return false;

  const createdMs = parseIqLocalCreatedAtMs(row.created_at);
  if (createdMs !== null && createdMs < lowerBoundMs) return false;

  return true;
}

async function recoverIqId(
  session: IqHttpAuthSession,
  item: IqSolicitudHttpItemA53,
  catalog: {
    clientName: string;
  iqClientId?: string;
    companyName: string;
  },
  lowerBoundMs: number,
): Promise<{
  iqId: string;
  pages: number;
  ambiguity: boolean;
}> {
  const waits = [0, 1200, 3500, 8000];
  let pagesFetched = 0;

  for (const waitMs of waits) {
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const matches: Array<Record<string, unknown>> = [];

    for (let offset = 0; offset < 500; offset += 100) {
      const url = new URL("/invoices", session.apiOrigin);
      url.searchParams.set("limit", "100");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("start_date", startDate(item));
      url.searchParams.set("order_by_field", "id");
      url.searchParams.set("order_by_direction", "asc");

      const response = await fetchIq(url, {
        method: "GET",
        headers: await authHeaders(session),
      }, { operation: "solicitud_recovery_search" });
      pagesFetched += 1;

      if (response.status !== 200) break;

      let rows: any[] = [];
      try {
        const body = await response.json();
        rows = Array.isArray(body) ? body : [];
      } catch {
        rows = [];
      }

      for (const row of rows) {
        if (
          row &&
          typeof row === "object" &&
          rowMatches(
            row as Record<string, unknown>,
            item,
            catalog,
            lowerBoundMs,
          )
        ) {
          matches.push(row as Record<string, unknown>);
        }
      }

      if (rows.length < 100) break;
    }

    const uniqueIds = Array.from(
      new Set(
        matches
          .map((row) => clean(row.id))
          .filter((id) => /^\d+$/.test(id)),
      ),
    );

    if (uniqueIds.length === 1) {
      return { iqId: uniqueIds[0], pages: pagesFetched, ambiguity: false };
    }
    if (uniqueIds.length > 1) {
      return { iqId: "", pages: pagesFetched, ambiguity: true };
    }
  }

  return { iqId: "", pages: pagesFetched, ambiguity: false };
}

function baseResult(
  item: IqSolicitudHttpItemA53,
): IqSolicitudHttpResultA53 {
  return {
    key: clean(item.key),
    marker: clean(item.comments) || undefined,
    httpContractCapture: null,
    status: "IQ_SOLICITUD_HTTP_PENDING",
    message: "",
    authenticated: false,
    formOpened: true,
    verified: false,
    finalPath: "/invoices",
    associatedMatched: "",
    clientMatched: "",
    clientMatchStrategy: "HTTP_CATALOG_EXACT",
    companyMatched: "",
    invoiceTypeMatched: "",
    amountMatched: 0,
    orderFileUploaded: false,
    orderFileName: item.orderFileName,
    commentsFilled: Boolean(clean(item.comments)),
    createActionFound: true,
    submitClicked: false,
    created: false,
    iqId: "",
    resultPath: "/invoices",
    responseMessage: "",
    outcome: "NOT_SUBMITTED",
    errors: [],
    postAccepted: false,
    transport: "HTTP_DIRECT",
    httpStatus: 0,
  };
}

export async function runIqCreateInvoiceHttpA53(input: {
  erpUrl?: string;
  apiOrigin?: string;
  username: string;
  password: string;
  timeZone?: string;
} & Omit<IqSolicitudHttpItemA53, "key">): Promise<IqSolicitudHttpResultA53> {
  const item: IqSolicitudHttpItemA53 = {
    associatedName: input.associatedName,
    clientName: input.clientName,
    iqClientId: input.iqClientId,
    companyName: input.companyName,
    invoiceType: input.invoiceType,
    amount: input.amount,
    orderFilePath: input.orderFilePath,
    orderFileName: input.orderFileName,
    comments: input.comments,
    targetDateIso: input.targetDateIso,
    createdAtLowerBoundMs: input.createdAtLowerBoundMs,
  };

  const result = baseResult(item);
  const credentials: IqHttpCredentials = {
    username: clean(input.username),
    password: clean(input.password),
  };
  const origin = clean(input.apiOrigin) || apiOrigin();

  try {
    if (!credentials.username || !credentials.password) {
      throw new Error("IQ_AUTH_CREDENTIALS_REQUIRED");
    }
    if (!["PUE", "PPD"].includes(item.invoiceType)) {
      throw new Error("IQ_INVOICE_TYPE_INVALID");
    }
    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      throw new Error("IQ_INVOICE_AMOUNT_INVALID");
    }
    if (!clean(item.comments)) {
      throw new Error("IQ_SOLICITUD_MARKER_REQUIRED");
    }

    let session = await loginIqHttpDirect({
      apiOrigin: origin,
      credentials,
    });
    result.authenticated = true;

    const catalog = await resolveCatalog(session, item);
    result.associatedMatched = catalog.partnerName;
    result.clientMatched = catalog.clientName;
    result.companyMatched = catalog.companyName;
    result.invoiceTypeMatched = item.invoiceType;
    result.amountMatched = item.amount;
    result.orderFileUploaded = true;
    result.verified = true;

    const postStartedAtMs = Date.now();
    const requestedLower = Number(item.createdAtLowerBoundMs ?? 0);
    const recoveryLowerBoundMs =
      requestedLower > 0
        ? Math.max(requestedLower, postStartedAtMs - 5000)
        : postStartedAtMs - 5000;

    let post: { status: number; bodyText: string };

    try {
      post = await postOnce(session, item, catalog);
    } catch (error) {
      result.submitClicked = true;
      result.outcome = "UNKNOWN";
      result.status = "IQ_SOLICITUD_CREATE_UNKNOWN";
      result.responseMessage =
        "El POST de solicitud IQ pudo haber sido enviado, pero no fue posible conocer la respuesta. Reintento bloqueado.";
      result.message = result.responseMessage;
      result.errors = [
        clean(error instanceof Error ? error.message : error) ||
          "IQ_SOLICITUD_POST_TRANSPORT_UNKNOWN",
      ];
      return result;
    }

    if (post.status === 401) {
      session = await loginIqHttpDirect({
        apiOrigin: origin,
        credentials,
      });
      result.authenticated = true;

      try {
        post = await postOnce(session, item, catalog);
      } catch (error) {
        result.submitClicked = true;
        result.outcome = "UNKNOWN";
        result.status = "IQ_SOLICITUD_CREATE_UNKNOWN";
        result.responseMessage =
          "IQ renovó autenticación, pero el reintento autorizado del POST quedó con resultado desconocido.";
        result.message = result.responseMessage;
        result.errors = [
          clean(error instanceof Error ? error.message : error) ||
            "IQ_SOLICITUD_POST_RETRY_TRANSPORT_UNKNOWN",
        ];
        return result;
      }
    }

    result.submitClicked = true;
    result.httpStatus = post.status;
    result.httpContractCapture = {
      method: "POST",
      path: "/invoices",
      status: post.status,
      contentType: "multipart/form-data",
      requestFieldNames: [
        "client_id",
        "company_id",
        "invoice_type",
        "sum",
        "purchase_order",
        "comments",
      ],
      responseBodyPreview: clean(post.bodyText).slice(0, 500),
      origin: session.apiOrigin,
      resourceType: "HTTP_DIRECT",
    };

    if (post.status !== 201) {
      result.outcome = "REJECTED";
      result.status = "IQ_SOLICITUD_CREATE_REJECTED";
      result.responseMessage =
        clean(post.bodyText) || `IQ rechazó la solicitud con HTTP ${post.status}.`;
      result.message = result.responseMessage;
      result.errors = [`IQ_SOLICITUD_HTTP_${post.status}`];
      return result;
    }

    result.postAccepted = true;
    result.created = true;

    const recovery = await recoverIqId(
      session,
      item,
      catalog,
      recoveryLowerBoundMs,
    );

    if (recovery.iqId) {
      result.iqId = recovery.iqId;
      result.outcome = "CREATED";
      result.status = "IQ_SOLICITUD_CREATED";
      result.resultPath = `/invoices/${recovery.iqId}`;
      result.finalPath = result.resultPath;
      result.responseMessage =
        `IQ aceptó la solicitud (201) y PAY0 recuperó el folio ${recovery.iqId} por marcador exacto.`;
      result.message = result.responseMessage;
      return result;
    }

    result.outcome = recovery.ambiguity
      ? "UNKNOWN"
      : "CREATED_ID_MISSING";
    result.status = recovery.ambiguity
      ? "IQ_SOLICITUD_CREATE_UNKNOWN"
      : "IQ_SOLICITUD_CREATED_ID_MISSING";
    result.responseMessage = recovery.ambiguity
      ? "IQ aceptó la solicitud (201), pero la relectura encontró más de una coincidencia exacta. No repetir el POST."
      : "IQ aceptó la solicitud (201). Folio pendiente de relectura; no repetir el POST.";
    result.message = result.responseMessage;

    if (recovery.ambiguity) {
      result.errors = ["IQ_SOLICITUD_RECOVERY_AMBIGUOUS"];
    }

    return result;
  } catch (error) {
    result.status = "IQ_SOLICITUD_CREATE_REJECTED";
    result.outcome = "REJECTED";
    result.message =
      clean(error instanceof Error ? error.message : error) ||
      "IQ_SOLICITUD_HTTP_ERROR";
    result.responseMessage = result.message;
    result.errors = [result.message];
    return result;
  }
}

export async function runIqCreateInvoiceBatchHttpA53(input: {
  erpUrl?: string;
  apiOrigin?: string;
  username: string;
  password: string;
  timeZone?: string;
  items: IqSolicitudHttpItemA53[];
  lookupMaxPages?: number;
}): Promise<IqSolicitudHttpBatchResultA53> {
  const result: IqSolicitudHttpBatchResultA53 = {
    authenticated: false,
    finalPath: "/invoices",
    createdCount: 0,
    linkedCount: 0,
    failedCount: 0,
    pagesInspected: 0,
    searchDiagnostics: ["H4_D85_A53_HTTP_DIRECT"],
    items: [],
    errors: [],
  };

  for (const item of input.items.slice(0, 25)) {
    const row = await runIqCreateInvoiceHttpA53({
      erpUrl: input.erpUrl,
      apiOrigin: input.apiOrigin,
      username: input.username,
      password: input.password,
      timeZone: input.timeZone,
      associatedName: item.associatedName,
      clientName: item.clientName,
      iqClientId: item.iqClientId,
      companyName: item.companyName,
      invoiceType: item.invoiceType,
      amount: item.amount,
      orderFilePath: item.orderFilePath,
      orderFileName: item.orderFileName,
      comments: item.comments,
      targetDateIso: item.targetDateIso,
      createdAtLowerBoundMs: item.createdAtLowerBoundMs,
    });

    row.key = clean(item.key);
    row.marker = clean(item.comments) || undefined;
    result.items.push(row);
    result.authenticated = result.authenticated || row.authenticated;

    if (row.outcome === "CREATED" && row.iqId) {
      result.createdCount += 1;
      result.linkedCount += 1;
    } else if (row.outcome === "CREATED_ID_MISSING") {
      result.createdCount += 1;
    } else {
      result.failedCount += 1;
    }

    if (row.errors.length) {
      result.errors.push(
        `${clean(item.key) || "item"}: ${row.errors.join(" ")}`,
      );
    }
  }

  return result;
}

