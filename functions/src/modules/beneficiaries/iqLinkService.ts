import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";

import { logActivityBatch } from "../../utils/logActivity";
import { CONSERVATIVE_POLICY, SafetyRuntime } from "../automationSafety/runtime";
import { db } from "../sharedCallables/helpers";
import { methodAccountRef, resolveIqLink, rowsOfPartner, type IqCatalogRow, type IqLinkDecision } from "./iqCatalogDomain";
import { buildLinkEntry, catalogsForClient, createReservationId, evaluateCreateGate, GATE_REASONS, linkActivityId, MAX_RETRY_ATTEMPTS, mexicoDay, retryDelayMs, type ClientCatalogProfile } from "./iqLinkDomain";

const text = (value: unknown) => String(value ?? "").trim();

export type IqLinkContext = {
  rootId: string; methodId: string; catalog: string; profile: ClientCatalogProfile;
  beneficiaryName: string; method: Record<string, any>; account: { key: string; last4: string };
};
// absenceProof says how "not found" was established. NAME means IQ was searched by beneficiary name only,
// which does not prove the account is missing under another name; only ACCOUNT allows a create.
export type LiveLookupResult =
  | { found: false; absenceProof: "NAME" | "ACCOUNT" }
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

async function writeEntry(ctx: IqLinkContext, entry: Record<string, unknown>, audit?: { event: string; description: string; status: string; source: string; outcomeKey: string }) {
  const batch = db.batch();
  const ref = db.doc(`clientBeneficiaryMethods/${ctx.methodId}`);
  // Replaces the whole catalog entry, so ids from an earlier state cannot survive.
  batch.set(ref, { iqLinksByCatalog: { [ctx.catalog]: entry } }, { mergeFields: [new FieldPath("iqLinksByCatalog", ctx.catalog)] });
  if (audit) {
    logActivityBatch(batch, db, { event: audit.event, rootId: ctx.rootId, actorUid: "SYSTEM_IQ_BENEFICIARY_LINK", actorRole: "system", referenceId: ctx.methodId, referenceType: "clientBeneficiaryMethod",
      description: audit.description, extra: { catalog: ctx.catalog, last4: ctx.account.last4, status: audit.status, source: audit.source } },
      db.collection("pay0ActivityLog").doc(linkActivityId(ctx.methodId, ctx.catalog, ctx.account.key, audit.outcomeKey)));
  }
  await batch.commit();
}

const linked = (found: { iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string }): IqLinkDecision => ({ status: "LINKED", iqBeneficiaryId: found.iqBeneficiaryId, iqAccountId: found.iqAccountId, iqBeneficiaryName: found.iqBeneficiaryName, nameDiffers: false });

async function settle(ctx: IqLinkContext, decision: IqLinkDecision, source: "CATALOG" | "LIVE_LOOKUP" | "CREATED_IN_IQ", createState: string | null = null): Promise<LinkOutcome> {
  const audited = decision.status === "LINKED" || decision.status === "REVIEW_REQUIRED";
  const event = source === "CREATED_IN_IQ" && decision.status === "LINKED" ? AUDIT_EVENT.CREATED : AUDIT_EVENT[decision.status];
  const entry = buildLinkEntry({ decision, key: ctx.account.key, last4: ctx.account.last4, source, createState }, FieldValue.serverTimestamp());
  await writeEntry(ctx, entry, audited && event ? { event, status: decision.status, source, outcomeKey: `${decision.status}:${source}:${createState ?? ""}`,
    description: decision.status === "LINKED" ? `Beneficiario vinculado con IQ (${source === "CATALOG" ? "catálogo" : source === "LIVE_LOOKUP" ? "consulta en vivo" : "creado en IQ"}), cuenta ****${ctx.account.last4}.` : `Varios beneficiarios de IQ coinciden con la cuenta ****${ctx.account.last4}; requiere revisión.` } : undefined);
  return { methodId: ctx.methodId, catalog: ctx.catalog, status: decision.status, createState };
}

