import { parseIqDateTimeMs } from "./iqDateTime";
import {
  loginIqHttpDirect,
  type IqHttpAuthSession,
} from "./iqHttpAuth";

const DEFAULT_IQ_API_ORIGIN =
  "https://iq-produccion-ccc570f75402.herokuapp.com";

export type IqInvoiceMarkerLookupItemA54 = {
  key: string;
  marker: string;
  iqIdExact?: string;
  folioToken?: string;
  expectedAmount?: number;
  targetDateIso?: string;
  createdAtLowerBoundMs: number;
};

export type IqInvoiceMarkerMatchA54 = {
  key: string;
  marker: string;
  found: boolean;
  iqId: string;
  rowText: string;
  rowCells: string[];
  hasInvoiceAction: boolean;
  invoiceActionText: string;
  operationStatus?: string;
  rejectionComment?: string;
  matchStrategy: "IQ_ID" | "MARKER" | "FOLIO_AMOUNT" | "NONE";
};

export type IqInvoiceMarkerLookupResultA54 = {
  authenticated: boolean;
  finalPath: string;
  pagesInspected: number;
  refreshedCount: number;
  filtersApplied: number;
  sortsVerified: number;
  dateWindowsInspected: string[];
  searchDiagnostics: string[];
  matches: IqInvoiceMarkerMatchA54[];
  errors: string[];
  transport: "HTTP_DIRECT";
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function apiOrigin(): string {
  return clean(process.env.PAY0_IQ_API_ORIGIN) || DEFAULT_IQ_API_ORIGIN;
}

function parseAmount(value: unknown): number {
  const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseIqCreatedAtMs(value: unknown): number | null {
  return parseIqDateTimeMs(value);
}

function localDateFromMs(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const y = parts.find((p) => p.type === "year")?.value || "";
  const m = parts.find((p) => p.type === "month")?.value || "";
  const d = parts.find((p) => p.type === "day")?.value || "";

  if (!y || !m || !d) {
    throw new Error("IQ_SOLICITUD_HTTP_INVALID_LOWER_BOUND_DATE");
  }

  return `${y}-${m}-${d}`;
}

function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return clean(value);

  if (typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    return clean(
      row.name ??
      row.nombre ??
      row.label ??
      row.description ??
      row.descripcion ??
      row.value ??
      row.id,
    );
  }

  return clean(value);
}

function invoiceActionFromRow(row: Record<string, unknown>): {
  available: boolean;
  text: string;
} {
  const candidates = [
    row.invoice,
    row.invoice_url,
    row.invoiceUrl,
    row.invoice_file,
    row.invoiceFile,
    row.invoice_zip,
    row.invoiceZip,
    row.invoice_pdf,
    row.invoicePdf,
    row.invoice_xml,
    row.invoiceXml,
    row.download_url,
    row.downloadUrl,
    row.documents,
    row.archivos,
    row.factura,
    row.factura_url,
    row.facturaUrl,
    row.uuid,
    row.invoice_uuid,
    row.invoiceUuid,
  ];

  const text = candidates.map(fieldText).filter(Boolean).join(" | ");
  const booleanSignal =
    row.has_invoice === true ||
    row.hasInvoice === true ||
    row.invoice_available === true ||
    row.invoiceAvailable === true ||
    row.stamped === true ||
    row.is_stamped === true ||
    row.isStamped === true;

  return {
    available: booleanSignal || Boolean(text),
    text: text.slice(0,300),
  };
}

function rowInfo(row: Record<string, unknown>) {
  const id = clean(row.id ?? row.invoice_id ?? row.invoiceId ?? row.folio);

  const comments = fieldText(
    row.comments ??
    row.comment ??
    row.comentarios ??
    row.observations ??
    row.observaciones,
  );

  const amount = parseAmount(
    row.sum ??
    row.amount ??
    row.total ??
    row.monto ??
    row.importe,
  );

  const createdAt = clean(
    row.created_at ??
    row.createdAt ??
    row.date ??
    row.fecha ??
    row.fecha_creacion ??
    row.fechaCreacion,
  );

  const createdAtMs = parseIqCreatedAtMs(createdAt);

  const operationStatus = fieldText(
    row.operation_status ??
    row.operationStatus ??
    row.status ??
    row.estado ??
    row.invoice_status ??
    row.invoiceStatus,
  );

  const rejectionComment = fieldText(
    row.rejection_comment ??
    row.rejectionComment ??
    row.reject_comment ??
    row.rejectComment ??
    row.rejection_reason ??
    row.rejectionReason ??
    row.rejection_comments ??
    row.rejectionComments ??
    row.motivo_rechazo ??
    row.motivoRechazo,
  );

  const action = invoiceActionFromRow(row);

  const rowCells = [
    id,
    fieldText(row.partner ?? row.associated ?? row.asociado),
    fieldText(row.client ?? row.cliente),
    fieldText(row.company ?? row.empresa),
    fieldText(row.invoice_type ?? row.invoiceType ?? row.tipoFactura),
    amount ? String(amount) : "",
    createdAt,
    operationStatus,
    comments,
    rejectionComment,
    action.text,
  ];

  return {
    id,
    comments,
    amount,
    createdAt,
    createdAtMs,
    operationStatus,
    rejectionComment,
    hasInvoiceAction: action.available,
    invoiceActionText: action.text,
    rowCells,
    rowText: rowCells.filter(Boolean).join(" | ").slice(0,3000),
  };
}

function emptyMatch(
  item: IqInvoiceMarkerLookupItemA54,
): IqInvoiceMarkerMatchA54 {
  return {
    key: clean(item.key),
    marker: clean(item.marker),
    found: false,
    iqId: "",
    rowText: "",
    rowCells: [],
    hasInvoiceAction: false,
    invoiceActionText: "",
    operationStatus: "",
    rejectionComment: "",
    matchStrategy: "NONE",
  };
}

function matchRow(
  row: Record<string, unknown>,
  item: IqInvoiceMarkerLookupItemA54,
): IqInvoiceMarkerMatchA54 | null {
  const info = rowInfo(row);
  const lower = Number(item.createdAtLowerBoundMs);

  if (!Number.isFinite(lower) || lower <= 0) {
    throw new Error("IQ_SOLICITUD_CREATED_AT_LOWER_BOUND_REQUIRED");
  }

  if (info.createdAtMs === null || info.createdAtMs < lower) {
    return null;
  }

  // H4_D87_A58_A31_IQ_ID_EXACT
  // Si PAY0 ya conoce el Folio IQ, la identidad exacta es autoritativa.
  // No se mezcla con marker/folio+monto para evitar ambiguedad.
  // La regla temporal canonica ya fue aplicada arriba.
  const iqIdExact = clean(item.iqIdExact);
  const iqIdHit =
    Boolean(iqIdExact) &&
    clean(info.id) === iqIdExact;

  const marker = clean(item.marker);
  const markerHit =
    Boolean(marker) &&
    norm(info.comments).includes(norm(marker));

  const folioToken = clean(item.folioToken);
  const amount = Number(item.expectedAmount ?? 0);

  const amountHit =
    amount > 0 &&
    Math.abs(info.amount - amount) <= 0.009;

  const folioHit =
    Boolean(folioToken) &&
    norm(info.rowText).includes(norm(folioToken));

  if (iqIdExact) {
    if (!iqIdHit) {
      return null;
    }
  } else if (!markerHit && !(folioHit && amountHit)) {
    return null;
  }

  return {
    key: clean(item.key),
    marker,
    found: true,
    iqId: info.id,
    rowText: info.rowText,
    rowCells: info.rowCells,
    hasInvoiceAction: info.hasInvoiceAction,
    invoiceActionText: info.invoiceActionText,
    operationStatus: info.operationStatus,
    rejectionComment: info.rejectionComment,
    matchStrategy: iqIdHit ? "IQ_ID" : markerHit ? "MARKER" : "FOLIO_AMOUNT",
  };
}

async function getRows(
  session: IqHttpAuthSession,
  lowerBoundMs: number,
  maxPages: number,
): Promise<{ rows: Record<string, unknown>[]; pages: number }> {
  const rows: Record<string, unknown>[] = [];
  let pages = 0;

  const startDate = localDateFromMs(lowerBoundMs);

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL("/invoices", session.apiOrigin);
    // H4_D87_A58_A32_REAL_INVOICES_PAGINATION
    // Contrato observado en IQ: limit + offset.
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String((page - 1) * 100));
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("order_by_field", "id");
    url.searchParams.set("order_by_direction", "asc");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    pages += 1;

    if (response.status !== 200) {
      throw new Error(`IQ_SOLICITUD_HTTP_GET_${response.status}`);
    }

    const body = await response.json().catch(() => null);

    const pageRows =
      Array.isArray(body)
        ? body
        : body && typeof body === "object"
          ? (
              Array.isArray((body as any).data)
                ? (body as any).data
                : Array.isArray((body as any).invoices)
                  ? (body as any).invoices
                  : Array.isArray((body as any).results)
                    ? (body as any).results
                    : []
            )
          : [];

    for (const row of pageRows) {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        rows.push(row as Record<string, unknown>);
      }
    }

    if (pageRows.length < 100) break;
  }

  return { rows, pages };
}

