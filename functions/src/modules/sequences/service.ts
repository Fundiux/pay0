import type { Transaction, DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export type SequenceScope =
  | "clients"
  | "companies"
  | "users"
  | "solicitudes"
  | "pagos"
  | "paymentApplications"
  | "dispersions"
  | "beneficiaries";

export interface NextSequenceInput {
  db: Firestore;
  tx: Transaction;
  rootId: string;
  scope: SequenceScope;
  scopeKey?: string | null;
}

export interface NextSequenceResult {
  sequenceNumber: number;
  counterPath: string;
}

function cleanPart(value: string | number | null | undefined): string {
  return String(value ?? "").trim();
}

function requireCleanPart(label: string, value: string | number | null | undefined): string {
  const cleaned = cleanPart(value);
  if (!cleaned) {
    throw new Error(`${label} requerido para secuencia.`);
  }
  return cleaned;
}

export function buildCounterPath(input: {
  rootId: string;
  scope: SequenceScope;
  scopeKey?: string | null;
}): string {
  const rootId = requireCleanPart("rootId", input.rootId);
  const scope = requireCleanPart("scope", input.scope);
  const rawScopeKey = cleanPart(input.scopeKey);

  const key = rawScopeKey || "global";
  return `counters/${rootId}/sequences/${scope}__${key}`;
}

export async function nextSequenceTx(input: NextSequenceInput): Promise<NextSequenceResult> {
  const counterPath = buildCounterPath({
    rootId: input.rootId,
    scope: input.scope,
    scopeKey: input.scopeKey,
  });

  const ref: DocumentReference = input.db.doc(counterPath);
  const snap = await input.tx.get(ref);
  const current = snap.exists ? Number((snap.data() as any)?.value || 0) : 0;
  const next = current + 1;

  input.tx.set(
    ref,
    {
      rootId: input.rootId,
      scope: input.scope,
      scopeKey: cleanPart(input.scopeKey) || "global",
      value: next,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: snap.exists ? (snap.data() as any)?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    sequenceNumber: next,
    counterPath,
  };
}

export interface ReserveSequenceRangeInput extends NextSequenceInput {
  count: number;
}

export interface ReserveSequenceRangeResult {
  firstSequenceNumber: number;
  lastSequenceNumber: number;
  sequenceNumbers: number[];
  counterPath: string;
}

export async function reserveSequenceRangeTx(
  input: ReserveSequenceRangeInput,
): Promise<ReserveSequenceRangeResult> {
  const count = Math.trunc(Number(input.count));

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("count invalido para reservar secuencia.");
  }

  const counterPath = buildCounterPath({
    rootId: input.rootId,
    scope: input.scope,
    scopeKey: input.scopeKey,
  });

  const ref: DocumentReference = input.db.doc(counterPath);
  const snap = await input.tx.get(ref);

  const current = snap.exists
    ? Number((snap.data() as any)?.value || 0)
    : 0;

  const firstSequenceNumber = current + 1;
  const lastSequenceNumber = current + count;

  input.tx.set(
    ref,
    {
      rootId: input.rootId,
      scope: input.scope,
      scopeKey: cleanPart(input.scopeKey) || "global",
      value: lastSequenceNumber,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: snap.exists
        ? (snap.data() as any)?.createdAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    firstSequenceNumber,
    lastSequenceNumber,
    sequenceNumbers: Array.from(
      { length: count },
      (_, index) => firstSequenceNumber + index,
    ),
    counterPath,
  };
}
export function buildCanonicalFolio(
  prefix: "S" | "P" | "D" | "C" | "U" | "E" | string,
  sequenceNumber: number,
  parts?: Array<{ label: string; value: string | number | null | undefined }>
): string {
  const seq = Number(sequenceNumber);

  if (!Number.isFinite(seq) || seq <= 0) {
    throw new Error("sequenceNumber invalido para folio.");
  }

  const cleanPrefix = cleanPart(prefix).toUpperCase();
  if (!cleanPrefix) {
    throw new Error("prefix requerido para folio.");
  }

  const base = `${cleanPrefix}${seq}`;

  const suffix = (parts || [])
    .map((part) => {
      const label = cleanPart(part.label).toUpperCase();
      const value = cleanPart(part.value);

      if (!label || !value) {
        return "";
      }

      return `${label}${value}`;
    })
    .filter(Boolean)
    .join("");

  return `${base}${suffix}`;
}
export function normalizeSequenceNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
