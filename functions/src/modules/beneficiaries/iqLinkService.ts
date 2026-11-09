import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { logActivityBatch } from "../../utils/logActivity";
import { CONSERVATIVE_POLICY, SafetyRuntime } from "../automationSafety/runtime";
import { db } from "../sharedCallables/helpers";
import { methodAccountRef, resolveIqLink, type IqCatalogRow, type IqLinkDecision } from "./iqCatalogDomain";
import { buildLinkEntry, catalogsForClient, createReservationId, evaluateCreateGate, linkActivityId, mexicoDay, type ClientCatalogProfile } from "./iqLinkDomain";

const text = (value: unknown) => String(value ?? "").trim();

export type IqLinkContext = {
  rootId: string; methodId: string; catalog: string; profile: ClientCatalogProfile;
  beneficiaryName: string; method: Record<string, any>; account: { key: string; last4: string };
};
export type LiveLookupResult =
  | { found: false }
  | { found: true; iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string }
  | { found: "AMBIGUOUS"; candidates: number[] };
export type CreateResult =
  | { outcome: "CREATED"; iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string }
  | { outcome: "EXISTS" }
  | { outcome: "OUTCOME_UNKNOWN" };

// The two things that touch IQ. Production wires them in iqLinkPorts.ts; tests pass fakes.
export interface IqLinkPorts {
  liveLookup(input: IqLinkContext): Promise<LiveLookupResult>;
  create(input: IqLinkContext & { reservationId: string }): Promise<CreateResult>;
}

export type LinkOutcome = { methodId: string; catalog: string; status: string; createState?: string | null; skipped?: string };

const AUDIT_EVENT: Record<string, string> = {
  LINKED: "IQ_BENEFICIARIO_VINCULADO", REVIEW_REQUIRED: "IQ_BENEFICIARIO_REVISION_REQUERIDA", CREATED: "IQ_BENEFICIARIO_CREADO", OUTCOME_UNKNOWN: "IQ_BENEFICIARIO_CREACION_INCIERTA",
};

async function writeEntry(ctx: IqLinkContext, decision: IqLinkDecision, source: "CATALOG" | "LIVE_LOOKUP" | "CREATED_IN_IQ", createState: string | null, audit?: { event: string; description: string }) {
  const batch = db.batch();
  const ref = db.doc(`clientBeneficiaryMethods/${ctx.methodId}`);
  // Replaces the whole catalog entry, so ids from an earlier state cannot survive.
  batch.set(ref, { iqLinksByCatalog: { [ctx.catalog]: buildLinkEntry({ decision, key: ctx.account.key, last4: ctx.account.last4, source, createState }, FieldValue.serverTimestamp()) } },
    { mergeFields: [new FieldPath("iqLinksByCatalog", ctx.catalog)] });
  if (audit) {
    logActivityBatch(batch, db, { event: audit.event, rootId: ctx.rootId, actorUid: "SYSTEM_IQ_BENEFICIARY_LINK", actorRole: "system", referenceId: ctx.methodId, referenceType: "clientBeneficiaryMethod",
      description: audit.description, extra: { catalog: ctx.catalog, last4: ctx.account.last4, status: decision.status, source } },
      db.collection("pay0ActivityLog").doc(linkActivityId(ctx.methodId, ctx.catalog, ctx.account.key, `${decision.status}:${source}:${createState ?? ""}`)));
  }
  await batch.commit();
}

const linked = (found: { iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string }): IqLinkDecision => ({ status: "LINKED", iqBeneficiaryId: found.iqBeneficiaryId, iqAccountId: found.iqAccountId, iqBeneficiaryName: found.iqBeneficiaryName, nameDiffers: false });

async function settle(ctx: IqLinkContext, decision: IqLinkDecision, source: "CATALOG" | "LIVE_LOOKUP" | "CREATED_IN_IQ", createState: string | null = null): Promise<LinkOutcome> {
  const audited = decision.status === "LINKED" || decision.status === "REVIEW_REQUIRED";
  const event = source === "CREATED_IN_IQ" && decision.status === "LINKED" ? AUDIT_EVENT.CREATED : AUDIT_EVENT[decision.status];
  await writeEntry(ctx, decision, source, createState, audited && event ? { event, description: decision.status === "LINKED" ? `Beneficiario vinculado con IQ (${source === "CATALOG" ? "catálogo" : source === "LIVE_LOOKUP" ? "consulta en vivo" : "creado en IQ"}), cuenta ****${ctx.account.last4}.` : `Varios beneficiarios de IQ coinciden con la cuenta ****${ctx.account.last4}; requiere revisión.` } : undefined);
  return { methodId: ctx.methodId, catalog: ctx.catalog, status: decision.status, createState };
}

// Admission refusals that only mean "not now": nothing is written, so the trigger can retry the same work.
const DEFERRABLE = new Set(["CAPACITY", "BACKOFF", "DEFERRED", "DEDUPLICATED"]);
const deferred = (ctx: IqLinkContext): LinkOutcome => ({ methodId: ctx.methodId, catalog: ctx.catalog, status: "DEFERRED" });

