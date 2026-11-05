import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { fetchIq } from "../iq/iqHttpClient";
import { loginIqHttpDirect, type IqHttpAuthSession } from "../iq/iqHttpAuth";
import { decryptSecret, IQ_CANCELLATION_CREDENTIALS_KEY } from "../iq/solicitudCancellationService";
import { iqApiOrigin } from "../iq/solicitudHttpCancellation";
import { iqAccountIdentity, iqCatalogForAlias, methodAccountKey, resolveIqLink, type IqCatalogRow } from "./iqCatalogDomain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const PAGE = 100;
const READ_SPACING_MS = 150;
const RUN_BUDGET_MS = 220_000;
const METHODS_PER_RUN = 300;

const text = (value: unknown) => String(value ?? "").trim();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

// Reads IQ only. A full catalog takes several nights, so the cursor survives each run.
export async function syncIqCatalog(input: { rootId: string; catalog: string; session: IqHttpAuthSession; deadlineMs: number; spacingMs?: number }) {
  const stateRef = db.doc(`iqBeneficiaryCatalogState/${input.rootId}_${input.catalog}`);
  const state = (await stateRef.get()).data() || {};
  const partners = (await allRows(input.session, "/partners")).sort((a, b) => Number(a.id) - Number(b.id));
  let partnerIndex = Math.max(0, partners.findIndex(row => Number(row.id) === Number(state.partnerId)));
  let offset = Number(state.offset || 0);
  while (partnerIndex < partners.length) {
    const partner = partners[partnerIndex];
    const beneficiaries = await iqRows(input.session, `/partners/${partner.id}/beneficiaries`, offset);
    for (const beneficiary of beneficiaries) {
      const accounts = await allRows(input.session, `/beneficiaries/${beneficiary.id}/accounts`);
      const batch = db.batch();
      for (const account of accounts) {
        const identity = iqAccountIdentity(account);
        if (!identity) continue;
        batch.set(db.doc(`iqBeneficiaryCatalog/${input.catalog}_${account.id}`), { rootId: input.rootId, catalog: input.catalog, key: identity.key, last4: identity.last4,
          partnerId: Number(partner.id), beneficiaryId: Number(beneficiary.id), beneficiaryName: text(beneficiary.name), accountId: Number(account.id),
          conciliationStatus: text(account.conciliation_status), syncedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      await batch.commit();
      await sleep(input.spacingMs ?? READ_SPACING_MS);
    }
    if (beneficiaries.length === PAGE) offset += PAGE;
    else { partnerIndex += 1; offset = 0; }
    await stateRef.set({ rootId: input.rootId, catalog: input.catalog, partnerId: partners[partnerIndex]?.id ?? null, offset, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (Date.now() >= input.deadlineMs) return false;
  }
  await stateRef.set({ partnerId: null, offset: 0, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

// Writes only iqLinksByCatalog. iqLinkStatus keeps belonging to commissions, and
// nothing here changes how a dispersion is sent.
export async function linkMethodsToCatalog(input: { rootId: string; catalog: string; limit?: number }) {
  const stateRef = db.doc(`iqBeneficiaryCatalogState/${input.rootId}_${input.catalog}`);
  const state = (await stateRef.get()).data() || {};
  let query = db.collection("clientBeneficiaryMethods").where("rootId", "==", input.rootId).orderBy(admin.firestore.FieldPath.documentId()).limit(input.limit ?? METHODS_PER_RUN);
  if (state.methodCursor) query = query.startAfter(text(state.methodCursor));
  const methods = await query.get();
  for (const row of methods.docs) {
    const method = row.data();
    const key = methodAccountKey(method);
    if (!key || method.active === false) continue;
    const [catalogRows, beneficiary] = await Promise.all([
      db.collection("iqBeneficiaryCatalog").where("rootId", "==", input.rootId).where("catalog", "==", input.catalog).where("key", "==", key).get(),
      db.doc(`clientBeneficiaries/${text(method.beneficiaryId || method.beneficiarioId)}`).get(),
    ]);
    const decision = resolveIqLink(beneficiary.data()?.nombre ?? beneficiary.data()?.name, catalogRows.docs.map(doc => doc.data() as IqCatalogRow));
    await row.ref.set({ iqLinksByCatalog: { [input.catalog]: { ...decision, checkedAt: FieldValue.serverTimestamp() } } }, { merge: true });
  }
  await stateRef.set({ methodCursor: methods.size === (input.limit ?? METHODS_PER_RUN) ? methods.docs.at(-1)?.id ?? null : null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export const syncIqBeneficiaryCatalog = onSchedule({ schedule: "30 20 * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "512MiB", secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], retryCount: 0, maxInstances: 1, concurrency: 1 }, async () => {
  const profiles = await db.collection("iqCredentialProfiles").where("active", "==", true).get();
  const seen = new Set<string>();
  for (const doc of profiles.docs) {
    const profile = doc.data();
    const catalog = iqCatalogForAlias(profile.alias);
    const rootId = text(profile.rootId);
    if (!catalog || !rootId || profile.hasPassword !== true || seen.has(`${rootId}:${catalog}`)) continue;
    seen.add(`${rootId}:${catalog}`);
    try {
      const session = await loginIqHttpDirect({ apiOrigin: iqApiOrigin(), credentials: { username: text(profile.username), password: decryptSecret(profile) }, requiredPermissions: "NONE" });
      const complete = await syncIqCatalog({ rootId, catalog, session, deadlineMs: Date.now() + RUN_BUDGET_MS });
      const state = (await db.doc(`iqBeneficiaryCatalogState/${rootId}_${catalog}`).get()).data();
      if (complete || state?.completedAt) await linkMethodsToCatalog({ rootId, catalog });
    } catch (error) {
      console.error("IQ_BENEFICIARY_CATALOG_FAILED", catalog, text(error instanceof Error ? error.message : error).slice(0, 200));
    }
  }
});
