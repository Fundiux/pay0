import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  loadIqCanonicalProfileById,
  loadIqCanonicalUserAccess,
  type IqCanonicalAccess,
  type IqCanonicalModule,
} from "./iqCanonicalAccess";

type AnyRecord = Record<string, any>;

export const IQ_ORIGIN_IDENTITY_REVISION = "IQ_ORIGIN_IDENTITY_V1";

export type IqOriginIdentity = {
  originActorUid: string;
  originRootId: string;
  originIqProfileId: string;
  originIqContext: {
    profileAlias: string;
    associatedName: string;
    despachoId: string | null;
    companyId: string | null;
  };
  identityRevision: typeof IQ_ORIGIN_IDENTITY_REVISION;
};

export type EffectiveIqIdentity = IqOriginIdentity & {
  authorizedActorUid: string;
  effectiveIqProfileId: string;
  identityResolutionReason:
    | "PERSISTED_ORIGIN"
    | "LEGACY_EXECUTION_EVIDENCE"
    | "LEGACY_DEPOSIT_EVIDENCE"
    | "LEGACY_DISPERSION_EVIDENCE"
    | "LEGACY_CLIENT_LINK_EVIDENCE";
  credentialProfile: IqCanonicalAccess;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRecord
    : {};
}

export async function captureIqOriginIdentity(input: {
  actorUid: string;
  rootId: string;
  role: string;
  moduleKey: IqCanonicalModule;
  despachoId?: string | null;
  companyId?: string | null;
  encryptionSecret?: string;
}): Promise<IqOriginIdentity> {
  const access = await loadIqCanonicalUserAccess({
    uid: clean(input.actorUid),
    rootId: clean(input.rootId),
    role: clean(input.role),
    moduleKey: input.moduleKey,
    encryptionSecret: input.encryptionSecret || "not-used-without-password",
    includePassword: false,
  });

  return {
    originActorUid: clean(input.actorUid),
    originRootId: clean(input.rootId),
    originIqProfileId: access.profileId,
    originIqContext: {
      profileAlias: access.profileAlias,
      associatedName: access.associatedName,
      despachoId: clean(input.despachoId) || null,
      companyId: clean(input.companyId) || null,
    },
    identityRevision: IQ_ORIGIN_IDENTITY_REVISION,
  };
}

export function buildIqOriginIdentityPatch(identity: IqOriginIdentity): AnyRecord {
  return {
    originActorUid: identity.originActorUid,
    originRootId: identity.originRootId,
    originIqProfileId: identity.originIqProfileId,
    originIqContext: identity.originIqContext,
    identityRevision: identity.identityRevision,
    identityCapturedAt: FieldValue.serverTimestamp(),
  };
}

function legacyProfileEvidence(movement: AnyRecord): Array<{
  profileId: string;
  reason: EffectiveIqIdentity["identityResolutionReason"];
}> {
  const evidence: Array<{
    profileId: string;
    reason: EffectiveIqIdentity["identityResolutionReason"];
  }> = [];
  const executionProfile = clean(
    movement.iqExecutionProfileId ??
    movement.profileId ??
    record(movement.iqAttempt).profileId,
  );
  if (executionProfile) evidence.push({ profileId: executionProfile, reason: "LEGACY_EXECUTION_EVIDENCE" });

  const depositProfile = clean(record(movement.iqDepositSync).profileId);
  if (depositProfile) evidence.push({ profileId: depositProfile, reason: "LEGACY_DEPOSIT_EVIDENCE" });

  const dispersionProfile = clean(movement.iqCredentialProfileId);
  if (dispersionProfile) evidence.push({ profileId: dispersionProfile, reason: "LEGACY_DISPERSION_EVIDENCE" });

  const clientLink = record(movement.iqLink);
  const clientProfile = clean(clientLink.profileId);
  if (clientProfile) evidence.push({ profileId: clientProfile, reason: "LEGACY_CLIENT_LINK_EVIDENCE" });

  const profileLinks = record(movement.iqLinksByProfile);
  for (const [profileId, link] of Object.entries(profileLinks)) {
    const storedLink = record(link);
    if (clean(profileId) && clean(storedLink.clientId ?? storedLink.clientIqId)) {
      evidence.push({
        profileId: clean(profileId),
        reason: "LEGACY_CLIENT_LINK_EVIDENCE",
      });
    }
  }

  return evidence;
}

export function selectIqOriginProfileReference(
  movement: AnyRecord,
  legacyEvidence: AnyRecord[] = [],
): { profileId: string; reason: EffectiveIqIdentity["identityResolutionReason"] } {
  const persistedProfileId = clean(record(movement).originIqProfileId);
  if (persistedProfileId) {
    return { profileId: persistedProfileId, reason: "PERSISTED_ORIGIN" };
  }

  const evidence = [record(movement), ...legacyEvidence.map(record)]
    .flatMap(legacyProfileEvidence);
  const unique = [...new Set(evidence.map((item) => item.profileId))];
  if (unique.length !== 1) {
    throw new HttpsError(
      "failed-precondition",
      "IDENTITY_ORIGIN_UNRESOLVED: no existe evidencia IQ historica unica para el movimiento.",
    );
  }
  return evidence.find((item) => item.profileId === unique[0])!;
}

export async function resolveEffectiveIqIdentity(input: {
  movement: AnyRecord;
  rootId: string;
  authorizedActorUid: string;
  encryptionSecret: string;
  includePassword?: boolean;
  legacyEvidence?: AnyRecord[];
}): Promise<EffectiveIqIdentity> {
  const movement = record(input.movement);
  const rootId = clean(input.rootId);
  const selected = selectIqOriginProfileReference(movement, input.legacyEvidence);
  const profileId = selected.profileId;
  const reason = selected.reason;

  const originRootId = clean(movement.originRootId) || rootId;
  if (originRootId !== rootId) {
    throw new HttpsError("permission-denied", "La identidad IQ de origen esta fuera de root.");
  }

  const credentialProfile = await loadIqCanonicalProfileById({
    profileId,
    rootId,
    encryptionSecret: input.encryptionSecret,
    includePassword: input.includePassword,
  });
  const context = record(movement.originIqContext);

  return {
    originActorUid: clean(movement.originActorUid ?? movement.createdBy),
    originRootId,
    originIqProfileId: profileId,
    originIqContext: {
      profileAlias: clean(context.profileAlias) || credentialProfile.profileAlias,
      associatedName: clean(context.associatedName) || credentialProfile.associatedName || credentialProfile.username,
      despachoId: clean(context.despachoId ?? movement.despachoId) || null,
      companyId: clean(context.companyId ?? movement.companyId) || null,
    },
    identityRevision: IQ_ORIGIN_IDENTITY_REVISION,
    authorizedActorUid: clean(input.authorizedActorUid),
    effectiveIqProfileId: profileId,
    identityResolutionReason: reason,
    credentialProfile,
  };
}

export function assertIqIdentityInvariant(identity: Pick<EffectiveIqIdentity, "originIqProfileId" | "effectiveIqProfileId">): void {
  if (!identity.originIqProfileId || identity.effectiveIqProfileId !== identity.originIqProfileId) {
    throw new HttpsError("failed-precondition", "IQ_IDENTITY_PROFILE_SUBSTITUTION_BLOCKED");
  }
}
