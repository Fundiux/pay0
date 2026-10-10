# Remaining IQ executors: read-only preflight

2026-10-10. Candidate: integration 5a4457e. No integration edits, deployment, IQ call, message, financial data query, task execution or cloud mutation. Scope was expanded by the coordinator from solicitud3 + dispersion2 to include executeUserCommissionDispersion, a real transitive consumer of the dispersion core.

## Decision

Prepare two logical groups: solicitud3 and dispersion/comision3. Metadata and immutable source pins match the retained baselines for all six. Do not yet declare either group deploy-ready: SDK/CLI option preservation, exact environment grouping, transitive authorization/USER tests and candidate build/discovery remain explicit gates. Publishing dispersion2 alone leaves commission execution on its old ambiguity classifier.

## Current metadata and immutable artifacts

All six report ACTIVE, nodejs22, CPU1, 2GiB, ALLOW_ALL and the same existing Compute runtime identity. Minimum instances and VPC fields were omitted, not interpreted as zero/empty. Metadata fields were projected; environment values were discarded in memory and never emitted or saved. Secret metadata contains names and versions only.

| Export | Revision | Source generation | Timeout | Max / concurrency | ZIP group |
| --- | --- | --- | --- | --- | --- |
| createSolicitudIq | createsolicitudiq-00057-tar | 1790638545651227 | 300s | 20 / 1 | A |
| processIqCreateOnDemandTask | processiqcreateondemandtask-00009-qey | 1791410490996895 | 540s | 1 / 1 | C |
| processIqCreateQueue | processiqcreatequeue-00019-dut | 1791410577000980 | 540s | 20 / 80 | C |
| createClientDispersionIq | createclientdispersioniq-00022-hoy | 1790638546049323 | 540s | 1 / 1 | A |
| processIqDispersionCreate | processiqdispersioncreate-00011-nor | 1790638545671737 | 540s | 1 / 1 | A |
| executeUserCommissionDispersion | executeusercommissiondispersion-00002-fow | 1790638545592528 | 540s | 2 / 80 | A |

Retained ZIP SHA256, rechecked locally against the earlier immutable-generation inventory:

- A: 8eb3cdb9f23e011defe720e4ccd09edd0fe50a50318d6ed56df5a0cb78a6b056.
- C: 07d05e50d00feba5dbe9eabcc4e8333cf52641752057a8aa0bafb94dd656316f.

All six named ZIPs already existed privately and matched their prior hashes; no replacement/download was needed. Generation equality links each live function to its own retained artifact, despite identical package hashes within groups. No recovered code was executed or full ZIP extracted. Private projections/comparisons remain under ignored .firebase/iq-unknown-preflight; they are not committed.

## Environment and runtime preservation

All six bind IQ_CREDENTIALS_KEY version2. Solicitud3 additionally binds TELEGRAM_BOT_TOKEN version1; dispersion/comision3 does not. Preserve these exact bindings rather than importing Telegram credentials through a blanket deployment environment.

All six expose the intended public web configuration key name PAY0_FIREBASE_WEB_API_KEY. Only processIqCreateOnDemandTask additionally exposes PAY0_OPERATION_TIMING. Other returned names are EVENTARC_CLOUD_EVENT_SOURCE, FIREBASE_CONFIG, FUNCTION_SIGNATURE_TYPE, FUNCTION_TARGET, GCLOUD_PROJECT and LOG_EXECUTION_ID. They are platform environment names, not a dotenv template.

This pass inspected names only, not equality or timing value classification. Therefore a single dotenv map for solicitud3 is not justified. A future deploy helper must compare approved user-environment maps in memory and preserve per-endpoint presence and values, excluding generated platform fields and unrelated Telegram transport flags. Likely groups are manual+scheduler versus Task, but key presence alone does not prove map equality. No dotenv file was changed.

Preventive blocker: these six source options do not yet set preserveExternalChanges. createSolicitudIq and processIqCreateQueue also omit maxInstances although their current maximum is20. The documented SDK/CLI behavior can emit null resets for omitted settings without preservation. Explicit max1/max2 in the other handlers protects only that field, not omitted min/ingress/VPC/identity. Do not rely solely on postflight to catch a reset after publication. Extend the actual SDK/CLI manifest/PATCH test to all six, including CPU/concurrency and source precedence, before approving any option patch. No such patch was made here. Preserve current20 as a known present value; this is distinct from the automatic-deposit absent-to20 investigation.

## Jobs and pauses at 17:29:53Z

Five bounded metadata GETs refreshed the relevant queue and four schedulers without retrieving task payloads, targets, headers or URLs.

| Resource | Observed state and settings |
| --- | --- |
| processIqCreateOnDemandTask queue | RUNNING; concurrent1, dispatch1/s, burst10; maxAttempts1, backoff60..300s, maxDoublings16 |
| processIqCreateQueue scheduler | ENABLED; every1minute; America/Mexico_City; deadline540s |
| processIqDispersionCreate scheduler | ENABLED; every5minutes; same zone; deadline540s |
| syncTodayIqInvoicesNow scheduler | PAUSED; every24hours; same zone; deadline540s |
| checkPaymentComplementsDaily scheduler | PAUSED; 0 19 * * 1-5; same zone; deadline540s; retry duration0s/backoff5..3600s/doublings5 |

