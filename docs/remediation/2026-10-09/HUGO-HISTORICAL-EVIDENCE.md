# Hugo historical source evidence: proposed compatibility contract

2026-10-09. Design-only review of HUGO-RELEASE-PREFLIGHT (49446c7), 06e4527,
current stores, observer, logActivity and paymentApplications producers. No source
code edits, tests, historical data reads, cloud operations or model calls in this
review. The coordinator approved local implementation after reviewing this contract; execution gates remain deferred during the IQ predeploy window.

## Narrow compatibility

Resolve only a genuinely absent observation sourceSystem, not null, empty,
malformed or contradictory values. Require source ACTIVITY_LOG, valid existing
caseType and caseId, safe sourceActivityId and exact observation document identity
`activity_${sourceActivityId}`. The current and inspected historical observer use
that identity. Missing decision entity type/system is still an explicit failure;
never manufacture it from features, a prefix, matching IDs or related entities.

A server-only helper `resolveObservationEvidenceTx` receives the current
Firestore transaction, validated root and observation snapshot/ID. It returns an
ephemeral copy with the recovered system plus source provenance/timestamp. It
never updates the observation, activity log, decision or existing memory. The
pure identity/experience builders retain their strict contracts.

For missing system, read the exact sourceActivityId by tx.get in the five allowed
collections: pay0ActivityLog, assetsActivityLog, tttActivityLog, hugoActivityLog,
and activityLog. No collection queries, scans, client-chosen collection names or
out-of-transaction reads. Zero existing sources fails SOURCE_MISSING; more than
one existing source fails SOURCE_AMBIGUOUS even if values agree. A conflicting
source in another root is not silently ignored to select a convenient match.

The single source must have the same root and source event, an explicit valid
sourceSystem and a collection consistent with that system. If event/type/eventType
are present, contradictions fail. Resolve primary entity identity only from an
explicit complete referenceType/referenceId pair, or a complete entityType/entityId
pair when the reference pair is absent. A partial primary pair fails. Do not use
relatedEntityType/Id, referenceFolio or activityId as substitutes. The source tuple
must match the observation's existing typed identity, using only current
case-normalization aliases. Related entity fields may intentionally describe a
different entity and do not override primary identity. This consciously leaves
historical observations without explicit primary identity unverified; no claim
that every historical observation becomes promotable.

Require finite positive source and observation timestamps; backend activity logs
use Firestore createdAt. Source creation must not be later than observation
creation. Preserve original observation chronology. For outcomes, also require
the underlying source event time to be at/after the human decision (and applicable
correction); a late observer write must not turn a pre-decision event into a new
outcome. Do not require equality of separate server timestamps or replace original
observation times with log times.

## Verified legacy collection exception

paymentApplications/service.ts passes explicit activityLog references to
logActivityTx for PAGO_APLICADO_A_SOLICITUD and SOLICITUD_COMPLETADA. domain.ts
buildPaymentApplicationActivityId computes `paa_` plus the first52 SHA256 hex
characters of `applicationId|APPLIED` or `applicationId|COMPLETED` respectively.
The payload contains activitySchemaVersion2, atomicBatch:true,
paymentApplicationId and batchReservationId, plus explicit reference identity.

Permit activityLog only for these two producer contracts, with sourceSystem PAY0
explicit in the source, valid IDs/markers and an exact deterministic source ID
match. PAGO_APLICADO_A_SOLICITUD remains PAGO; SOLICITUD_COMPLETADA remains
SOLICITUD. Matching related IDs is not evidence of equality. No reads of payments,
applications or solicitudes are necessary for this exception. Legacy logs lacking
these verified markers fail closed rather than being inferred from an event name.

## Four consumers and budgets

