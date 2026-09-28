import { createHash } from "crypto";

export type VerifiedIqCommissionInstrument = {
  partnerId: string;
  clientId: string;
  beneficiaryId: string;
  accountId: string;
  last4: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const validId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

/** This contract comes from server-owned verification, never callable input. */
export function assertVerifiedIqCommissionInstrument(value: VerifiedIqCommissionInstrument | undefined): asserts value is VerifiedIqCommissionInstrument {
  if (!value || ![value.partnerId, value.clientId, value.beneficiaryId, value.accountId].every(validId) || !/^\d{4}$/.test(value.last4)) {
    throw new Error("IQ_COMMISSION_VERIFIED_INSTRUMENT_REQUIRED");
  }
}

export function bindVerifiedIqCommissionInstrument(input: {
  rootId: string;
  despachoId: string;
  profileId: string;
  clientIqId: string;
  operationTypeKey: string;
  method: Record<string, any>;
  historicalLeg: Record<string, any> | undefined;
}): VerifiedIqCommissionInstrument {
  const { method, historicalLeg } = input;
  const binding = {
    partnerId: text(method.iqPartnerId), clientId: text(method.iqClientId),
    beneficiaryId: text(method.iqBeneficiaryId), accountId: text(method.iqAccountId), last4: text(method.iqInstrumentLast4),
  };
  assertVerifiedIqCommissionInstrument(binding);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    rootId: input.rootId, despachoId: input.despachoId, profileId: input.profileId, clientIqId: input.clientIqId,
    beneficiaryId: binding.beneficiaryId, accountId: binding.accountId, last4: binding.last4, operationTypeKey: input.operationTypeKey,
  })).digest("hex");
  if (!historicalLeg || text(method.iqDespachoId) !== input.despachoId || text(method.iqCredentialProfileId) !== input.profileId ||
      binding.clientId !== input.clientIqId || text(method.iqInstrumentType) !== input.operationTypeKey || text(method.last4) !== binding.last4 ||
      text(historicalLeg.iqPartnerId) !== binding.partnerId || text(historicalLeg.iqBeneficiaryId) !== binding.beneficiaryId || text(historicalLeg.iqAccountId) !== binding.accountId ||
      text(historicalLeg.instrumentLast4) !== binding.last4 || text(method.iqEvidenceFingerprint) !== fingerprint ||
      text(historicalLeg.iqEvidenceFingerprint) !== fingerprint) throw new Error("IQ_COMMISSION_VERIFIED_INSTRUMENT_CHANGED");
  return binding;
}
