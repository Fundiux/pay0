import type { IqHttpAuthSession } from "./iqHttpAuth";
import { isIqAccessTokenUsable } from "./iqHttpAuth";
import { fetchIq } from "./iqHttpClient";

interface CatalogRow {
  id?: unknown;
  name?: unknown;
  value?: unknown;
  base_percentage?: unknown;
  sale_percentage?: unknown;
}

interface IqDepositCatalogPayload {
  partners?: unknown;
  clients?: unknown;
  companies?: unknown;
  operation_types_by_percentages?: unknown;
  sale_types?: unknown;
  sale_types_by_percentages?: unknown;
  percentages?: unknown;
  currencies?: unknown;
}

export interface IqDepositCatalogTarget {
  partnerName: string;
  clientName: string;
  iqClientId?: string;
  companyName: string;
  operationTypeName: string;
  saleTypeName: string;
  percentageName: string;
  currencyName: string;
}

export interface IqDepositResolvedCatalog {
  partnerId: number;
  partnerName: string;
  clientId: number;
  clientName: string;
  companyId: number;
  companyName: string;
  operationTypeId: number;
  operationTypeName: string;
  saleTypeValue: string;
  saleTypeName: string;
  salePercentageId: number;
  basePercentage: string;
  salePercentage: string;
  currencyValue: string;
  currencyName: string;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalize(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function selectCurrencySemantic(
  rows: CatalogRow[],
  expected: string,
): CatalogRow {
  const wanted = normalize(expected || "mxn");

  const candidatesFor = (row: CatalogRow): string[] =>
    [
      rowLabel(row),
      cleanText(row.name),
      cleanText(row.value),
      cleanText((row as Record<string, unknown>).code),
      cleanText((row as Record<string, unknown>).currency),
      cleanText(row.id),
    ]
      .map(normalize)
      .filter(Boolean);

  const exact = rows.filter((row) =>
    candidatesFor(row).includes(wanted),
  );

  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    throw new Error(
      `IQ_CATALOG_AMBIGUOUS:currency:${expected}`,
    );
  }

  const semantic = rows.filter((row) =>
    candidatesFor(row).some((candidate) =>
      candidate.includes(wanted) ||
      wanted.includes(candidate),
    ),
  );

  if (semantic.length === 1) {
    return semantic[0];
  }

  const available = rows
    .map((row) => {
      const label = rowLabel(row);
      const code = cleanText(
        (row as Record<string, unknown>).code,
      );
      const currency = cleanText(
        (row as Record<string, unknown>).currency,
      );

      return [label, code, currency]
        .filter(Boolean)
        .join("/");
    })
    .filter(Boolean)
    .slice(0, 12)
    .join("|");

  if (semantic.length > 1) {
    throw new Error(
      `IQ_CATALOG_AMBIGUOUS:currency:${expected}:AVAILABLE=${available}`,
    );
  }

  throw new Error(
    `IQ_CATALOG_NOT_FOUND:currency:${expected}:AVAILABLE=${available || "NONE"}`,
  );
}
function selectSaleTypeSemantic(
  rows: CatalogRow[],
  expected: string,
): CatalogRow {
  const wanted = normalize(expected || "Subtotal");

  const exact = rows.filter((row) => {
    const candidates = [
      rowLabel(row),
      cleanText(row.name),
      cleanText(row.value),
      cleanText(row.id),
    ]
      .map(normalize)
      .filter(Boolean);

    return candidates.includes(wanted);
  });

  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    throw new Error(
      `IQ_CATALOG_AMBIGUOUS:sale_type:${expected}`,
    );
  }

  // Fallback semantico controlado:
  // "Subtotal" puede corresponder a "Factura subtotal", etc.
  // Solo se acepta si existe UNA unica candidata.
  const semantic = rows.filter((row) => {
    const candidates = [
      rowLabel(row),
      cleanText(row.name),
      cleanText(row.value),
    ]
      .map(normalize)
      .filter(Boolean);

    return candidates.some((candidate) =>
      candidate.includes(wanted) ||
      wanted.includes(candidate),
    );
  });

  if (semantic.length === 1) {
    return semantic[0];
  }

  const available = rows
    .map((row) => rowLabel(row))
    .filter(Boolean)
    .slice(0, 12)
    .join("|");

  if (semantic.length > 1) {
    throw new Error(
      `IQ_CATALOG_AMBIGUOUS:sale_type:${expected}:AVAILABLE=${available}`,
    );
  }

  throw new Error(
    `IQ_CATALOG_NOT_FOUND:sale_type:${expected}:AVAILABLE=${available || "NONE"}`,
  );
}
function numericId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`IQ_CATALOG_INVALID_ID:${label}`);
  }
  return parsed;
}

