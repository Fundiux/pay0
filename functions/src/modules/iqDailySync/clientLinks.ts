import type * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import { logActivity } from "../../utils/logActivity";
import { isMergedClient } from "../clients/mergeDomain";
import { normalizeClientRfc, requiresUniqueClientRfc } from "../clients/domain";
import { resolveIqPay0Identity } from "../iq/iqPay0Identity";
import { P4_PLAN_GROUPS, type IqPlanRow, type Pay0PlanRow } from "../iqHistoricalImport/planner";

/**
 * Links a PAY0 client to its IQ client by exact RFC (owner decision 2026-11-23), so the daily sync does not stop
 * at "same client, no proof": a client created in PAY0 before IQ knew it, or never linked, is the same company.
 *
 * It links only when every condition is clear, and never creates or changes anything else:
 *  - the RFC is a real, unique one (not the generic public / foreign RFC);
 *  - exactly one IQ client of the group has that RFC, and exactly one live PAY0 client has it;
 *  - that PAY0 client belongs to the owner the IQ group maps to (RR -> BETELL, ELIUT -> EBASOR);
 *  - the PAY0 client has no IQ link, or already points at this same IQ client.
 * Anything else stays in review for a person.
 */

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const GROUP_ALIAS: Record<string, string> = { "iq-group-rr": "RR", "iq-group-pay0": "PAY0" };
export const MAX_CLIENT_LINKS_PER_GROUP = 50;
export const CLIENT_LINK_METHOD = "RFC_EXACT_DAILY_SYNC";
export const CLIENT_LINK_ACTOR_UID = "system:iq-daily-sync";

export type ClientLink = {
  pay0ClientId: string;
  iqClientId: string;
  iqClientName: string;
  rfc: string;
  groupId: string;
  profileId: string;
  profileAlias: string;
  partnerId: string;
  partnerName: string;
  ownerAdminId: string;
};

/** IQ client ids this PAY0 client already points at (any link shape the app has used). */
function linkedIqIds(data: Record<string, unknown>): string[] {
  return [
    text(data.iqClientId), text(data.iqId), text(data.externalIqId), text(data.originalIqEntityId),
    text(object(data.iqLink).clientId), text(object(data.originClientIqLink).clientIqId),
    ...Object.values(object(data.iqLinksByProfile)).map((link) => text(object(link).clientId)),
  ].filter(Boolean);
}

const isLive = (data: Record<string, unknown>) => data.isDeleted !== true && !data.deletedAt && !["ELIMINADO", "ELIMINADA"].includes(text(data.status).toUpperCase()) && !isMergedClient(data as Record<string, any>);

export function planClientLinks(input: { groupId: string; iqRows: IqPlanRow[]; pay0Rows: Pay0PlanRow[] }): ClientLink[] {
  const group = P4_PLAN_GROUPS[input.groupId];
  if (!group) return [];
  const identity = resolveIqPay0Identity({ canonicalIqGroupId: input.groupId, canonicalIqProfileId: group.canonicalIqProfileId });
  if (!identity) return [];

  // IQ clients of this group, one per IQ id.
  const iqClients = new Map<string, IqPlanRow>();
  for (const row of input.iqRows) if (row.kind === "CLIENT" && row.id && group.memberProfileIds.includes(row.profileId) && !iqClients.has(row.id)) iqClients.set(row.id, row);

  const iqByRfc = new Map<string, string[]>();
  for (const [id, row] of iqClients) {
    const rfc = normalizeClientRfc(row.raw.rfc ?? row.raw.tax_id);
    if (requiresUniqueClientRfc(rfc)) iqByRfc.set(rfc, [...(iqByRfc.get(rfc) || []), id]);
  }

  const pay0Clients = input.pay0Rows.filter((row) => row.collection === "clients" && isLive(row.data));
  const links: ClientLink[] = [];
  for (const [rfc, iqIds] of iqByRfc) {
    if (iqIds.length !== 1) continue; // two IQ clients with the same RFC: a person decides
    const iqId = iqIds[0], iq = iqClients.get(iqId)!;
    // Already linked to this IQ client: the planner matches it by its IQ id, nothing to do.
    if (pay0Clients.some((row) => linkedIqIds(row.data).includes(iqId))) continue;
    const candidates = pay0Clients.filter((row) => normalizeClientRfc(row.data.rfc) === rfc);
    if (candidates.length !== 1) continue; // none, or several PAY0 clients with the same RFC
    const [candidate] = candidates;
    if (text(candidate.data.adminId) !== identity.pay0UserId) continue; // belongs to another owner
    if (linkedIqIds(candidate.data).some((id) => id !== iqId)) continue; // already linked to another IQ client
    links.push({
      pay0ClientId: candidate.id, iqClientId: iqId, iqClientName: text(iq.raw.name ?? iq.raw.business_name ?? iq.raw.razon_social), rfc,
      groupId: input.groupId, profileId: group.canonicalIqProfileId, profileAlias: GROUP_ALIAS[input.groupId] || "",
      partnerId: text(iq.raw.partner_id ?? iq.raw.partnerId), partnerName: text(iq.raw.partner ?? iq.raw.partner_name), ownerAdminId: identity.pay0UserId,
    });
  }
  return links.sort((a, b) => a.pay0ClientId.localeCompare(b.pay0ClientId));
}

