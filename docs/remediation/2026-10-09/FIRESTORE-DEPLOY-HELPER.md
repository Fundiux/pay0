# Firestore-only release helper (fake-tested; no remote execution)

2026-10-10 UTC. Source preparation only. No Preflight remote call, Execute,
publication, environment-file change, integration edit or emulator/build occurred.
Synthetic tests initially waited for the coordinator's Hugo predeploy; their
completed local results appear below.

## Scope and gates

`scripts/deploy-firestore-remediation.ps1` has LibraryOnly, Preflight (default)
and Execute modes. Non-library modes require an explicit reviewed40hex
ExpectedHead; there is no implicit acceptance of whatever HEAD is currently
checked out. They operate only on the designated integration worktree, which
must match that HEAD and be clean. Candidate Firestore source is independently
pinned, LF-normalized SHA256:
`7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876`.

The coordinator must first finish Hugo and approve the integration HEAD, inspect
candidate-versus-production authorization expansions and run the reviewed
policy/query/budget gates. Source candidate8258074 already has518 access PASS,
zero caught/printed evaluator exhaustion and policy synchronization PASS. Those
are source evidence; they do not assert an arbitrary later integration is ready.

Preflight performs only official metadata GETs: default Firestore database must
already exist and be FIRESTORE_NATIVE, both Rules releases and their immutable
source Rulesets must match the exact pins below. Each release is read twice
around its source fetch to reject pointer movement during that snapshot.

| Resource | Pinned ruleset | Release update | Source LF SHA256 |
| --- | --- | --- | --- |
| cloud.firestore | 042bafab-3487-418e-8245-2416e19d1963 | 2026-09-28T08:07:43.649443Z | 96257055c977d62b4afe30cec4443f65d2717c7a99386fe6578c14e7dd48f20c |
| firebase.storage/pay-0-system.firebasestorage.app | d37e96b3-5266-4a44-8ce6-c903a502a854 | 2026-09-28T08:07:42.831469Z | 5876da2001a4c13f1a5947e9e0729a4a9d30f17eed2f890ef1f8f1ef4ccc6282 |

Baseline provenance: coordinator's preserved source/reference files in ignored
`.firebase/remediation-temp/rules-release-c1fe9c2cc97c42f39afa3dc6712e45ff/` and
FIRESTORE-RELEASE-PREFLIGHT.md. This helper rechecks them live at actual Preflight;
preparation did not make a fresh remote claim.

## Exact publication transport

Integration firebase.json declares Firestore rules+indexes and also Storage,
Functions and Hosting with expensive independent predeploy hooks. The helper
creates a private minimal config containing only
`{"firestore":{"rules":"firestore.rules"}}`, plus a byte-preserved copy of the
reviewed source. The sole selector is literal `firestore:rules`, with fixed
`--project pay-0-system --non-interactive`. No indexes, Storage, Functions,
Hosting, environment files or custom hooks are included. It uses the existing
integration run-firebase-clean-env wrapper, whose child DEBUG cleanup does not
modify project dotenv files. Candidate HEAD and source hash protect the wrapper
and rule file from an unreviewed worktree change.

Installed CLI15.3.1 firestore/prepare sets excludeIndexes for this exact selector;
the minimal config also omits indexes. Its prepare can create a missing default
database, which is why the explicit existing-database GET is a hard gate.
The CLI can still perform normal API-availability metadata checks; this is not
an assertion of a wire request count or an IAM boundary beyond the selector.

Execute takes a local exclusive lock, verifies the private directory is within
ignored .firebase/remediation-temp and checks git check-ignore for every backup,
reference, config and log filename. It saves both original sources and release
references with CreateNew and flush/hash verification, then stages the minimal
config/candidate. Immediately before invoking the CLI, it rechecks HEAD/clean
state, both live release pins, existing database, staged source hash and exact
minimal config. No token is written into files or command arguments. Metadata
GETs disable redirects explicitly, so Bearer credentials cannot follow a redirect.

Native stderr goes to an ignored private log and is judged by LASTEXITCODE,
not PowerShell pipeline status. Nonzero/null/wrong-type exit fails without retry.
After native success, postflight rereads both releases and sources: Firestore
must have a changed ruleset/update time with the exact candidate source hash;
Storage name, ruleset, update time and hash/content must remain identical. Safe
reference projections and a state journal remain private for review. No automatic
rollback is attempted, since restoring the old rules would reopen known guards.

## Limits and commands (plan only)

Preflight command, once the coordinator selects the final integration commit:
`powershell -NoProfile -File scripts/deploy-firestore-remediation.ps1 -Mode Preflight -ExpectedHead <reviewed40hex>`.
Execute uses the same explicit HEAD and Mode Execute only after a separate
publication decision. This document is not that authorization and neither mode
has been run by this preparation task.

Rechecks are not server-side compare-and-swap. Another publisher can race between
last read and release; postflight detects mismatched final state, not every
transient concurrent change. Unexpected native failure may follow a partial
release; stop and inspect metadata rather than retry blindly. A postflight read
failure or stale pointer is an unresolved gate, not success. Successful control
plane identity/hash checks do not prove client rule propagation is complete.
No document reads, account-restriction writer activation, grant migration, Storage
fallback retirement or cached-client revocation is part of this helper.

Primary references: [release GET](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get),
[ruleset GET](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get),
and [narrow deployment selectors](https://firebase.google.com/docs/rules/manage-deploy).

## Prepared synthetic verification

`qa/scripts/remediation-firestore-deploy-helper.test.cjs` dot-sources LibraryOnly
and replaces network/auth entry points with fail-fast fakes. It checks immutable
pins, LF normalization, exact selector/minimal config, missing HEAD/scope rejects,
source/pointer/update mismatches, Storage unchanged postflight, Firestore changed
hash/release, a pre-deploy race with zero deploy calls, native exit handling,
one deploy/no automatic retry, and backup overwrite refusal. Test fixture hashes
are rebound only inside that isolated fake process; production pins remain fixed.
After the coordinator released the CPU window, the fake suite passed50 checks,
exit0, network=forbidden. Initial46 checks passed, then four additional transport
checks passed with the full suite: GET only, timeout30s, MaximumRedirection0,
Bearer only in the in-memory header and rejection of a different project URL.
Neither Preflight nor Execute ran; no cloud metadata or project data was fetched.
No build/emulator was started. The reviewed working-tree changes of other agents
were left untouched.

Run these commands from the source ROOT, whose `.worktrees/` contains the
integration checkout. A later release must supply the coordinator-reviewed
integration HEAD explicitly; this helper never infers authorization from the
current branch or from a successful fake test.
