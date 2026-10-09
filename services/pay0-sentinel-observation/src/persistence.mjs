const pathPattern = /^sentinelObservationRoots\/[a-f0-9]{64}\/(quotas|receipts|incidents)\/[a-f0-9]{64}$/;
export const GLOBAL_PATH = 'sentinelAdmission/global';
export class GlobalQuotaExceeded extends Error { constructor() { super('GLOBAL_QUOTA'); } }
function increment(previous, now, duration, limit) {
  const start = Math.floor(now / duration) * duration;
  if (previous && (!Number.isSafeInteger(previous.start) || previous.start < 0 || previous.start > now || !Number.isSafeInteger(previous.count) || previous.count < 0)) throw new Error('INVALID_ADMISSION_STATE');
  const count = previous?.start === start ? previous.count : 0;
  if (count >= limit) throw new GlobalQuotaExceeded();
  return { start, count: count + 1 };
}

/** No ambient project selection. All staged writes commit with global admission.
 * The SDK instance is created separately with dedicated project+database only. */
export class FirestoreIncidentPersistence {
  constructor(db, timestampFromMillis, config, now = () => Date.now()) {
    this.db = db; this.timestamp = timestampFromMillis; this.config = config; this.now = now;
    if (config.projectId === 'pay-0-system' || config.databaseId !== 'sentinel-observation') throw new Error('ISOLATION_CONFIG_REQUIRED');
  }
  async runTransaction(operation) {
    return this.db.runTransaction(async tx => {
      const admissionRef = this.db.doc(GLOBAL_PATH);
      const admission = await tx.get(admissionRef);
      const staged = [];
      const path = value => { if (!pathPattern.test(value)) throw new Error('INVALID_OBSERVATION_PATH'); return this.db.doc(value); };
      const result = await operation({
        read: async value => { const snap = await tx.get(path(value)); return snap.exists ? snap.data() : null; },
        create: (value, data) => staged.push({ kind: 'create', ref: path(value), value, data }),
        replace: (value, data) => staged.push({ kind: 'set', ref: path(value), value, data }),
      });
      if (!staged.length) return result;
      if (staged.length !== 4 || staged.filter(row => row.kind === 'create' && row.value.includes('/receipts/')).length !== 1) throw new Error('INVALID_OBSERVATION_WRITESET');
      const now = this.now();
      const previous = admission.exists ? admission.data() : null;
      if (previous && (!previous.minute || !previous.day)) throw new Error('INVALID_ADMISSION_STATE');
      const minute = increment(previous?.minute, now, 60000, this.config.globalPerMinute);
      const day = increment(previous?.day, now, 86400000, this.config.globalPerDay);
      tx.set(admissionRef, { minute, day, expiresAt: this.timestamp(now + 172800000) });
      for (const row of staged) {
        const expiry = row.value.includes('/quotas/') ? now + 172800000 : row.data.expiresAtMs;
        if (!Number.isSafeInteger(expiry) || expiry <= now) throw new Error('INVALID_EXPIRY');
        tx[row.kind](row.ref, { ...row.data, expiresAt: this.timestamp(expiry) });
      }
      return result;
    }, { maxAttempts: 3 });
  }
}

/** Translate quota into core's existing QUOTA result without modifying core.
 * Callback completed but all its writes were only staged; transaction rolls back. */
export class GlobalAdmissionStore {
  constructor(store) { this.store = store; }
  async transact(root, callback) {
    try { return await this.store.transact(root, callback); }
    catch (error) {
      if (error instanceof GlobalQuotaExceeded) return { decision: 'OBSERVE_ONLY', restricted: false, outcome: 'QUOTA' };
      throw error;
    }
  }
}
