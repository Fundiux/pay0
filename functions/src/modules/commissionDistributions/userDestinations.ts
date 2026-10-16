import { isPostedCommissionPayment } from "./domain";
import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { calculateUserCommissionDestinations, canonicalUserCommission, evaluateIqLink, validateUserCommissionDestinations } from "./domain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const timestamp = admin.firestore.FieldValue.serverTimestamp;
const text = (value: unknown) => String(value ?? "").trim();
export const commissionSettingsId = (rootId: string, clientId: string, ownerUid: string) => createHash("sha256").update(JSON.stringify([rootId, clientId, ownerUid])).digest("hex");
export const commissionMillis = (value: any): number => typeof value?.toMillis === "function" ? value.toMillis() : Number(value?.seconds || 0) * 1000;
function id(value: unknown, field: string) { const result = text(value); if (!result || result.includes("/") || result.length > 200) throw new HttpsError("invalid-argument", `${field} requerido.`); return result; }

export async function commissionAccountActor(request: any, superadminOnly = false) {
  const uid = text(request.auth?.uid);
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const user = (await db.doc(`users/${uid}`).get()).data() || {};
  assertAuthorized(request.auth, user, { allowedRoles: superadminOnly ? ["superadmin"] : ["superadmin", "admin", "operador"] });
  return { uid, rootId: text(user.rootId || uid), role: text(user.role).toLowerCase() };
}

