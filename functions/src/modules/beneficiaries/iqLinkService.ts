import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";

import { logActivityBatch } from "../../utils/logActivity";
import { CONSERVATIVE_POLICY, SafetyRuntime } from "../automationSafety/runtime";
import { db } from "../sharedCallables/helpers";
import { methodAccountRef, resolveIqLink, rowsOfPartner, type IqCatalogRow, type IqLinkDecision } from "./iqCatalogDomain";
import {
  buildLinkEntry, catalogAbsenceProof, catalogMaxAgeMs, catalogsForClient, createReservationId, evaluateCreateGate, linkActivityId, MAX_RETRY_ATTEMPTS,
  MAX_UNKNOWN_OUTCOME_READS, mexicoDay, retryDelayMs, UNKNOWN_OUTCOME_REASON, WAITING_REASONS, type ClientCatalogProfile,
} from "./iqLinkDomain";

const text = (value: unknown) => String(value ?? "").trim();

export type IqLinkContext = {
  rootId: string; methodId: string; catalog: string; profile: ClientCatalogProfile;
  beneficiaryName: string; method: Record<string, any>; account: { key: string; last4: string };
};
// The name search is an extra chance to link; it never proves absence (only the catalog does).
export type LiveLookupResult =
  | { found: false; absenceProof?: "NAME" | "ACCOUNT" }
  | { found: true; iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string }
  | { found: "AMBIGUOUS"; candidates: number[] };
type CreatedIds = { iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string; conciliated?: boolean };
export type CreateResult =
  | ({ outcome: "CREATED" } & CreatedIds)
  | { outcome: "EXISTS" }
  | { outcome: "OUTCOME_UNKNOWN" }
  // Stopped before the account POST left (login, a read, the kill switch): safe to try again later.
  | { outcome: "NOT_SENT"; reason: string }
  // effect NONE: nothing was created in IQ; PARTIAL: at most an empty beneficiary.
  | { outcome: "REJECTED"; reason: string; effect: "NONE" | "PARTIAL" };
export type FindResult = ({ found: true } & CreatedIds) | { found: false } | { found: "AMBIGUOUS"; candidates: number[] };

// The three things that touch IQ. Production wires them in iqLinkPorts.ts; tests pass fakes.
export interface IqLinkPorts {
  liveLookup(input: IqLinkContext): Promise<LiveLookupResult>;
  create(input: IqLinkContext & { reservationId: string }): Promise<CreateResult>;
  // Account-level read under the client's associate; used after "ya existe" or a lost answer, never to create.
  findExisting(input: IqLinkContext): Promise<FindResult>;
}

export type LinkOutcome = { methodId: string; catalog: string; status: string; createState?: string | null; skipped?: string };

const AUDIT_EVENT: Record<string, string> = {
  LINKED: "IQ_BENEFICIARIO_VINCULADO", REVIEW_REQUIRED: "IQ_BENEFICIARIO_REVISION_REQUERIDA", CREATED: "IQ_BENEFICIARIO_CREADO", OUTCOME_UNKNOWN: "IQ_BENEFICIARIO_CREACION_INCIERTA",
};
const REVIEW_LABEL: Record<string, string> = {
  PARTNER_UNKNOWN: "falta el asociado IQ del cliente", ACCOUNT_IN_CATALOG: "la cuenta aparece cancelada o rechazada en IQ", OUTCOME_UNKNOWN: "no se sabe si IQ la creó",
  EXISTS_UNRESOLVED: "IQ indica que ya existe pero no se encontró", IQ_BANK_UNRESOLVED: "no se identificó el banco en IQ", IQ_BENEFICIARY_NAME_AMBIGUOUS: "hay varios beneficiarios con ese nombre en IQ",
};
const reviewText = (last4: string, createState: string | null) => createState
  ? `La cuenta ****${last4} requiere revisión antes de darla de alta en IQ: ${REVIEW_LABEL[createState] ?? "IQ rechazó el alta"}.`
  : `Varios beneficiarios de IQ coinciden con la cuenta ****${last4}; requiere revisión.`;

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
    description: decision.status === "LINKED" ? `Beneficiario vinculado con IQ (${source === "CATALOG" ? "catálogo" : source === "LIVE_LOOKUP" ? "consulta en vivo" : "creado en IQ"}), cuenta ****${ctx.account.last4}.` : reviewText(ctx.account.last4, createState) } : undefined);
  return { methodId: ctx.methodId, catalog: ctx.catalog, status: decision.status, createState };
}

