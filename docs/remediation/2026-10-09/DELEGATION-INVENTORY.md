# Delegation inventory continuation

Local implementation; no additional remote execution performed by this change.
The earlier bounded run reported 25 scanned collectionGroup entries, all other
paths, zero grant paths and zero scope reads. That is not evidence of no grants.
The previous run did not persist a cursor; the first durable run must start from
the beginning. Do not fabricate a cursor to skip canonical clients.

## Execution contract

`scripts/inventory-delegation-provenance.mjs` remains dry-run by default.
An authorized read-only execution now requires `--checkpoint` in addition to
`--execute-read-only --bootstrap <private file> --root-index <index>`.
Checkpoint must be a direct JSON child of the existing private
`.firebase/document-inventory` directory, distinct from the bootstrap file.
Keep the same checkpoint, selected root, project, projection, max-records and
page-size on each invocation. Default max-records/page-size is 25/25; hard maximum
is 100 scanned collectionGroup entries and 200 scope reads PER invocation.
There is no automatic multi-invocation loop or globally unbounded execution.
Every invocation still requires the explicit execute flag.

The checkpoint schema stores the actual last successfully processed document
name, selected root/project/configuration, fixed classification timestamp,
completion flag and cumulative aggregate counts. These identifiers remain in the
private file and memory, never stdout. No names, emails, tokens, financial payloads
or grant documents are persisted. Local filesystem protection inherits the private
directory ACL; mode 0600 is requested where supported and is not a Windows ACL claim.

Each fully successful page is flushed to a temporary sibling file and atomically
renamed over the checkpoint. An exclusive lock prevents concurrent runs of the
same checkpoint. A failed query or scope read does not advance the page cursor or
counts; retry re-reads that page. This can repeat reads, never writes. Counters
represent committed successful pages, not billed requests from failed attempts.
An abrupt process termination may leave a lock/temp file: inspect the process
before manually recovering local artifacts; the tool never steals locks.

## Output and limitations

Output separates `batch` from `cumulative`. Budget exhaustion is per batch;
`complete` means a short/empty query page was observed, not a transactionally
consistent census. A completed checkpoint does not query again. Start a new
checkpoint for a new inventory. Classification time is frozen for comparability;
it is not a statement of current authorization on later invocations.
Concurrent insertions before the cursor or updates to already scanned records can
be missed. The tool does not invent provenance, traverse grant ancestors or migrate
data. Missing grantor can remain `LEGACY_PROVENANCE_UNVERIFIED` and backend-allowed.
Owner scope fallback and temporal classifications retain the semantics documented
in the script; missing client root remains UNKNOWN. Role, restriction, lifecycle
and ancestor authority remain unverified.

Malformed schema/config/cursor/counts, unexpected histogram labels, out-of-order
or repeated pages fail closed. CLI errors remain generic. A failed invocation can
have durably saved earlier pages; its next invocation resumes those safely.

## Local evidence

`node --test qa/scripts/remediation-delegation-provenance-inventory.test.mjs`:
24/24 PASS. Includes restart across canonical clients into grants, fixed time,
project/root/config/schema mismatch, partial scope-read failure, repeated page,
private path and lock restrictions, empty completion, corrupt counter redaction,
and all prior scope/projection/temporal/no-provider-output tests.
No new remote inventory, production writes, migration or builds performed.

## Reported remote evidence, 2026-10-09 23:12:55.376 UTC

The coordinating agent executed commit `0d437c6` with a new private checkpoint
`delegation-root0-v1.json`, max-records 100, selected root index 0. Reported fixed
classificationAsOf: 1791587575376. This reviewer did not reopen private identifiers
or execute another remote read.

The single batch reached completion: 88 scanned, 84 other paths, 4 grant paths,
4 in scope through explicit profile + client root, and 8 scope reads. Two grants
were CURRENT_BY_LIFETIME_ONLY and two INACTIVE. All four had grantAuthority ABSENT,
grantedBy STRING, createdBy STRING, startsAt/expiresAt/revokedAt NULL and consistent
declared scope. legacyCurrentByLifetime was zero. No missing grantor was observed
in these four; STRING format alone is not a historical proof of issuance authority.
No grantor ancestors, roles, current restrictions or permissions were evaluated.
These counts are bounded evidence for the selected root, not a global S10 closure.