Task stats returned effectiveExecutionRate1 but no task count or concurrent execution count. Do not claim empty/drained queues or absence of financial work. No Firestore runtime root/REP configuration was read; scheduler pause is not proof of every runtime policy value. Source retains solicitudCreate and dispersionCreate automation checks. Enabled schedulers can perform pending work after publication; the deployment is not an effects-free runtime test.

## Exact source comparison and authority boundaries

A local comparison read only 15 selected source/code entries per retained artifact and compared source against git show 5a4457e. For A, solicitudHttpCreateA53, solicitudCreationCallables, solicitudCreateQueueCallables, dispersionHttpCreateCore, dispersionCreationCallables, automationRuntime, authGuard and users/authorization differ. IQ authorization, commissionInstrumentBinding and commission execution/withdrawal/requests are identical. authorizeDeferredIntent and automationSafety/runtime are absent from the old package.

C contains compiled JS only for its executed solicitud modules; there is no TS comparison claim for C. Its ZIP is byte-identical to the earlier reviewed C package. Candidate solicitud/dispersion/commission sources and authorizeDeferredIntent are unchanged between9616055 and5a4457e; the IQ delta in that range is only deposit option preservation. Accordingly the earlier C semantic review can be carried forward for those unchanged modules, not presented as a fresh build or whole-package equivalence.

Relevant behavior retained/added:

- Manual solicitud: preserved associated-name, invoice identity, dispatch checks and request shape; adds current source-root and actor/client authorization immediately before provider POST. Solicitud HTTP still bounds the401 refresh and reauthorizes it; ambiguous outcomes remain UNKNOWN and cannot authorize another POST.
- Solicitud queue: retains C's deleted-source protection, transactional QUEUED/FAILED_RETRYABLE claim, current source validation and empty-batch skip. New authorizeSolicitudJob rereads the source, rejects terminal/out-of-scope state, validates requestedBy lifecycle/role/root/client permission and despacho access. The original economic identity is not replaced by a scheduler identity.
- Dispersion: manual/scheduler invoke runCreateClientDispersionIqCore; current principal root and actor permission are rechecked before POST. Client-funded operations require operateDispersiones access. USER-funded operations preserve owner matching, with the existing superadmin rule; no client delegation is fabricated for USER funding. Associated-name, instrument binding and persisted IQ identity already exist in actual A, so these are not new migrations inferred from unrelated C modules.
- Commission: execution.ts itself is identical to A, but dynamically imports the changed dispersion core. Its unchanged wrapper is not proof of unchanged effective policy. commissionAccountActor, assertCommissionWithdrawalOwner, userDestinations, funding/reservation/release and the common authorization guard remain distinct gates. UNKNOWN must not release held funds or cause a repeat POST. Positive owner and rejection scenarios must accompany any claim of compatibility.
- Authorization policy now flows through current users/authorization, defaultModules and trusted restrictions, plus client-delegation validation at deferred boundaries. No new user restriction writer is activated by these six exports. Integration5a4457e keeps synchronous authGuard free of Sentinel observation imports; only listUsers opts into the disabled observation port. No new Sentinel notifier activation or KMS/Logging binding follows from this IQ release.

No production user/profile values were queried to infer policy readiness. Telegram notifications remain a separate effect in solicitud processing and were not exercised. A notifier failure or permission change must not be confused with a demonstrated provider rejection; synthetic outcome/recovery tests are required for that boundary.

## Required release gates and recovery

1. Fix a final integration SHA and verify this six-export scope, retaining dispersion/comision3 coherence. Do not include enqueue-only exports, REP, syncToday or unrelated notification handlers incidentally.
2. Preventively validate manifest and outgoing PATCH for all six runtime configurations. Preserve fields and named presence explicitly, then independently snapshot GCF/Run service/template/revision settings as appropriate. Do not adopt a new default silently.
3. Compare environment maps in memory and construct exact deploy groups with journal/hash restoration. Values and secret payloads must remain out of logs. Preserve Task timing presence without spreading it to five other endpoints.
4. Run targeted fake UNKNOWN/deferred effects and authorization tests, instrument-binding and external-actions tests, plus USER commission funding/owner/release tests against the final SHA. Prior evidence exists in RELEASE-IQ-UNKNOWN.md: instrument29, isolated transport81, financial17 and deferred suites. No tests or builds were rerun in this read-only pass during the coordinator's discovery window; prior results are not new final-SHA certification.
5. Complete normal Functions build/discovery/predeploy in a coordinated window. Preserve Scheduler/Task state and rate/retry settings; verify revision/source generation and configuration after each selective release. Do not use a live financial request as a smoke test.

Each endpoint has its own immutable ZIP recovery pin above. Recovery must also retain current environment, secret bindings, job state and financial UNKNOWN/reservations. The old artifact can reintroduce unsafe ambiguity classification; no automatic code rollback, queue retry or reserve release is recommended. Prefer a reviewed forward correction where restoring old code would permit an ambiguous repeat effect. No recovery was executed.
