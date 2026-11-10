const assert = require('node:assert/strict');
const speed = require('../../functions/lib/modules/iq/solicitudCreateSpeedup');
const runtime = require('../../functions/lib/modules/iq/automationRuntime');
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const NOW = Date.UTC(2026, 10, 10, 18, 0, 0);
const ts = ms => ({ toMillis: () => ms });

// 1) interval claim slack: bounded, never more than a quarter of the interval.
check(runtime.claimSlackMs(20 * 60_000), 15_000, 'a 20 minute interval gets 15 s of slack');
check(runtime.claimSlackMs(60_000), 15_000, 'a 1 minute interval gets a quarter minute');
check(runtime.claimSlackMs(20_000), 5_000, 'a tiny interval gets at most a quarter of itself');

// 2) recovery of NOT_ENQUEUED solicitudes.
const stuck = (extra = {}) => ({ iqCreateQueueStatus: 'NOT_ENQUEUED', status: 'PROCESANDO', createdBy: 'u1', ...extra });
check(speed.recoveryDecision(stuck(), NOW), 'RETRY', 'a stuck solicitud is retried');
check(speed.recoveryDecision(stuck({ iqCreateQueueStatus: 'QUEUED' }), NOW), 'SKIP_STATUS', 'a queued solicitud is left alone');
check(speed.recoveryDecision(stuck({ iqId: '123' }), NOW), 'SKIP_HAS_FOLIO', 'a solicitud with folio is never recreated');
check(speed.recoveryDecision(stuck({ status: 'RECHAZADA' }), NOW), 'SKIP_DELETED', 'a rejected solicitud is skipped');
check(speed.recoveryDecision(stuck({ isDeleted: true }), NOW), 'SKIP_DELETED', 'a deleted solicitud is skipped');
check(speed.recoveryDecision(stuck({ iqCreateRecoveryAttempts: 4 }), NOW), 'SKIP_EXHAUSTED', 'the attempt cap stops retries');
check(speed.recoveryDecision(stuck({ createdBy: '' }), NOW), 'SKIP_NO_REQUESTER', 'no requester, no retry');
check(speed.recoveryDecision(stuck({ iqCreateRecoveryAttempts: 1, iqCreateRecoveryAt: ts(NOW - 60_000) }), NOW), 'SKIP_TOO_SOON', 'attempts are spaced out');
check(speed.recoveryDecision(stuck({ iqCreateRecoveryAttempts: 2, iqCreateRecoveryAt: ts(NOW - 5 * 60_000) }), NOW), 'SKIP_TOO_SOON', 'spacing grows with attempts');
check(speed.recoveryDecision(stuck({ iqCreateRecoveryAttempts: 2, iqCreateRecoveryAt: ts(NOW - 7 * 60_000) }), NOW), 'RETRY', 'a spaced attempt goes through');
check(speed.recoveryRequester({ iqCreateQueuedBy: 'q', createdBy: 'c' }), 'q', 'the original requester is preferred');

// 3) draining a profile.
const job = (id, extra = {}) => ({ id, status: 'QUEUED', nextRunAt: ts(NOW - 1000), ...extra });
const picked = speed.selectDrainJobs([
  job('a'), job('b', { nextRunAt: ts(NOW + 60_000) }), job('c', { retryBlocked: true }), job('d', { status: 'PROCESSING' }),
  job('e', { status: 'FAILED_RETRYABLE', nextRunAt: ts(NOW - 5000) }), job('f', { nextRunAt: null }), job('g'), job('h'),
], { nowMs: NOW, excludeIds: ['a'], max: 3 });
check(picked.map(x => x.id), ['f', 'e', 'g'], 'only due, unblocked, not-yet-taken jobs, oldest first (no date first), up to the room left');
check(speed.selectDrainJobs([job('a')], { nowMs: NOW, excludeIds: [], max: 0 }), [], 'no room, nothing drained');

// 4) lock busy: bounded retries with growing delay, never beyond the cap.
check(speed.lockBusyRetryPlan(0), { retry: true, delaySeconds: 15, nextRetry: 1 }, 'first wait is 15 s');
check(speed.lockBusyRetryPlan(2), { retry: true, delaySeconds: 29, nextRetry: 3 }, 'third wait is under 30 s');
check(speed.lockBusyRetryPlan(3).retry, false, 'after the cap the scheduled queue takes over');

// 5) first status check.
check(speed.STATUS_MONITOR_FIRST_CHECK_MS, 3 * 60_000, 'first status check at three minutes');
console.log('IQ CREATE SPEEDUP OK', checks);
