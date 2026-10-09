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
