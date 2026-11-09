import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { CONSERVATIVE_POLICY, SafetyRuntime } from "../automationSafety/runtime";
import { fetchIq } from "../iq/iqHttpClient";
import { loginIqHttpDirect, type IqHttpAuthSession } from "../iq/iqHttpAuth";
import { decryptSecret, IQ_CANCELLATION_CREDENTIALS_KEY } from "../iq/solicitudCancellationService";
import { iqApiOrigin } from "../iq/solicitudHttpCancellation";
import { iqAccountIdentity, iqCatalogForAlias, methodAccountRef, resolveIqLink, rowsOfPartner, type IqCatalogRow } from "./iqCatalogDomain";
import { catalogsForClient } from "./iqLinkDomain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const PAGE = 100;
const READ_SPACING_MS = 150;
const DEFAULT_BUDGET_MS = 150_000;
const MIN_BUDGET_MS = 30_000;
const MAX_BUDGET_MS = 200_000;
const DEFAULT_REFRESH_DAYS = 7;
const METHODS_PER_RUN = 300;
const MAX_SKIPPED_IDS = 200;
// A row that IQ refuses is skipped; anything else may affect the whole catalog.
const SKIPPABLE_STATUS = new Set([400, 403, 404, 410, 422]);

const text = (value: unknown) => String(value ?? "").trim();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const stateRef = (rootId: string, catalog: string) => db.doc(`iqBeneficiaryCatalogState/${rootId}_${catalog}`);
const errorText = (error: unknown) => text(error instanceof Error ? error.message : error).slice(0, 200);
const httpStatus = (error: unknown) => Number(errorText(error).match(/^IQ_CATALOG_HTTP_(\d{3})$/)?.[1] || 0);

