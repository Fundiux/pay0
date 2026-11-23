/**
 * Read-only integration preflight for personal commission accounts and client allocations.
 * Does not write Firestore or call IQ. All account data must be server-read and scoped.
 */
import { calculateClientCommissionInstructions, type ClientCommissionInstruction } from "./clientAllocation";
import { canUsePersonalCommissionAccount, type PersonalCommissionAccount } from "./personalAccounts";
import { validateClientAllocationDraft } from "./allocationDraftPolicy";
import { evaluateIqLink } from "./domain";

export type CommissionIntegrationPreflightInput = {
  rootId: string;
  ownerUid: string;
  clientId: string;
  earnedMinor: number;
  operationBaseMinor: number | null;
  contractRateBps: number | null;
  accounts: PersonalCommissionAccount[];
  instructions: ClientCommissionInstruction[];
  nowMs?: number;
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
    const iq = account as PersonalCommissionAccount & { iqVerifiedAtMs?: number; iqInstrumentLast4?: string; last4?: string; iqBeneficiaryId?: string; iqAccountId?: string; iqFullDigitsMatched?: boolean };
    const link = evaluateIqLink({ status: iq.iqLinkStatus, verifiedAtMs: iq.iqVerifiedAtMs, nowMs: input.nowMs ?? Date.now(), maxAgeMs: 86400000, storedLast4: iq.iqInstrumentLast4, currentLast4: iq.last4 });
    if (!link.ready || iq.iqFullDigitsMatched !== true || !iq.iqBeneficiaryId || !iq.iqAccountId) throw new Error("Cuenta sin vínculo IQ vigente y comprobable.");
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
