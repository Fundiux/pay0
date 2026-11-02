# Deposit lease release: independent ownership fence proposal

Base: ca9b165 (documentation only after product 0f4b1d3). No product change yet.

`functions/src/modules/iq/depositHttpCreateFirebaseAdapters.ts:155` creates an adapter; acquire stores a random execution token and expiry in the payment and returns an AttemptLockLease without that token. At :274, release reads current status and clears expiry/updates retry block without comparing ownership. The public port is defined in `depositHttpCreateCore.ts:95`; the core calls release from finally after creation/recovery, so an older asynchronous invocation can arrive after a newer owner.

Regression `qa/scripts/payment-iq-deposit-lease-release.test.cjs` transpiles the real adapter with synthetic Firestore/Timestamp only. Result 51ac1d: two positive cases PASS, stale-owner safety FAIL. Sequence: acquire A; install synthetic B token and later expiry with PROCESSING_HTTP/retryBlocked=true; release A. Actual result retained token B but deleted B expiry, set retryBlocked=false and wrote A lockKey. Same-owner CREATED_RECOVERED still releases normally; same-owner OUTCOME_UNKNOWN retains retryBlocked=true. No network, provider, Storage or SDK was invoked. The B ownership write is controlled fixture setup, not a claim of natural transaction contention.

Proposed bounded fix: closure-private WeakMap keyed by the actual returned lease object, storing executionToken and immutable lockKey/lockedAt/expiry captured only after acquire transaction succeeds. Public AttemptLockLease remains unchanged and contains no token. Release first validates exact issued object and unchanged public fields; inside transaction it requires current executionToken and lease expiry to match the captured binding before any write. A stale, cloned, mutated or unknown lease performs no writes. A same-owner expired lease can still release; wall-clock expiry does not transfer ownership by itself. Missing expiry after an earlier release is an idempotent no-op. Preserve the current status-specific retry-block behavior for a matching owner.

Do not use a single mutable lastToken slot: a reused adapter can issue multiple leases and delayed release must remain associated with its original acquisition. Do not remove a binding before transaction completion in a way that prevents safe retry after a transient error; a retry must re-read current ownership. No owner token in errors/logs. This proposal does not fix acquire eligibility, generic journal transitions, provider evidence persistence, release overwriting unrelated fields beyond its current patch, or other alias writers.

Before accepting the fix: require original regression PASS plus cloned/mutated lease, mismatched persisted expiry, failed acquire, repeated release, UNKNOWN and same-owner terminal positives. Add versioned transaction retry that changes owner before callback re-execution. Real SDK gate only after review, with no provider. Journal/create/recovery/Rules and the larger evidence contract remain separate and unchanged.


## Candidate implementation, pending final review

The adapter now registers an immutable private binding in a WeakMap only after acquire commits. Release validates the issued object/public fields before I/O and again inside each transaction callback, then compares the current stored execution token and exact expiry. Nonowners do not write. The binding is retained across transient errors; repeated release after expiry removal is a no-op. No public interface, journal transition, core, Rules, provider or evidence schema changed.

Regression history: 51ac1d was the genuine pre-fix ownership failure (2 PASS/1 FAIL). Candidate 61d296 passed the first 13 cases; an additional expired-different-owner negative was then added. The fixture stages writes before committing and injects a versioned retry with ownership changed before the second callback; this is synthetic, not a natural SDK contention claim. Build/SDK/commit remain pending root review.

Final focused gate 822692: 14/14 PASS, exit0, 837ms; diffcheck PASS. Three candidate files frozen for review; no build/SDK/commit.


## Separate SDK gate prepared (not executed)

Root fullreview457fcf and focused106 (14+92)/policy94e8d0 PASS. A new source-pinned fixture `payment-iq-deposit-lease-sdk.test.cjs` transpiles the entire real adapter and supplies a closed Firestore facade backed by the actual demo SDK; it does not mock lock/release logic. SDK7.11.6/TS5.9.3 pins, loopback network guard and credential refusal are inherited from the reviewed runner pattern.

Demo project demo-pay0-iq-lease; ports18264/19264/14464/14564. One owned payment reference, no queries. Four cases: same-owner successful terminal release, same-owner UNKNOWN preserving retry block, delayed A release after synthetic B ownership, and injected ABORTED with ownership changed before the second transaction callback. Last two require unchanged updateTime and zero committed release writes. This is controlled mutation/injected retry, not natural contention. The source adapter is pinned to cf5aac9d5c191b71cf2d8e4552e9bdde58220c6eafc7b9f9eec345e34bd9a68c.

Positive acquisition/release snapshots verify owner/root/expected status/lease before adopting their updateTime. Cleanup uses only recorded times, no refresh, and confirms exact absence. No provider, Storage, core POST or new journal. Runner Prepare default, cached CLI15.3.1/JAR, bounded private logs, watchdog120/240s, own-tree cleanup and port closure. Syntax d58ee0 PASS; Prepare/Execute remain held for root review.


## Final reviewed evidence

Root full SDK review12f197; Prepare a95ff0 PASS; Execute19990/8e75ed terminal929f2d PASS four cases/one owned reference, CAS cleanup verified, ports closed, cloudCalls=0 and injectedAborted=true. NORMAL59873/43106b PASS; root106 focused tests and policy94e8d0 PASS. Preparation/pending statements above describe the historical sequence, not current gate status.

Private runtime `.firebase/remediation-temp/payment-iq-lease-4c5e7c3e8e214ef2b5f6ca52560e159d`. Bounded metadata inspection102708: stdout1557 bytes SHA256 `be4955db24cd05edf48f18e6cc05d272f1ab2c88013f9643951b01c4437be8a4`; stderr0 bytes. Executed source SHA256 `cf5aac9d5c191b71cf2d8e4552e9bdde58220c6eafc7b9f9eec345e34bd9a68c` matches the reviewed adapter. Fixture09d38097c4b0a94ad00e6b893e9814ece5696cd51ec2a22d93026e4e7d0b774b and runner66c3a1027dec0e7f153ce7982156c6f2ec96959b1bfa655ad9c016251d0cc65b remained unchanged.

The SDK scope remains the real adapter over an exact-reference demo facade with synthetic ownership changes and injected ABORTED; no natural contention or provider/Storage/POST claim. Cleanup adopts no late timestamps; only positive verified state captures and own mutations supply recorded preconditions. Root authorized the coherent five-file commit. No integration or deployment. Larger journal/evidence design remains documentation-only at ca9b165; this release fence does not close those races.
