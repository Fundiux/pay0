# Firestore release preflight

## Effective release, 2026-10-10 17:25 UTC

Published only `firestore:rules` from integration `5a4457e` (remote matches).
Candidate LF SHA256 `7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876`
passed 518 access checks with zero expression-budget exhaustion diagnostics,
including captured SDK errors, plus the authorization-policy verifier.
Helper `dc0f8f3` passed 50 fake checks and a real read-only preflight.

Execute session34920 exited0. Effective ruleset
`76fda1a0-4463-4106-80ff-1b4ea13d3a61`, release update
`2026-10-10T17:24:21.300538Z`. Postflight and separate read-only recheck confirmed
the exact candidate source hash. Storage ruleset, updateTime and hash stayed
identical to the preserved baseline below. No indexes, Storage rules, document
writes or production financial operations were included.

Private backup, exact config, source, references and journal are retained under
`.firebase/remediation-temp/firestore-release-c631e28b29b346cea169529b86e3fd94/`.
The helper pins the former baseline and must not be rerun as a retry after success.
Recovery should prefer a forward correction: restoring former rules would remove
the new restrictions and immediate delegation checks. No rollback was performed.

The 24 Storage restriction gaps, grantor lineage in direct Firestore delegation
reads, and client transition remain open. This is not complete S01/S10 closure.
The sections below retain the historical preflight and are superseded where they
state that this Firestore-only release is pending.

Review date: 2026-10-09. Integration reviewed at c29260b, then a71a8b8 with the
same rules. No rule edits, deployment or remote project reads in this review.

## Decision

A Firestore-only release is technically independent of the Storage fallback cut.
It can enforce actor restrictions and immediate grant lifetime/scope checks while
leaving old Storage clients operational. The old uploadDispersionDoc
getDownloadURL-before-finalize problem is not a reason to couple these releases.
This is a conditional release candidate, not an approval or a claim of complete
S01/S10 containment. Query/listener compatibility evidence is still required.