// Admission refusals that only mean "not now": nothing is written, so the trigger can retry the same work.
const DEFERRABLE = new Set(["CAPACITY", "BACKOFF", "DEFERRED", "DEDUPLICATED"]);
const deferred = (ctx: IqLinkContext): LinkOutcome => ({ methodId: ctx.methodId, catalog: ctx.catalog, status: "DEFERRED" });

// A stop is either temporary (stored as PENDING_RETRY and re-driven on a schedule, up to a cap) or final
// for this account (NOT_FOUND with the reason). Final stops are not retried until the CLABE or card changes.
async function stop(ctx: IqLinkContext, reason: string, attempts = 1, nowMs = Date.now()): Promise<LinkOutcome> {
  const delay = retryDelayMs(reason);
  // Waiting for a switch to be turned on is not a failure: it never counts toward the cap.
  if (GATE_REASONS.has(reason)) attempts = 1;
  if (delay !== null && attempts <= MAX_RETRY_ATTEMPTS) {
    await writeEntry(ctx, { status: "PENDING_RETRY", reason, attempts, key: ctx.account.key, last4: ctx.account.last4, source: "CATALOG", retryAfter: Timestamp.fromMillis(nowMs + delay), checkedAt: FieldValue.serverTimestamp() });
    return { methodId: ctx.methodId, catalog: ctx.catalog, status: "PENDING_RETRY", createState: reason };
  }
  return settle(ctx, { status: "NOT_FOUND" }, "CATALOG", delay !== null ? "RETRY_EXHAUSTED" : reason);
}

type Reservation = { state: "NEW" | "CREATED" | "BLOCKED"; reason?: string; ids?: { iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string } };

const counterRef = (rootId: string, nowMs: number) => db.doc(`iqBeneficiaryCreateCounters/${rootId}_${mexicoDay(nowMs)}`);

