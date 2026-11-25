import { createHash } from "node:crypto";
import type * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import { logActivity } from "../../utils/logActivity";
import { isMergedClient } from "../clients/mergeDomain";
import { normalizeClientRfc, requiresUniqueClientRfc } from "../clients/domain";
import { loadIqCanonicalProfileById, openIqCanonicalSession } from "../iq/iqCanonicalAccess";
import { fetchIq } from "../iq/iqHttpClient";
import { resolveIqPay0Identity } from "../iq/iqPay0Identity";
import { P4_PLAN_GROUPS, type Pay0PlanRow } from "../iqHistoricalImport/planner";

/**
 * Creates in PAY0 the client of an operation made in IQ when PAY0 does not have it (owner decision 2026-11-23:
 * "que el cliente se cree por su RFC al traerlo de IQ"). It only creates when the proof is exact:
 *  - exactly one IQ client of the group has the name the operation names;
 *  - that IQ client has a real, unique RFC (never the generic public / foreign RFC);
 *  - no live PAY0 client of the root has that RFC and none points at that IQ client already
 *    (a client that exists under another owner is a person's decision, never a duplicate).
 * The client belongs to the owner the IQ group maps to (RR -> BETELL, ELIUT -> EBASOR).
 */

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const plain = (value: unknown) => text(value).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
export const MAX_CLIENT_CREATES_PER_GROUP = 100;
export const CLIENT_CREATE_ACTOR_UID = "system:iq-daily-sync";
export const CLIENT_CREATE_VERSION = 1;

export type ClientCreate = {
  docId: string; iqClientId: string; name: string; rfc: string; groupId: string; profileId: string; ownerAdminId: string; iqUsername: string; partnerId: string; partnerName: string;
};

const isLive = (data: Record<string, unknown>) => data.isDeleted !== true && !data.deletedAt && !["ELIMINADO", "ELIMINADA"].includes(text(data.status).toUpperCase()) && !isMergedClient(data as Record<string, any>);
const pointsAt = (data: Record<string, unknown>, iqId: string) => [
  text(data.iqClientId), text(object(data.iqLink).clientId), text(object(data.originClientIqLink).clientIqId), ...Object.values(object(data.iqLinksByProfile)).map((link) => text(object(link).clientId)),
].includes(iqId);

export const clientCreateDocId = (rootId: string, groupId: string, iqClientId: string) => `iqc_${createHash("sha1").update(`${rootId}|${groupId}|${iqClientId}`).digest("hex").slice(0, 28)}`;

/** Which clients to create for these client names, given the IQ catalog of the group and the PAY0 clients. Pure. */
export function planClientCreates(input: { rootId: string; groupId: string; names: string[]; catalog: Record<string, unknown>[]; pay0Rows: Pay0PlanRow[] }): ClientCreate[] {
  const group = P4_PLAN_GROUPS[input.groupId];
  const identity = group ? resolveIqPay0Identity({ canonicalIqGroupId: input.groupId, canonicalIqProfileId: group.canonicalIqProfileId }) : null;
  if (!group || !identity) return [];
  const live = input.pay0Rows.filter((row) => row.collection === "clients" && isLive(row.data));
  const out = new Map<string, ClientCreate>();
  for (const wanted of [...new Set(input.names.map(plain).filter(Boolean))]) {
    const matches = input.catalog.filter((row) => plain(row.name ?? row.business_name ?? row.razon_social) === wanted && text(row.id));
    if (matches.length !== 1) continue; // none, or two IQ clients with the same name: a person decides
    const iq = matches[0], iqId = text(iq.id), rfc = normalizeClientRfc(iq.rfc ?? iq.tax_id);
    if (!requiresUniqueClientRfc(rfc)) continue;
    if (live.some((row) => pointsAt(row.data, iqId) || normalizeClientRfc(row.data.rfc) === rfc)) continue;
    out.set(iqId, {
      docId: clientCreateDocId(input.rootId, input.groupId, iqId), iqClientId: iqId, name: text(iq.name ?? iq.business_name ?? iq.razon_social), rfc, groupId: input.groupId,
      profileId: group.canonicalIqProfileId, ownerAdminId: identity.pay0UserId, iqUsername: identity.iqUsername, partnerId: text(iq.partner_id ?? iq.partnerId), partnerName: text(iq.partner ?? iq.partner_name),
    });
  }
  return [...out.values()].sort((a, b) => a.docId.localeCompare(b.docId));
}

