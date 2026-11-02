# Transactional solicitud replacement claim candidate

Scope: only source snapshot placement within createSolicitud in index.ts, a
new focused suite and this document. Existing tests are unchanged. No integration,
fiscal action, provider call, cloud data operation or deployment.

Before the change, sourceSnap was read before the creation transaction. A retry
could retain an empty relatedSolicitudId from that old snapshot and overwrite a
claim another invocation had just committed, even when both transactions shared
the sequence counter. The candidate prepares only the source reference outside
the transaction, then reads and validates it inside every callback attempt.
This read occurs BEFORE nextSequenceTx, which stages counter writes. All new
replacement metadata and the original's linkage are derived/written within the
same transaction. Existing validation messages/codes, root/company/client/fiscal
checks, status semantics, sequence/folio algorithm and actor permissions remain
unchanged. No new allowed-status policy is invented.

Focused synthetic evidence: 12 new contracts plus all 17 initial-note contracts
PASS. The new fixture executes the actual createSolicitud callback extracted
from TypeScript AST, with real auth/author/sequence/folio helpers and synthetic
external effects. Its optimistic transaction adapter tracks read versions and
uses a two-contender barrier before commit; loser retry observes the winner's
source claim. Exactly one parent, note and counter commit survives, and only the
winner starts audit/Materialidad/fiscal-draft/metric mocks. Changes to existence,
root, company, client, environment, invoice and UUID are reread on retry. Valid
metadata changes supply the fresh UUID/folio/date consistently. A preexisting
claim fails before counter/write staging; ordinary creation remains compatible.
This is synthetic conflict evidence, not a claim about emulator scheduling or
natural production contention. After the CPU window was released, the final
normal Functions build passed (session31462, exit0) and the approved SDK gate
passed (session85279, exit0).

Open boundaries: financial actor/client/company/delegation/cost authority still
comes from the existing pretransaction reads; this patch does not certify that
broader authorization. Existing terminal/source-status policy is preserved.
Other postcommit effects may fail after persistence; HTTP retries remain
non-idempotent except that a now-linked replacement source denies another claim.
No historical duplicate or orphan is reconciled by this candidate.

## Reviewed real SDK gate and execution evidence

Use a fresh reviewed demo-only namespace and cached emulator CLI runner pattern,
with fixed loopback ports, credentials refusal, 120s fixture watchdog / 240s
runner limit and exact captured-ref CAS cleanup. Seed only synthetic user,
client/company/access/despacho/original records required by the callback; use
real Firestore/sequence/auth helpers and stub all Materialidad/fiscal/audit
boundaries. No full index initialization or external provider runtime is needed.

Start two callback invocations together using a barrier BEFORE any transaction
read, never a barrier holding read locks. The SDK may serialize them; assert one
success, one already-exists, one counter increment, one new parent/note, original
linked to the winner, and only winner sideeffects. Do not require a natural retry
count, since emulator lock scheduling may differ from cloud. Separately inject
one explicitly labelled ABORTED after staging, change source metadata before the
retry's first read and prove fresh validation/derived fields plus stable IDs.
Preserve updateTime evidence after owned commits and delete only captured refs
with CAS; no collection cleanup. SDK fixture/runner were separately reviewed
and executed only after the final normal Functions build passed.


Prepared files: remediation-solicitud-replacement-sdk.test.cjs and
remediation-solicitud-replacement-emulator-run.ps1. Demo project is
`demo-pay0-solicitud-replacement`; ports18253/19253/14453/14553. The runner copies
the reviewed manual-note runner contract: Prepare default, explicit Execute,
CLI15.3.1/cached JAR, hidden owned process, retained PS5 handle, 240s watchdog,
private bounded logs, preserved runtime artifacts and four-port closure checks.
It requires exactly two labelled contracts, fourteen captured references and
verified cleanup. Source/callback hashes accompany the private SDK result.

Seven records are seeded (user/client/company/despacho/direct company access and
two originals). One exact counter plus three reserved fixture parents and three
SDK-generated note references produce fourteen owned refs, including the losing
absent candidate. No query-wide cleanup is used. Non-SDK domain lookups for cost,
canonical business context and delegation are fixture stubs; authorization,
author fields, counter and folio formatting use existing compiled real helpers.
The full financial authority workflow is not certified by this limited gate.

Execution pins: fixture `EC0F570B7F03A6DCD755CFF8428565ECFE6C0FD5A62B73DE6035383BE0D3518C`;
runner `F29E248313172D20407E8BB475F899BF5AD09F4CC3791CBBDEC9CE4C8C54F1DD`.
Prepare passed without network. Execute passed both labelled contracts in one
node:test case; `cleanupVerified=true`, fourteen tracked refs,
`EXACT_REFS_ABSENT`, `cloudCalls=0`, CLI exit0 and all four ports closed.
The injected ABORTED case is explicitly synthetic; no natural retry count is
claimed. Private artifacts remain under
`.firebase/remediation-temp/solicitud-replacement-d16fd15aac554fd0b226cc38c87ae1ab/`.
Stdout SHA256 is `56edff118c997b4a7e7f7aacf5d671e458044857f5fda3f40b0b519efdd5dde6`;
stderr is empty. Source SHA256 is
`ac6b945deeed561d9cca093875fa40cdfb1e63ec81874cd00380046360cc1081`;
extracted callback SHA256 is
`1cd99554b5f8ce63a92f6bd5624c8d4fc9ab2e6565acb2828b95195687d536ef`.
No integration, production deployment, real notification or fiscal call was run.

## Integration into main (2026-11-02)

The transactional replacement claim was re-applied to main on
`fix/iq-hardening-from-october`. Main still writes the initial solicitud note
after the creation transaction (the atomic initial-note change was not
integrated), so the real-SDK fixture and runner above, which assume an
in-transaction note, were not carried over. The node-level regression
`qa/scripts/remediation-solicitud-replacement-claim.test.cjs` was adapted to
main's postcommit note and is the gate for this change.
