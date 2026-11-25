import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { logActivity } from "../../utils/logActivity";
import { assertIqAuthorized } from "../iq/authorization";
import { IQ_CANCELLATION_CREDENTIALS_KEY } from "../iq/solicitudCancellationService";
import { db } from "../sharedCallables/helpers";
import { DEFAULT_CATALOG_MAX_AGE_HOURS, mexicoDay } from "./iqLinkDomain";
import { REDRIVEN_CATALOGS } from "./iqLinkRedrive";
import { productionIqLinkPorts } from "./iqLinkPorts";
import { linkOrCreateMethod } from "./iqLinkService";

const text = (value: unknown) => String(value ?? "").trim();
const PENDING_STATUSES = ["PENDING_RETRY", "REVIEW_REQUIRED", "NOT_CONCILIATED", "NOT_FOUND"];
// Only these can be tried again by hand: a temporary stop, or a review that only lacked the associate id.
const RETRIABLE_REVIEW_STATES = new Set(["PARTNER_UNKNOWN"]);
const PAGE = 100, RETRY_CAP = 10;

async function superadminRoot(request: CallableRequest<any>) {
  const profile = await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
  if (text(profile.role).toLowerCase() !== "superadmin") throw new HttpsError("permission-denied", "Solo Super Admin puede ver o reintentar el alta en IQ.");
  const uid = text(request.auth?.uid);
  return { uid, rootId: text(profile.rootId) || uid };
}

type PendingRow = { methodId: string; catalog: string; status: string; reason: string; attempts: number; beneficiaryName: string; clientName: string; bankName: string; last4: string; retryAfterMs: number | null; retriable: boolean };
type Joined = PendingRow & { beneficiaryRef: string; clientRef: string };

async function pendingRows(rootId: string): Promise<PendingRow[]> {
  const rows: Joined[] = [];
  for (const catalog of REDRIVEN_CATALOGS) {
    const snap = await db.collection("clientBeneficiaryMethods").where("rootId", "==", rootId).where(new FieldPath("iqLinksByCatalog", catalog, "status"), "in", PENDING_STATUSES).limit(PAGE).get();
    for (const doc of snap.docs) {
      const method = doc.data(), entry = (method.iqLinksByCatalog?.[catalog] ?? {}) as Record<string, any>;
      if (method.active === false || method.isDeleted === true) continue;
      // Reconciled in another IQ group (white in the app): the group that does not hold it is not a pending alta.
      if (Object.values((method.iqLinksByCatalog ?? {}) as Record<string, any>).some(link => text(link?.status).toUpperCase() === "LINKED" && link?.nameDiffers !== true)) continue;
      const status = text(entry.status), reason = text(entry.reason) || text(entry.createState);
      rows.push({ methodId: doc.id, catalog, status, reason, attempts: Number(entry.attempts || 0), beneficiaryName: "", clientName: "", bankName: text(method.bankName), last4: text(method.last4),
        retryAfterMs: entry.retryAfter?.toMillis?.() ?? null,
        retriable: status === "PENDING_RETRY" || (status === "REVIEW_REQUIRED" && RETRIABLE_REVIEW_STATES.has(reason)),
        beneficiaryRef: text(method.beneficiaryId || method.beneficiarioId), clientRef: text(method.clientId || method.clienteId) });
    }
  }
  // Names for display only (never ids): one read per distinct beneficiary and client.
  const cache = new Map<string, string>();
  const nameOf = async (path: string) => {
    if (!cache.has(path)) { const data = (await db.doc(path).get()).data() || {}; cache.set(path, text(data.nombre) || text(data.name)); }
    return cache.get(path)!;
  };
  return Promise.all(rows.map(async ({ beneficiaryRef, clientRef, ...row }) => ({
    ...row,
    beneficiaryName: beneficiaryRef ? await nameOf(`clientBeneficiaries/${beneficiaryRef}`) : "",
    clientName: clientRef ? await nameOf(`clients/${clientRef}`) : "",
  })));
}