const review = (ctx: IqLinkContext, createState: string, candidates: number[] = []) => settle(ctx, { status: "REVIEW_REQUIRED", candidates }, "CREATED_IN_IQ", createState);

// A new IQ account usually waits for IQ's conciliation. Until then the ids are kept, but the entry is not LINKED,
// so no dispersion uses it; the nightly catalog turns it LINKED once IQ shows it conciliated.
async function settleCreated(ctx: IqLinkContext, ids: CreatedIds, source: "CREATED_IN_IQ" | "LIVE_LOOKUP" = "CREATED_IN_IQ"): Promise<LinkOutcome> {
  if (ids.conciliated === true) return settle(ctx, linked(ids), source);
  await writeEntry(ctx, { status: "NOT_CONCILIATED", iqBeneficiaryId: ids.iqBeneficiaryId, iqAccountId: ids.iqAccountId, key: ctx.account.key, last4: ctx.account.last4, source, createState: "PENDING_CONCILIATION", checkedAt: FieldValue.serverTimestamp() },
    { event: source === "LIVE_LOOKUP" ? AUDIT_EVENT.LINKED : AUDIT_EVENT.CREATED, status: "NOT_CONCILIATED", source, outcomeKey: `NOT_CONCILIATED:${source}:PENDING_CONCILIATION`,
      description: source === "LIVE_LOOKUP" ? `La cuenta ****${ctx.account.last4} ya estaba en IQ; falta que IQ la concilie antes de usarla.` : `Beneficiario dado de alta en IQ, cuenta ****${ctx.account.last4}; IQ debe conciliar la cuenta antes de usarla.` });
  return { methodId: ctx.methodId, catalog: ctx.catalog, status: "NOT_CONCILIATED", createState: "PENDING_CONCILIATION" };
}

// Admission refusals that only mean "not now": nothing is written, so the trigger can retry the same work.
const DEFERRABLE = new Set(["CAPACITY", "BACKOFF", "DEFERRED", "DEDUPLICATED"]);
const deferred = (ctx: IqLinkContext): LinkOutcome => ({ methodId: ctx.methodId, catalog: ctx.catalog, status: "DEFERRED" });

// A stop is either temporary (stored as PENDING_RETRY and re-driven on a schedule, up to a cap) or final
// for this account (NOT_FOUND with the reason). Final stops are not retried until the CLABE or card changes.
// pendingSince survives retries, so a method waiting for more than a day shows up in the daily summary.
async function stop(ctx: IqLinkContext, reason: string, attempts = 1, nowMs = Date.now(), pendingSince?: unknown): Promise<LinkOutcome> {
  const delay = retryDelayMs(reason);
  // Waiting for a switch or for the catalog is not a failure: it never counts toward the cap.
  if (WAITING_REASONS.has(reason)) attempts = 1;
  if (delay !== null && attempts <= MAX_RETRY_ATTEMPTS) {
    await writeEntry(ctx, { status: "PENDING_RETRY", reason, attempts, key: ctx.account.key, last4: ctx.account.last4, source: "CATALOG", retryAfter: Timestamp.fromMillis(nowMs + delay),
      pendingSince: pendingSince instanceof Timestamp ? pendingSince : Timestamp.fromMillis(nowMs), checkedAt: FieldValue.serverTimestamp() });
    return { methodId: ctx.methodId, catalog: ctx.catalog, status: "PENDING_RETRY", createState: reason };
  }
  return settle(ctx, { status: "NOT_FOUND" }, "CATALOG", delay !== null ? "RETRY_EXHAUSTED" : reason);
}

type Reservation = { state: "NEW" | "BLOCKED"; reason?: string; take?: number };

const counterRef = (rootId: string, nowMs: number) => db.doc(`iqBeneficiaryCreateCounters/${rootId}_${mexicoDay(nowMs)}`);
const reservationRefOf = (reservationId: string) => db.doc(`iqBeneficiaryCreateReservations/${reservationId}`);
// A RESERVED create older than this lost its worker (timeout, crash): its outcome is unknown, never retaken.
const IN_FLIGHT_MS = 15 * 60_000;

