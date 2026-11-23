import { getFirestore } from "firebase-admin/firestore";
import { loadIqCanonicalProfileById, openIqCanonicalSession } from "../iq/iqCanonicalAccess";
import { fetchIq } from "../iq/iqHttpClient";
import { P4_PLAN_GROUPS } from "../iqHistoricalImport/planner";
import { mexicoDate } from "./domain";
import { displayFromIqDispersion, type ReviewDisplay } from "./reviewDisplay";

/**
 * IQ dispersions created directly in IQ: DETECTION ONLY (owner rule: never duplicate; this pass does not create).
 * A PAY0 client dispersion needs a beneficiary method, a wallet reservation (dispatch balance), legs and the
 * financing postings in financing/dispersionFinancial.ts; IQ's /dispersions row does not carry PAY0's
 * beneficiary method id nor the wallet source, so creating one automatically would have to guess money
 * movements. Each IQ dispersion without a PAY0 match becomes a review item instead.
 *
 * Match: an IQ dispersion id is "in PAY0" when any clientDispersionLegs row has it as iqDispersionId or
 * iqDispersionFolio, or a clientDispersions principal lists it in iqDispersionFolios / iqDispersionId, inside
 * the same root.
 */

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const rowsOf = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter(row => row && typeof row === "object") as Record<string, unknown>[];
  const row = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  for (const key of ["data", "items", "results", "records", "dispersions"]) if (Array.isArray(row[key])) return row[key] as Record<string, unknown>[];
  return [];
};
function localDate(value: unknown): string {
  const raw = text(value); if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw); return Number.isFinite(ms) ? mexicoDate(new Date(ms)) : raw.slice(0, 10);
}

export type IqDispersionObservation = { iqDispersionId: string; profileId: string; date: string; amount: number | null; operationStatus: string; inPay0: boolean; display: ReviewDisplay };
export type DispersionDetection = { observed: IqDispersionObservation[]; pages: number; truncated: boolean };

export async function detectIqDispersions(input: { rootId: string; groupId: string; range: { start: string; end: string }; secret: string; maxPages?: number }): Promise<DispersionDetection> {
  const group = P4_PLAN_GROUPS[input.groupId];
  if (!group) throw Object.assign(new Error("Grupo IQ inexistente."), { code: "IQ_DAILY_SYNC_GROUP_NOT_FOUND" });
  const maxPages = Math.max(1, Math.min(50, input.maxPages ?? 20)), seen = new Map<string, IqDispersionObservation>();
  let pages = 0, truncated = false;
  for (const profileId of group.memberProfileIds) {
    const access = await loadIqCanonicalProfileById({ profileId, rootId: input.rootId, encryptionSecret: input.secret });
    const session = await openIqCanonicalSession({ access, requiredPermissions: "NONE" });
    for (let offset = 0; ; offset += 100) {
      if (pages >= maxPages) { truncated = true; break; }
      const url = new URL("/dispersions", session.apiOrigin);
      for (const [key, value] of Object.entries({ limit: "100", offset: String(offset), start_date: input.range.start, end_date: input.range.end, order_by_field: "id", order_by_direction: "desc" })) url.searchParams.set(key, value);
      const response = await fetchIq(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}` } }, { operation: "iq-daily-sync-dispersions" });
      if (!response.ok) throw Object.assign(new Error(`IQ read failed HTTP_${response.status}`), { code: "IQ_DAILY_SYNC_IQ_READ_FAILED", status: response.status });
      const rows = rowsOf(await response.json()); pages++;
      for (const raw of rows) {
        const id = text(raw.id ?? raw.iq_id ?? raw.folio), date = localDate(raw.created_at ?? raw.createdAt ?? raw.date);
        if (!id || !date || date < input.range.start || date > input.range.end || seen.has(id)) continue;
        const amount = Number(raw.total_to_disperse ?? raw.amount ?? raw.sum);
        seen.set(id, { iqDispersionId: id, profileId, date, amount: Number.isFinite(amount) ? amount : null, operationStatus: text(raw.operation_status ?? raw.status).toUpperCase(), inPay0: false, display: displayFromIqDispersion(raw) });
      }
      if (rows.length < 100) break;
    }
  }
  const db = getFirestore();
  for (const row of seen.values()) row.inPay0 = await dispersionInPay0(db, input.rootId, row.iqDispersionId);
  return { observed: [...seen.values()].sort((a, b) => a.iqDispersionId.localeCompare(b.iqDispersionId)), pages, truncated };
}

async function dispersionInPay0(db: FirebaseFirestore.Firestore, rootId: string, iqId: string): Promise<boolean> {
  const sameRoot = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.some(doc => text(doc.get("rootId")) === rootId);
  // IQ ids may have been persisted as text or as a number.
  const values: Array<string | number> = /^\d{1,15}$/.test(iqId) ? [iqId, Number(iqId)] : [iqId];
  const queries = values.flatMap(value => [
    db.collection("clientDispersionLegs").where("iqDispersionId", "==", value).limit(5),
    db.collection("clientDispersionLegs").where("iqDispersionFolio", "==", value).limit(5),
    db.collection("clientDispersions").where("iqDispersionFolios", "array-contains", value).limit(5),
    db.collection("clientDispersions").where("iqDispersionId", "==", value).limit(5),
  ]);
  for (const query of queries) if (sameRoot(await query.get())) return true;
  return false;
}