async function iqRows(session: IqHttpAuthSession, pathname: string, offset: number) {
  const url = new URL(pathname, session.apiOrigin);
  url.searchParams.set("limit", String(PAGE));
  url.searchParams.set("offset", String(offset));
  const response = await fetchIq(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}` } }, { operation: "beneficiary_catalog" });
  if (!response.ok) throw new Error(`IQ_CATALOG_HTTP_${response.status}`);
  const rows = await response.json() as Array<Record<string, any>>;
  if (!Array.isArray(rows)) throw new Error("IQ_CATALOG_RESPONSE_INVALID");
  return rows;
}

async function allRows(session: IqHttpAuthSession, pathname: string) {
  const rows: Array<Record<string, any>> = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await iqRows(session, pathname, offset);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

// The nightly trigger is fixed; this decides what each night does. Once a catalog
// is full, nextRunAfter spaces the refresh, and linking can still finish its pages.
export async function iqCatalogGate(rootId: string, catalog: string, now = Date.now()) {
  const [master, state] = await Promise.all([db.doc(`iqIntegrationConfigs/${rootId}`).get(), stateRef(rootId, catalog).get()]);
  const row = state.data() || {};
  const skip = async (reason: string, link = false) => {
    await stateRef(rootId, catalog).set({ rootId, catalog, lastSkipReason: reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { sync: false, link, reason };
  };
  if (master.data()?.enabled !== true) return skip("IQ_MASTER_OFF");
  if (row.paused === true) return skip("CATALOG_PAUSED");
  if ((row.nextRunAfter?.toMillis?.() ?? 0) > now) return skip("NEXT_RUN_PENDING", !!row.completedAt);
  return { sync: true, link: !!row.completedAt, reason: "OPEN" };
}

// Reads IQ only. A full catalog takes several nights, so the cursor survives each run.
export async function syncIqCatalog(input: { rootId: string; catalog: string; session: IqHttpAuthSession; deadlineMs: number; spacingMs?: number; refreshDays?: number }) {
  const ref = stateRef(input.rootId, input.catalog);
  const state = (await ref.get()).data() || {};
  const partners = (await allRows(input.session, "/partners")).sort((a, b) => Number(a.id) - Number(b.id));
  let partnerIndex = Math.max(0, partners.findIndex(row => Number(row.id) === Number(state.partnerId)));
  let offset = Number(state.offset || 0);
  const skipped: number[] = [];
  const save = (lastError: string | null = null) => ref.set({ rootId: input.rootId, catalog: input.catalog, partnerId: partners[partnerIndex]?.id ?? null, offset, lastError,
    ...(skipped.length ? { skippedBeneficiaryIds: FieldValue.arrayUnion(...skipped.slice(0, MAX_SKIPPED_IDS)) } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  while (partnerIndex < partners.length) {
    const partner = partners[partnerIndex];
    let beneficiaries: Array<Record<string, any>>;
    try { beneficiaries = await iqRows(input.session, `/partners/${partner.id}/beneficiaries`, offset); }
    catch (error) { await save(errorText(error)); throw error; }
    let done = 0;
    for (const beneficiary of beneficiaries) {
      try {
        const accounts = await allRows(input.session, `/beneficiaries/${beneficiary.id}/accounts`);
        const batch = db.batch();
        for (const account of accounts) {
          const identity = iqAccountIdentity(account);
          if (!identity) continue;
          batch.set(db.doc(`iqBeneficiaryCatalog/${input.rootId}_${input.catalog}_${account.id}`), { rootId: input.rootId, catalog: input.catalog, key: identity.key, last4: identity.last4,
            partnerId: Number(partner.id), beneficiaryId: Number(beneficiary.id), beneficiaryName: text(beneficiary.name), accountId: Number(account.id),
            conciliationStatus: text(account.conciliation_status), syncedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      } catch (error) {
        if (!SKIPPABLE_STATUS.has(httpStatus(error))) { offset += done; await save(errorText(error)); throw error; }
        skipped.push(Number(beneficiary.id));
      }
      done += 1;
      await sleep(input.spacingMs ?? READ_SPACING_MS);
      if (Date.now() >= input.deadlineMs) { offset += done; await save(); return false; }
    }
    if (beneficiaries.length === PAGE) offset += PAGE;
    else { partnerIndex += 1; offset = 0; }
    await save();
  }
  const nextRunAfter = admin.firestore.Timestamp.fromMillis(Date.now() + (input.refreshDays ?? DEFAULT_REFRESH_DAYS) * 86_400_000);
  await ref.set({ partnerId: null, offset: 0, lastError: null, completedAt: FieldValue.serverTimestamp(), nextRunAfter, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

// Writes only iqLinksByCatalog. iqLinkStatus keeps belonging to commissions, and
// nothing here changes how a dispersion is sent. IQ names stay in the catalog,
// which clients cannot read; methods are readable across the root.
export async function linkMethodsToCatalog(input: { rootId: string; catalog: string; limit?: number }) {
  const ref = stateRef(input.rootId, input.catalog);
  const state = (await ref.get()).data() || {};
  const limit = input.limit ?? METHODS_PER_RUN;
  let query = db.collection("clientBeneficiaryMethods").where("rootId", "==", input.rootId).orderBy(admin.firestore.FieldPath.documentId()).limit(limit);
  if (state.methodCursor) query = query.startAfter(text(state.methodCursor));
  const methods = await query.get();
  let lastLinkError: string | null = null;
  for (const row of methods.docs) {
    try {
      const method = row.data();
      const account = methodAccountRef(method);
      if (!account || method.active === false) continue;
      const [catalogRows, beneficiary, client] = await Promise.all([
        db.collection("iqBeneficiaryCatalog").where("rootId", "==", input.rootId).where("catalog", "==", input.catalog).where("key", "==", account.key).get(),
        db.doc(`clientBeneficiaries/${text(method.beneficiaryId || method.beneficiarioId)}`).get(),
        text(method.clientId || method.clienteId) ? db.doc(`clients/${text(method.clientId || method.clienteId)}`).get() : Promise.resolve(null),
      ]);
      // Rows of another IQ associate are not this client's when its associate is known.
      const partnerId = catalogsForClient(client?.data()).find(profile => profile.catalog === input.catalog)?.partnerId;
      const rows = catalogRows.docs.map(doc => doc.data() as IqCatalogRow);
      const resolved = resolveIqLink(beneficiary.data()?.nombre ?? beneficiary.data()?.name, partnerId ? rowsOfPartner(rows, partnerId) : rows);
      const existing = method.iqLinksByCatalog?.[input.catalog];
      // The catalog only knows what the nightly sync saw. A link found live or created, a stop with a reason
      // or a pending retry for this same account must not be downgraded by a catalog that has not caught up.
      const ownedByTrigger = existing?.key === account.key && (existing.source === "LIVE_LOOKUP" || existing.source === "CREATED_IN_IQ" || !!existing.createState || existing.status === "PENDING_RETRY");
      if (ownedByTrigger && (resolved.status === "NOT_FOUND" || resolved.status === "NOT_CONCILIATED")) continue;
      const { iqBeneficiaryName: _name, ...decision } = resolved as Record<string, unknown>;
      // Replaces the whole entry, so ids from an earlier state cannot survive.
      await row.ref.set({ iqLinksByCatalog: { [input.catalog]: { ...decision, key: account.key, last4: account.last4, source: "CATALOG", checkedAt: FieldValue.serverTimestamp() } } },
        { mergeFields: [new admin.firestore.FieldPath("iqLinksByCatalog", input.catalog)] });
    } catch (error) {
      lastLinkError = `${row.id}: ${errorText(error)}`;
    }
  }
  await ref.set({ methodCursor: methods.size === limit ? methods.docs.at(-1)?.id ?? null : null, lastLinkError, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

const safety = new SafetyRuntime(db);

export const syncIqBeneficiaryCatalog = onSchedule({ schedule: "30 20 * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "512MiB", secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], retryCount: 0, maxInstances: 1, concurrency: 1 }, async () => {
  const profiles = await db.collection("iqCredentialProfiles").where("active", "==", true).get();
  const seen = new Set<string>();
  const day = new Date().toISOString().slice(0, 10);
  for (const doc of profiles.docs) {
    const profile = doc.data();
    const catalog = iqCatalogForAlias(profile.alias);
    const rootId = text(profile.rootId);
    if (!catalog) { console.warn("IQ_BENEFICIARY_CATALOG_UNKNOWN_PROFILE", doc.id); continue; }
    if (!rootId || profile.hasPassword !== true || seen.has(`${rootId}:${catalog}`)) continue;
    seen.add(`${rootId}:${catalog}`);
    try {
      const gate = await iqCatalogGate(rootId, catalog);
      if (gate.sync) {
        const config = (await db.doc(`iqBeneficiaryCatalogConfig/${rootId}`).get()).data() || {};
        const budget = Math.min(MAX_BUDGET_MS, Math.max(MIN_BUDGET_MS, Number(config.runBudgetMs) || DEFAULT_BUDGET_MS));
        await safety.run({ rootId, process: "IQ_CATALOG", partition: catalog, operationType: "IQ_CATALOG_SYNC", operationId: `${catalog}:${day}`, idempotencyKey: `${catalog}:${day}`,
          origin: "AUTOMATIC", technicalOrigin: "SCHEDULER", externalTarget: "IQ", policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: 1000 } }, async () => {
          const session = await loginIqHttpDirect({ apiOrigin: iqApiOrigin(), credentials: { username: text(profile.username), password: decryptSecret(profile) }, requiredPermissions: "NONE" });
          await syncIqCatalog({ rootId, catalog, session, deadlineMs: Date.now() + budget, refreshDays: Number(config.refreshDays) || DEFAULT_REFRESH_DAYS });
        });
      }
      const state = (await stateRef(rootId, catalog).get()).data();
      if (gate.link || (gate.sync && state?.completedAt)) await linkMethodsToCatalog({ rootId, catalog });
    } catch (error) {
      console.error("IQ_BENEFICIARY_CATALOG_FAILED", catalog, errorText(error));
    }
  }
});