export function assertCommissionWithdrawalOwner(ownerUid: string, user: any, rootId: string) {
  if (!user || text(user.rootId || ownerUid) !== rootId || user.disabled === true || user.deleted === true || user.deletedAt) throw new HttpsError("permission-denied", "Titular inactivo o fuera de alcance.");
  return assertAuthorized({ uid: ownerUid }, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones" });
}

export function assertOwnedCommissionInstrument(method: any, beneficiary: any, input: { rootId: string; clientId: string; ownerUid: string; beneficiaryId: string; now?: number }, requireOwner = true) {
  if (!method || !beneficiary || method.active === false || beneficiary.active === false || text(method.rootId) !== input.rootId || text(beneficiary.rootId) !== input.rootId || text(method.clientId || method.clienteId) !== input.clientId || text(beneficiary.clientId || beneficiary.clienteId) !== input.clientId || text(method.beneficiaryId) !== input.beneficiaryId) throw new HttpsError("failed-precondition", "Instrumento fuera del cliente, raíz o beneficiario autorizados.");
  if (requireOwner && text(method.commissionOwnerUid) !== input.ownerUid) throw new HttpsError("permission-denied", "La cuenta no está asignada a este usuario.");
  const link = evaluateIqLink({ status: method.iqLinkStatus, verifiedAtMs: commissionMillis(method.iqVerifiedAt), nowMs: input.now ?? Date.now(), maxAgeMs: 86400000, storedLast4: method.iqInstrumentLast4, currentLast4: method.last4 });
  if (!link.ready || !text(method.iqBeneficiaryId) || !text(method.iqAccountId) || !text(method.last4)) throw new HttpsError("failed-precondition", `Cuenta bloqueada: ${link.reasons.join(", ") || "identificadores IQ incompletos"}.`);
}

/** Entitlement is an audited contractual reference, never a credit to the USER ledger. */
export const configureUserCommissionEntitlement = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = id(request.data?.clientId, "Cliente"), ownerUid = id(request.data?.ownerUid, "Usuario");
  const referencePaymentId = id(request.data?.referencePaymentId, "Pago contabilizado de referencia");
  const methodIds: string[] = Array.isArray(request.data?.methodIds) ? request.data.methodIds.map((value: unknown) => id(value, "Instrumento")) : [];
  if (!methodIds.length || methodIds.length > 50 || new Set(methodIds).size !== methodIds.length) throw new HttpsError("invalid-argument", "Asigna de 1 a 50 instrumentos distintos.");
  const key = commissionSettingsId(actor.rootId, clientId, ownerUid), ref = db.doc(`commissionUserEntitlements/${key}`);
  const version = await db.runTransaction(async tx => {
    const [client, owner, previous, payment] = await Promise.all([tx.get(db.doc(`clients/${clientId}`)), tx.get(db.doc(`users/${ownerUid}`)), tx.get(ref), tx.get(db.doc(`pagos/${referencePaymentId}`))]);
    const ownerData = owner.data() || {};
    if (text(client.data()?.rootId) !== actor.rootId || !owner.exists || text(ownerData.rootId || ownerUid) !== actor.rootId || ownerData.isDeleted === true || ownerData.active === false || ownerData.isActive === false) throw new HttpsError("permission-denied", "Cliente o usuario fuera de alcance.");
    const paymentData = payment.data();
    if (!paymentData || paymentData.rootId !== actor.rootId || text(paymentData.clienteId || paymentData.clientId) !== clientId || !isPostedCommissionPayment(paymentData)) throw new HttpsError("failed-precondition", "El pago de referencia debe estar conciliado y contabilizado para este cliente.");
    const financialSnapshotId = id(paymentData.financialSnapshotId, "Snapshot financiero");
    const snapshot = (await tx.get(db.doc(`paymentFinancialSnapshots/${financialSnapshotId}`))).data();
    if (!snapshot || snapshot.rootId !== actor.rootId || snapshot.pagoId !== referencePaymentId || snapshot.clienteId !== clientId) throw new HttpsError("failed-precondition", "Snapshot financiero fuera de alcance.");
    let earning;
    try { earning = canonicalUserCommission(snapshot, ownerUid); } catch (error: any) { throw new HttpsError("failed-precondition", error.message); }
    if (earning.earnedMinor <= 0) throw new HttpsError("failed-precondition", "El usuario no tiene utilidad en el pago de referencia.");
    const methods = await Promise.all(methodIds.map(methodId => tx.get(db.doc(`clientBeneficiaryMethods/${methodId}`))));
    const beneficiaries = await Promise.all(methods.map(method => tx.get(db.doc(`clientBeneficiaries/${id(method.data()?.beneficiaryId, "Beneficiario")}`))));
    methods.forEach((method, index) => {
      const data = method.data();
      assertOwnedCommissionInstrument(data, beneficiaries[index].data(), { ...actor, clientId, ownerUid, beneficiaryId: beneficiaries[index].id }, false);
      if (text(data?.commissionOwnerUid) && text(data?.commissionOwnerUid) !== ownerUid) throw new HttpsError("failed-precondition", "Una cuenta ya pertenece a otro usuario; no puede reasignarse con este flujo.");
    });
    const previousVersion = Number(previous.data()?.version || 0);
    if (Number(request.data?.expectedVersion || 0) !== previousVersion) throw new HttpsError("aborted", "La asignación cambió. Recarga antes de guardar.");
    const nextVersion = previousVersion + 1;
    const payload = { rootId: actor.rootId, clientId, ownerUid, contractRateBps: earning.contractRateBps, calculationBaseType: earning.calculationBaseType, referencePaymentId, financialSnapshotId, active: request.data?.active === true, allowedMethodIds: methodIds, version: nextVersion, effectiveFrom: timestamp(), updatedBy: actor.uid, updatedAt: timestamp() };
    tx.set(ref, payload);
    tx.create(db.doc(`commissionUserEntitlementHistory/${key}__v${nextVersion}`), { ...payload, configurationId: key });
    methods.forEach(method => tx.update(method.ref, { commissionOwnerUid: ownerUid, commissionOwnerAssignedBy: actor.uid, commissionOwnerAssignedAt: timestamp() }));
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId: actor.rootId, clientId, ownerUid, actorUid: actor.uid, event: "USER_COMMISSION_ENTITLEMENT_SAVED", version: nextVersion, createdAt: timestamp() });
    return nextVersion;
  });
  return { ok: true, version };
});

