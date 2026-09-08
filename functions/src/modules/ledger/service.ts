import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type {
  LedgerBalanceSummary,
  LedgerDirection,
  LedgerHolderType,
  LedgerStatementRow,
  LedgerStatementResult,
} from "./types";

function cleanText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function money2(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function resolveCanonicalAvailableBalance(account: Record<string, any> | null | undefined) {
  return money2(account?.availableBalance ?? account?.balance ?? account?.currentBalance);
}

export function buildCanonicalBalanceValues(
  account: Record<string, any> | null | undefined,
  pendingAdvance: unknown,
) {
  const availableBalance = resolveCanonicalAvailableBalance(account);
  const normalizedPendingAdvance = money2(pendingAdvance);
  return {
    availableBalance,
    pendingAdvance: normalizedPendingAdvance,
    netBalance: money2(availableBalance - normalizedPendingAdvance),
  };
}

function toMillis(value: any): number | null {
  if (!value) return null;

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    const millis = Number(date?.getTime?.());
    return Number.isFinite(millis) ? millis : null;
  }

  const seconds = Number(value?.seconds ?? value?._seconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHolderType(value: unknown): LedgerHolderType {
  const text = cleanText(value).toUpperCase();
  return text === "USER" ? "USER" : "CLIENT";
}

function normalizeDirection(value: unknown): LedgerDirection {
  const text = cleanText(value).toUpperCase();
  if (text === "IN" || text === "OUT") return text;
  return "";
}

function isPendingAdvanceStatus(status: unknown) {
  const text = cleanText(status).toUpperCase();
  return text === "OTORGADO" || text === "LIQUIDADO_PARCIAL" || text === "PENDIENTE";
}

async function readPendingAdvanceAmount(db: Firestore, holderType: LedgerHolderType, holderId: string) {
  if (holderType !== "CLIENT") return 0;

  const snap = await db.collection("clientAdvances").where("clienteId", "==", holderId).limit(250).get();

  return money2(
    snap.docs.reduce((sum, doc) => {
      const data = doc.data() || {};
      if (!isPendingAdvanceStatus((data as any).status)) return sum;

      const pendingAmount = money2((data as any).pendingAmount);
      return pendingAmount > 0 ? sum + pendingAmount : sum;
    }, 0),
  );
}

export async function readCanonicalBalanceSummary(
  db: Firestore,
  holderType: LedgerHolderType,
  holderId: string,
): Promise<LedgerBalanceSummary> {
  const cleanHolderId = cleanText(holderId);
  const normalizedHolderType = normalizeHolderType(holderType);
  const accountId = `${normalizedHolderType}_${cleanHolderId}`;
  const snap = await db.collection("balanceAccounts").doc(accountId).get();
  const account = snap.exists ? snap.data() || {} : {};

  const pendingAdvance = await readPendingAdvanceAmount(db, normalizedHolderType, cleanHolderId);
  const canonicalValues = buildCanonicalBalanceValues(account as Record<string, any>, pendingAdvance);

  return {
    holderType: normalizedHolderType,
    holderId: cleanHolderId,
    holderName: cleanText((account as any).holderName, cleanHolderId),
    holderRole: cleanText((account as any).holderRole) || null,
    rootId: cleanText((account as any).rootId) || null,
    adminId: cleanText((account as any).adminId) || null,
    operadorId: cleanText((account as any).operadorId) || null,
    ...canonicalValues,
    totalGenerated: money2((account as any).totalGenerated),
    totalSpent: money2((account as any).totalSpent),
    totalReturned: money2((account as any).totalReturned),
    totalAdjusted: money2((account as any).totalAdjusted),
    lastMovementAtMillis: toMillis((account as any).lastMovementAt),
    updatedAtMillis: toMillis((account as any).updatedAt),
  };
}

function mapMovementRow(doc: QueryDocumentSnapshot): LedgerStatementRow {
  const data = doc.data() || {};
  const holderType = normalizeHolderType((data as any).holderType);

  return {
    id: doc.id,
    holderType,
    holderId: cleanText((data as any).holderId),
    movementType: cleanText((data as any).movementType, "MOVIMIENTO"),
    movementSubType: cleanText((data as any).movementSubType) || null,
    direction: normalizeDirection((data as any).direction),
    amount: money2((data as any).amount),
    beforeBalance: money2((data as any).beforeBalance),
    afterBalance: money2((data as any).afterBalance),
    sourceModule: cleanText((data as any).sourceModule),
    referenceType: cleanText((data as any).referenceType),
    referenceId: cleanText((data as any).referenceId),
    referenceFolio: cleanText((data as any).referenceFolio) || null,
    folio: cleanText((data as any).folio) || null,
    pagoFolio: cleanText((data as any).pagoFolio) || null,
    solicitudFolio: cleanText((data as any).solicitudFolio) || null,
    dispersionFolio: cleanText((data as any).dispersionFolio) || null,
    sourceFolio: cleanText((data as any).sourceFolio) || null,
    pagoId: cleanText((data as any).pagoId) || null,
    solicitudId: cleanText((data as any).solicitudId) || null,
    dispersionId: cleanText((data as any).dispersionId) || null,
    clienteId: cleanText((data as any).clienteId) || null,
    empresaId: cleanText((data as any).empresaId) || null,
    empresaNombre: cleanText((data as any).empresaNombre) || null,
    note: cleanText((data as any).note) || null,
    createdBy: cleanText((data as any).createdBy) || null,
    actorUsername: cleanText((data as any).actorUsername) || null,
    isSystemGenerated: (data as any).isSystemGenerated === true,
    createdAtMillis: toMillis((data as any).createdAt),
  };
}

export async function readCanonicalStatement(
  db: Firestore,
  holderType: LedgerHolderType,
  holderId: string,
  limit = 100,
): Promise<LedgerStatementResult> {
  const normalizedHolderType = normalizeHolderType(holderType);
  const cleanHolderId = cleanText(holderId);
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit || 100)), 1), 250);
  const summary = await readCanonicalBalanceSummary(db, normalizedHolderType, cleanHolderId);

  const snap = await db.collection("balanceMovements").where("holderId", "==", cleanHolderId).limit(250).get();

  const rows = snap.docs
    .map(mapMovementRow)
    .filter((row) => row.holderType === normalizedHolderType)
    .sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0) || b.id.localeCompare(a.id))
    .slice(0, safeLimit);

  return {
    ok: true,
    summary,
    rows,
  };
}