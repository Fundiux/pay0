import { createHash } from "node:crypto";

const text = (value: unknown) => String(value ?? "").trim();
/** Pure identity; importing this must never initialize the IQ API or callables. */
export function personalCommissionIqLinkId(rootId: string, clientId: string, ownerUid: string, accountId: string) {
  return createHash("sha256").update(JSON.stringify([rootId, clientId, ownerUid, accountId])).digest("hex");
}
export function personalCommissionMirrorId(rootId: string, clientId: string, ownerUid: string, accountId: string) {
  if (![rootId, clientId, ownerUid, accountId].every(v => v && !v.includes("/"))) throw new Error("PERSONAL_COMMISSION_MIRROR_SCOPE_INVALID");
  return "pcm_" + createHash("sha256").update(JSON.stringify([rootId, clientId, ownerUid, accountId])).digest("hex").slice(0, 40);
}
export function personalCommissionIqEvidence(input: {
  rootId: string; despachoId: string; profileId: string; clientIqId: string;
  beneficiaryId: string; accountId: string; last4: string; operationTypeKey: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * Compatibility documents for PAY0's existing canonical withdrawal and IQ executor.
 * The sensitive digits remain only inside personalCommissionAccounts.encryptedInstrument.
 * Only the server-side IQ executor may decrypt the instrument in memory.
 */
export function personalCommissionMirrorData(input: {
  rootId: string; clientId: string; ownerUid: string; accountId: string;
  account: Record<string, any>; verifiedLink: Record<string, any>;
  actorUid: string;
}) {
  const { rootId, clientId, ownerUid, accountId, account, verifiedLink: link } = input;
  if (account.rootId !== rootId || account.ownerUid !== ownerUid || account.active !== true ||
      link.rootId !== rootId || link.clientId !== clientId || link.ownerUid !== ownerUid ||
      link.accountId !== accountId || link.accountFingerprint !== account.instrumentFingerprint ||
      link.last4 !== account.last4 || link.iqLinkStatus !== "VERIFIED" ||
      !text(link.iqPartnerId) || !text(link.iqBeneficiaryId) || !text(link.iqAccountId) ||
      !text(link.iqClientId) || !text(link.iqCredentialProfileId) || !text(link.despachoId)) {
    throw new Error("PERSONAL_COMMISSION_MIRROR_IQ_NOT_VERIFIED");
  }
  const mirrorId = personalCommissionMirrorId(rootId, clientId, ownerUid, accountId);
  const last4 = text(account.last4);
  const operationTypeKey = account.instrumentType === "CLABE" ? "TRANSFERENCIA" : account.instrumentType === "CARD" ? "TDC" : null;
  if (!operationTypeKey || !/^\d{4}$/.test(last4)) throw new Error("PERSONAL_COMMISSION_MIRROR_INVALID_ACCOUNT");
  const evidence = personalCommissionIqEvidence({
    rootId, despachoId: text(link.despachoId), profileId: text(link.iqCredentialProfileId),
    clientIqId: text(link.iqClientId), beneficiaryId: text(link.iqBeneficiaryId),
    accountId: text(link.iqAccountId), last4, operationTypeKey,
  });
  const beneficiary = {
    rootId, clientId, clienteId: clientId, ownerUid,
    sourceType: "PERSONAL_COMMISSION", virtualCommissionOnly: true,
    personalCommissionAccountId: accountId,
    nombre: text(account.beneficiaryName), nombreNormalizado: text(account.beneficiaryName).toUpperCase(),
    active: true, createdBy: input.actorUid,
  };
  const method = {
    rootId, clientId, clienteId: clientId, beneficiaryId: mirrorId, beneficiarioId: mirrorId,
    ownerUid, commissionOwnerUid: ownerUid,
    sourceType: "PERSONAL_COMMISSION", virtualCommissionOnly: true,
    personalCommissionAccountId: accountId, personalAccountFingerprint: text(account.instrumentFingerprint),
    tipo: account.instrumentType === "CLABE" ? "DEBITO" : "TDC",
    destinationKind: account.instrumentType === "CLABE" ? "CLABE" : "TARJETA",
    bankName: text(account.bankName), bankCode: text(account.bankCode) || null,
    last4, masked: "••" + last4, clabe: null, cardNumber: null,
    active: true, iqLinkStatus: "VERIFIED",
    iqPartnerId: text(link.iqPartnerId), iqClientId: text(link.iqClientId),
    iqBeneficiaryId: text(link.iqBeneficiaryId), iqAccountId: text(link.iqAccountId),
    iqCredentialProfileId: text(link.iqCredentialProfileId), iqDespachoId: text(link.despachoId),
    iqInstrumentType: operationTypeKey, iqInstrumentLast4: last4,
    iqEvidenceFingerprint: evidence, iqVerifiedAt: link.verifiedAt,
    createdBy: input.actorUid,
  };
  return { mirrorId, beneficiary, method, iqEvidenceFingerprint: evidence };
}
