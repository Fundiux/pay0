import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { money2 } from "../shared/money";
import { logActivityTx } from "../../utils/logActivity";

export interface ApplyPendingAdvancesOnClientNetTxParams {
  tx: Transaction;
  db: Firestore;
  rootId: string;
  pagoId: string;
  clienteId: string;
  clientNetAmount: number;
  actorUid: string;
  actorUsername: string;
  actorRole: string;
}

export interface ApplyPendingAdvancesOnClientNetTxResult {
  pendingBeforeAmount: number;
  appliedAmount: number;
  releasedAmount: number;
  pendingAfterAmount: number;
  updatedAdvanceIds: string[];
}

function getCreatedAtSortableValue(value: any) {
  const seconds = Number(value?.seconds || 0);
  const nanos = Number(value?.nanoseconds || 0);
  return (seconds * 1000000000) + nanos;
}

/**
 * Adelantos no son prestamos.
 * Se liquidan con el neto cliente despues de comision.
 *
 * Reglas canonicas:
 * - no usa monto bruto conciliado
 * - no toca saldo disponible directamente
 * - solo reduce clientAdvances.pendingAmount/status
 * - devuelve cuanto del neto se aplico a adelanto
 * - devuelve cuanto neto queda libre para liberar a wallet
 */
export async function applyPendingAdvancesOnClientNetTx(
  params: ApplyPendingAdvancesOnClientNetTxParams
): Promise<ApplyPendingAdvancesOnClientNetTxResult> {
  const prepared = await preparePendingAdvancesOnClientNetTx(params);
  prepared.commit();
  return prepared.result;
}

/**
 * Read phase of the advance settlement. Firestore transactions reject any
 * read after a write, so callers that still need to read (forward-only
 * dispatch accounts) must call commit() only after their last tx.get.
 */
export async function preparePendingAdvancesOnClientNetTx(
  params: ApplyPendingAdvancesOnClientNetTxParams
): Promise<{ result: ApplyPendingAdvancesOnClientNetTxResult; commit: () => void }> {
  const {
    tx,
    db,
    rootId,
    pagoId,
    clienteId,
    clientNetAmount,
    actorUid,
    actorUsername,
    actorRole,
  } = params;

  const amount = money2(clientNetAmount);

  const nothingToWrite = () => undefined;

  if (!clienteId || amount <= 0) {
    return { commit: nothingToWrite, result: {
      pendingBeforeAmount: 0,
      appliedAmount: 0,
      releasedAmount: amount,
      pendingAfterAmount: 0,
      updatedAdvanceIds: [],
    } };
  }

  const advancesQuery = db
    .collection("clientAdvances")
    .where("rootId", "==", rootId)
    .where("clienteId", "==", clienteId);

  const advancesSnap = await tx.get(advancesQuery);

  const pendingAdvances = advancesSnap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() as any }))
    .filter((item) => {
      const status = String(item.data.status || "").trim().toUpperCase();
      const pendingAmount = money2(item.data.pendingAmount || 0);
      return pendingAmount > 0 && (status === "OTORGADO" || status === "LIQUIDADO_PARCIAL");
    })
    .sort((a, b) => getCreatedAtSortableValue(a.data.createdAt) - getCreatedAtSortableValue(b.data.createdAt));

  const pendingBeforeAmount = money2(
    pendingAdvances.reduce((acc, item) => acc + money2(item.data.pendingAmount || 0), 0)
  );

  if (!pendingAdvances.length) {
    return { commit: nothingToWrite, result: {
      pendingBeforeAmount: 0,
      appliedAmount: 0,
      releasedAmount: amount,
      pendingAfterAmount: 0,
      updatedAdvanceIds: [],
    } };
  }

  let remainingNet = amount;
  let appliedAmount = 0;
  const updatedAdvanceIds: string[] = [];
  const writes: Array<() => void> = [];

  for (const item of pendingAdvances) {
    if (remainingNet <= 0) break;

    const pendingAmount = money2(item.data.pendingAmount || 0);
    if (pendingAmount <= 0) continue;

    const amountToApply = money2(Math.min(remainingNet, pendingAmount));
    const nextPendingAmount = money2(pendingAmount - amountToApply);
    const nextStatus = nextPendingAmount <= 0 ? "LIQUIDADO_TOTAL" : "LIQUIDADO_PARCIAL";

    writes.push(() => {
      tx.update(item.ref, {
        pendingAmount: nextPendingAmount,
        status: nextStatus,
        lastLiquidatedPagoId: pagoId,
        lastLiquidatedAmount: amountToApply,
        lastLiquidatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      logActivityTx(tx, db, {
        event: "ADELANTO_LIQUIDADO",
        rootId,
        adminId: item.data.adminId || null,
        actorUid,
        actorUsername,
        actorRole,
        entityType: "clientAdvance",
        entityId: item.id,
        relatedEntityId: pagoId,
        relatedEntityType: "pago",
        amount: amountToApply,
        referenceId: item.id,
        referenceType: "clientAdvance",
        description: `Adelanto ${item.id} liquidado con neto cliente del pago ${pagoId} por ${amountToApply}.`,
        createdBy: actorUid,
        extra: {
          note: item.data.note || item.data.reason || null,
        },
      });
    });

    remainingNet = money2(remainingNet - amountToApply);
    appliedAmount = money2(appliedAmount + amountToApply);
    updatedAdvanceIds.push(item.id);
  }

  const releasedAmount = money2(amount - appliedAmount);
  const pendingAfterAmount = money2(Math.max(0, pendingBeforeAmount - appliedAmount));

  return { commit: () => writes.forEach((write) => write()), result: {
    pendingBeforeAmount,
    appliedAmount,
    releasedAmount,
    pendingAfterAmount,
    updatedAdvanceIds,
  } };
}