import type { ObservationIncident, ObservationReceipt, ObservationStore, ObservationTransaction, QuotaState } from "./store";

/** Persistence port supplied by the incident writer, not the detector identity.
 * Implementations must provide serializable/retrying transactions. This port
 * deliberately imports no Admin SDK and makes no ambient credential discovery.
 */
export interface IncidentPersistenceTransaction {
  read(path: string): Promise<unknown | null>;
  create(path: string, value: unknown): void;
  replace(path: string, value: unknown): void;
}
export interface IncidentPersistence {
  runTransaction<T>(operation: (transaction: IncidentPersistenceTransaction) => Promise<T>): Promise<T>;
}

export class NamespacedObservationStore implements ObservationStore {
  constructor(private readonly persistence: IncidentPersistence) {}

  transact<T>(rootDigest: string, operation: (transaction: ObservationTransaction) => Promise<T>): Promise<T> {
    if (!/^[a-f0-9]{64}$/.test(rootDigest)) throw new Error("INVALID_OBSERVATION_NAMESPACE");
    return this.persistence.runTransaction(async transaction => {
      const path = (collection: "quotas" | "receipts" | "incidents", key: string) => {
        if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("INVALID_OBSERVATION_KEY");
        return `sentinelObservationRoots/${rootDigest}/${collection}/${key}`;
      };
      return operation({
        readQuota: async key => await transaction.read(path("quotas", key)) as QuotaState | null,
        readReceipt: async key => await transaction.read(path("receipts", key)) as ObservationReceipt | null,
        readIncident: async key => await transaction.read(path("incidents", key)) as ObservationIncident | null,
        writeQuota: (key, value) => transaction.replace(path("quotas", key), value),
        createReceipt: (key, value) => transaction.create(path("receipts", key), value),
        writeIncident: (key, value) => transaction.replace(path("incidents", key), value),
      });
    });
  }
}
