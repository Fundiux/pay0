import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import type {
  BalanceAccountDoc,
  BalanceMovementDoc,
  BalanceMovementType,
  HolderType,
  Pay0Role,
  ReferenceType,
  SourceModule,
} from "../shared/domain";
import { money2 } from "../shared/money";

export type BuildBalanceMovementInput = {
  rootId: string;
  holderType: HolderType;
  holderId: string;
  holderRole: Pay0Role | null;
  holderName: string;
  movementType: BalanceMovementType;
  movementSubType?: string | null;
  direction: "IN" | "OUT";
  amount: number;
  beforeBalance: number;
  sourceModule: SourceModule;
  referenceType: ReferenceType;
  referenceId: string;
    referenceFolio?: string | null;
  folio?: string | null;
  pagoFolio?: string | null;
  solicitudFolio?: string | null;
  dispersionFolio?: string | null;
  sourceFolio?: string | null;depositId?: string | null;
  dispersionId?: string | null;
  transferId?: string | null;
  correctionOfMovementId?: string | null;
  clienteId?: string | null;
  empresaId?: string | null;
  empresaNombre?: string | null;
  beneficiaryId?: string | null;
  beneficiaryNombre?: string | null;
  methodId?: string | null;
  methodTipo?: string | null;
  destinationKind?: string | null;
  bankName?: string | null;
  operationalReference?: string | null;
  displayConcept?: string | null;
  currency?: string | null;
  actorDisplayName?: string | null;
  asociadoId?: string | null;
  adminId?: string | null;
  operadorId?: string | null;
  note?: string | null;
  createdBy: string;
  actorUsername: string;
  isSystemGenerated: boolean;
};

export function computeAfterBalance(beforeBalance: number, direction: "IN" | "OUT", amount: number) {
  const before = money2(beforeBalance);
  const delta = money2(amount);
  const next = direction === "IN" ? before + delta : before - delta;
  return money2(next);
}

export function buildBalanceMovement(input: BuildBalanceMovementInput): BalanceMovementDoc {
  const amount = money2(input.amount);
  const beforeBalance = money2(input.beforeBalance);
  const afterBalance = computeAfterBalance(beforeBalance, input.direction, amount);

  return {
    rootId: input.rootId,
    holderType: input.holderType,
    holderId: input.holderId,
    holderRole: input.holderRole,
    holderName: input.holderName,
    movementType: input.movementType,
    movementSubType: input.movementSubType ?? null,
    direction: input.direction,
    amount,
    beforeBalance,
    afterBalance,
    sourceModule: input.sourceModule,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
        referenceFolio: input.referenceFolio ?? null,
    folio: input.folio ?? null,
    pagoFolio: input.pagoFolio ?? null,
    solicitudFolio: input.solicitudFolio ?? null,
    dispersionFolio: input.dispersionFolio ?? null,
    sourceFolio: input.sourceFolio ?? null,depositId: input.depositId ?? null,
    dispersionId: input.dispersionId ?? null,
    transferId: input.transferId ?? null,
    correctionOfMovementId: input.correctionOfMovementId ?? null,
    clienteId: input.clienteId ?? null,
    empresaId: input.empresaId ?? null,
    empresaNombre: input.empresaNombre ?? null,
    beneficiaryId: input.beneficiaryId ?? null,
    beneficiaryNombre: input.beneficiaryNombre ?? null,
    methodId: input.methodId ?? null,
    methodTipo: input.methodTipo ?? null,
    destinationKind: input.destinationKind ?? null,
    bankName: input.bankName ?? null,
    operationalReference: input.operationalReference ?? null,
    displayConcept: input.displayConcept ?? null,
    currency: input.currency ?? "MXN",
    actorDisplayName: input.actorDisplayName ?? input.actorUsername,
    asociadoId: input.asociadoId ?? null,
    adminId: input.adminId ?? null,
    operadorId: input.operadorId ?? null,
    status: "APPLIED",
    note: input.note ?? null,
    createdBy: input.createdBy,
    actorUsername: input.actorUsername,
    isSystemGenerated: input.isSystemGenerated,
  };
}

export function buildBalanceAccountPatchFromMovement(
  current: Partial<BalanceAccountDoc> | undefined,
  movement: BalanceMovementDoc,
): BalanceAccountDoc {
  const availableBalance = money2(movement.afterBalance);
  const totalGeneratedBase = money2(current?.totalGenerated ?? 0);
  const totalSpentBase = money2(current?.totalSpent ?? 0);
  const totalReturnedBase = money2(current?.totalReturned ?? 0);
  const totalAdjustedBase = money2(current?.totalAdjusted ?? 0);

  const isIn = movement.direction === "IN";
  const isReturn =
    movement.movementType === "DEVOLUCION" ||
    movement.movementType === "DISPERSION_REINTEGRADA";
  const isAdjustment =
    movement.movementType === "AJUSTE_MANUAL" ||
    movement.movementType === "CORRECCION_MOVIMIENTO";

  return {
    rootId: movement.rootId,
    holderType: movement.holderType,
    holderId: movement.holderId,
    holderRole: movement.holderRole,
    holderName: movement.holderName,
    adminId: movement.adminId ?? null,
    operadorId: movement.operadorId ?? null,
    availableBalance,
    totalGenerated: money2(totalGeneratedBase + (isIn && !isReturn ? movement.amount : 0)),
    totalSpent: money2(totalSpentBase + (!isIn ? movement.amount : 0)),
    totalReturned: money2(totalReturnedBase + (isReturn ? movement.amount : 0)),
    totalAdjusted: money2(totalAdjustedBase + (isAdjustment ? movement.amount : 0)),
    lastMovementAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function assertSufficientBalance(beforeBalance: number, amount: number) {
  const next = computeAfterBalance(beforeBalance, "OUT", amount);
  if (next < 0) {
    throw new HttpsError("failed-precondition", "Saldo insuficiente.");
  }
  return next;
}
