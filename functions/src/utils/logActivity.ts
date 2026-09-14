import type {
  DocumentReference,
  Firestore,
  Transaction,
  WriteBatch,
} from "firebase-admin/firestore";
import { FieldValue as FirestoreFieldValue, getFirestore } from "firebase-admin/firestore";
import {
  observeActivityForAgent007,
  observeActivityForAgent007Batch,
  observeActivityForAgent007Tx,
} from "../modules/agent007/observer";
import { getActivityEventMeta, normalizeActivityEventKey } from "../modules/activityLog/eventCatalog";

export type ActivityLogParams = {
  event: string;
  rootId: string;
  adminId?: string | null;

  actorUid: string;
  actorName?: string | null;
  actorUsername?: string | null;
  actorRole?: string | null;

  referenceId?: string | null;
  referenceFolio?: string | null;
  referenceType?: string | null;

  relatedEntityId?: string | null;
  relatedEntityType?: string | null;

  entityId?: string | null;
  entityType?: string | null;

  amount?: number | null;
  description?: string | null;
  text?: string | null;

  createdBy?: string | null;
  createdByRole?: string | null;

  extra?: Record<string, any>;
};

type LogParams = ActivityLogParams;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanOrNull(value: unknown): string | null {
  const next = clean(value);
  return next ? next : null;
}

function normalizeEventKey(value: unknown): string {
  return normalizeActivityEventKey(value);
}

function normalizeAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return Number(n.toFixed(2));
}

function withDefinedExtra(payload: Record<string, any>, extra: Record<string, any> | undefined) {
  if (!extra) return payload;

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  return payload;
}

export function buildActivityPayload(params: ActivityLogParams) {
  const event = normalizeEventKey(params.event);
  const description = clean(params.description || params.text || "");
  const actorUsername = clean(params.actorUsername || params.actorName || "");
  const actorName = clean(params.actorName || params.actorUsername || "");
  const eventMeta = getActivityEventMeta(event);

  if (!event) {
    throw new Error("event es requerido para activityLog");
  }

  if (!clean(params.rootId)) {
    throw new Error("rootId es requerido para activityLog");
  }

  if (!clean(params.actorUid)) {
    throw new Error("actorUid es requerido para activityLog");
  }

  const payload: Record<string, any> = {
    event,
    type: event,
    eventType: event,
    eventLabel: eventMeta.label,
    eventCategory: eventMeta.category,
    eventModule: eventMeta.module,
    eventSeverity: eventMeta.severity,

    rootId: clean(params.rootId),
    adminId: clean(params.adminId),

    actorUid: clean(params.actorUid),
    actorName,
    actorUsername,
    actorRole: clean(params.actorRole),

    referenceId: clean(params.referenceId),
    referenceFolio: clean(params.referenceFolio),
    referenceType: clean(params.referenceType),

    relatedEntityId: clean(params.relatedEntityId),
    relatedEntityType: clean(params.relatedEntityType),

    entityId: clean(params.entityId),
    entityType: clean(params.entityType),

    amount: normalizeAmount(params.amount),
    description,
    text: description,

    createdBy: clean(params.createdBy || params.actorUid),
    createdByRole: clean(params.createdByRole || params.actorRole),
    createdAt: FirestoreFieldValue.serverTimestamp(),
  };

  return withDefinedExtra(payload, params.extra);
}

export async function logActivity(params: LogParams) {
  const db = getFirestore();
  const payload = buildActivityPayload(params);
  const ref = await db.collection("activityLog").add(payload);
  await observeActivityForAgent007(db, ref.id, payload).catch(() => undefined);
}

export function logActivityTx(
  tx: Transaction,
  db: Firestore,
  params: ActivityLogParams,
  ref?: DocumentReference,
) {
  const activityRef = ref || db.collection("activityLog").doc();
  const payload = buildActivityPayload(params);
  tx.set(activityRef, payload);
  observeActivityForAgent007Tx(tx, db, activityRef.id, payload);
  return activityRef;
}
export function logActivityBatch(
  batch: WriteBatch,
  db: Firestore,
  params: ActivityLogParams,
  ref?: DocumentReference,
) {
  const activityRef = ref || db.collection("activityLog").doc();
  const payload = buildActivityPayload(params);
  batch.set(activityRef, payload);
  observeActivityForAgent007Batch(batch, db, activityRef.id, payload);
  return activityRef;
}
