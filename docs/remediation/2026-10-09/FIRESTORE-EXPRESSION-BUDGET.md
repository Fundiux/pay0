# Firestore evaluator budget: validated source candidate

2026-10-10 UTC. Source-only candidate; integration and production rules unchanged.

## Baseline and bounded changes

Before edits, source and integration a71a8b8 both had normalized-LF SHA256
`03cca1237bd47a9e5670c4c1411e114383788a56c7763d6e0779cd7602601dc3`.
Original query release gate passed 169 access expectations, but seven expected-deny
solicitud note writes exhausted the 1000-expression evaluator budget. Sequential
fixture order identifies owner/creator/superadmin with ACTIVE restriction, then
delegates expired/future/revoked/inactive. No allowed query/listener failed.
assertFails accepts permission-denied caused by exhaustion; that was not clean
budget evidence.

Candidate LF SHA256:
`5709fbcca4c4a32d317b92555b158bb8c6a4404ef0c257b35df246ec89ddced5`.
Only three helpers outside the generated policy block changed:

- restrictionAllowsRecord returns false immediately for map ACTIVE records with
  an integer expiry later than request.time. Such a record cannot satisfy the
  previous allow expression, even if other schema fields are malformed. Expired
  ACTIVE and REVOKED records still undergo the complete existing schema checks.
- hasClientSolicitudAccessFromData and hasClientPagoAccessFromData cache root and
  both client identifiers, avoiding repeated root evaluation and an identical
  delegation lookup when clientId equals clienteId. Different identifiers retain
  their alternative authorization paths; neither alias is silently made canonical.

No permission/default, expiry boundary, revocation, client/root check, restriction
schema, generated policy, direct-write rule or Storage rule was broadened. No
shared materialization helper changed.

## Gates and execution

New budget runner explicitly selects source root and reviewed hash. It runs the
existing 169 query/listener expectations and 325 Firestore/Storage expectations
in isolated demo projects, then 24 additional alias cases. The existing source
tests are not edited: temporary copies replace only the pinned hash and relocate
the generator import; expected-denial promises gain diagnostic instrumentation
without suppressing or replacing their original errors/assertions. Any expression
or document-access budget exhaustion in caught errors or SDK output fails the new
gate independently of expected access outcomes.

The alias matrix verifies both helpers and solicitud note creation for same valid
IDs, same inactive IDs, two distinct IDs where only either one grants access,
primary-only, legacy-only, absent IDs and null primary with valid legacy. Thus
three operations for eight cases, including preservation of the old OR behavior
for the null-primary legacy case.

Baseline command (expected budget failure):
`powershell -NoProfile -File qa/scripts/remediation-firestore-budget-run.ps1 -Baseline -QueryOnly -SourceRoot .worktrees/pay0-remediation-integration-20261009`.
Observed 169+24 access expectations PASS; budget gate FAIL with18 exhaustion
message occurrences across nine denied writes (the original seven plus two alias
negative cases). Occurrences are diagnostics, not unique requests. Exit1 proves
that expected permission-denied cannot conceal this budget failure.

First candidate run: 169+325 PASS, zero exhaustion diagnostics; known delegated
Storage gaps remain24. Native CLI script exit0 and complete emulator shutdown.
The enclosing PowerShell process reported1 despite expected native stderr; runner
now exits0 explicitly only after checking the captured native exit (null/nonzero
throws) and restoring environment in finally. Final run included all24 alias checks and caught-error instrumentation:
169+325+24 access assertions PASS, but the budget gate correctly FAILS. Catching
exception messages revealed24 additional budget failures hidden by assertFails,
not visible in the first run's SDK stderr. Thus first-run zero diagnostics was
insufficient and is NOT a clean-budget result.

A diagnostic-only325 rerun completed and classified every remaining failure as
Firestore permission-denied, clientDispersions getDoc at candidate rule L697:
owner checks13/38/47/56/65/74/83/92, delegate those indices+104, root+208. Each role
has eight states: active, malformed-revoked, wrong-root, fake-writer, null,
unknown-field, replaced-required-field and ttl-too-long. Storage is not the source
of these24 evaluator failures; its separate24 delegated restriction gaps remain.
All emulator processes shut down and CPU work is paused for the coordinator's IQ
release. No commit/release-ready claim while this Firestore budget gate fails.

Next proposed narrow fix, pending scope approval: use an explicit accountAllowed
ternary before the unchanged read predicates for clientDispersions and its notes.
This would avoid evaluating the denied account's expensive permission/ownership
branches, instead of duplicating restriction checks inside the shared wallet
helper. It requires fresh budget execution, including allowed clients, before
claiming preservation.