function asRows(value: unknown): CatalogRow[] {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is CatalogRow =>
        Boolean(row) && typeof row === "object",
    );
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => {
        if (raw && typeof raw === "object") {
          return {
            id: key,
            ...(raw as Record<string, unknown>),
          };
        }

        return {
          id: raw,
          value: key,
          name: key,
        };
      });
  }

  return [];
}

function rowLabel(row: CatalogRow): string {
  return cleanText(
    row.name ??
      row.value ??
      row.id,
  );
}

function scoreRow(
  row: CatalogRow,
  target: string,
): number {
  const normalizedTarget = normalize(target);
  const normalizedLabel = normalize(rowLabel(row));

  if (!normalizedTarget || !normalizedLabel) {
    return 0;
  }

  if (normalizedLabel === normalizedTarget) {
    return 1000;
  }

  if (
    normalizedLabel.startsWith(normalizedTarget) ||
    normalizedTarget.startsWith(normalizedLabel)
  ) {
    return 800;
  }

  if (
    normalizedLabel.includes(normalizedTarget) ||
    normalizedTarget.includes(normalizedLabel)
  ) {
    return 600;
  }

  const targetTokens = new Set(normalizedTarget.split(" "));
  const labelTokens = normalizedLabel.split(" ");
  const overlap = labelTokens.filter((token) =>
    targetTokens.has(token),
  ).length;

  if (overlap < 1) {
    return 0;
  }

  return Math.round(
    (overlap /
      Math.max(targetTokens.size, labelTokens.length)) *
      500,
  );
}

function selectUnique(
  rows: CatalogRow[],
  target: string,
  label: string,
): CatalogRow {
  const scored = rows
    .map((row) => ({
      row,
      score: scoreRow(row, target),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length < 1) {
    throw new Error(
      `IQ_CATALOG_NOT_FOUND:${label}:${cleanText(target)}`,
    );
  }

  const bestScore = scored[0].score;
  const best = scored.filter(
    (entry) => entry.score === bestScore,
  );

  if (best.length !== 1) {
    throw new Error(
      `IQ_CATALOG_AMBIGUOUS:${label}:${cleanText(target)}:${best.length}`,
    );
  }

  return best[0].row;
}

function normalizePercent(value: unknown): string {
  const parsed = Number(
    cleanText(value).replace(/[^0-9.]/g, ""),
  );

  if (!Number.isFinite(parsed)) {
    return "";
  }

  return String(
    Math.round(parsed * 10_000) / 10_000,
  ).replace(/\.0+$/, "");
}

function selectPercentage(
  rows: CatalogRow[],
  target: string,
): CatalogRow {
  if (rows.length < 1) {
    throw new Error("IQ_CATALOG_PERCENTAGES_EMPTY");
  }

  const targetNumbers =
    cleanText(target).match(/\d+(?:\.\d+)?/g) ?? [];
  const targetBase = normalizePercent(
    targetNumbers[0],
  );
  const targetSale = normalizePercent(
    targetNumbers[1] ?? targetNumbers[0],
  );

  const exact = rows.filter((row) => {
    const base = normalizePercent(row.base_percentage);
    const sale = normalizePercent(row.sale_percentage);

    return Boolean(
      targetBase &&
        targetSale &&
        base === targetBase &&
        sale === targetSale,
    );
  });

  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    throw new Error(
      `IQ_CATALOG_AMBIGUOUS:percentage:${cleanText(target)}:${exact.length}`,
    );
  }

  if (rows.length === 1) {
    return rows[0];
  }

  throw new Error(
    `IQ_CATALOG_PERCENTAGE_NOT_FOUND:${cleanText(target)}`,
  );
}

async function fetchCatalog(
  session: IqHttpAuthSession,
  params: Record<string, string>,
): Promise<IqDepositCatalogPayload> {
  if (!isIqAccessTokenUsable(session)) {
    throw new Error("IQ_AUTH_ACCESS_TOKEN_EXPIRED");
  }

  const url = new URL(
    "/deposits/new",
    session.apiOrigin,
  );

  for (const [key, value] of Object.entries(params)) {
    const cleanValue = cleanText(value);

    // __EMPTY__ significa que este parametro aun no debe enviarse.
    // IQ devuelve el siguiente catalogo con el contexto ya resuelto.
    if (!cleanValue || cleanValue === "__EMPTY__") {
      continue;
    }

    url.searchParams.set(key, cleanValue);
  }

  const response = await fetchIq(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
  }, { operation: "deposit_catalog" });

  if (!response.ok) {
    const queryKeys =
      Array.from(url.searchParams.keys()).join(",") ||
      "NONE";

    throw new Error(
      `IQ_CATALOG_HTTP_${response.status}:GET ${url.pathname}:PARAMS=${queryKeys}`,
    );
  }

  const payload = (await response.json()) as unknown;

  if (!payload || typeof payload !== "object") {
    throw new Error("IQ_CATALOG_INVALID_PAYLOAD");
  }

  return payload as IqDepositCatalogPayload;
}

