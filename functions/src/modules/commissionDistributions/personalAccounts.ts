/** Personal commission account registry validation. No payment submission is performed here. */
export type PersonalCommissionAccount = {
  id: string;
  ownerUid: string;
  rootId: string;
  bankName: string;
  beneficiaryName: string;
  instrumentType: "CLABE" | "CARD";
  instrumentNumber: string;
  active: boolean;
  iqLinkStatus: "PENDING" | "VERIFIED" | "AMBIGUOUS" | "STALE" | "ERROR";
};
export function normalizePersonalCommissionAccount(input: Omit<PersonalCommissionAccount, "id" | "iqLinkStatus" | "active">) {
  const ownerUid = String(input.ownerUid || "").trim();
  const rootId = String(input.rootId || "").trim();
  const bankName = String(input.bankName || "").trim();
  const beneficiaryName = String(input.beneficiaryName || "").trim();
  const instrumentNumber = String(input.instrumentNumber || "").replace(/\s|-/g, "");
  if (!ownerUid || !rootId || !bankName || !beneficiaryName) throw new Error("Faltan datos de titularidad o banco.");
  if (bankName.length > 100 || beneficiaryName.length > 160 || /[\\u0000-\\u001f\\u007f]/.test(bankName + beneficiaryName)) {
    throw new Error("Banco o beneficiario contienen datos inválidos.");
  }
  if (input.instrumentType === "CLABE" && !/^\d{18}$/.test(instrumentNumber)) throw new Error("La CLABE debe contener 18 dígitos.");
  if (input.instrumentType === "CARD" && !/^\d{16,19}$/.test(instrumentNumber)) throw new Error("La tarjeta debe contener de 16 a 19 dígitos.");
  if (input.instrumentType !== "CLABE" && input.instrumentType !== "CARD") throw new Error("Tipo de instrumento inválido.");
  return { ownerUid, rootId, bankName, beneficiaryName, instrumentType: input.instrumentType, instrumentNumber, active: true as const, iqLinkStatus: "PENDING" as const };
}
export function canUsePersonalCommissionAccount(account: PersonalCommissionAccount, actor: { rootId: string; ownerUid: string }) {
  return account.active === true && account.iqLinkStatus === "VERIFIED" && account.rootId === actor.rootId && account.ownerUid === actor.ownerUid;
}
export function maskPersonalCommissionInstrument(account: Pick<PersonalCommissionAccount, "instrumentNumber">) {
  return "••" + String(account.instrumentNumber || "").slice(-4);
}

/**
 * Masked projection for summaries and other UI contexts. The separately authorized
 * personal-account callable may disclose full numbers to the account holder and
 * organizational superadmin as explicitly required by the product contract.
 */
export function publicPersonalCommissionAccount(account: PersonalCommissionAccount) {
  return {
    id: account.id,
    ownerUid: account.ownerUid,
    rootId: account.rootId,
    bankName: account.bankName,
    beneficiaryName: account.beneficiaryName,
    instrumentType: account.instrumentType,
    instrumentMasked: maskPersonalCommissionInstrument(account),
    active: account.active,
    iqLinkStatus: account.iqLinkStatus,
  };
}