Authorization-policy verifier PASS: frontend, Functions and generated Firestore
policy remain synchronized. New runner additionally checks generated block byte
identity against integration (line-ending normalized). No Functions/frontend
build is required for this rules-only helper change.

The runner reuses the integration clean-env CLI wrapper for its existing emulator
mutex and Storage JSON framing adapter. It starts only loopback18236 Firestore,
19236 websocket,19196 Storage,14436 hub and14536 logging; no Functions/provider.
Temporary test/config/diagnostic files remain ignored; no recursive cleanup.

## Limits and rollout

The first candidate removes the seven demonstrated note-write exhaustions but
leaves the24 dispersion get failures above; it does not yet clear the release
gate or assert unbounded rule
capacity for every document shape. Malformed records and missing parent/fields
can still produce evaluation errors that deny access; only valid tested shapes
are claimed compatible. Firestore ancestor provenance remains outside rule
validation; the observed four backend-valid grants do not close global S10.
Storage's24 delegated restriction gaps and old-client transition remain unchanged.
No deployment, restriction writer activation, migration or historical rewrite is
authorized by this document. A changed candidate requires explicit hash review
and rerunning the same gates before any separate release decision.

## Second candidate prepared, not executed

Coordinator authorized exactly two additional guard-expression changes for
clientDispersions read and its notas read. Replaced only the outer
`accountAllowed() && (predicate)` with `accountAllowed() ? (predicate) : false`.
A mechanical reverse replacement proves the inner predicate text is identical.
No generated policy, funding scope, ownership, delegation or module condition was
removed or reordered. No other family received this change.

Current candidate normalized-LF SHA256: `7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876`.
The new budget test pins this exact reviewed source; the original baseline pin
remains unchanged. Execution is deferred during IQ discovery. The24 known
Firestore exhaustion cases remain an OPEN gate; this static edit is not PASS.

Current full gate command from source ROOT:
`powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-firestore-budget-run.ps1 -SourceRoot .`.
The previous release-query script remains intentionally pinned to the reviewed
baseline; use this new pinned budget wrapper for the new candidate, not an
arbitrary environment-supplied hash. Its temporary copy retains all access
assertions and instruments failures additionally. The inherited325 reporter field
`deployableRulesChanged:false` is not a working-tree assertion: firestore.rules
is intentionally changed in source, while integration/production are untouched.

## Final validation, superseding the open candidate gates above

Second candidate7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876
completed the full runner on 2026-10-10 UTC, session21791. Ignored local evidence:
`.firebase/remediation-temp/firestore-budget-candidate2.log`.

- Original query/listener expectations:169 PASS.
- Original restriction/Firestore/Storage matrix:325 PASS; known delegated Storage
  gaps remain24.
- Additional client identifier alias compatibility:24 PASS.
- Budget gate: zero expression/document-access exhaustion diagnostics, including
  the caught-error instrumentation that exposed the previous24 hidden failures.
- Native Firebase CLI reported script exit0 and shut down Firestore, Storage, hub
  and logging emulators. Authorization-policy verifier PASS after the final rule
  edit. Generated policy remained unchanged. No builds or cloud effects here.

The enclosing tool reported exit1 because the outer PowerShell redirected native
stderr. A bounded local reproduction, without Firebase/emulators, executed a
child PowerShell that only wrote a synthetic stderr diagnostic and exited0.
The immediately captured values were `pipelineStatus=False nativeExit=0`;
explicitly exiting with the captured native code returned tool exit0. This proves
the orchestration discrepancy rather than inferring it from a passing assertion.
The gate runner already checks native LASTEXITCODE for null/nonzero and exits0
only after its cleanup; no assertion or error classification was changed.

For an automated outer PowerShell shell that redirects this runner, propagate the
actual native code explicitly instead of allowing the tool to infer it from `$?`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-firestore-budget-run.ps1 -SourceRoot . *> .firebase/remediation-temp/firestore-budget-candidate2.log
$taskGateExit=$LASTEXITCODE
exit $taskGateExit
```

No emulator repeat was performed for this proven wrapper-only discrepancy.
All518 access assertions and the zero-budget-exhaustion result apply to the
unchanged second-candidate rules hash above. CPU/emulators were released to the
coordinator. This closes the demonstrated evaluator-budget gate for this matrix,
not Firestore lineage, Storage compatibility, production publication or global S10.
