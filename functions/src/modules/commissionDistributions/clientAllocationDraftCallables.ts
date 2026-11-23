import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { commissionAccountActor, commissionMillis, commissionSettingsId } from "./userDestinations";
import { calculateClientCommissionInstructions } from "./clientAllocation";
import { canonicalUserCommission, evaluateIqLink, isPostedCommissionPayment } from "./domain";
import { postedClientOperationBaseMinor } from "./postedClientAllocationPreview";
import type { ClientCommissionInstruction } from "./clientAllocation";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const id = (value: unknown) => {
  const result = String(value || "").trim();
  if (!result || result.length > 128 || result.includes("/")) throw new HttpsError("invalid-argument", "Identificador inválido.");
  return result;
};
const parseRows = (value: unknown): ClientCommissionInstruction[] => {
  if (!Array.isArray(value) || value.length > 50) throw new HttpsError("invalid-argument", "Máximo 50 filas.");
  return value.map(row => {
    if (!row || typeof row !== "object") throw new HttpsError("invalid-argument", "Fila inválida.");
    const accountId = row.accountId ? id(row.accountId) : "";
    const pointsBps = row.pointsBps == null ? null : row.pointsBps;
    const earningsPercentBps = row.earningsPercentBps == null ? null : row.earningsPercentBps;
    for (const rate of [pointsBps, earningsPercentBps]) {
      if (rate !== null && (typeof rate !== "number" || !Number.isSafeInteger(rate) || rate < 0 || rate > 10000)) {
        throw new HttpsError("invalid-argument", "Tasa fuera de rango.");
      }
    }
    return { accountId, pointsBps, earningsPercentBps };
  });
};
/** Draft-only endpoint: no activation, balance mutation or IQ submission. */
export const saveClientCommissionAllocationDraft = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = id(request.data?.clientId);
  const ownerUid = id(request.data?.ownerUid);
  const instructions = parseRows(request.data?.instructions);
  const key = commissionSettingsId(actor.rootId, clientId, ownerUid);
  const ref = db.doc(`clientCommissionAllocationDrafts/${key}`);
  const version = await db.runTransaction(async tx => {
    const [client, owner, previous] = await Promise.all([
      tx.get(db.doc(`clients/${clientId}`)), tx.get(db.doc(`users/${ownerUid}`)), tx.get(ref),
    ]);
    const user = owner.data() || {};
    if (client.data()?.rootId !== actor.rootId || !owner.exists ||
      String(user.rootId || ownerUid) !== actor.rootId ||
      user.active === false || user.isActive === false || user.isDeleted === true || user.disabled === true || user.deleted === true || !!user.deletedAt) {
      throw new HttpsError("permission-denied", "Cliente o participante fuera de alcance.");
    }
    const selectedIds = [...new Set(instructions.map(row => row.accountId).filter(Boolean))];
    const selectedAccounts = await Promise.all(selectedIds.map(accountId =>
      tx.get(db.doc(`personalCommissionAccounts/${accountId}`))));
    for (const selected of selectedAccounts) {
      const data = selected.data();
      if (!data || data.rootId !== actor.rootId || data.ownerUid !== ownerUid) {
        throw new HttpsError("permission-denied", "Cuenta seleccionada fuera del usuario u organización.");
      }
    }
    // Never allow a deactivated account to be newly referenced by a draft.
    // Existing historical drafts remain readable, but cannot be resaved with revoked accounts.
    for (const selected of selectedAccounts) {
      if (selected.data()?.active !== true) {
        throw new HttpsError("failed-precondition", "Una cuenta fue desactivada. Retírala del borrador.");
      }
    }
    // A draft may be incomplete, but complete rows must not contradict each other.
    const seen = new Set<string>();
    for (const row of instructions) {
      if (!row.accountId) continue;
      const hasPoints = row.pointsBps != null;
      const hasPercent = row.earningsPercentBps != null;
      if (hasPoints && hasPercent) throw new HttpsError("invalid-argument", "Una fila no puede combinar puntos y porcentaje.");
      if (!hasPoints && !hasPercent) continue;
      const mode = hasPoints ? "points" : "earnings";
      const key = JSON.stringify([row.accountId, mode]);
      if (seen.has(key)) throw new HttpsError("invalid-argument", "Cuenta y modalidad duplicadas.");
      seen.add(key);
    }
    // Never store an active configuration in the draft collection.
    // A blank account/rate is permitted only while drafting.
    for (const row of instructions) {
      if (row.accountId && row.pointsBps != null && row.earningsPercentBps != null) {
        throw new HttpsError("invalid-argument", "Una fila no puede usar ambas modalidades.");
      }
      if ((row.pointsBps != null && row.pointsBps === 0) ||
          (row.earningsPercentBps != null && row.earningsPercentBps === 0)) {
        throw new HttpsError("invalid-argument", "Las tasas definidas deben ser positivas.");
      }
    }
    const oldVersion = Number(previous.data()?.version || 0);
    if (request.data?.expectedVersion !== oldVersion) throw new HttpsError("aborted", "El borrador cambió. Recarga antes de guardar.");
    const nextVersion = oldVersion + 1;
    tx.set(ref, { rootId: actor.rootId, clientId, ownerUid, instructions, status: "DRAFT",
      version: nextVersion, updatedBy: actor.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.create(db.doc(`clientCommissionAllocationDraftHistory/${key}__v${nextVersion}`),
      { rootId: actor.rootId, clientId, ownerUid, instructions, status: "DRAFT", version: nextVersion,
        updatedBy: actor.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return nextVersion;
  });
  return { ok: true, status: "DRAFT", canExecute: false, version };
});
export const getClientCommissionAllocationDraft = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = id(request.data?.clientId), ownerUid = id(request.data?.ownerUid);
  const [client, owner] = await Promise.all([db.doc(`clients/${clientId}`).get(), db.doc(`users/${ownerUid}`).get()]);
  if (client.data()?.rootId !== actor.rootId || !owner.exists || String(owner.data()?.rootId || ownerUid) !== actor.rootId || owner.data()?.active === false || owner.data()?.isActive === false || owner.data()?.isDeleted === true || owner.data()?.disabled === true || owner.data()?.deleted === true || !!owner.data()?.deletedAt) {
    throw new HttpsError("permission-denied", "Cliente o participante fuera de alcance.");
  }
  const doc = await db.doc(`clientCommissionAllocationDrafts/${commissionSettingsId(actor.rootId, clientId, ownerUid)}`).get();
  const data = doc.data();
  return { ok: true, draft: data ? { clientId, ownerUid, instructions: data.instructions || [], status: "DRAFT", version: data.version } : null };
});