function clientFields(create: ClientCreate, at: unknown) {
  const link = { status: "LINKED", active: true, clientId: create.iqClientId, clientName: create.name, profileId: create.profileId, source: "RFC_CREATED_DAILY_SYNC", partnerId: create.partnerId || null, partnerName: create.partnerName || null };
  return {
    name: create.name, nombre: create.name, razonSocial: create.name, rfc: create.rfc, active: true, adminId: create.ownerAdminId, iqUsername: create.iqUsername,
    iqClientId: create.iqClientId, iqClientName: create.name, iqLink: link, iqLinksByProfile: { [create.profileId]: { ...link } },
    originClientIqLink: { profileId: create.profileId, clientIqId: create.iqClientId, clientIqName: create.name }, canonicalIqGroupId: create.groupId,
    source: "IQ_IMPORT", importMode: "DAILY_SYNC", importVersion: CLIENT_CREATE_VERSION, importRunId: `iqclient-${create.docId}`, canonicalIqProfileId: create.profileId, originalIqEntityId: create.iqClientId,
    createdAt: at, updatedAt: at, createdBy: CLIENT_CREATE_ACTOR_UID_ALIAS, createdByName: "Sincronización diaria IQ",
  };
}
const CLIENT_CREATE_ACTOR_UID_ALIAS = CLIENT_CREATE_ACTOR_UID;

/** What the planner needs to see on the PAY0 row right after the creation (no server timestamps). */
export const clientRowForPlan = (rootId: string, create: ClientCreate): Pay0PlanRow => ({ collection: "clients", id: create.docId, data: { ...clientFields(create, null), rootId } });

/**
 * The clients IQ operations name: each invoice, deposit or application the plan read carries the exact IQ client it belongs to
 * (name, id and RFC). They are the catalog entries to create from when PAY0 lacks the client. Pure.
 */
export function catalogFromOperations(iqRows: Array<{ kind: string; raw: Record<string, unknown> }>): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of iqRows) {
    const resolution = object(object(row.raw).__p4ClientResolution);
    if (text(resolution.status) !== "FOUND_EXACT") continue;
    const id = text(resolution.iqClientId), name = text(resolution.clientName);
    if (id && name && !byId.has(id)) byId.set(id, { id, name, rfc: text(resolution.rfc) });
  }
  return [...byId.values()];
}

/** How many of those clients can be created (a real, unique RFC) and how many cannot, for the owner's decision. Pure. */
export function clientCreateCandidateStats(catalog: Record<string, unknown>[], creates: ClientCreate[]) {
  const withRfc = catalog.filter((row) => requiresUniqueClientRfc(normalizeClientRfc(row.rfc))).length;
  return { distinct: catalog.length, withRealRfc: withRfc, withoutRealRfc: catalog.length - withRfc, creatable: creates.length };
}

/** Creates each client in its own transaction, only when its document does not exist yet (replays are no-ops). */
export async function applyClientCreates(db: admin.firestore.Firestore, rootId: string, creates: ClientCreate[]): Promise<ClientCreate[]> {
  const written: ClientCreate[] = [];
  for (const create of creates.slice(0, MAX_CLIENT_CREATES_PER_GROUP)) {
    const ref = db.doc(`clients/${create.docId}`);
    const applied = await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, { ...clientFields(create, FieldValue.serverTimestamp()), rootId });
      return true;
    });
    if (!applied) continue;
    written.push(create);
    await logActivity({
      event: "CLIENT_CREATED_FROM_IQ", rootId, adminId: create.ownerAdminId, actorUid: CLIENT_CREATE_ACTOR_UID, actorName: "Sincronización diaria IQ", actorRole: "system",
      referenceId: create.docId, referenceType: "client",
      description: `Cliente creado desde IQ en la sincronización diaria por su RFC (${create.rfc}): ${create.name}.`,
    }).catch(() => undefined);
  }
  return written;
}

/** The whole client list of the group's canonical IQ profile (names, ids and RFCs). */
export async function readIqClientCatalog(input: { rootId: string; groupId: string; secret: string; maxPages?: number }): Promise<Record<string, unknown>[]> {
  const group = P4_PLAN_GROUPS[input.groupId];
  if (!group) return [];
  const access = await loadIqCanonicalProfileById({ profileId: group.canonicalIqProfileId, rootId: input.rootId, encryptionSecret: input.secret });
  const session = await openIqCanonicalSession({ access, requiredPermissions: "NONE" });
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < (input.maxPages ?? 30); page++) {
    const url = new URL("/clients", session.apiOrigin);
    for (const [key, value] of Object.entries({ limit: "100", offset: String(page * 100), order_by_field: "id", order_by_direction: "asc" })) url.searchParams.set(key, value);
    const response = await fetchIq(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}` } }, { operation: "iq-daily-sync-clients" });
    if (!response.ok) throw Object.assign(new Error(`IQ read failed HTTP_${response.status}`), { code: "IQ_DAILY_SYNC_IQ_READ_FAILED", status: response.status });
    const payload = await response.json();
    const rows = (Array.isArray(payload) ? payload : Array.isArray(object(payload).data) ? (object(payload).data as unknown[]) : []).filter((row) => row && typeof row === "object") as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}
