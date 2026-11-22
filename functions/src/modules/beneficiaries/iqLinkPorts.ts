import { db } from "../sharedCallables/helpers";
import { resolveIqBeneficiaryInstrument } from "../iq/dispersionHttpCreateCore";
import { loginIqHttpDirect } from "../iq/iqHttpAuth";
import { decryptSecret } from "../iq/solicitudCancellationService";
import { iqApiOrigin } from "../iq/solicitudHttpCancellation";
import { createAccountInIq, findAccountInIq, type IqAccountTarget, type IqSession } from "./iqBeneficiaryCreateHttp";
import { iqCreateAliasForCatalog } from "./iqCatalogDomain";
import type { CreateResult, FindResult, IqLinkContext, IqLinkPorts, LiveLookupResult } from "./iqLinkService";

const text = (value: unknown) => String(value ?? "").trim();
const NOT_FOUND = new Set(["IQ_BENEFICIARY_NOT_FOUND", "IQ_BENEFICIARY_ACCOUNT_NOT_FOUND"]);
const AMBIGUOUS = /^IQ_BENEFICIARY(_ACCOUNT)?_AMBIGUOUS/;

// Read-only: the wizard lookup that dispersions already use. It searches by beneficiary name and then checks
// the account's digits on that beneficiary. It is only an extra chance to link: absence is proven by the catalog.
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

// The login that writes in each catalog (PAY0 for ELIUT's list, RR for the RR/BETELL 1 list), never another one.
async function writerSession(ctx: IqLinkContext): Promise<IqSession> {
  const alias = iqCreateAliasForCatalog(ctx.catalog);
  if (!alias) throw new Error("IQ_CREATE_CATALOG_UNKNOWN");
  const profiles = await db.collection("iqCredentialProfiles").where("rootId", "==", ctx.rootId).where("active", "==", true).get();
  const writers = profiles.docs.map(doc => doc.data()).filter(profile => text(profile.alias).toUpperCase() === alias && profile.hasPassword === true);
  if (writers.length !== 1) throw new Error(writers.length ? "IQ_CREATE_PROFILE_AMBIGUOUS" : "IQ_CREATE_PROFILE_UNAVAILABLE");
  const session = await loginIqHttpDirect({ apiOrigin: iqApiOrigin(), credentials: { username: text(writers[0].username), password: decryptSecret(writers[0]) }, requiredPermissions: "NONE" });
  return { apiOrigin: session.apiOrigin, accessToken: session.accessToken };
}

function targetOf(ctx: IqLinkContext): IqAccountTarget {
  const clabe = text(ctx.method.clabe).replace(/\D/g, ""), card = text(ctx.method.cardNumber).replace(/\D/g, "");
  return { partnerId: Number(ctx.profile.partnerId), beneficiaryName: ctx.beneficiaryName.replace(/\s+/g, " ").trim(), digits: clabe || card, isClabe: !!clabe,
    bankCode: text(ctx.method.bankCode) || (clabe ? clabe.slice(0, 3) : ""), bankName: text(ctx.method.bankName) };
}

// Account-level read under the client's associate, with the catalog's writer login.
async function findExisting(ctx: IqLinkContext): Promise<FindResult> {
  const target = targetOf(ctx);
  if (!(target.partnerId > 0) || !target.beneficiaryName) return { found: false };
  return findAccountInIq(await writerSession(ctx), target);
}

// Contract: docs/iq-beneficiary-create-contract.md. Gated by iqBeneficiaryCreateConfig (enabled, contractVerified,
// dailyLimit), the catalog absence proof and the reservation; a lost answer is never re-sent.
async function create(ctx: IqLinkContext & { reservationId: string }): Promise<CreateResult> {
  const target = targetOf(ctx);
  if (!(target.partnerId > 0)) return { outcome: "REJECTED", reason: "PARTNER_UNKNOWN", effect: "NONE" };
  if (!target.beneficiaryName) return { outcome: "REJECTED", reason: "IQ_BENEFICIARY_NAME_MISSING", effect: "NONE" };
  let session: IqSession;
  try { session = await writerSession(ctx); }
  catch (error) { return { outcome: "NOT_SENT", reason: text(error instanceof Error ? error.message : error).slice(0, 120) }; }
  const result = await createAccountInIq(session, target);
  if (result.outcome === "OUTCOME_UNKNOWN") return { outcome: "OUTCOME_UNKNOWN" };
  return result;
}

export const productionIqLinkPorts: IqLinkPorts = { liveLookup, create, findExisting };