// One transaction decides whether this account may be created now: an existing reservation wins
// (never twice), and today's counter is only spent together with the reservation.
async function reserveCreate(ctx: IqLinkContext, nowMs: number): Promise<Reservation & { reservationId: string }> {
  const reservationId = createReservationId(ctx.rootId, ctx.catalog, ctx.account.key);
  const reservationRef = db.doc(`iqBeneficiaryCreateReservations/${reservationId}`);
  const counter = counterRef(ctx.rootId, nowMs);
  const result = await db.runTransaction(async tx => {
    const [reservation, today, config, master] = await Promise.all([tx.get(reservationRef), tx.get(counter), tx.get(db.doc(`iqBeneficiaryCreateConfig/${ctx.rootId}`)), tx.get(db.doc(`iqIntegrationConfigs/${ctx.rootId}`))]);
    const status = text(reservation.data()?.status);
    if (status === "CREATED") return { state: "CREATED" as const, ids: { iqBeneficiaryId: Number(reservation.get("iqBeneficiaryId")), iqAccountId: Number(reservation.get("iqAccountId")), iqBeneficiaryName: text(reservation.get("iqBeneficiaryName")) } };
    if (reservation.exists && status !== "FAILED_SAFE") return { state: "BLOCKED" as const, reason: status || "RESERVED" };
    const gate = evaluateCreateGate({ masterEnabled: master.data()?.enabled === true, config: config.data(), createdToday: Number(today.data()?.count || 0) });
    if (!gate.allowed) return { state: "BLOCKED" as const, reason: gate.reason };
    tx.set(reservationRef, { rootId: ctx.rootId, catalog: ctx.catalog, key: ctx.account.key, last4: ctx.account.last4, methodId: ctx.methodId, status: "RESERVED", profileId: ctx.profile.profileId, reservedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(counter, { rootId: ctx.rootId, day: mexicoDay(nowMs), count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { state: "NEW" as const };
  });
  return { ...result, reservationId };
}

const closeReservation = (reservationId: string, patch: Record<string, unknown>) => db.doc(`iqBeneficiaryCreateReservations/${reservationId}`).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

// Gives back the day's slot of a create that never reached IQ, together with the reservation, atomically
// and never below zero.
async function releaseReservation(ctx: IqLinkContext, reservationId: string, nowMs: number, reason: string) {
  const reservationRef = db.doc(`iqBeneficiaryCreateReservations/${reservationId}`), counter = counterRef(ctx.rootId, nowMs);
  await db.runTransaction(async tx => {
    const today = await tx.get(counter);
    tx.set(reservationRef, { status: "FAILED_SAFE", reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (Number(today.data()?.count || 0) > 0) tx.set(counter, { count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

// Link first, create only when IQ really lacks the account. Nothing here writes to IQ unless the create
// gate (master switch, create switch, verified contract, proven absence, daily limit, kill switch) allows it.
export async function linkOrCreateMethod(input: { methodId: string; ports: IqLinkPorts; nowMs?: number; safety?: SafetyRuntime }): Promise<LinkOutcome[]> {
  const nowMs = input.nowMs ?? Date.now();
  const safety = input.safety ?? new SafetyRuntime(db);
  const methodSnap = await db.doc(`clientBeneficiaryMethods/${input.methodId}`).get();
  if (!methodSnap.exists) return [];
  const method = methodSnap.data() || {};
  const account = methodAccountRef(method);
  const rootId = text(method.rootId);
  if (!account || !rootId || method.active === false || method.isDeleted === true) return [];
  const clientId = text(method.clientId || method.clienteId);
  // The client first: most methods of clients without an IQ link stop here with a single read.
  const client = await db.doc(`clients/${clientId}`).get();
  if (!client.exists || client.get("rootId") !== rootId) return [{ methodId: input.methodId, catalog: "", status: "SKIPPED", skipped: "OWNERSHIP_MISMATCH" }];
  const profiles = catalogsForClient(client.data());
  if (!profiles.length) return [{ methodId: input.methodId, catalog: "", status: "SKIPPED", skipped: "NO_IQ_CLIENT_LINK" }];
  const beneficiary = await db.doc(`clientBeneficiaries/${text(method.beneficiaryId || method.beneficiarioId)}`).get();
  if (!beneficiary.exists || beneficiary.get("rootId") !== rootId || text(beneficiary.get("clientId") || beneficiary.get("clienteId")) !== clientId) return [{ methodId: input.methodId, catalog: "", status: "SKIPPED", skipped: "OWNERSHIP_MISMATCH" }];
  const beneficiaryName = text(beneficiary.get("nombre") ?? beneficiary.get("name"));

  const outcomes: LinkOutcome[] = [];
  for (const profile of profiles) {
    const existing = method.iqLinksByCatalog?.[profile.catalog];
    const ctx: IqLinkContext = { rootId, methodId: input.methodId, catalog: profile.catalog, profile, beneficiaryName, method, account };
    const retrying = existing?.key === account.key && text(existing.status) === "PENDING_RETRY";
    const attempts = retrying ? Number(existing.attempts || 0) + 1 : 1;
    // The write below triggers this function again; the same account in the same state is a no-op,
    // except a temporary stop, which is exactly what a retry has to pick up.
    if (existing?.key === account.key && text(existing.status) && !retrying) { outcomes.push({ methodId: input.methodId, catalog: profile.catalog, status: text(existing.status), skipped: "UNCHANGED" }); continue; }

    const catalogRows = await db.collection("iqBeneficiaryCatalog").where("rootId", "==", rootId).where("catalog", "==", profile.catalog).where("key", "==", account.key).get();
    // Only the client's own IQ associate counts; without its id the catalog cannot be trusted, so IQ is asked.
    const decision = resolveIqLink(beneficiaryName, rowsOfPartner(catalogRows.docs.map(doc => doc.data() as IqCatalogRow), profile.partnerId));
    if (decision.status !== "NOT_FOUND") { outcomes.push(await settle(ctx, decision, "CATALOG")); continue; }

    // The catalog may be stale: ask IQ for this account before deciding it does not exist.
    const master = (await db.doc(`iqIntegrationConfigs/${rootId}`).get()).data()?.enabled === true;
    if (!master) { outcomes.push(await stop(ctx, "IQ_MASTER_OFF", attempts, nowMs)); continue; }
    const reservationId = createReservationId(rootId, profile.catalog, account.key);
    // Per method and 10-minute window: another method with the same account is its own lookup, and a retry later is not a duplicate.
    const bucket = Math.floor(nowMs / 600_000);
    const lookup = await safety.run({ rootId, process: "IQ_BENEFICIARY_LINK", partition: profile.catalog, operationType: "IQ_BENEFICIARY_LOOKUP", operationId: `${reservationId}:${input.methodId}:${bucket}`, idempotencyKey: `${reservationId}:${input.methodId}:lookup:${bucket}`,
      origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: 20 } }, () => input.ports.liveLookup(ctx));
    if (!lookup.admitted) { outcomes.push(DEFERRABLE.has(String(lookup.reason)) ? deferred(ctx) : await stop(ctx, `SAFETY_${lookup.reason}`, attempts, nowMs)); continue; }
    const live = (lookup as { value?: LiveLookupResult }).value;
    if (!live) { outcomes.push(await stop(ctx, "LOOKUP_FAILED", attempts, nowMs)); continue; }
    if (live.found === "AMBIGUOUS") { outcomes.push(await settle(ctx, { status: "REVIEW_REQUIRED", candidates: live.candidates }, "LIVE_LOOKUP")); continue; }
    if (live.found) { outcomes.push(await settle(ctx, linked(live), "LIVE_LOOKUP")); continue; }
    // A name-only search does not prove the account is absent: it may exist under another name, and creating
    // would duplicate it. Only an account-level lookup allows going on to create.
    if (live.absenceProof !== "ACCOUNT") { outcomes.push(await stop(ctx, "ABSENCE_NOT_PROVEN", attempts, nowMs)); continue; }

    const reservation = await reserveCreate(ctx, nowMs);
    if (reservation.state === "CREATED" && reservation.ids) { outcomes.push(await settle(ctx, linked(reservation.ids), "CREATED_IN_IQ")); continue; }
    if (reservation.state === "BLOCKED") { outcomes.push(await stop(ctx, reservation.reason || "BLOCKED", attempts, nowMs)); continue; }

    const created = await safety.run({ rootId, process: "IQ_BENEFICIARY_LINK", partition: profile.catalog, operationType: "IQ_BENEFICIARY_CREATE", operationId: reservation.reservationId, idempotencyKey: `${reservation.reservationId}:create`,
      origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: 10 } },
      () => input.ports.create({ ...ctx, reservationId: reservation.reservationId }), value => value.outcome === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "SUCCEEDED");
    const result = (created as { value?: CreateResult }).value;
    if (!created.admitted) {
      // Nothing reached IQ: give the day's slot back and let the reservation be taken again.
      await releaseReservation(ctx, reservation.reservationId, nowMs, `SAFETY_${created.reason}`);
      outcomes.push(DEFERRABLE.has(String(created.reason)) ? deferred(ctx) : await stop(ctx, `SAFETY_${created.reason}`, attempts, nowMs));
      continue;
    }
    if (!result) { await closeReservation(reservation.reservationId, { status: "OUTCOME_UNKNOWN", reason: String(created.reason) }); outcomes.push(await stop(ctx, "OUTCOME_UNKNOWN")); continue; }
    if (result.outcome === "OUTCOME_UNKNOWN") {
      await closeReservation(reservation.reservationId, { status: "OUTCOME_UNKNOWN" });
      await writeEntry(ctx, buildLinkEntry({ decision: { status: "NOT_FOUND" }, key: account.key, last4: account.last4, source: "CREATED_IN_IQ", createState: "OUTCOME_UNKNOWN" }, FieldValue.serverTimestamp()),
        { event: AUDIT_EVENT.OUTCOME_UNKNOWN, status: "NOT_FOUND", source: "CREATED_IN_IQ", outcomeKey: "NOT_FOUND:CREATED_IN_IQ:OUTCOME_UNKNOWN", description: `No se sabe si IQ creó el beneficiario de la cuenta ****${account.last4}; no se reintenta solo.` });
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
