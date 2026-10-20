# Hugo runtime and exact source artifact preflight

Read-only review, 2026-10-10 UTC. Candidate: `dfbe7ae`. This extends
[HUGO-RELEASE-PREFLIGHT.md](HUGO-RELEASE-PREFLIGHT.md) with fresh metadata and the
three previously missing deployed artifacts. No deploy, historical-record reads,
provider calls, integration edits, builds or test suites were performed.

## Exact deployed group

Project `pay-0-system`, region `us-central1`. All four Functions returned ACTIVE.
Sources use bucket `gcf-v2-sources-751158244178-us-central1` and object
`<export>/function-source.zip`.

| Export | Source generation | Revision | Last update UTC |
| --- | --- | --- | --- |
| linkAgent007VerifiedExperience | 1790583858009779 | linkagent007verifiedexperience-00002-fop | 2026-09-28T08:24:30.743908905Z |
| createAgent007LearningExperience | 1790583858403624 | createagent007learningexperience-00002-kim | 2026-09-28T08:24:46.661882452Z |
| createAgent007LearningDraft | 1790583861348821 | createagent007learningdraft-00002-sul | 2026-09-28T08:25:36.016719430Z |
| linkAgent007LearningOutcome | 1790583861314161 | linkagent007learningoutcome-00002-qad | 2026-09-28T08:25:34.563162566Z |

The three learning ZIPs were downloaded with the explicit `gs://...#generation`
selector into ignored `.firebase/hugo-release-preflight/<export>-<generation>.zip`.
The previously preserved linkVerified ZIP remains in
`%TEMP%/pay0-remediation-20261009-sources/linkAgent007VerifiedExperience-1790583858009779.zip`.
All four complete ZIPs have the same SHA256:
`c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
Thus this is one identical source archive deployed under four generation pins,
not an assumption based on nearby deployment times.

Archive inspection read only the five TypeScript entries below. No `.env`,
credentials or other private archive entries were opened. Hashing the whole ZIP
does not inspect or disclose its contents. Selected baseline and candidate source
copies and a redacted metadata summary are retained under the ignored directory.

| ZIP entry | Exact SHA256; identical in all four ZIPs |
| --- | --- |
| src/modules/agent007/callables.ts | 1867d9d7f587c3ca31d0b7487eaff2b3ca475c462f0eae93d5e19efaeb35f34d |
| src/modules/agent007/firestoreHugoDataStore.ts | a814b49752b6ad4aab6222e8e1eafa283183bbee413e9f1a5bc0ce17128bdfbe |
| src/modules/agent007/firestoreHugoLearningStore.ts | 79f11669f252a5e5ca34af7e225c59378dc925e1657409ac6d8344ed4da8741a |
| src/modules/agent007/observer.ts | fbd7ea33ee24fcd1dd8756714fee8419ecc7c2a5e74f08a44826c13c267e6e9a |
| src/utils/logActivity.ts | 48f33f765ba84b9cbd55c30abebd4b71fdf6ea6c7e7f62a025eaed3b35b92fbd |

## Runtime and configuration preservation contract

Fresh metadata agrees across all four exports:

| Field | Observed value |
| --- | --- |
| Runtime / entry point | nodejs22 / exact export name |
| Timeout / memory / CPU | 30 seconds / 256Mi / 1 |
| Maximum instances / request concurrency | 20 / 80 |
| Minimum instances | absent/null in returned metadata |
| Ingress | ALLOW_ALL |
| VPC connector / egress settings | absent/null |
| Runtime service account | 751158244178-compute@developer.gserviceaccount.com |
| Secret environment bindings | absent; no bound secret versions returned |

The redacted PowerShell summary serializes an absent secret list as `[null]`;
this is not a secret binding. Missing minimum/VPC fields are recorded as missing,
not asserted as explicit zero or a new deployment setting.

For all four exports, the only non-platform environment key returned was
`PAY0_FIREBASE_WEB_API_KEY`. Its value equals the integration dotenv value by
in-memory comparison. No differing or remote-only user keys were found. The
integration dotenv additionally contains `TELEGRAM_DOWNLOAD_TRANSPORT_MODE`.
No values were emitted or persisted. Runtime-managed environment keys were
excluded from the user-environment comparison. This does not certify build-time
environment, IAM bindings, or secret bindings on other exports.

Both deployed and candidate handlers declare only region `us-central1`, timeout
30 and memory `256MiB`; they do not explicitly pin the observed max20/concurrency80,
CPU, minimum, network or service account. Those values are observed configuration,
not a promise that a future CLI/SDK default preserves them. A release must compare
named fields, including null positions, and the intended environment before and
after deployment. Do not silently add the unrelated local Telegram variable or
claim environment preservation if the release intentionally adds it.

## Source comparison against dfbe7ae

`logActivity.ts` is unchanged after line-ending normalization. The three learning
callable handler blocks are unchanged. `linkAgent007VerifiedExperience` retains
the same request, response and runtime options; its audit description changes
the display name from Maria (accented in source) to Hugo. The guard changes reside
in their store dependencies and pure validation/resolution helpers.

Deployed promotion reads observation/decision/outcome outside a transaction,
checks matching entity IDs without complete type/system binding, and does not
explicitly reject non-finite decision timestamps. Candidate promotion reads the
evidence and existing deterministic target within one transaction, checks full
identity and finite chronology, and uses the historical evidence resolver.
Candidate learning stores pass explicit identity to the builders, resolve missing
observation provenance transactionally, validate outcome source time, and retain
the source system/type/ID in the outcome reference instead of hardcoding PAY0.
Existing learning create-method replay remains an early return; it is not
retroactive certification of historical evidence.

Historical compatibility follows
[HUGO-HISTORICAL-EVIDENCE.md](HUGO-HISTORICAL-EVIDENCE.md): only an absent
observation `sourceSystem` can be recovered from one unambiguous, scoped,
matching authoritative source log. Missing, ambiguous or contradictory evidence
fails closed, without rewriting history. No live historical records were sampled,
so the fraction of existing promotions satisfying this contract is unknown.

The deployed observer omits persisted `sourceSystem`. The candidate validates
and persists it. Deploying these four consumers does **not** replace observer
code bundled in other Functions. Their older observations remain dependent on
the resolver; no global producer deployment is necessary merely to release the
four consumer guards.

There are unrelated whole-file differences: deployed callables/DataStore contain
GLOBAL conversation ownership, scoped/date-paginated message and voice history,
model routing, platform read tools, dashboard support, and voice operational-state
persistence absent from the source-branch candidate. Do not overwrite integration
with these entire candidate files. Preserve the deployed/integration conversation
capabilities and apply only reviewed guard/helper changes. Limiting selectors to
the four consumers avoids republishing unrelated conversation endpoints, but is
not a substitute for preserving the integrated artifact's source capabilities.

## Release gate still open

The useful bounded selector remains exactly the four exports in the table.
Metadata pins and artifact equality are verified; a deployed fix is not claimed.
Before publishing: integrate compatible guard hunks, validate the final compiled
artifact and four selectors, rerun focused historical/identity transaction gates,
and compare runtime/environment configuration against this snapshot. Existing
build and test evidence in the parent release documents is historical evidence,
not a new run by this preflight. Recheck generation/revision immediately before
release; drift invalidates these pins. No cloud or integration mutation occurred.
