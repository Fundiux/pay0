import { createHash } from "crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { db } from "../sharedCallables/helpers";
import { mexicoDay, summarizeEntries, type LinkSummaryCounts } from "./iqLinkDomain";

const text = (value: unknown) => String(value ?? "").trim();
const COUNTED = ["LINKED", "NOT_CONCILIATED", "PENDING_RETRY", "REVIEW_REQUIRED", "NOT_FOUND"];
const PAGE_CAP = 2000;
const SUMMARY_HOUR = 8;
const mexicoHour = (nowMs: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "2-digit", hourCycle: "h23" }).format(new Date(nowMs)));

// Once a day (first run after 08:00 Mexico time): one log line per catalog with counts and no identifiers, and
// one OPEN incident per root and catalog when methods have waited more than 24 h, for the Hugo / Control Center flow.
export async function summarizeIqBeneficiaryLinks(input: { catalogs: string[]; nowMs?: number; force?: boolean }) {
  const nowMs = input.nowMs ?? Date.now(), day = mexicoDay(nowMs);
  const stateRef = db.doc("iqBeneficiaryLinkRedriveState/summary");
  if (!input.force) {
    if (mexicoHour(nowMs) < SUMMARY_HOUR) return null;
    const claimed = await db.runTransaction(async tx => {
      const state = await tx.get(stateRef);
      if (text(state.data()?.lastSummaryDay) === day) return false;
      tx.set(stateRef, { lastSummaryDay: day, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) return null;
  }
  const result: Record<string, LinkSummaryCounts & { incidents: number }> = {};
  for (const catalog of input.catalogs) {
    const statusPath = new FieldPath("iqLinksByCatalog", catalog, "status");
    const entries: Array<Record<string, any>> = [];
    const stuckByRoot = new Map<string, number>();
    for (const status of COUNTED) {
      const page = await db.collection("clientBeneficiaryMethods").where(statusPath, "==", status).select("rootId", new FieldPath("iqLinksByCatalog", catalog)).limit(PAGE_CAP).get();
      for (const doc of page.docs) {
        const entry = doc.get(new FieldPath("iqLinksByCatalog", catalog)) || {};
        entries.push(entry);
        if (status === "PENDING_RETRY" && summarizeEntries([entry], nowMs).stuck) stuckByRoot.set(text(doc.get("rootId")), (stuckByRoot.get(text(doc.get("rootId"))) ?? 0) + 1);
      }
    }
    const counts = summarizeEntries(entries, nowMs);
    let incidents = 0;
    for (const [rootId, stuck] of stuckByRoot) {
      if (!rootId) continue;
      const id = createHash("sha256").update(JSON.stringify([rootId, catalog, day])).digest("hex").slice(0, 40);
      await db.collection("agentIncidents").doc(`iq-beneficiary-stuck-${id}`).set({
        rootId, reportDay: day, runId: null, correlationId: `iq-beneficiary-link:${catalog}:${day}`, entityType: "beneficiaryIqLink", entityId: catalog, status: "OPEN",
        cause: `${stuck} cuenta(s) de beneficiario llevan más de 24 h sin quedar vinculadas con IQ (${catalog === "iq-group-rr" ? "RR" : "PAY0"}).`,
        evidence: [`iqBeneficiaryLinkRedriveState/summary`], action: "DIAGNOSE_ONLY", createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      incidents++;
    }
    result[catalog] = { ...counts, incidents };
    console.log("IQ_BENEFICIARY_LINK_DAILY_SUMMARY", JSON.stringify({ day, catalog, ...counts, incidents }));
  }
  await stateRef.set({ lastSummary: { day, result }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return result;
}