/** The link fields, with a plain timestamp placeholder so the same shape can patch the in-memory plan rows. */
function linkFields(link: ClientLink, at: unknown): Record<string, unknown> {
  const base = {
    status: "LINKED", clientId: link.iqClientId, clientName: link.iqClientName, partnerId: link.partnerId || null, partnerName: link.partnerName || null,
    source: CLIENT_LINK_METHOD, score: 1, active: true, linkedAt: at, linkedBy: CLIENT_LINK_ACTOR_UID, linkedByName: "Sincronización diaria IQ",
    profileId: link.profileId, profileAlias: link.profileAlias || null, updatedAt: at,
  };
  return {
    iqLink: base,
    iqLinksByProfile: { [link.profileId]: { ...base } },
    iqClientId: link.iqClientId,
    iqClientName: link.iqClientName,
    originClientIqLink: { profileId: link.profileId, clientIqId: link.iqClientId, clientIqName: link.iqClientName },
    canonicalIqGroupId: link.groupId,
  };
}

/** What the planner needs to see on the PAY0 row right after the link is written (no server timestamps). */
export const linkPatchForPlan = (link: ClientLink): Record<string, unknown> => linkFields(link, null);

/**
 * Writes the links, each in its own transaction that re-checks the conditions on the live document, so a client
 * changed meanwhile is skipped. Returns the links that were written.
 */
export async function applyClientLinks(db: admin.firestore.Firestore, rootId: string, links: ClientLink[]): Promise<ClientLink[]> {
  const written: ClientLink[] = [];
  for (const link of links.slice(0, MAX_CLIENT_LINKS_PER_GROUP)) {
    const ref = db.doc(`clients/${link.pay0ClientId}`);
    const applied = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = (snap.data() || {}) as Record<string, unknown>;
      if (!snap.exists || text(data.rootId) !== rootId || !isLive(data)) return false;
      if (normalizeClientRfc(data.rfc) !== link.rfc || text(data.adminId) !== link.ownerAdminId) return false;
      if (linkedIqIds(data).some((id) => id !== link.iqClientId)) return false;
      tx.set(ref, { ...linkFields(link, FieldValue.serverTimestamp()), updatedAt: FieldValue.serverTimestamp(), updatedBy: CLIENT_LINK_ACTOR_UID, updatedByName: "Sincronización diaria IQ" }, { merge: true });
      return true;
    });
    if (!applied) continue;
    written.push(link);
    await logActivity({
      event: "CLIENT_IQ_LINK", rootId, adminId: link.ownerAdminId, actorUid: CLIENT_LINK_ACTOR_UID, actorName: "Sincronización diaria IQ", actorRole: "system",
      referenceId: link.pay0ClientId, referenceType: "client",
      description: `Cliente enlazado con IQ por RFC exacto (${link.rfc}) en la sincronización diaria: ${link.iqClientName || "cliente de IQ"}.`,
    }).catch(() => undefined);
  }
  return written;
}
