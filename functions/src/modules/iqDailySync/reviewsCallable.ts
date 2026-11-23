import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";

import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { iqIdentityForPay0UserId } from "../iq/iqPay0Identity";
import { groupLabel, kindLabel, reasonEs, type ReviewDisplay } from "./reviewDisplay";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const text = (value: unknown) => String(value ?? "").trim();
const MAX_ROWS = 500;

/** What the page shows: kind, client, amount, date, partner and the reason in Spanish. No document ids or UIDs. */
function rowDto(data: Record<string, any>) {
  const display = (data.evidence?.display && typeof data.evidence.display === "object" ? data.evidence.display : null) as Partial<ReviewDisplay> | null;
  const code = text(data.code);
  const entityType = text(data.entityType);
  const amount = typeof display?.amount === "number" ? display.amount : typeof data.evidence?.amount === "number" ? data.evidence.amount : null;
  return {
    kind: display?.kind || kindLabel(entityType),
    clientName: display?.clientName || null,
    rfc: display?.rfc || null,
    beneficiaryName: display?.beneficiaryName || null,
    bank: display?.bank || null,
    amount,
    currency: display?.currency || null,
    date: display?.date || text(data.evidence?.date) || null,
    // The number IQ itself shows for the operation: it is what the team searches for in IQ.
    iqNumber: text(data.iqEntityId),
    partner: groupLabel(text(data.canonicalGroupId)),
    reason: reasonEs(code, display as ReviewDisplay | null),
    detailKnown: !!display,
    openedAt: data.openedAt?.toMillis?.() ?? null,
    seenCount: Number(data.seenCount) || 1,
  };
}

/**
 * Open operations of the daily IQ sync that were not brought into PAY0, in plain language.
 * Superadmin sees every partner; an admin (partner) only the operations of their own IQ group.
 */
export const listIqDailySyncReviews = onCall({ cors: true, region: "us-central1", timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin"], requiredModule: "wallet", requiredAction: "saldos" });
  const role = getUserRole(user);
  const rootId = text(user?.rootId) || uid;
  const ownGroup = role === "admin" ? iqIdentityForPay0UserId(uid)?.canonicalIqGroupId || "__NONE__" : null;

  const snap = await db.collection("iqDailySyncReviews").where("rootId", "==", rootId).where("status", "==", "OPEN").limit(MAX_ROWS).get();
  const docs = snap.docs.filter((doc) => !ownGroup || text(doc.get("canonicalGroupId")) === ownGroup);
  const rows = docs.map((doc) => rowDto(doc.data()));
  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || a.kind.localeCompare(b.kind, "es"));
  return { ok: true, truncated: snap.size >= MAX_ROWS, isSuperadmin: role === "superadmin", rows };
});
