import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { commissionAccountActor, commissionSettingsId } from "./userDestinations";
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
      user.active === false || user.isActive === false || user.isDeleted === true || user.disabled === true) {
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
  if (client.data()?.rootId !== actor.rootId || !owner.exists || String(owner.data()?.rootId || ownerUid) !== actor.rootId || owner.data()?.active === false || owner.data()?.isActive === false || owner.data()?.isDeleted === true || owner.data()?.disabled === true) {
    throw new HttpsError("permission-denied", "Cliente o participante fuera de alcance.");
  }
  const doc = await db.doc(`clientCommissionAllocationDrafts/${commissionSettingsId(actor.rootId, clientId, ownerUid)}`).get();
  const data = doc.data();
  return { ok: true, draft: data ? { clientId, ownerUid, instructions: data.instructions || [], status: "DRAFT", version: data.version } : null };
});