/**
 * Posted-payment preview only. Does not reserve funds, change ledger balances,
 * activate a draft, create an IQ beneficiary or submit a dispersion.
 * Amounts always come from a posted immutable payment snapshot, never the browser.
 */
export const previewPostedClientCommissionAllocation = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = id(request.data?.clientId);
  const ownerUid = id(request.data?.ownerUid);
  const paymentId = id(request.data?.paymentId);
  const key = commissionSettingsId(actor.rootId, clientId, ownerUid);
  const [clientSnap, ownerSnap, paymentSnap, draftSnap] = await Promise.all([
    db.doc(`clients/${clientId}`).get(),
    db.doc(`users/${ownerUid}`).get(),
    db.doc(`pagos/${paymentId}`).get(),
    db.doc(`clientCommissionAllocationDrafts/${key}`).get(),
  ]);
  const client = clientSnap.data(), owner = ownerSnap.data(), payment = paymentSnap.data();
  if (!client || client.rootId !== actor.rootId || !owner || String(owner.rootId || ownerUid) !== actor.rootId ||
      owner.active === false || owner.isActive === false || owner.isDeleted === true || owner.disabled === true || owner.deleted === true || !!owner.deletedAt) {
    throw new HttpsError("permission-denied", "Cliente o participante fuera de alcance.");
  }
  if (!payment || payment.rootId !== actor.rootId ||
      String(payment.clienteId || payment.clientId || "") !== clientId || !isPostedCommissionPayment(payment)) {
    throw new HttpsError("failed-precondition", "Se requiere un pago contabilizado del mismo cliente.");
  }
  const financialSnapshotId = id(payment.financialSnapshotId);
  const financialSnapshot = (await db.doc(`paymentFinancialSnapshots/${financialSnapshotId}`).get()).data();
  if (!financialSnapshot || financialSnapshot.rootId !== actor.rootId ||
      financialSnapshot.pagoId !== paymentId || financialSnapshot.clienteId !== clientId) {
    throw new HttpsError("failed-precondition", "Snapshot financiero no corresponde al pago.");
  }
  const draft = draftSnap.data();
  if (!draft || draft.rootId !== actor.rootId || draft.clientId !== clientId ||
      draft.ownerUid !== ownerUid || draft.status !== "DRAFT") {
    throw new HttpsError("failed-precondition", "No hay borrador válido para esta combinación.");
  }
  const instructions = parseRows(draft.instructions);
  if (!instructions.length) throw new HttpsError("failed-precondition", "Completa las filas del borrador.");
  const selectedIds = [...new Set(instructions.map(row => row.accountId))];
  if (selectedIds.some(accountId => !accountId)) {
    throw new HttpsError("failed-precondition", "Selecciona una cuenta en todas las filas.");
  }
  const accountSnaps = await Promise.all(selectedIds.map(accountId =>
    db.doc(`personalCommissionAccounts/${accountId}`).get()));
  const accounts = accountSnaps.map(accountSnap => {
    const data = accountSnap.data();
    if (!data || data.rootId !== actor.rootId || data.ownerUid !== ownerUid || data.active !== true) {
      throw new HttpsError("failed-precondition", "Una cuenta fue eliminada, desactivada o está fuera de alcance.");
    }
    return { id: accountSnap.id, ...data };
  });
  let earning: ReturnType<typeof canonicalUserCommission>;
  try { earning = canonicalUserCommission(financialSnapshot, ownerUid); }
  catch (error: any) { throw new HttpsError("failed-precondition", error.message || "No hay utilidad contabilizada para el usuario."); }
  if (earning.earnedMinor <= 0) throw new HttpsError("failed-precondition", "No hay utilidad positiva en este pago.");
  const operationBaseMinor = postedClientOperationBaseMinor(financialSnapshot, earning.calculationBaseType);
  let calculated;
  try {
    calculated = calculateClientCommissionInstructions({
      earnedMinor: earning.earnedMinor,
      operationBaseMinor,
      contractRateBps: earning.contractRateBps,
      instructions,
    });
  } catch (error: any) {
    throw new HttpsError("failed-precondition", error.message || "La asignación excede la utilidad contabilizada.");
  }
  const now = Date.now();
  const clientIqId = String(client.iqLink?.clientId || client.iqClientId || "");
  const blockedIqAccountIds = accounts.filter(account => {
    const link = evaluateIqLink({
      status: account.iqLinkStatus,
      verifiedAtMs: commissionMillis(account.iqVerifiedAt),
      nowMs: now,
      maxAgeMs: 86400000,
      storedLast4: account.iqInstrumentLast4,
      currentLast4: account.last4,
    });
    return !link.ready || account.iqFullDigitsMatched !== true || !account.iqBeneficiaryId ||
      !account.iqAccountId || !clientIqId || String(account.iqClientId || "") !== clientIqId;
  }).map(account => account.id);
  return {
    ok: true,
    simulationOnly: true,
    canSubmitToIq: false,
    canReserveFunds: false,
    clientId, ownerUid, paymentId, financialSnapshotId,
    draftVersion: draft.version,
    currency: String(payment.moneda || financialSnapshot.currency || "MXN"),
    earnedMinor: calculated.earnedMinor,
    distributedMinor: calculated.distributedMinor,
    remainingMinor: calculated.remainingMinor,
    rows: calculated.instructions.map(row => ({ accountId: row.accountId, amountMinor: row.amountMinor })),
    blockedIqAccountIds,
  };
});
