import { parseIqDateTimeMs } from "./iqDateTime";
import { fetchIq } from "./iqHttpClient";
const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";
const IQ_TIME_ZONE = "America/Mexico_City";

export type IqDispersionCreateItemH4D82A4A1 = {
  associatedName: string;
  clientCandidates: string[];
  beneficiaryCandidates: string[];
  clientIqId: string | null;
  currency: string;
  operationTypeKey: "TRANSFERENCIA" | "TDC";
  percentageLabel: string;
  amount: number;
  expectedDestinationLast4: string;
  reference: string;
};

export type IqDispersionCreateResultH4D82A4A1 = {
  version: "H4_D82_A4_A1";
  authenticated: boolean;
  outcome:
    | "CREATED"
    | "CREATED_PENDING_FOLIO"
    | "OUTCOME_UNKNOWN"
    | "FAILED_SAFE";
  submitClicked: boolean;
  postAccepted: boolean;
  iqId: string | null;
  resultPath: string | null;
  responseMessage: string | null;
  writeContract?: {
    method: string;
    path: string;
    contentType: string;
    requestBody: string | null;
    status: number;
    responseBody: string | null;
  };
  selected: {
    associated: string;
    client: string;
    currency: string;
    type: string;
    percentage: string;
  };
  destinationVerified: boolean;
  errors: string[];
};

type AnyRow = Record<string, unknown>;

type LoginPayload = {
  access_token?: unknown;
};

type WizardPayload = {
  partners?: unknown;
  clients?: unknown;
  currencies?: unknown;
  operation_types?: unknown;
  beneficiaries?: unknown;
  beneficiary_accounts?: unknown;
  sale_percentages?: unknown;
  balance?: unknown;
};