async function prepareUserDestinations(request: any, actor: Awaited<ReturnType<typeof commissionAccountActor>>, tx?: FirebaseFirestore.Transaction) {
  if (request.data?.ownerUid && text(request.data.ownerUid) !== actor.uid) throw new HttpsError("permission-denied", "Sólo puedes configurar tus propios destinos.");
  const clientId = id(request.data?.clientId, "Cliente"), key = commissionSettingsId(actor.rootId, clientId, actor.uid);
  const read = (ref: FirebaseFirestore.DocumentReference) => tx ? tx.get(ref) : ref.get();
  const entitlement = (await read(db.doc(`commissionUserEntitlements/${key}`))).data();
  if (!entitlement || entitlement.active !== true || entitlement.ownerUid !== actor.uid || entitlement.rootId !== actor.rootId) throw new HttpsError("failed-precondition", "No tienes una asignación de comisión activa para este cliente.");
  let validated;
  try { validated = validateUserCommissionDestinations(Number(entitlement.contractRateBps || 0), request.data?.distributionMode, request.data?.destinations); }
  catch (error: any) { throw new HttpsError("invalid-argument", error.message); }
  const rows = [];
  for (const destination of validated.destinations) {
    if (!entitlement.allowedMethodIds?.includes(destination.methodId)) throw new HttpsError("permission-denied", "Instrumento no asignado a tu comisión.");
    const [method, beneficiary] = await Promise.all([read(db.doc(`clientBeneficiaryMethods/${destination.methodId}`)), read(db.doc(`clientBeneficiaries/${destination.beneficiaryId}`))]);
    assertOwnedCommissionInstrument(method.data(), beneficiary.data(), { rootId: actor.rootId, clientId, ownerUid: actor.uid, beneficiaryId: destination.beneficiaryId });
    rows.push({ ...destination, beneficiaryName: text(beneficiary.data()?.nombre), instrumentMasked: text(method.data()?.masked), bankName: text(method.data()?.bankName) });
  }
  return { key, clientId, entitlement, validated, rows };
}

export const previewMyCommissionDestinations = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request);
  const prepared = await prepareUserDestinations(request, actor);
  const earnedMinor = Number(request.data?.earnedMinor);
  if (!Number.isSafeInteger(earnedMinor) || earnedMinor <= 0) throw new HttpsError("invalid-argument", "Indica una comisión de ejemplo positiva en centavos.");
  const calculation = calculateUserCommissionDestinations(earnedMinor, prepared.validated.contractRateBps, prepared.validated.distributionMode, prepared.validated.destinations);
  return { ok: true, exampleOnly: true, ...calculation, destinations: calculation.destinations.map((row, index) => ({ ...prepared.rows[index], ...row })) };
});

export const saveMyCommissionDestinations = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request);
  const result = await db.runTransaction(async tx => {
    const prepared = await prepareUserDestinations(request, actor, tx);
    const ref = db.doc(`commissionUserDestinationRules/${prepared.key}`), previous = await tx.get(ref);
    if (Number(request.data?.expectedVersion || 0) !== Number(previous.data()?.version || 0)) throw new HttpsError("aborted", "Tus destinos cambiaron. Recarga antes de guardar.");
    const version = Number(previous.data()?.version || 0) + 1;
    const payload = { rootId: actor.rootId, ownerUid: actor.uid, clientId: prepared.clientId, ...prepared.validated, entitlementVersion: prepared.entitlement.version, version, effectiveFrom: timestamp(), updatedAt: timestamp(), updatedBy: actor.uid };
    tx.set(ref, payload);
    tx.create(db.doc(`commissionUserDestinationHistory/${prepared.key}__v${version}`), { ...payload, configurationId: prepared.key });
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId: actor.rootId, clientId: prepared.clientId, ownerUid: actor.uid, actorUid: actor.uid, event: "USER_COMMISSION_DESTINATIONS_SAVED", version, createdAt: timestamp() });
    return { ok: true, version };
  });
  return result;
});

