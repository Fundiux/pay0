import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { CONSERVATIVE_POLICY, SafetyRuntime } from "../automationSafety/runtime";
import { iqCatalogForAlias } from "../beneficiaries/iqCatalogDomain";
import { mexicoDay } from "../beneficiaries/iqLinkDomain";
import { fetchIq } from "../iq/iqHttpClient";
import { loginIqHttpDirect, type IqHttpAuthSession } from "../iq/iqHttpAuth";
import { decryptSecret, IQ_CANCELLATION_CREDENTIALS_KEY } from "../iq/solicitudCancellationService";
import { iqApiOrigin } from "../iq/solicitudHttpCancellation";
import {
  clientLinks, compareBalances, explainMovements, indexLinks, normalizeGeneralRows, normalizeIqMovements, parseIqMoney,
  partnerOwnerMap, resolveRowClient, round2, snapshotId, snapshotKey,
  CONFIG, PROCESS, SNAPSHOTS, STATE,
  type ClientLink, type ComparisonStatus, type Explanation, type IqGeneralRow, type Pay0Movement,
} from "./domain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

export { PROCESS, SNAPSHOTS, STATE, CONFIG };
const DEFAULT_DETAIL_LIMIT = 25;
const MAX_DETAIL_LIMIT = 60;
const READ_SPACING_MS = 150;
const PAY0_MOVEMENT_LIMIT = 2000;
const REFERENCE_LIMIT = 300;
// A refused client is skipped; anything else may affect IQ as a whole and stops the details pass.
const SKIPPABLE_STATUS = new Set([400, 404, 410, 422]);

const text = (value: unknown) => String(value ?? "").trim();
const sleep = (ms: number) => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
const errorText = (error: unknown) => text(error instanceof Error ? error.message : error).slice(0, 200);
const httpStatus = (error: unknown) => Number(errorText(error).match(/^IQ_BALANCE_HTTP_(\d{3})$/)?.[1] || 0);
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

