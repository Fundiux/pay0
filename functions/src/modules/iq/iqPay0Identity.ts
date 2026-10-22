const text = (value: unknown) => String(value ?? "").trim();

export type IqPay0Identity = Readonly<{
  iqUsername: "RR" | "ELIUT";
  canonicalIqGroupId: "iq-group-rr" | "iq-group-pay0";
  canonicalIqProfileId: string;
  pay0UserId: string;
  pay0UserLabel: "BETELL" | "EBASOR";
}>;

const IDENTITIES: readonly IqPay0Identity[] = Object.freeze([
  Object.freeze({ iqUsername: "RR", canonicalIqGroupId: "iq-group-rr", canonicalIqProfileId: "Q3TaFdNTdR2mLPh7KcTi", pay0UserId: "lcOz4nO5DTbksM3Lbz3hJcCpCdu1", pay0UserLabel: "BETELL" }),
  Object.freeze({ iqUsername: "ELIUT", canonicalIqGroupId: "iq-group-pay0", canonicalIqProfileId: "bEGPMuplqNHMZ3lvYkeb", pay0UserId: "Ab4z0RttIqXbZFT0NuWsDjBkt6J2", pay0UserLabel: "EBASOR" }),
]);

export function resolveIqPay0Identity(input: { iqUsername?: unknown; canonicalIqGroupId?: unknown; canonicalIqProfileId?: unknown }): IqPay0Identity | null {
  const username = text(input.iqUsername).toUpperCase();
  const groupId = text(input.canonicalIqGroupId);
  const profileId = text(input.canonicalIqProfileId);
  const candidates = IDENTITIES.filter(identity =>
    (!username || identity.iqUsername === username) &&
    (!groupId || identity.canonicalIqGroupId === groupId) &&
    (!profileId || identity.canonicalIqProfileId === profileId));
  return candidates.length === 1 ? candidates[0] : null;
}

export function iqIdentityForPay0UserId(value: unknown): IqPay0Identity | null {
  const uid = text(value);
  return IDENTITIES.find(identity => identity.pay0UserId === uid) || null;
}
