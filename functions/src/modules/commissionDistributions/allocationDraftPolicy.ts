import type { PersonalCommissionAccount } from "./personalAccounts";
import type { ClientCommissionInstruction } from "./clientAllocation";

/** Drafts may be incomplete, but cannot be activated or submitted to IQ. */
export type ClientCommissionAllocationDraft = {
  ownerUid: string;
  clientId: string;
  status: "DRAFT" | "ACTIVE";
  instructions: ClientCommissionInstruction[];
};
export function commissionAccountOptions(
  accounts: PersonalCommissionAccount[],
  owner: { rootId: string; ownerUid: string },
) {
  return accounts
    .filter(account => account.rootId === owner.rootId && account.ownerUid === owner.ownerUid && account.active)
    .map(account => ({
      id: account.id,
      bankName: account.bankName,
      masked: "••" + account.instrumentNumber.slice(-4),
      iqLinkStatus: account.iqLinkStatus,
      selectable: account.iqLinkStatus === "VERIFIED",
      reason: account.iqLinkStatus === "VERIFIED" ? null : "Cuenta pendiente de verificación IQ",
    }));
}
export function deactivatePersonalCommissionAccount<T extends PersonalCommissionAccount>(account: T): T {
  return { ...account, active: false };
}
export function validateClientAllocationDraft(
  draft: ClientCommissionAllocationDraft,
  accounts: PersonalCommissionAccount[],
  owner: { rootId: string; ownerUid: string },
) {
  if (!draft.ownerUid || draft.ownerUid !== owner.ownerUid || !draft.clientId) throw new Error("Titular o cliente inválido.");
  if (!Array.isArray(draft.instructions) || draft.instructions.length > 50) throw new Error("Demasiadas filas.");
  if (draft.status === "DRAFT") return { canExecute: false as const, savedAsDraft: true as const };
  if (draft.status !== "ACTIVE" || draft.instructions.length === 0) throw new Error("No se puede activar una distribución vacía.");
  for (const row of draft.instructions) {
    const account = accounts.find(a => a.id === row.accountId);
    if (!account || account.rootId !== owner.rootId || account.ownerUid !== owner.ownerUid || !account.active || account.iqLinkStatus !== "VERIFIED") {
      throw new Error("Cada cuenta debe pertenecer al usuario, estar activa y verificada en IQ.");
    }
    const points = row.pointsBps != null, percent = row.earningsPercentBps != null;
    if (points === percent || !Number.isSafeInteger(points ? row.pointsBps : row.earningsPercentBps) || Number(points ? row.pointsBps : row.earningsPercentBps) <= 0) {
      throw new Error("Completa exactamente una columna positiva por fila.");
    }
  }
  return { canExecute: true as const, savedAsDraft: false as const };
}
