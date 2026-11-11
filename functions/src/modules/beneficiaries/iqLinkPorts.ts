import { db } from "../sharedCallables/helpers";
import { resolveIqBeneficiaryInstrument } from "../iq/dispersionHttpCreateCore";
import { decryptSecret } from "../iq/solicitudCancellationService";
import type { CreateResult, IqLinkContext, IqLinkPorts, LiveLookupResult } from "./iqLinkService";

const text = (value: unknown) => String(value ?? "").trim();
const NOT_FOUND = new Set(["IQ_BENEFICIARY_NOT_FOUND", "IQ_BENEFICIARY_ACCOUNT_NOT_FOUND"]);
const AMBIGUOUS = /^IQ_BENEFICIARY(_ACCOUNT)?_AMBIGUOUS/;

export const IQ_CREATE_CONTRACT_UNVERIFIED = "IQ_BENEFICIARY_CREATE_CONTRACT_UNVERIFIED";

// Read-only: the wizard lookup that dispersions already use. It searches by beneficiary name and then checks
// the account's digits on that beneficiary; it cannot search IQ by account, so it never proves absence.
async function liveLookup(ctx: IqLinkContext): Promise<LiveLookupResult> {
  const profile = (await db.doc(`iqCredentialProfiles/${ctx.profile.profileId}`).get()).data();
  if (!profile || profile.active !== true || profile.rootId !== ctx.rootId) throw new Error("IQ_PROFILE_UNAVAILABLE");
  // Same precedence as the account fingerprint: the CLABE when there is one, otherwise the card.
  const clabeDigits = text(ctx.method.clabe).replace(/[^0-9]/g, ""), digits = clabeDigits || text(ctx.method.cardNumber).replace(/[^0-9]/g, "");
  try {
    const found = await resolveIqBeneficiaryInstrument({
      username: text(profile.username), password: decryptSecret(profile), associatedName: ctx.profile.partnerName || text(profile.alias),
      clientIqId: ctx.profile.clientIqId, beneficiaryCandidates: [ctx.beneficiaryName], currency: "MXN",
      operationTypeKey: clabeDigits ? "TRANSFERENCIA" : "TDC", expectedDestinationLast4: digits.slice(-4), expectedDestinationDigits: digits,
    });
    // IQ often shows only the last four digits. That is enough to dispatch, not to record a link: a beneficiary
    // that matches on four digits alone goes to a person.
    if (!found.fullDigitsMatched) return { found: "AMBIGUOUS", candidates: [Number(found.iqBeneficiaryId)] };
    return { found: true, iqBeneficiaryId: Number(found.iqBeneficiaryId), iqAccountId: Number(found.iqAccountId), iqBeneficiaryName: found.iqBeneficiaryName };
  } catch (error) {
    const code = text(error instanceof Error ? error.message : error);
    // The wizard is searched by beneficiary name: that does not prove the account is absent under another name.
    if (NOT_FOUND.has(code)) return { found: false, absenceProof: "NAME" };
    if (AMBIGUOUS.test(code)) return { found: "AMBIGUOUS", candidates: [] };
    throw error;
  }
}

// There is no verified IQ contract for creating a beneficiary or an account (endpoint, fields, how it is
// tied to the client and the associate), so this refuses. It is also gated by iqBeneficiaryCreateConfig.contractVerified.
// Replace this body only with a contract captured from IQ itself.
async function create(_ctx: IqLinkContext & { reservationId: string }): Promise<CreateResult> {
  throw new Error(IQ_CREATE_CONTRACT_UNVERIFIED);
}

export const productionIqLinkPorts: IqLinkPorts = { liveLookup, create };