const stop = (ctx: IqLinkContext, createState: string) => settle(ctx, { status: "NOT_FOUND" }, "CATALOG", createState);

type Reservation = { state: "NEW" | "CREATED" | "BLOCKED"; reason?: string; ids?: { iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string } };

// One transaction decides whether this account may be created now: an existing reservation wins
// (never twice), and today's counter is only spent together with the reservation.
async function reserveCreate(ctx: IqLinkContext, nowMs: number): Promise<Reservation & { reservationId: string }> {
  const reservationId = createReservationId(ctx.rootId, ctx.catalog, ctx.account.key);
  const reservationRef = db.doc(`iqBeneficiaryCreateReservations/${reservationId}`);
  const counterRef = db.doc(`iqBeneficiaryCreateCounters/${ctx.rootId}_${mexicoDay(nowMs)}`);
  const result = await db.runTransaction(async tx => {
    const [reservation, counter, config, master] = await Promise.all([tx.get(reservationRef), tx.get(counterRef), tx.get(db.doc(`iqBeneficiaryCreateConfig/${ctx.rootId}`)), tx.get(db.doc(`iqIntegrationConfigs/${ctx.rootId}`))]);
    const status = text(reservation.data()?.status);
    if (status === "CREATED") return { state: "CREATED" as const, ids: { iqBeneficiaryId: Number(reservation.get("iqBeneficiaryId")), iqAccountId: Number(reservation.get("iqAccountId")), iqBeneficiaryName: text(reservation.get("iqBeneficiaryName")) } };
    if (reservation.exists && status !== "FAILED_SAFE") return { state: "BLOCKED" as const, reason: status || "RESERVED" };
    const gate = evaluateCreateGate({ masterEnabled: master.data()?.enabled === true, config: config.data(), createdToday: Number(counter.data()?.count || 0) });
    if (!gate.allowed) return { state: "BLOCKED" as const, reason: gate.reason };
    tx.set(reservationRef, { rootId: ctx.rootId, catalog: ctx.catalog, key: ctx.account.key, last4: ctx.account.last4, methodId: ctx.methodId, status: "RESERVED", profileId: ctx.profile.profileId, reservedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(counterRef, { rootId: ctx.rootId, day: mexicoDay(nowMs), count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { state: "NEW" as const };
  });
  return { ...result, reservationId };
}

const closeReservation = (reservationId: string, patch: Record<string, unknown>) => db.doc(`iqBeneficiaryCreateReservations/${reservationId}`).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

// Link first, create only when IQ really lacks the account. Nothing here writes to IQ unless the create
// gate (master switch, create switch, verified contract, daily limit, kill switch) allows it.
export async function linkOrCreateMethod(input: { methodId: string; ports: IqLinkPorts; nowMs?: number; safety?: SafetyRuntime }): Promise<LinkOutcome[]> {
  const nowMs = input.nowMs ?? Date.now();
  const safety = input.safety ?? new SafetyRuntime(db);
  const methodSnap = await db.doc(`clientBeneficiaryMethods/${input.methodId}`).get();
  if (!methodSnap.exists) return [];
  const method = methodSnap.data() || {};
  const account = methodAccountRef(method);
  const rootId = text(method.rootId);
  if (!account || !rootId || method.active === false || method.isDeleted === true) return [];
  const [beneficiary, client] = await Promise.all([
    db.doc(`clientBeneficiaries/${text(method.beneficiaryId || method.beneficiarioId)}`).get(),
    db.doc(`clients/${text(method.clientId || method.clienteId)}`).get(),
  ]);
  if (!beneficiary.exists || !client.exists || beneficiary.get("rootId") !== rootId || client.get("rootId") !== rootId) return [{ methodId: input.methodId, catalog: "", status: "SKIPPED", skipped: "OWNERSHIP_MISMATCH" }];
  const beneficiaryName = text(beneficiary.get("nombre") ?? beneficiary.get("name"));
  const profiles = catalogsForClient(client.data());
  if (!profiles.length) return [{ methodId: input.methodId, catalog: "", status: "SKIPPED", skipped: "NO_IQ_CLIENT_LINK" }];

  const outcomes: LinkOutcome[] = [];
  for (const profile of profiles) {
    const existing = method.iqLinksByCatalog?.[profile.catalog];
    const ctx: IqLinkContext = { rootId, methodId: input.methodId, catalog: profile.catalog, profile, beneficiaryName, method, account };
    // The write below triggers this function again; the same account in the same state is a no-op.
    if (existing?.key === account.key && text(existing.status)) { outcomes.push({ methodId: input.methodId, catalog: profile.catalog, status: text(existing.status), skipped: "UNCHANGED" }); continue; }

    const catalogRows = await db.collection("iqBeneficiaryCatalog").where("rootId", "==", rootId).where("catalog", "==", profile.catalog).where("key", "==", account.key).get();
    const decision = resolveIqLink(beneficiaryName, catalogRows.docs.map(doc => doc.data() as IqCatalogRow));
    if (decision.status !== "NOT_FOUND") { outcomes.push(await settle(ctx, decision, "CATALOG")); continue; }

    // The catalog may be stale: ask IQ for this account before deciding it does not exist.
    const master = (await db.doc(`iqIntegrationConfigs/${rootId}`).get()).data()?.enabled === true;
    if (!master) { outcomes.push(await stop(ctx, "IQ_MASTER_OFF")); continue; }
    const reservationId = createReservationId(rootId, profile.catalog, account.key);
    // Per method and 10-minute window: another method with the same account is its own lookup, and a retry later is not a duplicate.
    const bucket = Math.floor(nowMs / 600_000);
    const lookup = await safety.run({ rootId, process: "IQ_BENEFICIARY_LINK", partition: profile.catalog, operationType: "IQ_BENEFICIARY_LOOKUP", operationId: `${reservationId}:${input.methodId}:${bucket}`, idempotencyKey: `${reservationId}:${input.methodId}:lookup:${bucket}`,
      origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: 20 } }, () => input.ports.liveLookup(ctx));
    if (!lookup.admitted) { outcomes.push(DEFERRABLE.has(String(lookup.reason)) ? deferred(ctx) : await stop(ctx, `SAFETY_${lookup.reason}`)); continue; }
    const live = (lookup as { value?: LiveLookupResult }).value;
    if (!live) { outcomes.push(await stop(ctx, "LOOKUP_FAILED")); continue; }
    if (live.found === "AMBIGUOUS") { outcomes.push(await settle(ctx, { status: "REVIEW_REQUIRED", candidates: live.candidates }, "LIVE_LOOKUP")); continue; }
    if (live.found) { outcomes.push(await settle(ctx, linked(live), "LIVE_LOOKUP")); continue; }

    const reservation = await reserveCreate(ctx, nowMs);
    if (reservation.state === "CREATED" && reservation.ids) { outcomes.push(await settle(ctx, linked(reservation.ids), "CREATED_IN_IQ")); continue; }
    if (reservation.state === "BLOCKED") { outcomes.push(await stop(ctx, reservation.reason || "BLOCKED")); continue; }

    const created = await safety.run({ rootId, process: "IQ_BENEFICIARY_LINK", partition: profile.catalog, operationType: "IQ_BENEFICIARY_CREATE", operationId: reservation.reservationId, idempotencyKey: `${reservation.reservationId}:create`,
      origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: 10 } },
      () => input.ports.create({ ...ctx, reservationId: reservation.reservationId }), value => value.outcome === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "SUCCEEDED");
    const result = (created as { value?: CreateResult }).value;
    if (!created.admitted) {
      // Nothing reached IQ: give the day's slot back and let the reservation be taken again.
      await closeReservation(reservation.reservationId, { status: "FAILED_SAFE", reason: `SAFETY_${created.reason}` });
      await db.doc(`iqBeneficiaryCreateCounters/${rootId}_${mexicoDay(nowMs)}`).set({ count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      outcomes.push(DEFERRABLE.has(String(created.reason)) ? deferred(ctx) : await stop(ctx, `SAFETY_${created.reason}`));
      continue;
    }
    if (!result) { await closeReservation(reservation.reservationId, { status: "OUTCOME_UNKNOWN", reason: String(created.reason) }); outcomes.push(await stop(ctx, "OUTCOME_UNKNOWN")); continue; }
    if (result.outcome === "OUTCOME_UNKNOWN") {
      await closeReservation(reservation.reservationId, { status: "OUTCOME_UNKNOWN" });
      await writeEntry(ctx, { status: "NOT_FOUND" }, "CREATED_IN_IQ", "OUTCOME_UNKNOWN", { event: AUDIT_EVENT.OUTCOME_UNKNOWN, description: `No se sabe si IQ creó el beneficiario de la cuenta ****${account.last4}; no se reintenta solo.` });
      outcomes.push({ methodId: input.methodId, catalog: profile.catalog, status: "NOT_FOUND", createState: "OUTCOME_UNKNOWN" });
      continue;
    }
    if (result.outcome === "EXISTS") {
      // "Ya existe" is a link, never an error loop: read the ids it now exposes.
      const again = await input.ports.liveLookup(ctx);
      if (again.found === true) { await closeReservation(reservation.reservationId, { status: "CREATED", existed: true, iqBeneficiaryId: again.iqBeneficiaryId, iqAccountId: again.iqAccountId, iqBeneficiaryName: again.iqBeneficiaryName }); outcomes.push(await settle(ctx, linked(again), "LIVE_LOOKUP")); continue; }
      await closeReservation(reservation.reservationId, { status: "OUTCOME_UNKNOWN", reason: "EXISTS_UNRESOLVED" });
      outcomes.push(await stop(ctx, "EXISTS_UNRESOLVED"));
      continue;
    }
    await closeReservation(reservation.reservationId, { status: "CREATED", iqBeneficiaryId: result.iqBeneficiaryId, iqAccountId: result.iqAccountId, iqBeneficiaryName: result.iqBeneficiaryName });
    outcomes.push(await settle(ctx, linked(result), "CREATED_IN_IQ"));
  }
  return outcomes;
}
