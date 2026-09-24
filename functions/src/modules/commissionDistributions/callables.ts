import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { validateCommissionRule } from "./domain";
import { materializeCommissionDistribution, preflightCommissionDistribution } from "./service";
import { requireClientOperationalAccess } from "../clientDelegations/access";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const text = (value: unknown) => String(value ?? "").trim();

async function auth(request: any, action: "view" | "configure" = "view") {
  const uid = text(request.auth?.uid);
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
  const user: any = snap.data() || {};
  const role = text(user.role).toLowerCase();
  assertAuthorized(request.auth, user, {
    allowedRoles: action === "configure" ? ["superadmin", "admin"] : ["superadmin", "admin", "operador"],
    requiredModule: action === "configure" ? "wallet" : "reportes",
    requiredAction: action === "configure" ? "beneficiarios" : "view",
  });
  return { uid, user, role, rootId: text(user.rootId || uid) };
}

function toIso(value: any): string | null {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export const getClientCommissionRule = onCall({ cors: true }, async (request) => {
  const actor = await auth(request);
  const clientId = text(request.data?.clientId);
  if (!clientId) throw new HttpsError("invalid-argument", "clientId es obligatorio.");
  const [clientSnap, ruleSnap] = await Promise.all([db.doc(`clients/${clientId}`).get(), db.doc(`clientCommissionRules/${clientId}`).get()]);
  if (!clientSnap.exists || text(clientSnap.data()?.rootId) !== actor.rootId) throw new HttpsError("permission-denied", "Cliente fuera de alcance.");
  await requireClientOperationalAccess({ uid: actor.uid, role: actor.role as any, rootId: actor.rootId, clientId, permission: "view" });
  const rule: any = ruleSnap.data() || null;
  return { ok: true, rule: rule ? { ...rule, effectiveFrom: toIso(rule.effectiveFrom), createdAt: toIso(rule.createdAt), updatedAt: toIso(rule.updatedAt) } : null };
});

export const saveClientCommissionRule = onCall({ cors: true }, async (request) => {
  const actor = await auth(request, "configure");
  const clientId = text(request.data?.clientId);
  if (!clientId) throw new HttpsError("invalid-argument", "clientId es obligatorio.");
  let validated;
  try {
    validated = validateCommissionRule({ totalRateBps: Number(request.data?.totalRateBps), legs: request.data?.legs || [] });
  } catch (error: any) {
    throw new HttpsError("invalid-argument", error?.message || "Regla de comisión inválida.");
  }
  const clientSnap = await db.doc(`clients/${clientId}`).get();
  if (!clientSnap.exists || text(clientSnap.data()?.rootId) !== actor.rootId) throw new HttpsError("permission-denied", "Cliente fuera de alcance.");
  await requireClientOperationalAccess({ uid: actor.uid, role: actor.role as any, rootId: actor.rootId, clientId, permission: "operateBeneficiarios" });
  const refs = validated.legs.flatMap((leg) => [db.doc(`clientBeneficiaries/${leg.beneficiaryId}`), db.doc(`clientBeneficiaryMethods/${leg.methodId}`)]);
  const snaps = await db.getAll(...refs);
  for (let index = 0; index < validated.legs.length; index += 1) {
    const beneficiary: any = snaps[index * 2]?.data() || {};
    const method: any = snaps[index * 2 + 1]?.data() || {};
    if (!snaps[index * 2]?.exists || !snaps[index * 2 + 1]?.exists || text(beneficiary.rootId) !== actor.rootId || text(method.rootId) !== actor.rootId || text(method.beneficiaryId) !== validated.legs[index].beneficiaryId || method.active === false) {
      throw new HttpsError("failed-precondition", `El destino ${validated.legs[index].alias} no conserva un beneficiario/instrumento activo y coherente.`);
    }
  }
  const ref = db.doc(`clientCommissionRules/${clientId}`);
  const previous = await ref.get();
  const version = Number(previous.data()?.version || 0) + 1;
  const payload = {
    rootId: actor.rootId, clientId, totalRateBps: validated.totalRateBps, legs: validated.legs,
    active: request.data?.active === true, automationEnabled: request.data?.automationEnabled === true,
    version, effectiveFrom: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
    ...(previous.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }),
  };
  const batch = db.batch();
  batch.set(ref, payload, { merge: true });
  batch.set(db.collection("commissionRuleHistory").doc(`${clientId}__v${version}`), { ...payload, archivedAt: FieldValue.serverTimestamp() });
  batch.set(db.collection("commissionAuditEvents").doc(), { rootId: actor.rootId, clientId, ruleVersion: version, event: "COMMISSION_RULE_SAVED", actorUid: actor.uid, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { ok: true, clientId, version };
});

export const previewPaymentCommissionDistribution = onCall({ cors: true }, async (request) => {
  const actor = await auth(request);
  try {
    return await materializeCommissionDistribution({ paymentId: text(request.data?.paymentId), actorUid: actor.uid, dryRun: true });
  } catch (error: any) {
    throw new HttpsError("failed-precondition", error?.message || "No se pudo calcular la distribución.");
  }
});

export const processPaymentCommissionDistribution = onCall({ cors: true }, async (request) => {
  const actor = await auth(request, "configure");
  try {
    return await materializeCommissionDistribution({ paymentId: text(request.data?.paymentId), actorUid: actor.uid });
  } catch (error: any) {
    throw new HttpsError("failed-precondition", error?.message || "No se pudo crear la distribución.");
  }
});

export const preflightPaymentCommissionDistribution = onCall({ cors: true, timeoutSeconds: 60 }, async (request) => {
  const actor = await auth(request, "configure");
  const distributionId = text(request.data?.distributionId);
  if (!distributionId) throw new HttpsError("invalid-argument", "distributionId es obligatorio.");
  const distributionSnap = await db.doc(`commissionDistributions/${distributionId}`).get();
  const distribution: any = distributionSnap.data() || {};
  if (!distributionSnap.exists || text(distribution.rootId) !== actor.rootId) throw new HttpsError("permission-denied", "Distribución fuera de alcance.");
  await requireClientOperationalAccess({ uid: actor.uid, role: actor.role as any, rootId: actor.rootId, clientId: text(distribution.clientId), permission: "operateDispersiones" });
  try { return await preflightCommissionDistribution({ distributionId, actorUid: actor.uid }); }
  catch (error: any) { throw new HttpsError("failed-precondition", error?.message || "No se pudo completar el preflight."); }
});

export const getCommissionDistributionsReport = onCall({ cors: true, timeoutSeconds: 60 }, async (request) => {
  const actor = await auth(request);
  const from = text(request.data?.dateFrom);
  const to = text(request.data?.dateTo);
  const commissioner = text(request.data?.commissioner).toUpperCase();
  const clientId = text(request.data?.clientId);
  const status = text(request.data?.status).toUpperCase();
  const snap = await db.collection("commissionDistributions").where("rootId", "==", actor.rootId).limit(5000).get();
  const rows: any[] = [];
  for (const doc of snap.docs) {
    const data: any = doc.data() || {};
    if (actor.role === "admin" && text(data.adminId) !== actor.uid) continue;
    if (actor.role === "operador" && ![data.operadorId, data.createdBy].map(text).includes(actor.uid)) continue;
    if (from && text(data.operationalDate) < from) continue;
    if (to && text(data.operationalDate) > to) continue;
    if (clientId && text(data.clientId) !== clientId) continue;
    if (status && text(data.status).toUpperCase() !== status) continue;
    for (const leg of Array.isArray(data.legs) ? data.legs : []) {
      if (commissioner && text(leg.alias).toUpperCase() !== commissioner) continue;
      rows.push({
        distributionId: doc.id, operationalDate: data.operationalDate, paymentId: data.paymentId,
        pay0Folio: data.pay0Folio, originalReference: data.originalReference, clientId: data.clientId,
        clientName: data.clientName, kind: leg.kind, commissioner: leg.alias, rateBps: leg.rateBps,
        amount: Number(leg.amount || 0), beneficiaryName: leg.beneficiaryName, instrumentMasked: leg.instrumentMasked,
        iqFolio: leg.iqFolio || null, iqOperationId: leg.iqOperationId || null, iqReceiptPath: leg.iqReceiptPath || null,
        status: leg.status, reportStatus: leg.reportStatus || "NOT_INCLUDED", deliveryStatus: leg.deliveryStatus || "DELIVERY_PENDING",
      });
    }
  }
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const baseAmount = rows.filter((row) => row.kind === "BASE").reduce((sum, row) => sum + row.amount, 0);
  return { ok: true, dateFrom: from || null, dateTo: to || null, rows, summary: { movements: new Set(rows.map((row) => row.distributionId)).size, legs: rows.length, totalAmount, baseAmount, pending: rows.filter((row) => !["CONFIRMED", "IQ_CREATED"].includes(row.status)).length, errors: rows.filter((row) => row.status === "ERROR" || row.status === "OUTCOME_UNKNOWN").length } };
});