async function iqGet(session: IqHttpAuthSession, pathname: string, params: Record<string, string> = {}) {
  const url = new URL(pathname, session.apiOrigin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchIq(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}` } }, { operation: "balance_reconciliation" });
  if (!response.ok) throw new Error(`IQ_BALANCE_HTTP_${response.status}`);
  return response.json();
}

export type CatalogSource = { catalog: string; openSession: () => Promise<IqHttpAuthSession> };
export type RunInput = { rootId: string; day: string; catalogs: CatalogSource[]; safety: SafetyRuntime; detailLimit?: number; spacingMs?: number };
export type RunSummary = { ran: boolean; reason: string; match: number; different: number; unmapped: number; catalogsRead: number; catalogsSkipped: number; runId?: string };

/** The master IQ switch and a per-root pause. No other switch: the comparison is read-only and automatic. */
export async function reconciliationGate(rootId: string) {
  const [master, config] = await Promise.all([db.doc(`iqIntegrationConfigs/${rootId}`).get(), db.doc(`${CONFIG}/${rootId}`).get()]);
  if (master.data()?.enabled !== true) return { open: false, reason: "IQ_MASTER_OFF", config: config.data() || {} };
  if (config.data()?.paused === true) return { open: false, reason: "PAUSED", config: config.data() || {} };
  return { open: true, reason: "OPEN", config: config.data() || {} };
}

type Entry = {
  key: string; status: ComparisonStatus; reason: string | null; catalogs: string[];
  clientId: string | null; clientName: string; clientNumber: number | null; ownerAdminId: string | null;
  partners: Array<{ name: string; balance: number | null }>; iqClientIds: Array<{ catalog: string; iqClientId: string }>;
  iqBalance: number | null; pay0Balance: number | null; difference: number | null; signInverted: boolean; partnerOwnerMismatch: boolean;
  explanation: Explanation | null; explanationStatus: "OK" | "NOT_REQUESTED" | "SKIPPED_LIMIT" | "FAILED" | "IQ_UNAVAILABLE";
};

/** PAY0 movements of one client in one month, with the IQ ids their pago or dispersion carries. */
async function pay0MonthMovements(clientId: string, month: string): Promise<Pay0Movement[]> {
  const snap = await db.collection("balanceMovements").where("holderType", "==", "CLIENT").where("holderId", "==", clientId).limit(PAY0_MOVEMENT_LIMIT).get();
  const rows = snap.docs.map(doc => doc.data()).filter(row => {
    const millis = row.createdAt?.toMillis?.();
    return Number.isFinite(millis) && mexicoDay(millis).startsWith(month) && text(row.status || "APPLIED").toUpperCase() !== "REVERSED";
  });
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const row of rows) {
    if (text(row.depositId)) refs.set(`pagos/${text(row.depositId)}`, db.doc(`pagos/${text(row.depositId)}`));
    if (text(row.dispersionId)) refs.set(`clientDispersions/${text(row.dispersionId)}`, db.doc(`clientDispersions/${text(row.dispersionId)}`));
  }
  const iqIdsByPath = new Map<string, string[]>();
  const wanted = [...refs.values()].slice(0, REFERENCE_LIMIT);
  for (const group of chunks(wanted, 100)) {
    if (!group.length) continue;
    for (const doc of await db.getAll(...group)) {
      const data = doc.data() || {};
      iqIdsByPath.set(doc.ref.path, [data.iqDepositId, data.iqDepositFolio, data.iqDispersionId, data.iqDispersionFolio, data.iqFolio, data.iqId].map(text).filter(Boolean));
    }
  }
  return rows.map(row => ({
    iqIds: [...(iqIdsByPath.get(`pagos/${text(row.depositId)}`) || []), ...(iqIdsByPath.get(`clientDispersions/${text(row.dispersionId)}`) || [])],
    day: mexicoDay(row.createdAt.toMillis()),
    folio: text(row.folio || row.dispersionFolio || row.pagoFolio || row.referenceFolio).slice(0, 40),
    concept: text(row.displayConcept || String(row.movementType || "").replace(/_/g, " ")).slice(0, 80),
    direction: row.direction === "OUT" ? "OUT" : "IN",
    amount: round2(Number(row.amount) || 0),
  }));
}

/**
 * One nightly comparison for one root. Reads IQ only (GET), reads PAY0, and writes one snapshot per
 * PAY0 client (or per unmapped IQ row) for the day. A second run the same day does nothing.
 */
export async function runIqBalanceReconciliation(input: RunInput): Promise<RunSummary> {
  const { rootId, day, safety } = input;
  const stateRef = db.doc(`${STATE}/${rootId}`);
  const empty = { match: 0, different: 0, unmapped: 0, catalogsRead: 0, catalogsSkipped: 0 };
  // One comparison per day. A partial day is not retried: its read catalogs are already deduplicated by
  // the breaker, so a retry would replace a fuller snapshot with a thinner one. The next night starts fresh.
  if ((await stateRef.get()).data()?.lastRunDay === day) return { ran: false, reason: "ALREADY_DONE", ...empty };
  const gate = await reconciliationGate(rootId);
  if (!gate.open) {
    await stateRef.set({ rootId, lastSkipDay: day, lastSkipReason: gate.reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ran: false, reason: gate.reason, ...empty };
  }

  // 1. IQ balances per catalog, each under its own breaker scope.
  const read = new Map<string, { session: IqHttpAuthSession; rows: IqGeneralRow[] }>();
  const catalogStatus: Record<string, string> = {};
  for (const source of input.catalogs) {
    const result = await safety.run({ rootId, process: PROCESS, partition: source.catalog, operationType: "IQ_BALANCE_GENERAL", operationId: `${source.catalog}:${day}`,
      idempotencyKey: `${source.catalog}:${day}`, origin: "AUTOMATIC", technicalOrigin: "SCHEDULER", externalTarget: "IQ", policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: 5 } }, async () => {
      const session = await source.openSession();
      return { session, rows: normalizeGeneralRows(await iqGet(session, "/balances/general")) };
    });
    if (result.admitted && result.reason === "SUCCEEDED" && result.value) { read.set(source.catalog, result.value); catalogStatus[source.catalog] = "READ"; }
    else catalogStatus[source.catalog] = text(result.reason) || "NOT_READ";
  }
  const summaryBase = { catalogsRead: read.size, catalogsSkipped: input.catalogs.length - read.size };
  if (!read.size) {
    await stateRef.set({ rootId, lastSkipDay: day, lastSkipReason: "NO_CATALOG_READ", catalogStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ran: false, reason: "NO_CATALOG_READ", match: 0, different: 0, unmapped: 0, ...summaryBase };
  }

  // 2. PAY0 clients and their IQ links.
  const clientsSnap = await db.collection("clients").where("rootId", "==", rootId).get();
  const clients = new Map(clientsSnap.docs.map(doc => [doc.id, doc.data()]));
  const links: ClientLink[] = [];
  for (const [id, data] of clients) links.push(...clientLinks(id, data));
  const index = indexLinks(links);
  const owners = partnerOwnerMap(rootId, gate.config.partnerAdminIds);

  const byClient = new Map<string, Array<{ catalog: string; row: IqGeneralRow }>>();
  const unmapped: Array<{ catalog: string; row: IqGeneralRow; reason: string }> = [];
  for (const [catalog, { rows }] of read) {
    for (const row of rows) {
      const resolved = resolveRowClient(catalog, row, index);
      if (resolved.clientId !== null) byClient.set(resolved.clientId, [...(byClient.get(resolved.clientId) || []), { catalog, row }]);
      else unmapped.push({ catalog, row, reason: resolved.reason });
    }
  }
  // A linked client with money in PAY0 and no row in a catalog that was read is also a difference.
  const missing = new Set<string>();
  for (const link of links) {
    if (link.merged || byClient.has(link.clientId) || clients.get(link.clientId)?.active === false) continue;
    const all = links.filter(other => other.clientId === link.clientId);
    if (all.every(other => read.has(other.catalog))) missing.add(link.clientId);
  }

  // 3. PAY0 balances.
  const balanceIds = [...new Set([...byClient.keys(), ...missing])];
  const balances = new Map<string, number>();
  for (const group of chunks(balanceIds, 100)) {
    if (!group.length) continue;
    for (const doc of await db.getAll(...group.map(id => db.doc(`balanceAccounts/CLIENT_${id}`)))) balances.set(doc.id.replace(/^CLIENT_/, ""), round2(Number(doc.data()?.availableBalance) || 0));
  }

  const entries: Entry[] = [];
  const clientName = (id: string) => text(clients.get(id)?.name || clients.get(id)?.razonSocial);
  const clientNumber = (id: string) => Number(clients.get(id)?.clientNumber || clients.get(id)?.numeroCliente || 0) || null;
  for (const id of balanceIds) {
    const rows = byClient.get(id) || [];
    if (!rows.length && Math.abs(balances.get(id) || 0) <= 0.01) continue;
    const unreadable = rows.some(item => item.row.balance === null);
    const iqBalance = unreadable ? null : round2(rows.reduce((sum, item) => sum + (item.row.balance || 0), 0));
    const pay0Balance = balances.get(id) ?? 0;
    const compared = iqBalance === null ? null : compareBalances(iqBalance, pay0Balance);
    const ownerAdminId = text(clients.get(id)?.adminId) || owners.get(rows[0]?.row.partner.key || "") || null;
    const partnerOwners = rows.map(item => owners.get(item.row.partner.key)).filter(Boolean);
    entries.push({
      key: snapshotKey(["CLIENT", id]), status: compared?.status || "DIFFERENT",
      reason: unreadable ? "IQ_BALANCE_UNREADABLE" : rows.length ? null : "IQ_ROW_MISSING",
      catalogs: [...new Set(rows.map(item => item.catalog))], clientId: id, clientName: clientName(id) || rows[0]?.row.iqClientName || "", clientNumber: clientNumber(id), ownerAdminId,
      partners: rows.map(item => ({ name: item.row.partner.name, balance: item.row.balance })),
      iqClientIds: rows.map(item => ({ catalog: item.catalog, iqClientId: item.row.iqClientId })),
      iqBalance, pay0Balance, difference: compared ? compared.difference : null, signInverted: !!compared?.signInverted,
      partnerOwnerMismatch: !!ownerAdminId && partnerOwners.some(owner => owner !== ownerAdminId),
      explanation: null, explanationStatus: "NOT_REQUESTED",
    });
  }
  for (const item of unmapped) {
    entries.push({
      key: snapshotKey(["IQ", item.catalog, item.row.iqClientId, item.row.partner.key]), status: "UNMAPPED", reason: item.reason, catalogs: [item.catalog],
      clientId: null, clientName: item.row.iqClientName, clientNumber: null, ownerAdminId: owners.get(item.row.partner.key) || null,
      partners: [{ name: item.row.partner.name, balance: item.row.balance }], iqClientIds: [{ catalog: item.catalog, iqClientId: item.row.iqClientId }],
      iqBalance: item.row.balance, pay0Balance: null, difference: null, signInverted: false, partnerOwnerMismatch: false,
      explanation: null, explanationStatus: "NOT_REQUESTED",
    });
  }

  // 4. Bounded, best-effort explanation of the largest differences, one breaker run per catalog.
  const limit = Math.min(MAX_DETAIL_LIMIT, Math.max(0, Number(input.detailLimit ?? gate.config.detailLimit ?? DEFAULT_DETAIL_LIMIT) || 0));
  const different = entries.filter(entry => entry.status === "DIFFERENT" && entry.iqClientIds.length && entry.clientId)
    .sort((a, b) => Math.abs(b.difference ?? Infinity) - Math.abs(a.difference ?? Infinity));
  different.slice(limit).forEach(entry => { entry.explanationStatus = "SKIPPED_LIMIT"; });
  const chosen = different.slice(0, limit);
  const [year, monthNumber] = day.split("-");
  const iqDetails = new Map<Entry, Array<Record<string, any>>>();
  for (const [catalog, { session }] of read) {
    const targets = chosen.filter(entry => entry.iqClientIds.some(ref => ref.catalog === catalog));
    if (!targets.length) continue;
    // Same breaker scope as the balance read, which admits one operation per spacing window.
    await sleep(CONSERVATIVE_POLICY.spacingMs + 50);
    const result = await safety.run({ rootId, process: PROCESS, partition: catalog, operationType: "IQ_BALANCE_DETAILS", operationId: `${catalog}:${day}`,
      idempotencyKey: `${catalog}:${day}`, origin: "AUTOMATIC", technicalOrigin: "SCHEDULER", externalTarget: "IQ",
      policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: targets.length * 2 + 2 } }, async () => {
      for (const entry of targets) {
        for (const ref of entry.iqClientIds.filter(item => item.catalog === catalog)) {
          try {
            const body = await iqGet(session, "/balances/details", { client_id: ref.iqClientId, month: String(Number(monthNumber)), year });
            iqDetails.set(entry, [...(iqDetails.get(entry) || []), body && typeof body === "object" ? body : {}]);
          } catch (error) {
            if (!SKIPPABLE_STATUS.has(httpStatus(error))) throw error;
            entry.explanationStatus = "FAILED";
          }
          await sleep(input.spacingMs ?? READ_SPACING_MS);
        }
      }
      return true;
    });
    if (!(result.admitted && result.reason === "SUCCEEDED")) targets.forEach(entry => { if (!iqDetails.has(entry)) entry.explanationStatus = "IQ_UNAVAILABLE"; });
  }
  for (const entry of chosen) {
    const bodies = iqDetails.get(entry);
    if (!bodies || entry.explanationStatus === "FAILED" || entry.explanationStatus === "IQ_UNAVAILABLE") { if (entry.explanationStatus === "NOT_REQUESTED") entry.explanationStatus = "IQ_UNAVAILABLE"; continue; }
    try {
      const iqMovements = bodies.flatMap(body => normalizeIqMovements(body.movements));
      const pay0 = await pay0MonthMovements(entry.clientId!, `${year}-${monthNumber}`);
      const sum = (key: string) => bodies.every(body => parseIqMoney(body[key]) !== null) ? round2(bodies.reduce((total, body) => total + (parseIqMoney(body[key]) || 0), 0)) : null;
      entry.explanation = { ...explainMovements(iqMovements, pay0), previousBalance: sum("previous_balance"), totalCredits: sum("total_credits"), totalCharges: sum("total_charges"), month: `${year}-${monthNumber}` };
      entry.explanationStatus = "OK";
    } catch (error) {
      entry.explanationStatus = "FAILED";
      console.error("IQ_BALANCE_EXPLANATION_FAILED", errorText(error));
    }
  }

  // 5. Snapshots for the day, then the pointer the callable reads.
  const runId = randomUUID();
  for (const group of chunks(entries, 400)) {
    const batch = db.batch();
    for (const entry of group) batch.set(db.doc(`${SNAPSHOTS}/${snapshotId(rootId, day, entry.key)}`), { rootId, day, runId, ...entry, checkedAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  const counts = { match: entries.filter(e => e.status === "MATCH").length, different: entries.filter(e => e.status === "DIFFERENT").length, unmapped: entries.filter(e => e.status === "UNMAPPED").length };
  const complete = read.size === input.catalogs.length;
  await stateRef.set({ rootId, lastRunId: runId, lastRunDay: day, lastRunAt: FieldValue.serverTimestamp(), counts, catalogStatus, complete,
    ...(complete ? { lastCompletedDay: day } : {}), lastSkipReason: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ran: true, reason: complete ? "COMPLETED" : "PARTIAL", ...counts, ...summaryBase, runId };
}

const safety = new SafetyRuntime(db);

/** Nightly after IQ hours, Monday to Saturday. No manual trigger by design. */
export const reconcileIqBalances = onSchedule({ schedule: "0 21 * * 1-6", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "512MiB",
  secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], retryCount: 0, maxInstances: 1, concurrency: 1 }, async () => {
  const profiles = await db.collection("iqCredentialProfiles").where("active", "==", true).get();
  const byRoot = new Map<string, Map<string, CatalogSource>>();
  for (const doc of profiles.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const profile = doc.data();
    const catalog = iqCatalogForAlias(profile.alias), rootId = text(profile.rootId);
    if (!catalog || !rootId || profile.hasPassword !== true) continue;
    const catalogs = byRoot.get(rootId) || new Map<string, CatalogSource>();
    if (!catalogs.has(catalog)) catalogs.set(catalog, { catalog, openSession: () => loginIqHttpDirect({ apiOrigin: iqApiOrigin(), credentials: { username: text(profile.username), password: decryptSecret(profile) }, requiredPermissions: "NONE" }) });
    byRoot.set(rootId, catalogs);
  }
  const day = mexicoDay(Date.now());
  const totals = { roots: 0, match: 0, different: 0, unmapped: 0, catalogsRead: 0, catalogsSkipped: 0 };
  for (const [rootId, catalogs] of byRoot) {
    try {
      const summary = await runIqBalanceReconciliation({ rootId, day, catalogs: [...catalogs.values()], safety });
      totals.roots += 1; totals.match += summary.match; totals.different += summary.different; totals.unmapped += summary.unmapped;
      totals.catalogsRead += summary.catalogsRead; totals.catalogsSkipped += summary.catalogsSkipped;
    } catch (error) {
      console.error("IQ_BALANCE_RECONCILIATION_FAILED", errorText(error));
    }
  }
  // Counts only: no client names, ids or amounts in logs.
  console.log("IQ_BALANCE_RECONCILIATION_SUMMARY", JSON.stringify(totals));
});
