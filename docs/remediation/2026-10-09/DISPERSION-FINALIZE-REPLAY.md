# Dispersion document finalization replay

Source-only correction, 2026-10-09. Integration and production unchanged.

Actual finalizeDispersionDocumentUploadCore could replace its own READY upload,
increment its version and audit again on replay. It also revived INACTIVE,
REPLACED, DELETED and FAILED records, and ignored an upload root change occurring
during Storage exists(). Initial regression:1/8 PASS,7/8 FAIL.

The finalization transaction now reads its target before querying active versions.
It rejects changed scope/object identity and retired/deleted states; an existing
READY/active upload returns its valid existing version without writes or a second
audit. Only PENDING/active=false proceeds through the existing replacement flow.
The public response remains ok/uploadId/status/active/version. No notification
contract was changed.

Validation:15/15 synthetic tests execute the actual TypeScript service with fake
Firestore/Storage and authorization dependencies. Transactions are serialized in
this harness; this is not proof of SDK conflict retry behavior. Tests cover first
finalization, repeated and simultaneous calls, four retired states, root/object
identity changes during lookup, replacement and malformed READY version. No real
files/messages/providers. Functions build PASS; no frontend/rules changed.

Remaining release gates are material: current actor/parent/delegation revalidation,
USER-funded ownership, actual object metadata/generation validation and targeted
emulator contention. The automatic Telegram notification performs read-then-set
rather than a transactional claim and retries FAILED recipients as a whole;
replay idempotency of the upload does not fix duplicate notification or uncertain
external delivery. Do not expose pending-upload recovery or cut old Storage reads
until these compatibility and authorization prerequisites have been addressed.
Historical version sequences and stored records are not repaired by this change.

## Current authorization and exact-object follow-up

Source-only follow-up after `ad18928`; public callable request/response shapes and
notification wrapper are unchanged. `service.ts` now uses the real
`assertAuthorized` contract (`wallet.dispersiones`) before privileged role bypass,
including current account activity and `trustedRestrictionV1`. All three write
flows re-read actor and dispersion within their Firestore transaction. Root must
match exactly; deleted/unavailable parents are denied.

For CLIENT funding, non-superadmins require current
`requireClientOperationalAccess(... permission: operateDispersiones,
transaction: tx)`, including delegated ancestors. Parent `createdBy`/`adminId`
alone no longer bypasses client authority. USER funding follows the integrated
document bridge's ownership contract: sourceClientId matches the principal
client, principal.ownerUid matches fundingSource.ownerUid, and that owner must
be the current actor unless superadmin. A client delegation does not grant
another user's earnings. The source branch lacks `dispersionFunding.ts`; this
small private write-domain check matches its contract without importing the
broader integrated document bridge. During integration, compare against the
canonical helper and reuse it where practical.

Init prepares one document reference outside the transaction and creates PENDING
metadata from the current authorized parent inside it. Finalize rechecks actor,
parent, grant and upload before even a READY replay; deactivate reads/writes and
audits atomically, returns INACTIVE replay without writes, and cannot turn a
replaced/deleted record into INACTIVE. Financial terminal states such as completed
are not blanket-denied: operational proof documents may still be needed.

Finalization checks exact upload family/parent/path and reads Storage metadata
outside the transaction. It verifies object name, bucket, positive generation
and metageneration, declared MIME and prepared exact size within the existing
1 MiB maximum. It stores the verified generation/metageneration on first READY;
subsequent generation replacement is rejected. Firestore upload identity,
size and MIME changes during that lookup are rejected. There is no download,
hash, parser execution or malware claim in this check. The Storage read and
Firestore commit cannot be atomic across services: the stored generation binds
the observed object but does not prove the latest path stays unchanged after the
read. The downstream consumer must use that exact generation. In particular,
the unchanged Telegram notification still downloads the latest path and its
claim/delivery race remains a separate release gate; this patch does not claim
end-to-end immutable delivery.

Compatibility: ordinary records created by existing init contain the required
entity IDs, exact path, contentType and sizeBytes; missing/malformed historical
metadata is not guessed or backfilled. Existing valid READY records without a
generation remain read-only replay (no retroactive attestation); no historical
records were queried, so their prevalence is unknown. New writes carry the
generation. Restoring a superseded/deleted upload is intentionally unsupported.

Validation: original 15 replay cases PASS after replacing authorization stubs
with a shared harness that loads the actual guard, restriction policy and client
resolver. New 90 cases PASS, covering all three operations, direct and delegated
success, USER owner success, restrictions even for superadmin, explicit module
denial, cross-root/missing/deleted parents, expired/revoked grants, USER mismatches,
transaction-time revocations, exact metadata mismatches, identity races, generation
replacement and deactivation idempotency. Fake transactions enforce reads before
writes and serialize commits; these tests do not certify SDK contention retries.
Authorization-policy verifier PASS. No frontend/rules changes, emulators, live
Storage, Telegram, cloud mutations or environment reads in this follow-up.
Functions build of this source PASS (`tsc` plus canonical asset copy). This is
not a Functions discovery-time or deployment certification.