export const getMyCommissionSettings = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request);
  const ownerUid = text(request.data?.ownerUid) || actor.uid;
  if (ownerUid !== actor.uid && actor.role !== "superadmin") throw new HttpsError("permission-denied", "Sólo puedes consultar tus comisiones.");
  const target = (await db.doc(`users/${id(ownerUid, "Usuario")}`).get()).data();
  if (!target || text(target.rootId || ownerUid) !== actor.rootId) throw new HttpsError("permission-denied", "Usuario fuera de alcance.");
  const entitlements = await db.collection("commissionUserEntitlements").where("ownerUid", "==", ownerUid).limit(500).get();
  const configurations = [];
  for (const doc of entitlements.docs) {
    const entitlement = doc.data();
    if (entitlement.rootId !== actor.rootId) continue;
    const [rule, client] = await Promise.all([db.doc(`commissionUserDestinationRules/${doc.id}`).get(), db.doc(`clients/${entitlement.clientId}`).get()]);
    const instruments = [];
    for (const methodId of entitlement.allowedMethodIds || []) {
      const method = (await db.doc(`clientBeneficiaryMethods/${methodId}`).get()).data();
      if (!method || method.commissionOwnerUid !== ownerUid || method.rootId !== actor.rootId || text(method.clientId || method.clienteId) !== entitlement.clientId) continue;
      const beneficiary = (await db.doc(`clientBeneficiaries/${method.beneficiaryId}`).get()).data();
      let blockedReason: string | null = null;
      try { assertOwnedCommissionInstrument(method, beneficiary, { rootId: actor.rootId, clientId: entitlement.clientId, ownerUid, beneficiaryId: method.beneficiaryId }); }
      catch (error: any) { blockedReason = error.message; }
      instruments.push({ methodId, beneficiaryId: method.beneficiaryId, beneficiaryName: text(beneficiary?.nombre), instrumentMasked: text(method.masked), bankName: text(method.bankName), iqLinkStatus: text(method.iqLinkStatus || "PENDING"), blockedReason });
    }
    configurations.push({ clientId: entitlement.clientId, clientName: text(client.data()?.nombre || client.data()?.razonSocial || entitlement.clientId), ownerUid, contractRateBps: entitlement.contractRateBps, entitlementVersion: entitlement.version, active: entitlement.active === true, instruments, rule: rule.exists ? { distributionMode: rule.data()?.distributionMode, destinations: rule.data()?.destinations, version: rule.data()?.version, effectiveFrom: commissionMillis(rule.data()?.effectiveFrom) } : null });
  }
  const history = await db.collection("commissionDistributions").where("ownerUid", "==", ownerUid).limit(500).get();
  return { ok: true, ownerUid, configurations, history: await Promise.all(history.docs.filter(doc => doc.data().rootId === actor.rootId).map(async doc => { const row = doc.data(); const request = (await db.doc(`commissionDispersionRequests/${doc.id}`).get()).data(); return { distributionId: doc.id, clientId: row.clientId, requestId: request ? doc.id : null, requestStatus: request?.status || null, totalDebitMinor: request?.totalDebitMinor || null, paymentId: row.paymentId, pay0Folio: row.pay0Folio, operationalDate: row.operationalDate, status: row.status, totalAmountMinor: row.totalCommissionMinor, ruleVersion: row.userRuleVersion, distributionMode: row.distributionMode, legs: (row.legs || []).map((leg: any) => ({ amountMinor: leg.amountMinor, instrumentMasked: leg.instrumentMasked, beneficiaryName: leg.beneficiaryName, status: leg.status, errorCode: leg.errorCode || null })) }; })) };
});

/** Resolve configuration at posting time, never rewrite historical earnings after a change. */
export async function commissionConfigurationAt(collection: string, history: string, key: string, atMs: number) {
  const current = (await db.doc(`${collection}/${key}`).get()).data();
  if (!current) return null;
  if (commissionMillis(current.effectiveFrom) <= atMs) return current;
  const rows = await db.collection(history).where("configurationId", "==", key).limit(500).get();
  return rows.docs.map(doc => doc.data()).filter(row => commissionMillis(row.effectiveFrom) <= atMs).sort((a, b) => Number(b.version) - Number(a.version))[0] || null;
}