| Consumer | In-transaction legacy resolution | Additional exact-document reads |
| --- | --- | --- |
| FirestoreHugoDataStore.linkVerifiedExperience | observation and outcome before identity/chronology/replay validation | <=10, five per observation |
| FirestoreHugoLearningStore.createDraftFromDecision | linked observation before strict builder | <=5 |
| FirestoreHugoLearningStore.createFromVerifiedMemory | observation and outcome before strict builder | <=10 |
| FirestoreHugoLearningStore.linkOutcome | terminal observation before identity/outcome validation | <=5 |

All source reads precede writes in the same existing transaction. Memoize only
within that transaction invocation; retries must reread, including missing source
candidates so a concurrent duplicate is detected. Explicit complete observations
retain existing strict validation without a new global historical-log requirement.
No default system is introduced anywhere. Existing learning create-method replay
returns remain unchanged and are not retroactive provenance certification.

The source documents are authoritative only under existing backend/IAM ownership:
Firestore direct writes are denied for these activity collections. This design
does not protect against compromised privileged backend writers. logActivity.extra
can override defined payload fields, so the resolver validates the persisted
contract; it does not assume a producer helper alone makes every payload valid.

## Proposed ownership and synthetic gates

- New functions/src/modules/agent007/observationEvidence.ts server-only helper.
- Narrow hunks in firestoreHugoDataStore.ts and firestoreHugoLearningStore.ts.
- No observer/logActivity, producer, callable/export, rule or integration edit.
- New qa/scripts/remediation-hugo-historical-evidence.test.cjs; an isolated demo
  transaction/emulator runner may follow once a CPU window is available.

Tests should execute all four actual store callbacks and strict builders. Cover
both legacy observations, mixed old/new, each canonical collection, both verified
activityLog producers, null/malformed explicit system, missing and duplicate logs,
root/event/type/id mismatch, conflicting event aliases, partial primary tuple,
forged sourceActivityId and observation ID, PAGO/SOLICITUD related-ID confusion,
missing decision identity, missing/NaN/future/reversed timestamps, and source
outcome earlier than decision despite later observation time. Assert zero writes
on rejection and byte-identical historical snapshots after success.

Transaction tests must change/delete the source or add an ambiguous duplicate
between first read and commit, then prove retry revalidates and cannot promote.
Count at most five candidate reads per observation, include absent docs in the
read set, fail any unexpected collection read, retain deterministic replay rules,
and keep HOLDOUT/GOLDEN isolation and no external model/provider calls.

This design addresses verifiable legacy compatibility only. It does not assert a
production cohort exists, certify historical authority or authorize a rollout.

## Local candidate prepared, execution deferred

The new helper and narrow hunks in the two stores are present locally. Builders,
observer, logActivity, producers, exports, rules and integration remain unchanged.
Verified exact producer linkage: observer.ts lines223/239/255 uses
`activity_${activityId}` and firestoreHugoDataStore.observationRef simply returns
collection.doc(id), without safeDocId/truncation. The resolver bounds source IDs
to151 characters so the prefixed observation fits consumer160 limits.

The coordinator released a synthetic-test window. The new fake suite and the
57 prior identity/provenance/phase5/phase6 regressions passed together: 89/89,
exit0. The first attempt had72 passing checks and one harness-load failure:
the older provenance test explicitly rejected the newly imported helper. Its
loader now compiles the actual helper and allowed dependencies; no validation
was stubbed or assertion removed. The second full run passed all89.

Transaction retry cases here are synthetic, not Firestore emulator evidence.
Functions build, phase4/5 emulator gates and any additional central checks remain
pending. Three TypeScript files are frozen for the coordinator's combined build
with other approved lots. No frontend, index, rule, producer or integration
change was made; no historical cloud reads/model calls/deployment occurred.

## Central build gate

Coordinator reports ROOT Functions build PASS with the frozen Hugo, notifier and
signedContract candidates. This agent did not run a concurrent build. The89
synthetic assertions and reviewed diff support committing the six owned files;
phase4/5 and historical transaction emulator evidence remain pending.
