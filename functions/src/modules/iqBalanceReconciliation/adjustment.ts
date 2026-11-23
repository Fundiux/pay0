import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivityTx } from "../../utils/logActivity";
import { buildBalanceAccountPatchFromMovement, buildBalanceMovement } from "../balances/service";
import { createBalanceMovementTx, readBalanceAccountTx, upsertBalanceAccountTx } from "../balances/repository";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { opaque } from "./callables";
import { BALANCE_TOLERANCE, CONFIG, SNAPSHOTS, STATE, round2 } from "./domain";
import { AdjustmentRuleError, adjustmentLogComment, cleanReason, planBalanceAdjustment } from "./adjustmentDomain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const text = (value: unknown) => String(value ?? "").trim();

function idempotencyKeyOf(value: unknown): string {
  const key = text(value);
  if (key.length < 8 || key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new HttpsError("invalid-argument", "Clave de operación inválida.");
  return key;
}

async function requireSuperadmin(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "saldos" });
  if (getUserRole(user) !== "superadmin") throw new HttpsError("permission-denied", "Solo el superadmin puede hacer ajustes de saldo.");
  return { uid, user, rootId: text(user?.rootId) || uid, name: text(user?.username || user?.displayName || user?.name) || uid };
}

/**
 * Brings one client's PAY0 balance to its IQ balance with an exceptional manual adjustment (superadmin only, written
 * reason, internal comment in the log, switchable off). It is tied to the latest comparison row: it refuses when the
 * balance moved since, when the client already matches, and when the amount exceeds the difference.
 */
