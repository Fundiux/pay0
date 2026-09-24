type IqProfileIdentity = {
  profileId: string;
  profileAlias: string;
  associatedName: string;
  username: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedIdentity(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/^ASOCIADO\s+/, "");
}

export function resolveStoredIqClientIdForProfile(
  client: Record<string, unknown>,
  access: IqProfileIdentity,
): string {
  const linksByProfile = asRecord(client.iqLinksByProfile);
  const profileLink = asRecord(linksByProfile[access.profileId]);
  const profileClientId = cleanText(profileLink.clientId);
  if (profileClientId) return profileClientId;

  const legacyLink = asRecord(client.iqLink);
  const legacyClientId = cleanText(legacyLink.clientId ?? client.iqClientId);
  if (!legacyClientId) return "";

  const expected = new Set([
    access.profileId,
    access.profileAlias,
    access.associatedName,
    access.username,
  ].map(normalizedIdentity).filter(Boolean));
  const legacyIdentities = [
    legacyLink.profileId,
    legacyLink.profileAlias,
    legacyLink.partnerName,
    legacyLink.associatedName,
    legacyLink.iqAssociatedName,
  ].map(normalizedIdentity).filter(Boolean);

  return legacyIdentities.some((value) => expected.has(value))
    ? legacyClientId
    : "";
}
