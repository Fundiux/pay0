import { createHash, randomUUID } from "crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { context } from "./callables";
import { ANALYTIC_SOURCES, projectSource, readMetricBucket, Metrics } from "./projections";
import { enqueueRecovery, RECOVERY_FIELDS, RecoveryKind } from "./recovery";

const options = { region: "us-central1", cors: true, timeoutSeconds: 120, memory: "512MiB" as const };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const dimensions = new Set(["companyId", "clientId", "userId", "despachoId", "bankId", "status", "operationTypeKey", "destinationAccountId"]);
export function rangeDays(from: unknown, to: unknown) {
  const valid = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to)) throw new HttpsError("invalid-argument", "Fechas inválidas.");
  const start = new Date(`${from}T12:00:00Z`).getTime(), end = new Date(`${to}T12:00:00Z`).getTime();
  const count = (end - start) / 86400000 + 1;
  if (count < 1 || count > 366) throw new HttpsError("invalid-argument", "Selecciona entre 1 y 366 días.");
  return Array.from({ length: count }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
export function sumMetrics(rows: Metrics[]) {
  const total: Metrics = {};
  for (const row of rows) for (const [key, value] of Object.entries(row)) total[key] = (total[key] || 0) + value;
  return total;
}

export const getControlCenterAnalytics = onCall(options, async request => {
  const { rootId } = await context(request);
  const days = rangeDays(request.data?.from, request.data?.to);
  const key = String(request.data?.dimension || ""), value = String(request.data?.value || "");
  if ((key && (!dimensions.has(key) || !value || value.length > 200)) || (!key && value)) throw new HttpsError("invalid-argument", "Filtro inválido.");
  // Exactly one dimension is supported. Never silently ignore additional filters.
  if (request.data?.filters) throw new HttpsError("invalid-argument", "Usa una dimensión a la vez.");
  const scope = key ? `${key}:${value}` : "all";
  const previous = days.map(day => new Date(new Date(`${day}T12:00:00Z`).getTime() - days.length * 86400000).toISOString().slice(0, 10));
  const refs = [...days, ...previous].map(day => db.doc(`analyticsRoots/${rootId}/buckets/${hash(`day:${day}:${scope}`)}`));
  const rows: Metrics[] = [];
  for (let i = 0; i < refs.length; i += 100) {
    const docs = await db.getAll(...refs.slice(i, i + 100));
    rows.push(...docs.map(doc => doc.data()?.metrics || {}));
  }
  const [balance, coverage] = await Promise.all([readMetricBucket(rootId, "all", "all", scope), db.doc(`analyticsRoots/${rootId}`).get()]);
  return { ok: true, timezone: "America/Mexico_City", from: days[0], to: days[days.length - 1],
    totals: sumMetrics(rows.slice(0, days.length)), previous: sumMetrics(rows.slice(days.length)),
    daily: days.map((day, i) => ({ day, metrics: rows[i] })),
    current: { ...Object.fromEntries(Object.entries(balance).filter(([metric]) => /^(iq|whatsapp|telegram)/.test(metric))), clientWalletMinor: balance.clientWalletMinor || 0, advancePendingMinor: balance.advancePendingMinor || 0,
      recoveryPending: balance.recoveryPending || 0, recoveryBlocked: balance.recoveryBlocked || 0 },
    coverage: { complete: coverage.data()?.bootstrapStatus === "COMPLETE", source: coverage.data()?.sourceIndex || 0,
      processed: coverage.data()?.processed || 0, expensesComplete: false },
  };
});

// Resume one bounded page per invocation. The checkpoint is server-owned and
// the contribution transaction makes concurrent triggers/backfill retry-safe.
export async function initializeAnalyticsRoot(rootId: string) {
  if (!rootId || rootId.includes("/")) throw new HttpsError("invalid-argument", "Ámbito inválido.");
  const ref = db.doc(`analyticsRoots/${rootId}`), lease = randomUUID();
  const checkpoint = await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data() || {};
    if (row.bootstrapStatus === "COMPLETE") return null;
    if (row.leaseUntil?.toMillis() > Date.now()) throw new HttpsError("aborted", "La actualización ya está en curso.");
    tx.set(ref, { lease, leaseUntil: Timestamp.fromMillis(Date.now() + 180000), bootstrapStatus: "RUNNING" }, { merge: true });
    return row;
  });
  if (!checkpoint) return { ok: true, complete: true };
  try {
    const sourceIndex = Number(checkpoint.sourceIndex || 0), source = ANALYTIC_SOURCES[sourceIndex];
    let query = db.collection(source).where("rootId", "==", rootId).orderBy(FieldPath.documentId()).limit(50);
    if (checkpoint.cursor) query = query.startAfter(checkpoint.cursor);
    const page = await query.get();
    for (let offset = 0; offset < page.size; offset += 5) {
      const results = await Promise.allSettled(page.docs.slice(offset, offset + 5).map(async doc => {
        await projectSource(source, doc.id);
        if (source === "solicitudes") for (const kind of Object.keys(RECOVERY_FIELDS) as RecoveryKind[]) {
          if (doc.data()[RECOVERY_FIELDS[kind]] === "ERROR") await enqueueRecovery(doc.id, doc.data(), kind);
        }
      }));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    }
    const nextSource = page.size < 50 ? sourceIndex + 1 : sourceIndex;
    const complete = nextSource >= ANALYTIC_SOURCES.length;
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.data()?.lease !== lease) throw new HttpsError("aborted", "Cambió la sesión de actualización.");
      tx.set(ref, { sourceIndex: nextSource, cursor: nextSource === sourceIndex ? page.docs.at(-1)?.id || "" : "",
        processed: FieldValue.increment(page.size), bootstrapStatus: complete ? "COMPLETE" : "PENDING",
        leaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    return { ok: true, complete, source, processed: Number(checkpoint.processed || 0) + page.size };
  } catch (error) {
    await db.runTransaction(async tx => { const current = await tx.get(ref); if (current.data()?.lease === lease) tx.update(ref, { leaseUntil: FieldValue.delete(), bootstrapStatus: "PENDING" }); });
    throw error;
  }
}

export const initializeControlCenterAnalytics = onCall(options, async request => {
  const { rootId } = await context(request);
  return initializeAnalyticsRoot(rootId);
});

export const getControlCenterEvidence = onCall(options, async request => {
  const { rootId } = await context(request);
  const [snap, incidents, facets] = await Promise.all([
    db.collection("analyticsRoots").doc(rootId).collection("revisions").orderBy("createdAt", "desc").limit(30).get(),
    db.collection("analyticsRoots").doc(rootId).collection("incidents").orderBy("updatedAt", "desc").limit(51).get(),
    db.collection("analyticsRoots").doc(rootId).collection("facets").limit(501).get(),
  ]);
  return { ok: true, rows: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    incidents: incidents.docs.slice(0, 50).map(doc => ({ id: doc.id, ...doc.data() })),
    incidentsTruncated: incidents.size > 50,
    facets: facets.docs.slice(0, 500).map(doc => doc.data()), facetsTruncated: facets.size > 500,
  };
});
