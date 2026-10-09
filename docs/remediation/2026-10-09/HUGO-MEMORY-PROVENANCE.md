# Hugo: atomic verified-experience promotion

Review date: 2026-10-09. Scope: source branch remediation/pay0-integral-20261009. No production reads, model requests, TTS, IQ or deployment.

## Finding HUGO-MEMORY-PROVENANCE

`functions/src/modules/agent007/firestoreHugoDataStore.ts:linkVerifiedExperience` could persist an EXPERIENCE with CONFIRMED status and outcomeKnown=true when a nonempty decisionAt was not parseable. Date.parse returned NaN and both chronological comparisons evaluated false. Additionally, three independent reads followed by create allowed a concurrent decision rejection, supersession or root change to leave promotion based on stale evidence.

This is a promotion/provenance defect. A static foreign-root source was already rejected; the reproduction does not establish a general cross-tenant query leak or privilege escalation. The public callable derives root from the authenticated superadmin profile through actor(); it does not accept a caller-supplied root. The manual observation callable does not mint ACTIVITY_LOG provenance.

Consumer impact: retrieveMemory uses memoryApplicable and can select a confirmed entity experience without re-reading its linked evidence. The later learning builder separately validates chronological comparisons and rejects invalid dates; that downstream protection does not prevent the invalid confirmed memory from being created and selected earlier.

## Change

The method reads observation, decision, outcome and deterministic destination in one Firestore transaction. It validates finite positive timestamps, chronological order, existing source/root/case/link/status checks, and destination root before creating. Firestore retries when any source read changes before commit; the retried callback checks current evidence. Identical valid replay returns created=false; ID, content, link fields and verification contract remain stable. effectiveAt now derives from the validated outcome timestamp, without a fallback to the current time.

Owned implementation: functions/src/modules/agent007/firestoreHugoDataStore.ts. Regression: qa/scripts/remediation-hugo-memory-provenance.test.cjs. No authorization policy, rules, global exports, frontend or Telegram changes.

## Synthetic verification

The regression transpiles and invokes the actual store implementation with dependency fakes and an optimistic transaction harness that tracks read versions. It never loads Firebase credentials or contacts a provider. Before correction: 10/16 passed and six failed (two nonempty invalid decision dates, one negative observation timestamp, and three concurrent decision changes). After correction: 17/17 pass, including valid promotion/replay, invalid chronology, foreign roots for all sources, destination root mismatch, and commit-time rejection/supersession/root change with zero writes.

Command: `node --test qa/scripts/remediation-hugo-memory-provenance.test.cjs`.
Functions `npm run build` passed (TypeScript and canonical asset copy) in the coordinator's reserved window. No emulator claim: concurrency verification here is a deterministic transaction simulation, not an SDK contention test.

## Audit traceability and boundaries

- docs/audits/pay0-architecture-2026-10-07/02-MODULE-INVENTORY.md identifies agent007 observations, memory, learning and evals/hugo as a distinct domain.
- docs/audits/pay0-system-integral-2026-10-07/02-COMPLETE-FUNCTIONAL-INVENTORY.md distinguishes chat, observation, memory and experiments.
- docs/audits/pay0-system-integral-2026-10-07/05-FINANCIAL-AND-OPERATIONAL-INTEGRITY.md requires separate Hugo evidence; financial-chain checks do not prove memory integrity.
- FINDINGS.csv HUGO-RECEIPT-ROOT refers to receipt-pattern isolation (a43658b), not this generic verified-experience method. This change does not alter that finding or close the full Hugo review.

Negative evidence from the bounded review: reviewMemoryCandidate already uses a transaction and root checks; firestoreHugoLearningStore creation/correction/supersession use transaction/root checks; experienceBuilder independently checks finite ordered dates; learningGovernance requires reviewed eligibility for internal training and separate approval for external-provider training. Confirmed memory alone is not external training authorization.

Remaining: this fix does not inspect or repair historical confirmed experiences, does not retroactively invalidate an already-created experience when source evidence changes later, and does not claim an exhaustive audit of every Hugo write or direct rules path. Next concrete review: read-only inventory of persisted confirmed experiences against linked evidence, then define an explicit invalidation policy for evidence changed after a completed promotion. No historical backfill or deletion is authorized by this patch.
