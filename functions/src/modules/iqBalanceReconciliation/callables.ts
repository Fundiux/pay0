import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { onCall } from "firebase-functions/v2/https";

import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { SNAPSHOTS, STATE } from "./domain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const text = (value: unknown) => String(value ?? "").trim();
export const NO_OWNER = "__SIN_SOCIO__";
const CATALOG_LABEL: Record<string, string> = { "iq-group-rr": "IQ RR", "iq-group-pay0": "IQ PAY0" };
const opaque = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

/** What the page shows: names, folios, amounts and dates. No document ids, UIDs or IQ ids. */
function rowDto(id: string, data: Record<string, any>, ownerLabel: string | null) {
  const explanation = data.explanation && typeof data.explanation === "object" ? data.explanation : null;
  return {
    rowKey: opaque(id),
    status: text(data.status),
    reason: data.reason ? text(data.reason) : null,
    clientName: text(data.clientName),
    clientNumber: Number(data.clientNumber) || null,
    ownerLabel,
    sources: (Array.isArray(data.catalogs) ? data.catalogs : []).map((catalog: unknown) => CATALOG_LABEL[text(catalog)] || "IQ"),
    partners: (Array.isArray(data.partners) ? data.partners : []).map((partner: any) => ({ name: text(partner?.name), balance: typeof partner?.balance === "number" ? partner.balance : null })),
    iqBalance: typeof data.iqBalance === "number" ? data.iqBalance : null,
    pay0Balance: typeof data.pay0Balance === "number" ? data.pay0Balance : null,
    difference: typeof data.difference === "number" ? data.difference : null,
    signInverted: data.signInverted === true,
    partnerOwnerMismatch: data.partnerOwnerMismatch === true,
    explanationStatus: text(data.explanationStatus) || null,
    explanation: explanation ? {
      month: text(explanation.month),
      previousBalance: explanation.previousBalance ?? null, totalCredits: explanation.totalCredits ?? null, totalCharges: explanation.totalCharges ?? null,
      iqMovements: Number(explanation.iqMovements) || 0, pay0Movements: Number(explanation.pay0Movements) || 0,
      unexplainedIqCount: Number(explanation.unexplainedIqCount) || 0, unmatchedPay0Count: Number(explanation.unmatchedPay0Count) || 0,
      unexplainedIq: Array.isArray(explanation.unexplainedIq) ? explanation.unexplainedIq : [],
      unmatchedPay0: Array.isArray(explanation.unmatchedPay0) ? explanation.unmatchedPay0 : [],
    } : null,
    checkedAt: data.checkedAt?.toMillis?.() ?? null,
  };
}

/**
 * Latest IQ vs PAY0 comparison. Superadmin sees the whole root and may filter by socio; an admin
 * (socio) only ever receives the rows of their own clients, whatever the request asks for.
 */
export const getIqBalanceComparison = onCall({ cors: true, region: "us-central1", timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin"], requiredModule: "wallet", requiredAction: "saldos" });
  const role = getUserRole(user);
  const rootId = text(user?.rootId) || uid;
  const state = (await db.doc(`${STATE}/${rootId}`).get()).data();
  if (!state?.lastRunId) return { ok: true, run: null, rows: [], owners: [], isSuperadmin: role === "superadmin" };

  const snap = await db.collection(SNAPSHOTS).where("rootId", "==", rootId).where("runId", "==", text(state.lastRunId)).get();
  const all = snap.docs.filter(doc => doc.data().rootId === rootId);
  const requested = text(request.data?.ownerId);
  const visible = role === "superadmin"
    ? all.filter(doc => !requested || (requested === NO_OWNER ? !text(doc.data().ownerAdminId) : text(doc.data().ownerAdminId) === requested))
    : all.filter(doc => text(doc.data().ownerAdminId) === uid);

  const ownerIds = [...new Set(all.map(doc => text(doc.data().ownerAdminId)).filter(Boolean))];
  const labels = new Map<string, string>();
  if (role === "superadmin" && ownerIds.length) {
    for (const doc of await db.getAll(...ownerIds.map(id => db.doc(`users/${id}`)))) {
      const data = doc.data() || {};
      if (text(data.rootId || doc.id) === rootId) labels.set(doc.id, text(data.username || data.displayName || data.name) || "Usuario");
    }
  }
  const rows = visible.map(doc => rowDto(doc.id, doc.data(), role === "superadmin" ? labels.get(text(doc.data().ownerAdminId)) || null : null))
    .sort((a, b) => (a.status === b.status ? Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0) : ["DIFFERENT", "UNMAPPED", "MATCH"].indexOf(a.status) - ["DIFFERENT", "UNMAPPED", "MATCH"].indexOf(b.status)));
  const owners = role === "superadmin"
    ? [...[...labels].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
       ...(all.some(doc => !text(doc.data().ownerAdminId)) ? [{ id: NO_OWNER, label: "Sin socio asignado" }] : [])]
    : [];
  const count = (status: string) => rows.filter(row => row.status === status).length;
  return {
    ok: true,
    isSuperadmin: role === "superadmin",
    run: { day: text(state.lastRunDay), ranAt: state.lastRunAt?.toMillis?.() ?? null, complete: state.complete === true,
      counts: { match: count("MATCH"), different: count("DIFFERENT"), unmapped: count("UNMAPPED") } },
    rows,
    owners,
  };
});