export async function resolveIqDepositCatalogHttp(
  session: IqHttpAuthSession,
  target: IqDepositCatalogTarget,
): Promise<IqDepositResolvedCatalog> {
  const initial = await fetchCatalog(session, {
    sale_type: "__EMPTY__",
  });

  const partner = selectUnique(
    asRows(initial.partners),
    target.partnerName,
    "partner",
  );

  const partnerId = numericId(
    partner.id,
    "partner",
  );
  const partnerName = rowLabel(partner);

  const partnerCatalog = await fetchCatalog(session, {
    partner_id: String(partnerId),
    sale_type: "__EMPTY__",
  });

  const clientRows = asRows(
    partnerCatalog.clients,
  );

  const canonicalClientId =
    cleanText(target.iqClientId);

  let client: CatalogRow;

  if (canonicalClientId) {
    const requestedClientId = numericId(
      canonicalClientId,
      "client",
    );

    const clientMatches = clientRows.filter(
      (row) =>
        Number(row.id) === requestedClientId,
    );

    if (clientMatches.length === 0) {
      throw new Error(
        `IQ_CATALOG_CLIENT_ID_NOT_FOUND:${canonicalClientId}`,
      );
    }

    if (clientMatches.length !== 1) {
      throw new Error(
        `IQ_CATALOG_CLIENT_ID_AMBIGUOUS:${canonicalClientId}:${clientMatches.length}`,
      );
    }

    client = clientMatches[0];
  } else {
    client = selectUnique(
      clientRows,
      target.clientName,
      "client",
    );
  }

  const company = selectUnique(
    asRows(partnerCatalog.companies),
    target.companyName,
    "company",
  );

  const clientId = numericId(client.id, "client");
  const companyId = numericId(company.id, "company");
  const clientName = rowLabel(client);
  const companyName = rowLabel(company);

  const companyCatalog = await fetchCatalog(session, {
    partner_id: String(partnerId),
    client_id: String(clientId),
    company_id: String(companyId),
    sale_type: "__EMPTY__",
  });

  const operationType = selectUnique(
    asRows(
      companyCatalog.operation_types_by_percentages,
    ),
    target.operationTypeName,
    "operation_type",
  );

  const operationTypeId = numericId(
    operationType.id,
    "operation_type",
  );
  const operationTypeName = rowLabel(operationType);

  const operationCatalog = await fetchCatalog(session, {
    partner_id: String(partnerId),
    client_id: String(clientId),
    company_id: String(companyId),
    operation_type_id: String(operationTypeId),
    sale_type: "__EMPTY__",
  });

  const primarySaleTypes = asRows(
    operationCatalog.sale_types,
  );

  const fallbackSaleTypes = asRows(
    operationCatalog.sale_types_by_percentages,
  );

  const saleTypes =
    primarySaleTypes.length > 0
      ? primarySaleTypes
      : fallbackSaleTypes;

  const saleType = selectSaleTypeSemantic(
    saleTypes,
    target.saleTypeName || "Subtotal",
  );

  const saleTypeValue = cleanText(
    saleType.value ??
      saleType.id ??
      saleType.name,
  );
  const saleTypeName =
    cleanText(saleType.name) || saleTypeValue;

  if (!saleTypeValue) {
    throw new Error("IQ_CATALOG_SALE_TYPE_EMPTY");
  }

  const saleCatalog = await fetchCatalog(session, {
    partner_id: String(partnerId),
    client_id: String(clientId),
    company_id: String(companyId),
    operation_type_id: String(operationTypeId),
    sale_type: saleTypeValue,
  });

  const percentage = selectPercentage(
    asRows(saleCatalog.percentages),
    target.percentageName,
  );

  const salePercentageId = numericId(
    percentage.id,
    "sale_percentage",
  );
  const basePercentage = cleanText(
    percentage.base_percentage,
  );
  const salePercentage = cleanText(
    percentage.sale_percentage,
  );

  const currencyRows = asRows(
    saleCatalog.currencies ??
      partnerCatalog.currencies,
  );
  const currency = selectCurrencySemantic(
    currencyRows,
    target.currencyName || "mxn",
  );

  const currencyValue = cleanText(
    currency.value ??
      currency.id ??
      currency.name,
  );
  const currencyName =
    cleanText(currency.name) || currencyValue;

  if (!currencyValue) {
    throw new Error("IQ_CATALOG_CURRENCY_EMPTY");
  }

  return {
    partnerId,
    partnerName,
    clientId,
    clientName,
    companyId,
    companyName,
    operationTypeId,
    operationTypeName,
    saleTypeValue,
    saleTypeName,
    salePercentageId,
    basePercentage,
    salePercentage,
    currencyValue,
    currencyName,
  };
}
