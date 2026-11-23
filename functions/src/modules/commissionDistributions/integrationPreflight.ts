/**
 * Read-only integration preflight for personal commission accounts and client allocations.
 * Does not write Firestore or call IQ. All account data must be server-read and scoped.
 */
import { calculateClientCommissionInstructions, type ClientCommissionInstruction } from "./clientAllocation";
import { canUsePersonalCommissionAccount, type PersonalCommissionAccount } from "./personalAccounts";
import { validateClientAllocationDraft } from "./allocationDraftPolicy";

export type CommissionIntegrationPreflightInput = {
  rootId: string;
  ownerUid: string;
  clientId: string;
  earnedMinor: number;
  operationBaseMinor: number | null;
  contractRateBps: number | null;
  accounts: PersonalCommissionAccount[];
  instructions: ClientCommissionInstruction[];
};
export function preflightClientCommissionIntegration(input: CommissionIntegrationPreflightInput) {
  const owner = { rootId: input.rootId, ownerUid: input.ownerUid };
  validateClientAllocationDraft(
    { clientId: input.clientId, ownerUid: input.ownerUid, status: "ACTIVE", instructions: input.instructions },
    input.accounts,
    owner,
  );
  const accountById = new Map(input.accounts.map(account => [account.id, account]));
  for (const instruction of input.instructions) {
    const account = accountById.get(instruction.accountId);
    if (!account || !canUsePersonalCommissionAccount(account, owner)) throw new Error("Cuenta no disponible para el titular.");
  }
  const result = calculateClientCommissionInstructions({
    earnedMinor: input.earnedMinor,
    operationBaseMinor: input.operationBaseMinor,
    contractRateBps: input.contractRateBps,
    instructions: input.instructions,
  });
  return {
    ok: true as const,
    canSubmitToIq: false as const,
    clientId: input.clientId,
    ownerUid: input.ownerUid,
    distributedMinor: result.distributedMinor,
    remainingMinor: result.remainingMinor,
    rows: result.instructions.map(row => ({ accountId: row.accountId, amountMinor: row.amountMinor })),
  };
}
