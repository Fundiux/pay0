export type OperationRow = { id: string; [key: string]: any };

// Replace server fields (including removed fields), retaining only the explicit
// enrichment supplied by listPagos. Unchanged rows keep their React identity.
export function replaceOperationRow<T extends OperationRow>(
  rows: T[], id: string, data: OperationRow | null,
): T[] {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return rows;
  if (!data) return rows.filter((row) => row.id !== id);
  const previous = rows[index];
  const next = { ...data, id } as T;
  if (previous.createdBy === data.createdBy) {
    for (const key of ["createdByDisplayName", "createdByUsername", "createdByName"]) {
      if (!(key in data) && key in previous) next[key as keyof T] = previous[key];
    }
  }
  if (typeof previous.iqApplicable === "boolean") {
    Object.assign(next, { iqApplicable: previous.iqApplicable });
  }
  if (JSON.stringify(previous) === JSON.stringify(next)) return rows;
  const updated = rows.slice();
  updated[index] = next;
  return updated;
}

/** Reconcile subscriptions by ID; row updates never resubscribe the table. */
export function createOperationSubscriptions(
  subscribe: (id: string) => () => void,
) {
  const active = new Map<string, () => void>();
  return {
    reconcile(ids: string[]) {
      const wanted = new Set(ids);
      for (const [id, unsubscribe] of active) {
        if (!wanted.has(id)) { unsubscribe(); active.delete(id); }
      }
      for (const id of wanted) {
        if (!active.has(id)) active.set(id, subscribe(id));
      }
    },
    dispose() {
      for (const unsubscribe of active.values()) unsubscribe();
      active.clear();
    },
  };
}

export type OperationScope = {
  uid: string; rootId: string; role: string; fromMillis: number; toMillis: number; creatorUid?: string;
};
export type OperationDiscoverySeed = {
  scopeKey: string; boundary: { seconds: number; nanoseconds: number } | null;
};
export function operationCreatedMillis(row: OperationRow): number {
  const time = row.createdAt;
  return typeof time?.toMillis === "function" ? time.toMillis()
    : Number(time?.seconds ?? time?._seconds ?? 0) * 1000 + Number(time?.nanoseconds ?? time?._nanoseconds ?? 0) / 1e6;
}
export function operationBelongsToScope(row: OperationRow, collectionName: string, scope: OperationScope): boolean {
  if (!scope.uid || !scope.rootId) return false;
  if (row.rootId !== scope.rootId) return false;
  if (scope.role === "admin" && row.adminId !== scope.uid) return false;
  if (["operador", "operator"].includes(scope.role) && row.createdBy !== scope.uid) return false;
  if (!["superadmin", "admin", "operador", "operator"].includes(scope.role)) return false;
  if (["superadmin", "admin"].includes(scope.role) && scope.creatorUid && row.createdBy !== scope.creatorUid) return false;
  const at = operationCreatedMillis(row);
  return at >= scope.fromMillis && at <= scope.toMillis;
}
export function mergeDiscoveredOperationRows<T extends OperationRow>(rows: T[], incoming: OperationRow[]): T[] {
  let next = rows;
  for (const row of incoming) {
    next = next.some((item) => item.id === row.id)
      ? replaceOperationRow(next, row.id, row)
      : [...next, row as T];
  }
  if (next === rows) return rows;
  // Firestore orders by createdAt DESC, document ID ASC. Keep tie ordering stable.
  return next.slice().sort((a, b) => (Number(b.createdAt?.seconds ?? b.createdAt?._seconds ?? 0) - Number(a.createdAt?.seconds ?? a.createdAt?._seconds ?? 0)) || (Number(b.createdAt?.nanoseconds ?? b.createdAt?._nanoseconds ?? 0) - Number(a.createdAt?.nanoseconds ?? a.createdAt?._nanoseconds ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function operationDiscoverySeed(scopeKey: string, items: OperationRow[]): OperationDiscoverySeed {
  const time = items[items.length - 1]?.createdAt;
  return { scopeKey, boundary: time ? {
    seconds: Number(time.seconds ?? time._seconds), nanoseconds: Number(time.nanoseconds ?? time._nanoseconds ?? 0),
  } : null };
}