Firebase supports `firebase deploy --only firestore:rules`; Storage has a separate
target. The integration firebase.json declares a single default Firestore rules
file and no Firestore predeploy hook; Functions/Hosting hooks are on their own
targets. Use the narrow target, not `firestore` (which includes indexes), the
repository broad deploy script or an unqualified deploy.
[Official deployment documentation](https://firebase.google.com/docs/rules/manage-deploy).

## Exact candidate and preserved reference

Fresh read-only reconciliation during the IQ release window (2026-10-10 UTC):
both active sources exactly match the earlier preserved reference after LF
normalization. Firestore release points to ruleset
`042bafab-3487-418e-8245-2416e19d1963`, updated 2026-09-28T08:07:43.649443Z,
SHA256 `96257055c977d62b4afe30cec4443f65d2717c7a99386fe6578c14e7dd48f20c`.
Storage points to ruleset `d37e96b3-5266-4a44-8ce6-c903a502a854`, updated
2026-09-28T08:07:42.831469Z, SHA256
`5876da2001a4c13f1a5947e9e0729a4a9d30f17eed2f890ef1f8f1ef4ccc6282`.
Exact source and release metadata are retained privately under
`.firebase/remediation-temp/rules-release-c1fe9c2cc97c42f39afa3dc6712e45ff/`.
This refreshed the baseline gate only; query/listener tests and publication
remain pending. Recheck release pointers immediately before any publication.
Reads used the official [release GET](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get)
and [ruleset GET](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get)
APIs, without Firestore document reads or remote writes.

Read-only comparison used the preserved production reference in the private
TEMP/pay0-remediation-20261009-rules directory. No fresh remote rules fetch was
performed: refresh/reconcile the active release before publication.

| File | Candidate SHA256, LF-normalized | Relation to recorded 325 gate |
| --- | --- | --- |
| firestore.rules | 03cca1237bd47a9e5670c4c1411e114383788a56c7763d6e0779cd7602601dc3 | Exact match |
| storage.rules | 9ad56b35121ab516a3083d5943b3a68f73595a27dc165c5fa892470226a5a39e | Exact match, not part of this proposed release |

Native Windows CRLF file hashes differ; normalized source matches the documented
rules exactly. Firestore reference/candidate is 760/778 lines, with 244 added and
226 removed lines largely from authorization wrapping/renderer replacement.

Material Firestore differences reviewed:

- Full trustedRestrictionV1 validation at enabled allow boundaries, including
  superadmin; invalid present records deny, expiry/revocation use server time.
- Active own-profile get exception supports existing useUserProfile onSnapshot;
  it does not enable lists, writes or economic access. Own profile still exposes
  all its existing fields; rules do not redact restriction metadata.
- Immediate client delegation checks add client/root/target consistency, client
  activity, non-null revocation, strictly future expiry, startsAt and validated
  timestamp/numeric formats, TEMPORARY expiry requirement and permission map.
- Generated role renderer and cached helper changes preserve canonical policy
  semantics while avoiding the previously reproduced 1000-expression failure.
- Production corporate deny-only collections, USER-funded dispersion guard,
  application/ledger branches and legacy collection protections remain present.

No ancestor/grantor lookup was added to direct Firestore delegation rules. This
is a known remaining S10 gap. The four-grant read-only backend cohort currently
resolves as two allowed and two inactive, with one current superadmin grantor;
it does not prove future revocation enforcement in Firestore SDK reads.

## Evidence and remaining gates

Execution update, 2026-10-10 UTC: **169/169 PASS**, exit0, against unchanged
integration a71a8b8 hash shown above. Normal authorization-policy verifier PASS.
Initial runner attempt stopped on expected native stderr because PowerShell
ErrorActionPreference was Stop; corrected only the native-call wrapper to retain
stderr and check its real exit status. Rerun completed and shut down its owned
emulators. No assertions, query shapes, rules or limits were relaxed. Some denied
note-write probes emit expression-budget diagnostics; all allowed probes passed.
The result proves these listed cases, not universal budget headroom or grantor
lineage enforcement. Private log:
`.firebase/remediation-temp/firestore-release-query-gate-recheck.log`.
The table's earlier NOT RUN state below is superseded by this execution evidence;
publication and postrelease checks remain outstanding.

| Gate | Evidence / next action |
| --- | --- |
| Candidate identity | Normalized hash matches RESTRICTION-BOUNDARIES recorded actual325/325; no candidate rule change during this review. |
| Restriction/get coverage | Historical mode actual325/325 covers owner/delegate/root, malformed/active/expired/revoked restriction, own profile, three document families and prepared uploads; includes 24 acknowledged delegated Storage gaps. |
| Role semantics | Recorded canonical matrices 2760+33120 and verifier PASS; rerun against selected release commit as the normal gate. |
| Delegation lifetime | Existing remediation-delegations-emulator suite covers backend/Firestore get/Storage expiry, formats, permission updates and root cases; it does not supply list/listener evidence. |
| Query/listener compatibility | New tests and isolated runner prepared; NOT RUN yet because coordinator reserved emulator/build window. 169 expected assertions, not a reported PASS. |
| Latest production baseline | Obtain active Firestore release/ruleset metadata and preserve exact rollback source before deployment; ensure no intervening change since preserved reference. |
| Postrelease | Confirm only Firestore release changed and expected source hash; observe client permission errors and compatible reads with authorized non-sensitive probes; do not use Admin reads as a client-rule test. |

The 325 suite imports getDoc, not getDocs/query/onSnapshot for Firestore. The
existing delegation emulator also uses getDoc. Neither demonstrates query
compatibility. Firestore evaluates potential query results; rules are not
filters. [Official query semantics](https://firebase.google.com/docs/firestore/security/rules-query).

New qa/scripts/remediation-firestore-release-queries.test.mjs pins the candidate
hash and checks executable query shapes against integration UI sources:

- solicitudes/page.tsx and pagos/page.tsx: rootId, adminId and createdBy list
  filters, pagoAplicaciones scoped lists, ordered notas listeners.
- DocsModal.tsx: uploads rootId + solicitudId query.
- services/beneficiaries.ts: rootId + clientId beneficiary/method listeners.
- Own active profile remains readable while restriction blocks economic reads.
- Synthetic delegated root/client queries and notes test current, expired,
  future-start, revoked and inactive grants. These delegated list cases are
  security regressions in addition to the observed UI shapes.
- Direct solicitud note creation is a rule boundary test. The current UI calls
  addSolicitudNota; this suite does not claim to execute that callable. Pago note
  SDK writes remain denied.

Runner is Firestore-only, project demo-pay0-firestore-release, loopback18228,
websocket19228, hub14428, logging14528. It reads integration rules without changing
them and isolates CLI temporary/config paths. node --check passes; execution
awaits the coordinator's window. No Storage emulator or provider effect is needed.

## Publication sequence and rollback

1. Freeze the selected integration commit and hash, reconcile fresh remote
   Firestore source, retain previous ruleset/release name and source privately.
2. Complete query/listener gate and normal authorization verifier. Repeat325 if
   rules change; source equality means old evidence is applicable but not new
   execution. Keep restriction writer activation and Storage retirement separate.
3. After coordinator approval, from integration run only:
   `firebase deploy --project pay-0-system --config firebase.json --only firestore:rules`.
   This command is a plan; it was not executed by this review.
4. Verify release identity/hash and unchanged Storage release. Publication is
   database-wide, not a percentage canary. Observe new and already-open clients.
   Firebase documents up to one minute for new queries/listeners and up to ten
   minutes for active listeners; a successful immediate probe is not universal
   propagation evidence. [Official propagation guidance](https://firebase.google.com/docs/firestore/security/get-started).
5. If legitimate clients regress, stop rollout/activation and deliberately
   restore the preserved previous Firestore ruleset/source under the same narrow
   target. Do not restore via broad HEAD reset or publish Storage accidentally.
   Rollback reopens the prior restriction/expiry gaps, so it needs an explicit
   incident decision; it is not a harmless permanent fallback.

Old bundles retain Storage compatibility with this split, but a newly denied
Firestore listener can still show an error or stale UI: notas in solicitudes
clears messages with a generic error, whereas the inspected pagos notes listener
lacks an explicit error callback. New account recovery UI improves handling but
cannot update an already-loaded bundle. That is a recovery/UX limitation, not a
reason to authorize restricted data. Already delivered/cached bytes or documents
are not retroactively revoked. Unknown alternative clients and historical bearer
URLs remain outside this release's evidence.
