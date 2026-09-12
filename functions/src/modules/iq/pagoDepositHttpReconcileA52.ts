import { parseIqDateTimeMs } from "./iqDateTime";
import { loginIqHttpDirect } from "./iqHttpAuth";
import { fetchIq } from "./iqHttpClient";

export interface PagoDepositHttpLookupItemA52 {
  key: string;
  marker?: string;
  iqId?: string;
  clientName?: string;
  companyName?: string;
  expectedAmount?: number;
  targetDateIso?: string;
}

interface IqDepositRowA52 {
  id?: unknown;
  created_at?: unknown;
  operation_status?: unknown;
  conciliation_status?: unknown;
  sum?: unknown;
  client?: unknown;
  company?: unknown;
  partner?: unknown;
  operation_type?: unknown;
  sale_type?: unknown;
  currency?: unknown;
  base_percentage?: unknown;
  sale_percentage?: unknown;
}

function text(v: unknown): string { return String(v ?? "").trim(); }
function norm(v: unknown): string {
  return text(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toUpperCase();
}
function amount(v: unknown): number | null {
  const n = Number(text(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function iqDateLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error("PAY0_CREATED_AT_INVALID");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function exactLowerBoundOk(row: IqDepositRowA52, iso?: string): boolean {
  if (!iso) return true;
  const lower = Date.parse(iso);
  const actual = parseIqDateTimeMs(row.created_at);
  return (
    Number.isFinite(lower) &&
    actual !== null &&
    Number.isFinite(actual) &&
    actual >= lower
  );
}
function compatible(row: IqDepositRowA52, item: PagoDepositHttpLookupItemA52): boolean {
  if (!exactLowerBoundOk(row, item.targetDateIso)) return false;
  const expected = Number(item.expectedAmount ?? 0);
  const got = amount(row.sum);
  if (Number.isFinite(expected) && expected > 0 && (got === null || Math.abs(got - expected) >= 0.01)) return false;
  if (item.clientName && norm(row.client) !== norm(item.clientName)) return false;
  if (item.companyName && norm(row.company) !== norm(item.companyName)) return false;
  return true;
}
function mapped(row: IqDepositRowA52, key: string, strategy: string) {
  const iqId = text(row.id);
  const operationStatus = text(row.operation_status);
  const reconciliationStatus = text(row.conciliation_status);
  const rowText = JSON.stringify(row);
  return {
    key, found: Boolean(iqId), iqId,
    operationStatus, reconciliationStatus,
    createdAt: text(row.created_at),
    client: text(row.client), company: text(row.company), amount: amount(row.sum) ?? 0,
    rowText, debugText: rowText, matchStrategy: strategy,
  };
}

async function getRows(input: {
  apiOrigin: string;
  username: string;
  password: string;
  item: PagoDepositHttpLookupItemA52;
  maxRows?: number;
  maxPages?: number;
}): Promise<IqDepositRowA52[]> {
  const session = await loginIqHttpDirect({
    apiOrigin: input.apiOrigin,
    credentials: { username: input.username, password: input.password },
  });
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
  const exactIqId = text(input.item.iqId);
  const maxRows = Math.max(20, Math.min(500, Number(input.maxRows ?? 100) || 100));
  const maxPages = Math.max(1, Math.min(20, Number(input.maxPages ?? 5) || 5));
  const rows: IqDepositRowA52[] = [];

  if (exactIqId) {
    const url = new URL("/deposits", session.apiOrigin);
    url.searchParams.set("limit", String(maxRows));
    url.searchParams.set("offset", "0");
    url.searchParams.set("order_by_field", "id");
    url.searchParams.set("order_by_direction", "desc");
    url.searchParams.set("filter[id]", exactIqId);
    const res = await fetchIq(url, { method: "GET", headers }, { operation: "deposit_reconciliation_exact" });
    if (!res.ok) throw new Error(`IQ_DEPOSIT_HTTP_LOOKUP_${res.status}`);
    const payload = await res.json() as unknown;
    if (!Array.isArray(payload)) throw new Error("IQ_DEPOSIT_HTTP_LOOKUP_NON_ARRAY");
    return (payload as IqDepositRowA52[]).filter((r) => text(r.id) === exactIqId);
  }

  if (!input.item.targetDateIso) {
    throw new Error("PAY0_CREATED_AT_REQUIRED_FOR_IQ_RECONCILIATION");
  }

  const startDate = iqDateLocal(input.item.targetDateIso);
  const pageSize = Math.min(100, maxRows);

  for (
    let offset = 0, pageNo = 0;
    rows.length < maxRows && pageNo < maxPages;
    offset += pageSize, pageNo += 1
  ) {
    const url = new URL("/deposits", session.apiOrigin);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("order_by_field", "id");
    url.searchParams.set("order_by_direction", "desc");

    const res = await fetchIq(url, { method: "GET", headers }, { operation: "deposit_reconciliation_search" });
    if (!res.ok) throw new Error(`IQ_DEPOSIT_HTTP_LOOKUP_${res.status}`);
    const payload = await res.json() as unknown;
    if (!Array.isArray(payload)) throw new Error("IQ_DEPOSIT_HTTP_LOOKUP_NON_ARRAY");

    const page = payload as IqDepositRowA52[];
    rows.push(...page);

    if (page.length < pageSize) break;

    const timestamps = page
      .map((r) => parseIqDateTimeMs(r.created_at))
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const oldest = timestamps.length > 0 ? Math.min(...timestamps) : Number.NaN;
    const lower = Date.parse(input.item.targetDateIso);

    if (Number.isFinite(oldest) && Number.isFinite(lower) && oldest < lower) break;
  }

  return rows.slice(0, maxRows);
}
export async function runPagoDepositHttpFindByRefsA52(input: {
  apiOrigin: string;
  username: string;
  password: string;
  items: PagoDepositHttpLookupItemA52[];
  maxRows?: number;
  maxPages?: number;
  refreshDelaysMs?: number[];
}) {
  const matches = [] as Array<Record<string, unknown>>;
  const errors: string[] = [];
  const delays = Array.isArray(input.refreshDelaysMs) && input.refreshDelaysMs.length > 0
    ? input.refreshDelaysMs
        .map((value) => Math.max(0, Math.min(60000, Number(value) || 0)))
        .slice(0, 6)
    : [0];

  for (const item of input.items) {
    let finalMatch: Record<string, unknown> = { key: item.key, found: false };
    let lastError = "";

    for (const delayMs of delays) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const rows = await getRows({
          apiOrigin: input.apiOrigin,
          username: input.username,
          password: input.password,
          item,
          maxRows: input.maxRows,
          maxPages: input.maxPages,
        });

        const exactId = text(item.iqId);
        const valid = rows.filter(
          (row) =>
            exactLowerBoundOk(row, item.targetDateIso) &&
            (!exactId || text(row.id) === exactId),
        );

        if (exactId && valid.length === 1) {
          finalMatch = mapped(valid[0], item.key, "HTTP_EXACT_ID_A52");
        } else if (!exactId) {
          const candidates = valid.filter((row) => compatible(row, item));
          if (candidates.length === 1) {
            finalMatch = mapped(candidates[0], item.key, "HTTP_UNIQUE_FIELDS_A52");
          }
        }

        if (finalMatch.found === true) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (lastError && finalMatch.found !== true) {
      errors.push(`${item.key}:${lastError}`);
    }
    matches.push(finalMatch);
  }

  return {
    authenticated: errors.length === 0,
    finalPath: "/deposits",
    pagesInspected: Math.max(1, Number(input.maxPages ?? 1) || 1),
    matches,
    errors,
  };
}
export async function runPagoDepositHttpFindCandidatesA52(input: {
  apiOrigin: string; username: string; password: string; item: PagoDepositHttpLookupItemA52; maxRows?: number; maxPages?: number; limit?: number;
}) {
  const errors: string[] = [];
  try {
    const rows = await getRows({ ...input, maxRows: input.maxRows ?? 80, maxPages: input.maxPages ?? 5 });
    const candidates = rows.filter(r => compatible(r, input.item)).map(r => mapped(r, input.item.key, "HTTP_CANDIDATE_A52"));
    const unique = new Map<string, Record<string, unknown>>();
    for (const row of candidates) unique.set(text(row.iqId), row);
    return { authenticated: true, finalPath: "/deposits", pagesFetched: 1, rowsFetched: rows.length, candidates: [...unique.values()].slice(0, Math.max(1, Number(input.limit ?? 8))), errors };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { authenticated: false, finalPath: "/deposits", pagesFetched: 0, rowsFetched: 0, candidates: [] as Array<Record<string, unknown>>, errors };
  }
}
