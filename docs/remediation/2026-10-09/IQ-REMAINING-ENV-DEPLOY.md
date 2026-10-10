# Selective IQ remaining-six environment helper

Read-only Preflight subsequently passed; StageDryRun and Execute have not been run by this implementation. Baseline: RELEASE-IQ-REMAINING-PREFLIGHT.md /49ee665; runtime options:a5e0d9a, integrated1ebfcf2. The reviewed integration candidate at preparation is a276e0397bb2e7e7494ae9dd7588efa8a0537c93. Caller must supply the exact reviewed40-character ExpectedHead and exact original-dotenv ExpectedEnvHash; neither is inferred from the current checkout.

Owned files: scripts/deploy-iq-remaining-preserving-env.ps1 and qa/scripts/remediation-iq-remaining-env.test.ps1. The helper imports reviewed local hash/map/CAS/native-output/backup/workspace utilities through the document helper's LibraryOnly path. It does not reuse any document or deposit selector, runtime snapshot or plan. Automatic deposit is excluded.

Default Preflight performs read-only metadata checks; StageDryRun additionally creates ignored backups/staged files without touching the original dotenv. Execute is explicit and uses the normal Firebase wrapper/predeploy. There is no automatic retry, queue invocation, financial operation, rollback or scheduler pause/resume.

## Ordering and exact environment groups

Group0: createSolicitudIq, processIqCreateQueue, createClientDispersionIq, processIqDispersionCreate, executeUserCommissionDispersion. Group1: processIqCreateOnDemandTask. Keeping dispersion/comision3 together avoids deliberately leaving commission on the old ambiguity classifier, but Firebase updates are not atomic even within one invocation. Solicitud's Task is separate solely because its user-environment map has PAY0_OPERATION_TIMING.

The helper requires exact in-memory equality across Group0 and equality of the public API key across both groups. Only the Task may contain the timing flag. Its existing bounded dotenv-safe value is preserved verbatim; the code does not turn timing on or off. Application timing is enabled only for value1. Neither timing nor API-key values are printed. Unknown environment keys or unsafe serialization fail closed; unrelated local Telegram transport configuration is restored but not spread to these functions.

All six immutable source/revision pins and runtime tuples are checked before planning. Maximum/concurrency remain20/1,20/80,1/1,1/1,2/80,1/1 respectively. CPU1,2Gi, timeout300 only manual solicitud and540 otherwise, runtime identity, ingress, min/VPC omission and secret bindings are named fingerprint fields. No normalization of an absent maximum occurs.

## Secrets, jobs and drift

Bindings must be IQ_CREDENTIALS_KEY version2 for all six and TELEGRAM_BOT_TOKEN version1 only for solicitud3; secret volumes are rejected. Secret Manager latest metadata must resolve to those exact ENABLED versions before each phase and after it. Only name/state is queried, never secret payload. These checks reduce the rotation race window; they are not a Secret Manager lock. A rotation during deployment may cause a postflight failure after some functions updated. Stop and retain the journal; never claim atomic preservation or automatically roll back.

Read-only Scheduler GETs cover solicitud1minute/dispersion5minutes ENABLED and syncToday/REP PAUSED; the Task queue must remain RUNNING, concurrent1/rate1/burst10/retry1/backoff60..300/doublings16. Configuration fingerprints are compared before and after each phase. No task payload, URL, auth header, backlog claim or provider request is involved. Runtime Firestore root policies are not queried or changed. ENABLED schedulers and RUNNING tasks can execute during a deployment; the helper does not establish drainage.

Each phase rechecks all six functions, latest-secret metadata and job configuration before any dotenv change. Postflight requires new revision and generation only for that phase's endpoints, unchanged config/env for all six, and no unrelated endpoint revision change. Successful postflight snapshots become the exact baseline for the next phase, so another intervening deployment cannot pass merely because it differs from the original revision.

## Local preservation and recovery

Only the fixed integration worktree and sole ignored functions/.env.pay-0-system are eligible. Clean tracked and untracked state plus exact HEAD are required. Original bytes are backed up with CreateNew and verified hash. Journal and plan hash precede mutation. Group files and private logs remain ignored. Each phase uses CAS and finally restores exact original bytes; external mutation is not overwritten and the backup is retained on conflict. The helper checks native exit code rather than interpreting harmless stderr as failure. DEBUG is removed only inside deployment execution and restored afterward.

A failed second phase leaves the first potentially deployed. Recovery needs inspection of actual revisions and financial UNKNOWN/reservations; no blanket restoration of an unsafe old ambiguity classifier. Historical ZIPs remain separately pinned in the baseline document. The helper does not manage the independent Run service-level cap; compare that configuration separately where required before claiming complete runtime equivalence.

Prepared invocation contract (not executed):

    powershell -NoProfile -File scripts/deploy-iq-remaining-preserving-env.ps1 -Mode Preflight -ExpectedHead <reviewed-full-SHA> -ExpectedEnvHash <reviewed-original-SHA256>

Replace Mode with StageDryRun only for local staging, or Execute only for the reviewed release. A future integration SHA requires explicit review and a new exact argument; the helper never silently adopts HEAD.

## Validation

Fake suite PASS after the coordinator released the CPU window: 122 checks, network0, deploy0, realDotenvWrites0. Exact command: powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-iq-remaining-env.test.ps1. Includes changed revision/generation, API-key and timing values between phases, plus wrong-group environment rejection. It exercises six endpoint configurations, selector groups, timing presence/value preservation, binding/latest-version rejection, job drift, native failure restoration and external-file-conflict retention using temporary synthetic files. No tests import production handlers or call cloud. Deployment/build tests are not part of this helper implementation.

## Read-only preflight evidence

Coordinator-authorized Preflight session21568 exited0 against exact integration a276e0397bb2e7e7494ae9dd7588efa8a0537c93. The original dotenv SHA256 was compared in memory against the completed document-release journal (COMPLETE_ENV_RESTORED), and independently checked unchanged afterward. Six pins/configurations and both exact environment groups passed, as did latest-secret metadata IQ2/Telegram1 and all five job configuration checks. Output: IQ_REMAINING_PREFLIGHT_PASS functions=6 groups=5+1 cloudWrites=0 dotenvWrites=0. No environment values, secret payloads or task payloads were emitted. No StageDryRun, Execute, build or provider action occurred. This observation is time-bound; Execute must recheck before every phase.