type DispersionListRow = {
  id?: unknown;
  created_at?: unknown;
  amount?: unknown;
  total_to_disperse?: unknown;
  currency?: unknown;
  operation_status?: unknown;
  conciliation_status?: unknown;
  client?: unknown;
  dispersion_type?: unknown;
  partner?: unknown;
  beneficiary_name?: unknown;
  account?: unknown;
  sale_percentage?: unknown;
  bank_name?: unknown;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function upper(value: unknown): string {
  return clean(value).toUpperCase();
}

function normalize(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function digits(value: unknown): string {
  return clean(value).replace(/\D+/g, "");
}

function asRows(value: unknown): AnyRow[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is AnyRow =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : NaN;
}

function unique<T>(rows: T[]): T[] {
  return [...new Set(rows)];
}

function rowName(row: AnyRow): string {
  return clean(
    row.name ??
      row.client_name ??
      row.beneficiary_name ??
      row.label ??
      row.value ??
      row.description,
  );
}

function rowId(row: AnyRow): number | null {
  return positiveInt(
    row.id ??
      row.client_id ??
      row.partner_id ??
      row.beneficiary_id ??
      row.beneficiary_account_id ??
      row.sale_percentage_id ??
      row.operation_type_id,
  );
}

function findUniqueByNormalizedNames(
  rows: AnyRow[],
  candidates: string[],
  label: string,
): AnyRow {
  const wanted = unique(
    candidates.map(normalize).filter(Boolean),
  );

  const exact = rows.filter((row) => {
    const name = normalize(rowName(row));
    return Boolean(name) && wanted.includes(name);
  });

  if (exact.length === 1) return exact[0];

  if (exact.length > 1) {
    throw new Error(`${label}_AMBIGUOUS_EXACT`);
  }

  const distinctive = wanted.filter(
    (name) => name.replace(/\s+/g, "").length >= 5,
  );

  const contained = rows.filter((row) => {
    const name = normalize(rowName(row));
    if (!name) return false;

    return distinctive.some(
      (candidate) =>
        name.includes(candidate) ||
        candidate.includes(name),
    );
  });

  if (contained.length === 1) return contained[0];

  if (contained.length > 1) {
    throw new Error(`${label}_AMBIGUOUS_CONTAINS`);
  }

  throw new Error(`${label}_NOT_FOUND`);
}

function flattenStrings(
  value: unknown,
  depth = 0,
): string[] {
  if (depth > 4 || value == null) return [];

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return [clean(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((x) =>
      flattenStrings(x, depth + 1),
    );
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((x) =>
        flattenStrings(x, depth + 1),
      );
  }

  return [];
}

function percentageNumber(value: unknown): number | null {
  const raw = clean(value).replace("%", "").replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function targetPercentage(label: string): number | null {
  const match = clean(label).match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  return percentageNumber(match[0]);
}

function operationTypeId(
  key: "TRANSFERENCIA" | "TDC",
): number {
  if (key === "TRANSFERENCIA") return 31;
  if (key === "TDC") return 36;
  throw new Error("IQ_DISPERSION_OPERATION_TYPE_UNSUPPORTED");
}

function mexicoDate(): string {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: IQ_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(new Date());

  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${map.year}-${map.month}-${map.day}`;
}

async function fetchJson(
  url: URL,
  token: string,
  timeoutMs = 30_000,
): Promise<{
  status: number;
  text: string;
  json: unknown;
}> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let json: unknown = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      throw new Error(
        `IQ_HTTP_GET_${response.status}:${url.pathname}`,
      );
    }

    return {
      status: response.status,
      text,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function login(input: {
  apiOrigin: string;
  username: string;
  password: string;
}): Promise<string> {
  const username = clean(input.username);
  const password = clean(input.password);

  if (!username || !password) {
    throw new Error("IQ_AUTH_CREDENTIALS_REQUIRED");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    30_000,
  );

  try {
    const response = await fetch(
      new URL("/users/sessions", input.apiOrigin),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user: {
            username,
            password,
          },
        }),
        signal: controller.signal,
      },
    );

    const text = await response.text();
    let payload: LoginPayload = {};

    try {
      payload = text
        ? (JSON.parse(text) as LoginPayload)
        : {};
    } catch {
      payload = {};
    }

    if (response.status !== 201) {
      throw new Error(
        `IQ_AUTH_HTTP_${response.status}`,
      );
    }

    const token = clean(payload.access_token);
    if (!token) {
      throw new Error("IQ_AUTH_ACCESS_TOKEN_MISSING");
    }

    return token;
  } finally {
    clearTimeout(timer);
  }
}

function buildWizardUrl(
  apiOrigin: string,
  params: Record<string, string | number | null | undefined>,
): URL {
  const url = new URL("/dispersions/new", apiOrigin);

  for (const [key, value] of Object.entries(params)) {
    if (
      value === null ||
      value === undefined ||
      clean(value) === ""
    ) {
      continue;
    }

    url.searchParams.set(key, clean(value));
  }

  return url;
}

function resolvePartner(
  payload: WizardPayload,
  associatedName: string,
): {
  id: number;
  name: string;
} {
  const rows = asRows(payload.partners);

  if (rows.length === 1) {
    const id = rowId(rows[0]);
    if (!id) throw new Error("IQ_PARTNER_ID_INVALID");

    const name = rowName(rows[0]);
    const wanted = normalize(associatedName);

    if (
      wanted &&
      name &&
      normalize(name) !== wanted
    ) {
      throw new Error("IQ_PARTNER_MISMATCH");
    }

    return { id, name };
  }

  const selected = findUniqueByNormalizedNames(
    rows,
    [associatedName],
    "IQ_PARTNER",
  );

  const id = rowId(selected);
  if (!id) throw new Error("IQ_PARTNER_ID_INVALID");

  return {
    id,
    name: rowName(selected),
  };
}

function beneficiarySearchTerm(
  candidates: string[],
): string {
  const values = candidates
    .map(clean)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!values.length) {
    throw new Error("IQ_BENEFICIARY_NAME_REQUIRED");
  }

  return values[0].slice(0, 100);
}

function resolveBeneficiaryAccount(
  rows: AnyRow[],
  expectedLast4: string,
): {
  id: number;
  label: string;
} {
  const last4 = digits(expectedLast4).slice(-4);

  if (last4.length !== 4) {
    throw new Error("IQ_DESTINATION_LAST4_INVALID");
  }

  const matches = rows.filter((row) =>
    flattenStrings(row).some((value) => {
      const d = digits(value);
      return d.length >= 4 && d.endsWith(last4);
    }),
  );

  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "IQ_BENEFICIARY_ACCOUNT_NOT_FOUND"
        : "IQ_BENEFICIARY_ACCOUNT_AMBIGUOUS",
    );
  }

  const id = rowId(matches[0]);
  if (!id) {
    throw new Error(
      "IQ_BENEFICIARY_ACCOUNT_ID_INVALID",
    );
  }

  const label =
    flattenStrings(matches[0]).find((value) => {
      const d = digits(value);
      return d.length >= 4 && d.endsWith(last4);
    }) || `****${last4}`;

  return {
    id,
    label,
  };
}

function normalizePercent(
  value: unknown,
): string {
  const parsed = Number(
    clean(value).replace(/[^0-9.]/g, ""),
  );

  if (!Number.isFinite(parsed)) {
    return "";
  }

  return String(
    Math.round(parsed * 10_000) / 10_000,
  ).replace(/\.0+$/, "");
}

function resolveSalePercentage(
  rows: AnyRow[],
  percentageLabel: string,
): {
  id: number;
  label: string;
} {
  if (rows.length < 1) {
    throw new Error(
      "IQ_SALE_PERCENTAGE_NOT_FOUND",
    );
  }

  const targetNumbers =
    clean(percentageLabel).match(
      /\d+(?:\.\d+)?/g,
    ) ?? [];

  const targetBase =
    normalizePercent(targetNumbers[0]);

  const targetSale =
    normalizePercent(
      targetNumbers[1] ??
        targetNumbers[0],
    );

  const exact = rows.filter((row) => {
    const base =
      normalizePercent(
        row.base_percentage,
      );

    const sale =
      normalizePercent(
        row.sale_percentage,
      );

    return Boolean(
      targetBase &&
        targetSale &&
        base === targetBase &&
        sale === targetSale,
    );
  });

  const semanticPercentageKey = (
    row: AnyRow,
  ): string =>
    JSON.stringify({
      base_percentage:
        normalizePercent(
          row.base_percentage,
        ),
      sale_percentage:
        normalizePercent(
          row.sale_percentage,
        ),
      name: clean(row.name),
      label: clean(row.label),
      client_id: clean(row.client_id),
      partner_id: clean(row.partner_id),
      operation_type_id: clean(
        row.operation_type_id,
      ),
      dispersion_type_id: clean(
        row.dispersion_type_id,
      ),
      currency: clean(row.currency),
      active:
        row.active === undefined ||
        row.active === null
          ? null
          : Boolean(row.active),
      status: clean(row.status),
    });

  let selected: AnyRow | null = null;

  if (exact.length === 1) {
    selected = exact[0];
  } else if (exact.length > 1) {
    const semanticKeys = [
      ...new Set(
        exact.map(semanticPercentageKey),
      ),
    ];

    if (semanticKeys.length === 1) {
      // IQ puede contener IDs historicos duplicados con exactamente
      // la misma configuracion comercial. En ese caso reproducimos
      // el orden canonico devuelto por IQ y usamos el primer registro.
      // No se hardcodea ningun ID.
      selected = exact[0];
    } else {
      const diagnostic = exact.map((row) => {
        const safe: Record<string, unknown> = {};

        for (const key of [
          "id",
          "base_percentage",
          "sale_percentage",
          "name",
          "label",
          "client_id",
          "partner_id",
          "operation_type_id",
          "dispersion_type_id",
          "currency",
          "active",
          "status",
          "created_at",
          "updated_at",
        ]) {
          const value = row[key];

          if (
            value === null ||
            value === undefined ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          ) {
            safe[key] = value ?? null;
          }
        }

        return safe;
      });

      throw new Error(
        `IQ_SALE_PERCENTAGE_AMBIGUOUS:${JSON.stringify(diagnostic)}`,
      );
    }
  } else if (rows.length === 1) {
    selected = rows[0];
  }

  if (!selected) {
    throw new Error(
      "IQ_SALE_PERCENTAGE_NOT_FOUND",
    );
  }

  const id = rowId(selected);

  if (!id) {
    throw new Error(
      "IQ_SALE_PERCENTAGE_ID_INVALID",
    );
  }

  const base =
    normalizePercent(
      selected.base_percentage,
    );

  const sale =
    normalizePercent(
      selected.sale_percentage,
    );

  return {
    id,
    label:
      `Base: ${base || "?"} % - Venta: ${sale || "?"} %`,
  };
}

function accountLast4(value: unknown): string {
  const d = digits(value);
  return d.length >= 4 ? d.slice(-4) : "";
}

function createdAfter(
  createdAt: unknown,
  lowerBoundMs: number,
): boolean {
  const ms = parseIqDateTimeMs(createdAt);
  return (
    ms !== null &&
    Number.isFinite(ms) &&
    ms >= lowerBoundMs - 15_000
  );
}

function rowMatchesCreatedDispersion(input: {
  row: DispersionListRow;
  item: IqDispersionCreateItemH4D82A4A1;
  clientName: string;
  beneficiaryName: string;
  partnerName: string;
  dispatchedAtMs: number;
}): boolean {
  const row = input.row;

  if (
    money(
      row.total_to_disperse ??
        row.amount,
    ) !== money(input.item.amount)
  ) {
    return false;
  }

  if (
    upper(row.currency) !==
    upper(input.item.currency)
  ) {
    return false;
  }

  if (
    normalize(row.client) !==
    normalize(input.clientName)
  ) {
    return false;
  }

  if (
    normalize(row.beneficiary_name) !==
    normalize(input.beneficiaryName)
  ) {
    return false;
  }

  if (
    input.partnerName &&
    normalize(row.partner) !==
      normalize(input.partnerName)
  ) {
    return false;
  }

  const expectedType =
    input.item.operationTypeKey === "TRANSFERENCIA"
      ? "TRANSFERENCIA"
      : "TDC";

  if (
    !normalize(row.dispersion_type).includes(
      expectedType,
    )
  ) {
    return false;
  }

  if (
    accountLast4(row.account) !==
    digits(
      input.item.expectedDestinationLast4,
    ).slice(-4)
  ) {
    return false;
  }

  return createdAfter(
    row.created_at,
    input.dispatchedAtMs,
  );
}

async function recoverCreatedId(input: {
  apiOrigin: string;
  token: string;
  item: IqDispersionCreateItemH4D82A4A1;
  clientName: string;
  beneficiaryName: string;
  partnerName: string;
  dispatchedAtMs: number;
}): Promise<{
  iqId: string | null;
  ambiguity: boolean;
}> {
  const backoffs = [0, 750, 1500, 2500];

  for (const delay of backoffs) {
    if (delay > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, delay),
      );
    }

    const url = new URL(
      "/dispersions",
      input.apiOrigin,
    );

    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", "0");
    url.searchParams.set(
      "start_date",
      mexicoDate(),
    );
    url.searchParams.set(
      "order_by_field",
      "created_at",
    );
    url.searchParams.set(
      "order_by_direction",
      "desc",
    );

    const response = await fetchJson(
      url,
      input.token,
    );

    const rows = Array.isArray(response.json)
      ? (response.json as DispersionListRow[])
      : [];

    const matches = rows.filter((row) =>
      rowMatchesCreatedDispersion({
        row,
        item: input.item,
        clientName: input.clientName,
        beneficiaryName:
          input.beneficiaryName,
        partnerName: input.partnerName,
        dispatchedAtMs:
          input.dispatchedAtMs,
      }),
    );

    if (matches.length === 1) {
      const id = positiveInt(matches[0].id);
      return {
        iqId: id ? String(id) : null,
        ambiguity: false,
      };
    }

    if (matches.length > 1) {
      return {
        iqId: null,
        ambiguity: true,
      };
    }
  }

  return {
    iqId: null,
    ambiguity: false,
  };
}

function resultBase(
  authenticated: boolean,
): Pick<
  IqDispersionCreateResultH4D82A4A1,
  | "version"
  | "authenticated"
  | "selected"
  | "destinationVerified"
  | "errors"
> {
  return {
    version: "H4_D82_A4_A1",
    authenticated,
    selected: {
      associated: "",
      client: "",
      currency: "",
      type: "",
      percentage: "",
    },
    destinationVerified: false,
    errors: [],
  };
}

export async function runIqCreateDispersionHttpH4D85A50(
  input: {
    apiOrigin?: string;
    username: string;
    password: string;
    item: IqDispersionCreateItemH4D82A4A1;
  },
): Promise<IqDispersionCreateResultH4D82A4A1> {
  const apiOrigin = (() => {
    const raw =
      clean(input.apiOrigin) ||
      clean(process.env.PAY0_IQ_API_ORIGIN) ||
      DEFAULT_IQ_API_ORIGIN;

    try {
      return new URL(raw).origin;
    } catch {
      return DEFAULT_IQ_API_ORIGIN;
    }
  })();

  let authenticated = false;
  let postDispatched = false;
  let writeContract:
    | IqDispersionCreateResultH4D82A4A1["writeContract"]
    | undefined;

  const selected = {
    associated: "",
    client: "",
    currency: "",
    type: "",
    percentage: "",
  };

  let destinationVerified = false;

  try {
    const token = await login({
      apiOrigin,
      username: input.username,
      password: input.password,
    });

    authenticated = true;

    const initial = await fetchJson(
      buildWizardUrl(apiOrigin, {}),
      token,
    );

    const initialPayload =
      (initial.json ?? {}) as WizardPayload;

    const partner = resolvePartner(
      initialPayload,
      input.item.associatedName,
    );

    selected.associated = partner.name;

    const clientId = positiveInt(
      input.item.clientIqId,
    );

    if (!clientId) {
      throw new Error(
        "IQ_CLIENT_CANONICAL_LINK_REQUIRED",
      );
    }

    const opTypeId = operationTypeId(
      input.item.operationTypeKey,
    );

    const searchTerm = beneficiarySearchTerm(
      input.item.beneficiaryCandidates,
    );

    const beneficiaryLookup =
      await fetchJson(
        buildWizardUrl(apiOrigin, {
          partner_id: partner.id,
          client_id: clientId,
          currency:
            clean(input.item.currency).toLowerCase(),
          operation_type_id: opTypeId,
          beneficiary_search: searchTerm,
        }),
        token,
      );

    const beneficiaryPayload =
      (beneficiaryLookup.json ?? {}) as WizardPayload;

    const beneficiary =
      findUniqueByNormalizedNames(
        asRows(
          beneficiaryPayload.beneficiaries,
        ),
        input.item.beneficiaryCandidates,
        "IQ_BENEFICIARY",
      );

    const beneficiaryId = rowId(beneficiary);
    if (!beneficiaryId) {
      throw new Error(
        "IQ_BENEFICIARY_ID_INVALID",
      );
    }

    const beneficiaryName =
      rowName(beneficiary);

    const detail = await fetchJson(
      buildWizardUrl(apiOrigin, {
        partner_id: partner.id,
        client_id: clientId,
        currency:
          clean(input.item.currency).toLowerCase(),
        operation_type_id: opTypeId,
        beneficiary_search: searchTerm,
        beneficiary_id: beneficiaryId,
      }),
      token,
    );

    const detailPayload =
      (detail.json ?? {}) as WizardPayload;

    const clientRows =
      asRows(detailPayload.clients);

    let clientName =
      input.item.clientCandidates[0] || "";

    const linkedClient =
      clientRows.find(
        (row) => rowId(row) === clientId,
      );

    if (linkedClient) {
      clientName = rowName(linkedClient) || clientName;
    }

    if (!clientName) {
      throw new Error(
        "IQ_CLIENT_NAME_UNRESOLVED",
      );
    }

    const account =
      resolveBeneficiaryAccount(
        asRows(
          detailPayload.beneficiary_accounts,
        ),
        input.item.expectedDestinationLast4,
      );

    destinationVerified = true;

    const salePercentage =
      resolveSalePercentage(
        asRows(
          detailPayload.sale_percentages,
        ),
        input.item.percentageLabel,
      );

    selected.client = clientName;
    selected.currency =
      clean(input.item.currency).toLowerCase();
    selected.type =
      input.item.operationTypeKey ===
      "TRANSFERENCIA"
        ? "Transferencia"
        : "TDC";
    selected.percentage =
      salePercentage.label ||
      input.item.percentageLabel;

    const form = new FormData();

    form.append(
      "client_id",
      String(clientId),
    );
    form.append(
      "currency",
      clean(input.item.currency).toLowerCase(),
    );
    form.append(
      "total_to_disperse",
      String(money(input.item.amount)),
    );
    form.append(
      "dispersion_type_id",
      String(opTypeId),
    );
    form.append(
      "sale_percentage_id",
      String(salePercentage.id),
    );
    form.append(
      "beneficiary_account_id",
      String(account.id),
    );

    const requestBody = [
      `client_id=${clientId}`,
      `currency=${clean(input.item.currency).toLowerCase()}`,
      `total_to_disperse=${money(input.item.amount)}`,
      `dispersion_type_id=${opTypeId}`,
      `sale_percentage_id=${salePercentage.id}`,
      `beneficiary_account_id=${account.id}`,
    ].join("&");

    const postUrl =
      new URL("/dispersions", apiOrigin);
    const dispatchedAtMs = Date.now();

    postDispatched = true;

    let response: Response;

    try {
      response = await fetchIq(postUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: form,
      }, { operation: "dispersion_create" });
    } catch (error) {
      writeContract = {
        method: "POST",
        path: "/dispersions",
        contentType: "multipart/form-data",
        requestBody,
        status: 0,
        responseBody: null,
      };

      return {
        ...resultBase(authenticated),
        authenticated,
        outcome: "OUTCOME_UNKNOWN",
        submitClicked: true,
        postAccepted: false,
        iqId: null,
        resultPath: "/dispersions",
        responseMessage:
          "El POST de dispersion IQ fue enviado, pero no se pudo conocer su resultado. Reintento bloqueado.",
        writeContract,
        selected,
        destinationVerified,
        errors: [
          clean(
            error instanceof Error
              ? error.message
              : error,
          ) || "IQ_DISPERSION_POST_TRANSPORT_UNKNOWN",
        ],
      };
    }

    const responseBody =
      await response.text();

    writeContract = {
      method: "POST",
      path: "/dispersions",
      contentType: "multipart/form-data",
      requestBody,
      status: response.status,
      responseBody:
        responseBody.slice(0, 1000),
    };

    if (response.status !== 201) {
      return {
        ...resultBase(authenticated),
        authenticated,
        outcome: "FAILED_SAFE",
        submitClicked: true,
        postAccepted: false,
        iqId: null,
        resultPath: "/dispersions",
        responseMessage:
          clean(responseBody) ||
          `IQ rechazo la dispersion con HTTP ${response.status}.`,
        writeContract,
        selected,
        destinationVerified,
        errors: [
          `IQ_DISPERSION_HTTP_${response.status}`,
        ],
      };
    }

    let successMessage = "";

    try {
      const parsed = responseBody
        ? JSON.parse(responseBody)
        : {};
      successMessage = clean(
        (parsed as Record<string, unknown>)
          .message,
      );
    } catch {
      successMessage = clean(responseBody);
    }

    if (
      successMessage &&
      normalize(successMessage) !== "SUCCESS"
    ) {
      return {
        ...resultBase(authenticated),
        authenticated,
        outcome:
          "CREATED_PENDING_FOLIO",
        submitClicked: true,
        postAccepted: true,
        iqId: null,
        resultPath: "/dispersions",
        responseMessage:
          `IQ respondio 201: ${successMessage}. Folio pendiente de relectura; no repetir el envio.`,
        writeContract,
        selected,
        destinationVerified,
        errors: [
          "IQ_DISPERSION_201_UNEXPECTED_MESSAGE",
        ],
      };
    }

    try {
      const recovery =
        await recoverCreatedId({
          apiOrigin,
          token,
          item: input.item,
          clientName,
          beneficiaryName,
          partnerName: partner.name,
          dispatchedAtMs,
        });

      if (recovery.iqId) {
        return {
          ...resultBase(authenticated),
          authenticated,
          outcome: "CREATED",
          submitClicked: true,
          postAccepted: true,
          iqId: recovery.iqId,
          resultPath: `/dispersions/${recovery.iqId}`,
          responseMessage:
            `Dispersion IQ creada y verificada: ${recovery.iqId}.`,
          writeContract,
          selected,
          destinationVerified,
          errors: [],
        };
      }

      return {
        ...resultBase(authenticated),
        authenticated,
        outcome:
          "CREATED_PENDING_FOLIO",
        submitClicked: true,
        postAccepted: true,
        iqId: null,
        resultPath: "/dispersions",
        responseMessage:
          recovery.ambiguity
            ? "IQ acepto la dispersion (201), pero la relectura encontro mas de un candidato. No repetir el envio."
            : "IQ acepto la dispersion (201). Folio pendiente de relectura; no repetir el envio.",
        writeContract,
        selected,
        destinationVerified,
        errors: recovery.ambiguity
          ? [
              "IQ_DISPERSION_POST_CREATE_AMBIGUOUS",
            ]
          : [],
      };
    } catch (error) {
      return {
        ...resultBase(authenticated),
        authenticated,
        outcome:
          "CREATED_PENDING_FOLIO",
        submitClicked: true,
        postAccepted: true,
        iqId: null,
        resultPath: "/dispersions",
        responseMessage:
          "IQ acepto la dispersion (201), pero fallo la relectura del folio. No repetir el envio.",
        writeContract,
        selected,
        destinationVerified,
        errors: [
          clean(
            error instanceof Error
              ? error.message
              : error,
          ) || "IQ_DISPERSION_RECOVERY_FAILED",
        ],
      };
    }
  } catch (error) {
    const message =
      clean(
        error instanceof Error
          ? error.message
          : error,
      ) || "IQ_DISPERSION_HTTP_FAILED_BEFORE_POST";

    return {
      ...resultBase(authenticated),
      authenticated,
      outcome: postDispatched
        ? "OUTCOME_UNKNOWN"
        : "FAILED_SAFE",
      submitClicked: postDispatched,
      postAccepted: false,
      iqId: null,
      resultPath: null,
      responseMessage: postDispatched
        ? "El resultado del envio IQ es incierto. Reintento bloqueado."
        : "La prevalidacion HTTP de IQ fallo antes del POST.",
      writeContract,
      selected,
      destinationVerified,
      errors: [message],
    };
  }
}