// Super Admin only: the create switches, today's count and every method that is not yet reconciled in IQ, so the
// owner can see why it is not there.
export const getIqBeneficiaryCreateState = onCall({ cors: true, invoker: "public", timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const { rootId } = await superadminRoot(request);
  const day = mexicoDay(Date.now());
  const [config, master, counter, rows] = await Promise.all([db.doc(`iqBeneficiaryCreateConfig/${rootId}`).get(), db.doc(`iqIntegrationConfigs/${rootId}`).get(), db.doc(`iqBeneficiaryCreateCounters/${rootId}_${day}`).get(), pendingRows(rootId)]);
  const data = config.data() || {}, limit = Number(data.dailyLimit);
  const catalogs = await Promise.all(REDRIVEN_CATALOGS.map(async catalog => {
    const state = (await db.doc(`iqBeneficiaryCatalogState/${rootId}_${catalog}`).get()).data() || {};
    const synced = Object.values((state.partnerSyncedAt ?? {}) as Record<string, any>).map(value => value?.toMillis?.() ?? 0).filter(Boolean);
    return { catalog, partnerSyncedAtMs: synced.length ? Math.max(...synced) : null, completedAtMs: state.completedAt?.toMillis?.() ?? null };
  }));
  return {
    masterEnabled: master.data()?.enabled === true, enabled: data.enabled === true, contractVerified: data.contractVerified === true,
    dailyLimit: data.dailyLimit !== null && data.dailyLimit !== undefined && Number.isFinite(limit) ? limit : null,
    catalogMaxAgeHours: Number.isFinite(Number(data.catalogMaxAgeHours)) ? Number(data.catalogMaxAgeHours) : DEFAULT_CATALOG_MAX_AGE_HOURS,
    createdToday: Number(counter.data()?.count || 0), catalogs, pending: rows,
  };
});

// Super Admin only: runs the link-or-create again now for one method or for the pending ones (at most ten per call).
// It never writes to IQ by itself: linkOrCreateMethod still needs the master switch, the create switch, a verified
// contract, the catalog absence proof and the reservation.
export const retryIqBeneficiaryLinks = onCall({ cors: true, invoker: "public", timeoutSeconds: 300, memory: "512MiB", secrets: [IQ_CANCELLATION_CREDENTIALS_KEY] }, async request => {
  const { uid, rootId } = await superadminRoot(request);
  const wanted = text((request.data as Record<string, unknown> | undefined)?.methodId);
  const rows = (await pendingRows(rootId)).filter(row => row.retriable && (!wanted || row.methodId === wanted));
  const methodIds = [...new Set(rows.map(row => row.methodId))].slice(0, RETRY_CAP);
  if (wanted && !methodIds.length) throw new HttpsError("failed-precondition", "Esa cuenta no tiene un reintento disponible.");
  const results: { methodId: string; status: string }[] = [];
  for (const methodId of methodIds) {
    for (const row of rows.filter(item => item.methodId === methodId && item.status === "REVIEW_REQUIRED")) {
      // A review that only lacked the associate: put it back as a temporary stop so the same work runs again.
      const ref = db.doc(`clientBeneficiaryMethods/${methodId}`);
      const entry = ((await ref.get()).get(new FieldPath("iqLinksByCatalog", row.catalog)) ?? {}) as Record<string, unknown>;
      await ref.set({ iqLinksByCatalog: { [row.catalog]: { status: "PENDING_RETRY", reason: "LOOKUP_FAILED", attempts: 1, key: entry.key, last4: entry.last4, source: "CATALOG", retryAfter: Timestamp.now(), checkedAt: FieldValue.serverTimestamp() } } }, { mergeFields: [new FieldPath("iqLinksByCatalog", row.catalog)] });
    }
    try {
      const outcomes = await linkOrCreateMethod({ methodId, ports: productionIqLinkPorts });
      results.push({ methodId, status: outcomes.map(outcome => outcome.skipped || outcome.status).join(",") || "SKIPPED" });
    } catch (error) {
      console.error("IQ_BENEFICIARY_MANUAL_RETRY_FAILED", methodId, text(error instanceof Error ? error.message : error).slice(0, 200));
      results.push({ methodId, status: "ERROR" });
    }
  }
  await logActivity({ event: "IQ_BENEFICIARIO_REINTENTO_MANUAL", rootId, actorUid: uid, actorRole: "superadmin", referenceType: "iqBeneficiaryCreateConfig",
    description: `Reintento manual del alta de beneficiarios en IQ: ${results.length} cuenta(s).`, extra: { count: results.length } }).catch(() => undefined);
  return { retried: results.length, results };
});
