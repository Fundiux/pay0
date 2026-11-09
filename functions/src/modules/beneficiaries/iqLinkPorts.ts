import { db } from "../sharedCallables/helpers";
import { resolveIqBeneficiaryInstrument } from "../iq/dispersionHttpCreateCore";
import { decryptSecret } from "../iq/solicitudCancellationService";
import type { CreateResult, IqLinkContext, IqLinkPorts, LiveLookupResult } from "./iqLinkService";

const text = (value: unknown) => String(value ?? "").trim();
const NOT_FOUND = new Set(["IQ_BENEFICIARY_NOT_FOUND", "IQ_BENEFICIARY_ACCOUNT_NOT_FOUND"]);
const AMBIGUOUS = /^IQ_BENEFICIARY(_ACCOUNT)?_AMBIGUOUS/;

export const IQ_CREATE_CONTRACT_UNVERIFIED = "IQ_BENEFICIARY_CREATE_CONTRACT_UNVERIFIED";

// Read-only: the wizard lookup that dispersions already use, by name and then by the account itself.
async function liveLookup(ctx: IqLinkContext): Promise<LiveLookupResult> {
  const profile = (await db.doc(`iqCredentialProfiles/${ctx.profile.profileId}`).get()).data();
  if (!profile || profile.active !== true || profile.rootId !== ctx.rootId) throw new Error("IQ_PROFILE_UNAVAILABLE");
  const digits = text(ctx.method.clabe || ctx.method.cardNumber).replace(/\D/g, "");
  try {
    const found = await resolveIqBeneficiaryInstrument({
      username: text(profile.username), password: decryptSecret(profile), associatedName: ctx.profile.partnerName || text(profile.alias),
      clientIqId: ctx.profile.clientIqId, beneficiaryCandidates: [ctx.beneficiaryName], currency: "MXN",
      operationTypeKey: text(ctx.method.destinationKind).toUpperCase() === "CARD" ? "TDC" : "TRANSFERENCIA", expectedDestinationLast4: digits.slice(-4), expectedDestinationDigits: digits,
    });
    return { found: true, iqBeneficiaryId: Number(found.iqBeneficiaryId), iqAccountId: Number(found.iqAccountId), iqBeneficiaryName: found.iqBeneficiaryName };
  } catch (error) {
    const code = text(error instanceof Error ? error.message : error);
    if (NOT_FOUND.has(code)) return { found: false };
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
