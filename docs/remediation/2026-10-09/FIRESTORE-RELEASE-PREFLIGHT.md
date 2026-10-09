# Firestore release preflight

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
