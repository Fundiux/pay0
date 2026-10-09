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

## Follow-up HUGO-EVIDENCE-IDENTITY

After chronology/transaction fix6de1af4, a synthetic observation SOLICITUD/shared, confirmed decision SOLICITUD/shared and outcome PAGO/shared still created a confirmed SOLICITUD experience with outcomeKnown=true. A real backend producer in paymentApplications/service.ts writes PAGO_APLICADO_A_SOLICITUD with referenceType:pago and referenceId:batch.pagoId; its related solicitud ID is separate. Equality of raw IDs is not an entity relationship.

The same bypass was reproduced in learning builders and linkOutcome. Before correction, the initial20-case identity suite had3passes/17failures. The shared evidenceIdentity helper now requires explicit supported sourceSystem, canonical entity type and entity ID equality. Root checks remain at their existing transactional boundaries. Only case differences are normalized, justified by lower-case producer referenceType and upper-case observer caseType; no plural aliases, PAGO-to-SOLICITUD mappings or inferred parents were introduced.

The checks cover memory promotion, draft/verified learning creation, trace evidence references, caller-supplied feature entityType and later outcome attachment. Learning source adapters now carry caseType/sourceSystem and decision entity type/system instead of discarding them. Outcomes retain entity identity in their evidence references. Missing legacy type/system fails closed; this patch neither rewrites history nor claims prior experiences have been repaired.

Observer previously omitted sourceSystem from persisted observations. It now copies only an explicitly supported backend payload value and skips missing/invalid values; it does not default to PAY0. Existing production code calls observer solely through logActivity/logActivityTx/logActivityBatch. Their buildActivityPayload already computes sourceSystem through the existing inferActivitySystem backend routing before invoking observer. The regression executes this real producer with PAGO_APLICADO_A_SOLICITUD and verifies PAY0/PAGO propagation. No new source-system inference was added, and no missing producer was discovered in that call graph.

Synthetic tests invoke real data/learning stores, builders, observer and logging payload constructor with fake persistence only. They include same ID/different type, different or missing systems, missing type, wrong trace type, mismatched features, valid draft-to-outcome, valid verified creation, case-only aliases and positive pago/dispersion promotion. Existing phase5/phase6 and emulator fixture metadata was made explicit rather than weakening the new guards.

Direct access review: integration Firestore denies these collections via final catch-all; no client write allow exists. Manual observation callable whitelists its payload and never accepts ACTIVITY_LOG source. Promotion/review callables use actor(), require current superadmin profile and derive root server-side. ACTIVITY_LOG is assigned by the backend observer; the generic auth logging callable accepts only LOGIN/LOGOUT, which are not qualifying terminal events. This is source review of candidate rules, not a fresh production rules deployment check.

Evaluation boundary: HOLDOUT/GOLDEN and protectedCaseIds are blocked by retrieval/export and protected split transitions. TRAIN/VALIDATION/TEST are explicitly separate export partitions; this review does not label their presence as a proven leak. No model, training, TTS or financial provider was exercised.

Validation: Functions npm run build PASS in the window released by independent_review. Combined phase5-learning, phase6-hardening, remediation-hugo-memory-provenance and remediation-hugo-evidence-identity:57/57 PASS (23 identity cases,17 chronology/provenance cases,17 existing learning/hardening cases). git diff --check PASS. Emulator fixture metadata was updated but those emulator runners were not executed in this lot. No frontend, global index, rules, integration or remote changes. Existing historical observations produced before sourceSystem persistence cannot be newly promoted through these strict paths; an evidence-backed migration would be a separate authorized task. Already-created memories are not retroactively repaired or removed.