export const adjustClientBalanceFromComparison = onCall({ cors: true, region: "us-central1", timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  const { uid, rootId, name } = await requireSuperadmin(request);
  const rowKey = text(request.data?.rowKey);
  const idempotencyKey = idempotencyKeyOf(request.data?.idempotencyKey);
  if (!rowKey) throw new HttpsError("invalid-argument", "Falta el cliente a ajustar.");

  let reason: string;
  try { reason = cleanReason(request.data?.reason); } catch (error) { throw new HttpsError("invalid-argument", (error as Error).message); }

  const idempotencyRef = db.collection("operationIdempotency").doc(`adjustClientBalanceFromComparison__${uid}__${idempotencyKey}`);
  // A retry of a request that already went through returns what it did; it is never applied twice.
  const replay = await idempotencyRef.get();
  if (replay.exists && replay.get("result")) return { ok: true, ...replay.get("result") };

  const config = (await db.doc(`${CONFIG}/${rootId}`).get()).data() || {};
  if (config.adjustmentsEnabled === false) throw new HttpsError("failed-precondition", "Los ajustes excepcionales de saldo están desactivados.");

  const state = (await db.doc(`${STATE}/${rootId}`).get()).data();
  if (!state?.lastRunId) throw new HttpsError("failed-precondition", "Todavía no hay una comparación de saldos con IQ.");
  const snapshots = await db.collection(SNAPSHOTS).where("rootId", "==", rootId).where("runId", "==", text(state.lastRunId)).get();
  const snapshot = snapshots.docs.find((doc) => opaque(doc.id) === rowKey);
  if (!snapshot) throw new HttpsError("not-found", "Ese cliente ya no está en la última comparación. Actualiza la pantalla.");
  const row = snapshot.data();
  const clientId = text(row.clientId);
  if (!clientId || row.status === "UNMAPPED") throw new HttpsError("failed-precondition", "Este cliente no está vinculado a un cliente de PAY0.");

  // A client IQ does not report (or reports unreadably) has no balance to match: its 0 is not a real IQ balance.
  if (text(row.reason)) throw new HttpsError("failed-precondition", "IQ no entregó un saldo para este cliente. Revisa su vínculo con IQ antes de ajustar.");

  let plan;
  try { plan = planBalanceAdjustment({ iqBalance: row.iqBalance, pay0Balance: row.pay0Balance, amount: request.data?.amount }); }
  catch (error) { if (error instanceof AdjustmentRuleError) throw new HttpsError("failed-precondition", error.message); throw error; }

  const result = await db.runTransaction(async (tx) => {
    const stored = await tx.get(idempotencyRef);
    if (stored.exists && stored.get("result")) return stored.get("result");

    const clientSnap = await tx.get(db.doc(`clients/${clientId}`));
    if (!clientSnap.exists || text(clientSnap.get("rootId")) !== rootId) throw new HttpsError("permission-denied", "El cliente no pertenece a tu raíz.");
    const clientName = text(clientSnap.get("name") || clientSnap.get("razonSocial"));

    const { snap } = await readBalanceAccountTx(tx, db, "CLIENT", clientId);
    const current = snap.exists ? (snap.data() as any) : undefined;
    const before = round2(Number(current?.availableBalance || 0));
    if (Math.abs(before - round2(Number(row.pay0Balance))) > BALANCE_TOLERANCE) {
      throw new HttpsError("failed-precondition", "El saldo del cliente cambió desde la última comparación. Actualiza la pantalla y vuelve a revisar.");
    }

    const movementRef = db.collection("balanceMovements").doc();
    const comment = (after: number) => adjustmentLogComment({ actorName: name, clientName, direction: plan.direction, amount: plan.amount, before, after, iqBalance: round2(Number(row.iqBalance)), reason });
    const movement = buildBalanceMovement({
      rootId, holderType: "CLIENT", holderId: clientId, holderRole: null, holderName: clientName || String(current?.holderName || clientId),
      movementType: "AJUSTE_MANUAL", movementSubType: "AJUSTE_EXCEPCIONAL_MIGRACION", direction: plan.direction, amount: plan.amount, beforeBalance: before,
      sourceModule: "BALANCES", referenceType: "ADJUSTMENT", referenceId: movementRef.id, clienteId: clientId,
      displayConcept: "Ajuste excepcional de saldo", note: comment(round2(plan.direction === "IN" ? before + plan.amount : before - plan.amount)),
      createdBy: uid, actorUsername: name, isSystemGenerated: false,
    });

    createBalanceMovementTx(tx, db, movement, movementRef.id);
    upsertBalanceAccountTx(tx, db, "CLIENT", clientId, buildBalanceAccountPatchFromMovement(current, movement));

    // The comparison row follows the new balance, so the screen shows the result without waiting for tonight's run.
    const iq = round2(Number(row.iqBalance));
    const matches = Math.abs(iq - movement.afterBalance) <= BALANCE_TOLERANCE;
    tx.set(snapshot.ref, {
      pay0Balance: movement.afterBalance, difference: round2(movement.afterBalance - iq), status: matches ? "MATCH" : "DIFFERENT",
      adjustment: { movementId: movementRef.id, amount: plan.amount, direction: plan.direction, by: uid, byName: name, at: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    logActivityTx(tx, db, {
      event: "AJUSTE_MANUAL_APLICADO", rootId, actorUid: uid, actorUsername: name, actorRole: "superadmin", entityType: "CLIENT", entityId: clientId,
      amount: plan.amount, referenceId: movementRef.id, referenceType: "balanceMovement", description: comment(movement.afterBalance), createdBy: uid,
      extra: { direction: plan.direction, exceptionalMigration: true, reason, iqBalance: iq, pay0BalanceBefore: before, pay0BalanceAfter: movement.afterBalance, source: "COMPARACION_SALDOS_IQ" },
    });

    const out = { movementId: movementRef.id, beforeBalance: before, afterBalance: movement.afterBalance, status: matches ? "MATCH" : "DIFFERENT" };
    tx.set(idempotencyRef, { operation: "adjustClientBalanceFromComparison", uid, rootId, key: idempotencyKey, result: out, createdAt: FieldValue.serverTimestamp() });
    return out;
  });

  return { ok: true, ...result };
});

/** Turns the exceptional adjustments on or off for the whole root. They are for the migration only: switch them off when it ends. */
export const setIqBalanceAdjustmentsEnabled = onCall({ cors: true, region: "us-central1", timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const { uid, rootId, name } = await requireSuperadmin(request);
  if (typeof request.data?.enabled !== "boolean") throw new HttpsError("invalid-argument", "Indica si los ajustes quedan activados o desactivados.");
  const enabled = request.data.enabled as boolean;
  const ref = db.doc(`${CONFIG}/${rootId}`);
  await db.runTransaction(async (tx) => {
    tx.set(ref, { rootId, adjustmentsEnabled: enabled, adjustmentsUpdatedBy: uid, adjustmentsUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logActivityTx(tx, db, {
      event: enabled ? "AJUSTES_EXCEPCIONALES_ACTIVADOS" : "AJUSTES_EXCEPCIONALES_DESACTIVADOS", rootId, actorUid: uid, actorUsername: name, actorRole: "superadmin",
      referenceId: rootId, referenceType: "balanceAdjustments", description: `Ajustes excepcionales de saldo ${enabled ? "activados" : "desactivados"} por el superadmin ${name}.`, createdBy: uid,
    });
  });
  return { ok: true, enabled };
});
