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
  if (typeof previous.iqApplicable === "boolean" && data.iqApplicable === undefined) {
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