## Next read-only diagnostic; local implementation approved

Use current `clientDelegations/access.ts`, `utils/authGuard.ts`,
`users/authorization.ts` and `users/restrictions.ts` semantics. Resolve grantor
with the exact precedence `cleanId(grantAuthority?.grantorUid || grantedBy ||
createdBy)`. Count inconsistent grantedBy/createdBy without changing precedence
or reconstructing grantAuthority. Four grants do not necessarily mean four distinct
grantors. Direct ownership and superadmin are terminal before parent traversal.

Reenumerate at most 100 collectionGroup records because the aggregate checkpoint
retains the final cursor, not a private list of grant IDs. Process at most four
matching grants in scope, with IDs/deduplicated grantor profiles only in memory.
Stop and report truncation if the population changes beyond the bound. No invented
cursor, automatic recursion, provider call or write.

Minimum additional projections:

- Client: rootId, active, adminId, ownerId, managedByUserId, createdBy, operadorId.
- Recipient and grantor profiles: rootId, role, supervisorRole, active, isActive,
  isDeleted, disabled, deleted, deletedAt, modules.usuarios, trustedRestrictionV1.
- Grant fields already projected by the inventory; no financial payloads.

The complete trustedRestrictionV1 object is needed because its backend validator
rejects unknown fields; projecting only known subfields could hide an invalid
restriction. Do not output this object, IDs, or arbitrary reason values. Use fixed
aggregate categories only. Backend role defaults and module ceilings must be
reused rather than reimplemented from assumptions.

First validate current grantor admin/superadmin authorization for usuarios /
clientDelegations, including lifecycle and trusted restriction. Then verify the
same root and current client lifecycle. For admin, direct access matches any of
adminId/ownerId/managedByUserId/createdBy/operadorId. Superadmin terminates after
current profile/restriction/root checks. A nonterminal result is
REQUIRES_ANCESTOR_REVIEW, not an assertion of denial: the backend can resolve a
valid delegated parent. Do not infer parents or historical provenance from present
ownership. Current terminal authority does not prove authority at grant creation.

Before remote approval: local fake tests must cover both role terminals, module
revocation, restricted superadmin, wrong root, inactive/deleted profiles, missing
client, precedence conflict, nonterminal parent, four-grant/read limits, unchanged
checkpoint, and redacted output. Compare terminal decisions against actual backend
helpers with fake reads. A future recursive diagnostic needs its own explicit
budget and review. The coordinating agent approved local helper/tests after reviewing this proposal; no remote diagnostic has been executed.

### Local terminal helper evidence

New helper `scripts/diagnose-delegation-terminal-authority.mjs` and suite
`qa/scripts/remediation-delegation-terminal-authority.test.mjs`; the durable
inventory script and checkpoint remain unchanged. Default is DRY_RUN. Future
approved execution requires `--execute-read-only --bootstrap <private file>
--root-index <index>`; no diagnostic state is persisted. Maximum one query of
100 records, four grant paths (including outside-scope records), four distinct
grantors and twelve deduplicated profile/client reads. A fifth grant fails the
whole invocation with a generic error. Exactly 100 rows means exhaustion is
unproven. This intentionally does not auto-continue or modify the existing
inventory checkpoint.

The helper compiles an explicit allowlist of local backend modules with a fake
Admin SDK and fixed Date.now, executes real authGuard and access resolver, and
intercepts the first attempted parent-grant read as REQUIRES_ANCESTOR_REVIEW.
No Admin SDK app or remote callable is initialized. Real reads use only the
masked REST adapter. Timestamp decoding shares StoredTimestamp with policy's
injected Timestamp class; modules.usuarios retains its nested shape. The complete
restriction object is preserved, including unexpected fields that must deny.

Recipient histogram covers current profile/direct-terminal checks only; its
own grant lifetime is a separate histogram. Grantor terminal categories describe
present authority, not whether this particular grant or historical issuer is
valid. Grant permissions, recursive ancestors, and authority-source assertions
are not fully evaluated. Inactive records remain diagnostically visible.

14/14 terminal tests PASS locally, including four distinct grantors/clients and
exactly twelve reads; existing inventory suite 24/24 PASS remains required.
No production diagnostic, migration, new grantAuthority, build or deployment.