// One transaction decides whether this account may be created now: an existing reservation wins
// (never twice), and today's counter is only spent together with the reservation.
async function reserveCreate(ctx: IqLinkContext, nowMs: number): Promise<Reservation & { reservationId: string }> {
  const reservationId = createReservationId(ctx.rootId, ctx.catalog, ctx.account.key);
  const reservationRef = reservationRefOf(reservationId);
  const counter = counterRef(ctx.rootId, nowMs);
  const result = await db.runTransaction(async tx => {
    const [reservation, today, config, master] = await Promise.all([tx.get(reservationRef), tx.get(counter), tx.get(db.doc(`iqBeneficiaryCreateConfig/${ctx.rootId}`)), tx.get(db.doc(`iqIntegrationConfigs/${ctx.rootId}`))]);
    const status = text(reservation.data()?.status);
    if (reservation.exists && status !== "FAILED_SAFE") return { state: "BLOCKED" as const, reason: status || "RESERVED" };
    const gate = evaluateCreateGate({ masterEnabled: master.data()?.enabled === true, config: config.data(), createdToday: Number(today.data()?.count || 0) });
    if (!gate.allowed) return { state: "BLOCKED" as const, reason: gate.reason };
    // Each take is its own safety operation, so a take released before anything was sent can be taken again.
    const take = Number(reservation.data()?.takes || 0) + 1;
    tx.set(reservationRef, { rootId: ctx.rootId, catalog: ctx.catalog, key: ctx.account.key, last4: ctx.account.last4, methodId: ctx.methodId, status: "RESERVED", takes: take, profileId: ctx.profile.profileId, reservedAt: Timestamp.fromMillis(nowMs), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(counter, { rootId: ctx.rootId, day: mexicoDay(nowMs), count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { state: "NEW" as const, take };
  });
  return { ...result, reservationId };
}

const closeReservation = (reservationId: string, patch: Record<string, unknown>) => reservationRefOf(reservationId).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
const createdIdsOf = (data: Record<string, any>): CreatedIds => ({ iqBeneficiaryId: Number(data.iqBeneficiaryId), iqAccountId: Number(data.iqAccountId), iqBeneficiaryName: text(data.iqBeneficiaryName), conciliated: data.conciliated === true });

// Gives back the day's slot of a create that never reached IQ, together with the reservation, atomically
// and never below zero.
async function releaseReservation(ctx: IqLinkContext, reservationId: string, nowMs: number, reason: string) {
  const reservationRef = reservationRefOf(reservationId), counter = counterRef(ctx.rootId, nowMs);
  await db.runTransaction(async tx => {
    const today = await tx.get(counter);
    tx.set(reservationRef, { status: "FAILED_SAFE", reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (Number(today.data()?.count || 0) > 0) tx.set(counter, { count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

type Run = { ctx: IqLinkContext; ports: IqLinkPorts; safety: SafetyRuntime; nowMs: number; attempts: number; pendingSince?: unknown };

const readPolicy = { ...CONSERVATIVE_POLICY, maxExternalRequests: 20 };

// The safety runtime spaces its operations (policy.spacingMs after each one). The read, the proof read and the create of the same
// account run back to back, so the next one is refused with CAPACITY for about a second. That is not a stop: wait it out a few times
// instead of deferring, or every attempt would defer at the create and never reach IQ.
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const SPACING_WAIT_MS = CONSERVATIVE_POLICY.spacingMs + 100, SPACING_RETRIES = 3;
async function admitted<R extends { admitted: boolean; reason?: unknown }>(attempt: () => Promise<R>): Promise<R> {
  let result = await attempt();
  for (let retry = 0; retry < SPACING_RETRIES && !result.admitted && String(result.reason) === "CAPACITY"; retry += 1) { await sleep(SPACING_WAIT_MS); result = await attempt(); }
  return result;
}
const bucketOf = (nowMs: number) => Math.floor(nowMs / 600_000);

// After "ya existe" or a lost answer the create is never sent again: IQ is read at account level and the
// result linked; what cannot be settled by reading goes to a person.
async function reconcile(run: Run, reservationId: string, cause: "OUTCOME_UNKNOWN" | "EXISTS"): Promise<LinkOutcome> {
  const { ctx } = run;
  const read = await run.safety.run({ rootId: ctx.rootId, process: "IQ_BENEFICIARY_LINK", partition: ctx.catalog, operationType: "IQ_BENEFICIARY_LOOKUP", operationId: `${reservationId}:reconcile:${ctx.methodId}:${bucketOf(run.nowMs)}`,
    idempotencyKey: `${reservationId}:${ctx.methodId}:reconcile:${bucketOf(run.nowMs)}`, origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: readPolicy }, () => run.ports.findExisting(ctx));
  const found = (read as { value?: FindResult }).value;
  if (found?.found === true) {
    await closeReservation(reservationId, { status: "CREATED", reconciledFrom: cause, iqBeneficiaryId: found.iqBeneficiaryId, iqAccountId: found.iqAccountId, iqBeneficiaryName: found.iqBeneficiaryName, conciliated: found.conciliated === true });
    return settleCreated(ctx, found);
  }
  if (found?.found === "AMBIGUOUS") { await closeReservation(reservationId, { status: "OUTCOME_UNKNOWN", reason: "RECONCILE_AMBIGUOUS" }); return review(ctx, cause === "EXISTS" ? "EXISTS_UNRESOLVED" : "OUTCOME_UNKNOWN", found.candidates); }
  if (cause === "EXISTS" && found?.found === false) { await closeReservation(reservationId, { status: "OUTCOME_UNKNOWN", reason: "EXISTS_UNRESOLVED" }); return review(ctx, "EXISTS_UNRESOLVED"); }
  await closeReservation(reservationId, { status: "OUTCOME_UNKNOWN", reason: cause === "EXISTS" ? "EXISTS_UNRESOLVED" : "NOT_FOUND_AFTER_UNKNOWN" });
  // Not found yet (IQ may still be writing it) or the read was refused: read again later, a bounded number of times.
  if (run.attempts < MAX_UNKNOWN_OUTCOME_READS) {
    await writeEntry(ctx, { status: "PENDING_RETRY", reason: UNKNOWN_OUTCOME_REASON, attempts: run.attempts, key: ctx.account.key, last4: ctx.account.last4, source: "CREATED_IN_IQ", createState: "OUTCOME_UNKNOWN",
      retryAfter: Timestamp.fromMillis(run.nowMs + (retryDelayMs(UNKNOWN_OUTCOME_REASON) ?? 21_600_000)), pendingSince: run.pendingSince instanceof Timestamp ? run.pendingSince : Timestamp.fromMillis(run.nowMs), checkedAt: FieldValue.serverTimestamp() },
      { event: AUDIT_EVENT.OUTCOME_UNKNOWN, status: "PENDING_RETRY", source: "CREATED_IN_IQ", outcomeKey: "PENDING_RETRY:CREATED_IN_IQ:OUTCOME_UNKNOWN",
        description: `No se sabe si IQ creó la cuenta ****${ctx.account.last4}; PAY0 solo la vuelve a buscar, no la envía otra vez.` });
    return { methodId: ctx.methodId, catalog: ctx.catalog, status: "PENDING_RETRY", createState: UNKNOWN_OUTCOME_REASON };
  }
  return review(ctx, "OUTCOME_UNKNOWN");
}

// Link first, create only when IQ really lacks the account. Nothing here writes to IQ unless the create
// gate (master switch, create switch, verified contract, catalog absence proof, daily limit, kill switch) allows it.
export async function linkOrCreateMethod(input: { methodId: string; ports: IqLinkPorts; nowMs?: number; safety?: SafetyRuntime; /** Authorized, decrypted server-memory only; never stored in Firestore. */ methodOverride?: { clabe?: string | null; cardNumber?: string | null } }): Promise<LinkOutcome[]> {
  const nowMs = input.nowMs ?? Date.now();
  const safety = input.safety ?? new SafetyRuntime(db);
  const methodSnap = await db.doc(`clientBeneficiaryMethods/${input.methodId}`).get();
  if (!methodSnap.exists) return [];
  const storedMethod = methodSnap.data() || {};
  if (input.methodOverride && (storedMethod.sourceType !== "PERSONAL_COMMISSION" ||
      !storedMethod.personalCommissionAccountId || !storedMethod.personalAccountFingerprint ||
      storedMethod.active !== true)) throw new Error("PERSONAL_IQ_OVERRIDE_NOT_ALLOWED");
  const method = input.methodOverride ? { ...storedMethod, ...input.methodOverride } : storedMethod;
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
    const pendingSince = retrying ? existing.pendingSince : undefined;
    const run: Run = { ctx, ports: input.ports, safety, nowMs, attempts, pendingSince };
    // The write below triggers this function again; the same account in the same state is a no-op,
    // except a temporary stop, which is exactly what a retry has to pick up.
    if (existing?.key === account.key && text(existing.status) && !retrying) { outcomes.push({ methodId: input.methodId, catalog: profile.catalog, status: text(existing.status), skipped: "UNCHANGED" }); continue; }

    const catalogRows = await db.collection("iqBeneficiaryCatalog").where("rootId", "==", rootId).where("catalog", "==", profile.catalog).where("key", "==", account.key).get();
    // Only the client's own IQ associate counts; without its id the catalog cannot prove anything.
    const partnerRows = rowsOfPartner(catalogRows.docs.map(doc => doc.data() as IqCatalogRow), profile.partnerId);
    const decision = resolveIqLink(beneficiaryName, partnerRows);
    if (decision.status !== "NOT_FOUND") { outcomes.push(await settle(ctx, decision, "CATALOG")); continue; }

    const master = (await db.doc(`iqIntegrationConfigs/${rootId}`).get()).data()?.enabled === true;
    if (!master) { outcomes.push(await stop(ctx, "IQ_MASTER_OFF", attempts, nowMs, pendingSince)); continue; }

    // A create already made, lost or in flight for this account in this catalog decides before anything else.
    const reservationId = createReservationId(rootId, profile.catalog, account.key);
    const prior = (await reservationRefOf(reservationId).get()).data();
    const priorStatus = text(prior?.status);
    if (priorStatus === "CREATED") { outcomes.push(await settleCreated(ctx, createdIdsOf(prior!))); continue; }
    if (priorStatus === "RESERVED" && nowMs - (prior?.reservedAt?.toMillis?.() ?? 0) < IN_FLIGHT_MS) { outcomes.push({ methodId: input.methodId, catalog: profile.catalog, status: "IN_PROGRESS" }); continue; }
    if (priorStatus === "RESERVED" || priorStatus === "OUTCOME_UNKNOWN") { outcomes.push(await reconcile(run, reservationId, "OUTCOME_UNKNOWN")); continue; }
    if (priorStatus === "REJECTED") { outcomes.push(await review(ctx, text(prior?.reason) || "REJECTED")); continue; }

    // The catalog may lag behind IQ: a name search can still find the account and link it.
    const lookup = await admitted(() => safety.run({ rootId, process: "IQ_BENEFICIARY_LINK", partition: profile.catalog, operationType: "IQ_BENEFICIARY_LOOKUP", operationId: `${reservationId}:${input.methodId}:${bucketOf(nowMs)}`, idempotencyKey: `${reservationId}:${input.methodId}:lookup:${bucketOf(nowMs)}`,
      origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: readPolicy }, () => input.ports.liveLookup(ctx)));
    if (!lookup.admitted) { outcomes.push(DEFERRABLE.has(String(lookup.reason)) ? deferred(ctx) : await stop(ctx, `SAFETY_${lookup.reason}`, attempts, nowMs, pendingSince)); continue; }
    const live = (lookup as { value?: LiveLookupResult }).value;
    if (!live) { outcomes.push(await stop(ctx, "LOOKUP_FAILED", attempts, nowMs, pendingSince)); continue; }
    if (live.found === "AMBIGUOUS") { outcomes.push(await settle(ctx, { status: "REVIEW_REQUIRED", candidates: live.candidates }, "LIVE_LOOKUP")); continue; }
    if (live.found) { outcomes.push(await settle(ctx, linked(live), "LIVE_LOOKUP")); continue; }

    // Proof of absence is the catalog: the associate read whole recently and no row for this account.
    const [catalogState, createConfig] = await Promise.all([db.doc(`iqBeneficiaryCatalogState/${rootId}_${profile.catalog}`).get(), db.doc(`iqBeneficiaryCreateConfig/${rootId}`).get()]);
    const proof = catalogAbsenceProof({ partnerId: profile.partnerId, partnerRows, state: catalogState.data(), nowMs, maxAgeMs: catalogMaxAgeMs(createConfig.data()) });
    // A beneficiary never waits for the catalog pass: with an old catalog IQ is read now, only for this associate, name and account.
    // Found: it is linked. Several matches: a person decides. Nothing: IQ is told to create it (its own duplicate answer is reconciled).
    let absent = proof.proven;
    const proofReason = proof.proven ? null : proof.reason;
    if (proofReason === "CATALOG_STALE" && Number(profile.partnerId) > 0) {
      const liveRead = await admitted(() => safety.run({ rootId, process: "IQ_BENEFICIARY_LINK", partition: profile.catalog, operationType: "IQ_BENEFICIARY_LOOKUP", operationId: `${reservationId}:${input.methodId}:absence:${bucketOf(nowMs)}`,
        idempotencyKey: `${reservationId}:${input.methodId}:absence:${bucketOf(nowMs)}`, origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: readPolicy }, () => input.ports.findExisting(ctx)));
      if (!liveRead.admitted) { outcomes.push(DEFERRABLE.has(String(liveRead.reason)) ? deferred(ctx) : await stop(ctx, `SAFETY_${liveRead.reason}`, attempts, nowMs, pendingSince)); continue; }
      const seen = (liveRead as { value?: FindResult }).value;
      if (!seen) { outcomes.push(await stop(ctx, "LOOKUP_FAILED", attempts, nowMs, pendingSince)); continue; }
      if (seen.found === true) { outcomes.push(await settleCreated(ctx, seen, "LIVE_LOOKUP")); continue; }
      if (seen.found === "AMBIGUOUS") { outcomes.push(await settle(ctx, { status: "REVIEW_REQUIRED", candidates: seen.candidates }, "LIVE_LOOKUP")); continue; }
      absent = true;
    }
    if (!absent) { outcomes.push(proofReason === "CATALOG_STALE" ? await stop(ctx, "CATALOG_STALE", attempts, nowMs, pendingSince) : await review(ctx, proofReason ?? "CATALOG_STALE")); continue; }

    const reservation = await reserveCreate(ctx, nowMs);
    if (reservation.state === "BLOCKED") {
      // Another worker took it between the read above and the transaction: it settles the method.
      if (reservation.reason === "RESERVED" || reservation.reason === "CREATED" || reservation.reason === "OUTCOME_UNKNOWN") { outcomes.push({ methodId: input.methodId, catalog: profile.catalog, status: "IN_PROGRESS" }); continue; }
      outcomes.push(await stop(ctx, reservation.reason || "BLOCKED", attempts, nowMs, pendingSince));
      continue;
    }

    const created = await admitted(() => safety.run({ rootId, process: "IQ_BENEFICIARY_LINK", partition: profile.catalog, operationType: "IQ_BENEFICIARY_CREATE", operationId: `${reservation.reservationId}:${reservation.take}`, idempotencyKey: `${reservation.reservationId}:create:${reservation.take}`,
      origin: "AUTOMATIC", technicalOrigin: "TRIGGER", externalTarget: "IQ", policy: { ...CONSERVATIVE_POLICY, maxExternalRequests: 30 } },
      () => input.ports.create({ ...ctx, reservationId: reservation.reservationId }), value => value.outcome === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "SUCCEEDED"));
    const result = (created as { value?: CreateResult }).value;
    if (!created.admitted) {
      // Nothing reached IQ: give the day's slot back and let the reservation be taken again.
      await releaseReservation(ctx, reservation.reservationId, nowMs, `SAFETY_${created.reason}`);
      outcomes.push(DEFERRABLE.has(String(created.reason)) ? deferred(ctx) : await stop(ctx, `SAFETY_${created.reason}`, attempts, nowMs, pendingSince));
      continue;
    }
    // A throw inside the create may have happened after the POST left: treated as a lost answer.
    if (!result || result.outcome === "OUTCOME_UNKNOWN") {
      await closeReservation(reservation.reservationId, { status: "OUTCOME_UNKNOWN", reason: result ? "IQ_NO_ANSWER" : String(created.reason) });
      outcomes.push(await reconcile({ ...run, attempts: 1 }, reservation.reservationId, "OUTCOME_UNKNOWN"));
      continue;
    }
    if (result.outcome === "EXISTS") { outcomes.push(await reconcile(run, reservation.reservationId, "EXISTS")); continue; }
    if (result.outcome === "NOT_SENT") {
      await releaseReservation(ctx, reservation.reservationId, nowMs, result.reason);
      outcomes.push(await stop(ctx, "CREATE_NOT_SENT", attempts, nowMs, pendingSince));
      continue;
    }
    if (result.outcome === "REJECTED") {
      // Nothing created: the slot comes back. An empty beneficiary may remain: the reservation stays closed.
      if (result.effect === "NONE") await releaseReservation(ctx, reservation.reservationId, nowMs, result.reason);
      else await closeReservation(reservation.reservationId, { status: "REJECTED", reason: result.reason });
      outcomes.push(await review(ctx, result.reason));
      continue;
    }
    await closeReservation(reservation.reservationId, { status: "CREATED", iqBeneficiaryId: result.iqBeneficiaryId, iqAccountId: result.iqAccountId, iqBeneficiaryName: result.iqBeneficiaryName, conciliated: result.conciliated === true });
    outcomes.push(await settleCreated(ctx, result));
  }
  return outcomes;
}