export async function runIqFindInvoicesByMarkersHttpA54(input: {
  erpUrl?: string;
  apiOrigin?: string;
  username: string;
  password: string;
  items: IqInvoiceMarkerLookupItemA54[];
  maxPages?: number;
  timeZone?: string;
  adjacentMonthFallback?: boolean;
  dateFilterFallback?: boolean;
  refreshDelaysMs?: number[];
}): Promise<IqInvoiceMarkerLookupResultA54> {
  const errors: string[] = [];

  const items = input.items
    .map((item) => ({
      ...item,
      key: clean(item.key),
      marker: clean(item.marker),
      iqIdExact: clean(item.iqIdExact),
      folioToken: clean(item.folioToken),
      createdAtLowerBoundMs: Number(item.createdAtLowerBoundMs),
    }))
    .filter((item) => item.key && item.marker)
    .slice(0,50);

  const result: IqInvoiceMarkerLookupResultA54 = {
    authenticated: false,
    finalPath: "/invoices",
    pagesInspected: 0,
    refreshedCount: 1,
    filtersApplied: items.length,
    sortsVerified: 1,
    dateWindowsInspected: [],
    searchDiagnostics: [
      "H4_D87_A54_HTTP_DIRECT",
      "createdAtLowerBoundMs=REQUIRED",
      "iqIdExact=PRIMARY_WHEN_PRESENT",
      "pagination=LIMIT_OFFSET",
    ],
    matches: items.map(emptyMatch),
    errors,
    transport: "HTTP_DIRECT",
  };

  try {
    for (const item of items) {
      if (
        !Number.isFinite(item.createdAtLowerBoundMs) ||
        item.createdAtLowerBoundMs <= 0
      ) {
        throw new Error(
          `IQ_SOLICITUD_CREATED_AT_LOWER_BOUND_REQUIRED:${item.key}`,
        );
      }
    }

    const session = await loginIqHttpDirect({
      apiOrigin: clean(input.apiOrigin) || apiOrigin(),
      credentials: {
        username: clean(input.username),
        password: clean(input.password),
      },
    });

    result.authenticated = true;

    const earliest = Math.min(
      ...items.map((item) => item.createdAtLowerBoundMs),
    );

    const fetched = await getRows(
      session,
      earliest,
      Math.min(20,Math.max(1,Number(input.maxPages ?? 20) || 20)),
    );

    result.pagesInspected = fetched.pages;
    result.dateWindowsInspected = [localDateFromMs(earliest)];

    // H4_D87_A58_A33_RAW_IQ_ID_DIAGNOSTIC
    // Diagnostico temporal: no cambia matching ni estados.
    for (const item of items) {
      const iqIdExact = clean((item as any).iqIdExact);
      if (!iqIdExact) continue;

      const rawRow = fetched.rows.find(
        (row) => clean((row as any)?.id) === iqIdExact,
      );

      const rawCreatedAt = rawRow
        ? clean((rawRow as any).created_at)
        : "";

      const rawCreatedAtMs = rawRow
        ? parseIqCreatedAtMs((rawRow as any).created_at)
        : null;

      const ids = fetched.rows
        .map((row) => Number(clean((row as any)?.id)))
        .filter((value) => Number.isFinite(value));

      console.info("PAY0_A58_A33_IQ_STATUS_LOOKUP", {
        key: clean(item.key),
        iqIdExact,
        rowsFetched: fetched.rows.length,
        pagesInspected: fetched.pages,
        firstNumericId: ids.length ? Math.min(...ids) : null,
        lastNumericId: ids.length ? Math.max(...ids) : null,
        rawIdPresent: Boolean(rawRow),
        rawCreatedAt,
        rawCreatedAtMs,
        lowerBoundMs: Number(item.createdAtLowerBoundMs),
        passesLowerBound:
          rawCreatedAtMs !== null &&
          rawCreatedAtMs >= Number(item.createdAtLowerBoundMs),
        rawOperationStatus: rawRow
          ? clean((rawRow as any).operation_status)
          : "",
        rawRejectionComment: rawRow
          ? clean(
              (rawRow as any).rejection_comments ??
                (rawRow as any).rejection_comment ??
                (rawRow as any).comments,
            )
          : "",
      });
    }
    result.matches = items.map((item) => {
      const matches = fetched.rows
        .map((row) => matchRow(row,item))
        .filter((m): m is IqInvoiceMarkerMatchA54 => Boolean(m));

      const unique = new Map<string,IqInvoiceMarkerMatchA54>();
      for (const match of matches) {
        const key = match.iqId || match.rowText;
        if (!unique.has(key)) unique.set(key,match);
      }

      if (unique.size === 1) {
        return Array.from(unique.values())[0];
      }

      if (unique.size > 1) {
        errors.push(
          `IQ_SOLICITUD_AMBIGUOUS_MATCH:${item.key}:count=${unique.size}`,
        );
      }

      return emptyMatch(item);
    });

    return result;
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : clean(error) || "IQ_SOLICITUD_HTTP_READ_UNKNOWN_ERROR",
    );

    return result;
  }
}