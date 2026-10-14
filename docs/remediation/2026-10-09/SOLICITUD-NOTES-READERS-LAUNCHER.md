# Singleton reader release launcher - review candidate

This is local deployment tooling, not evidence of a deployment. It has not been
executed against production. The frozen integration and its installed bundle are
unchanged. The pure preservation contract remains separately reviewed and pinned.

## Scope and ownership

- `scripts/deploy-solicitud-notes-readers.ps1`: default local preflight,
  `LibraryOnly`, reversible staging, and explicit singleton `Execute`.
- `scripts/lib/solicitud-notes-readers-launch.cjs`: input/file pins, fresh metadata,
  CLI activation, postflight, and exact uploaded/source ZIP verification.
- `scripts/lib/solicitud-notes-readers-guard.cjs`: narrow CLI lifecycle and transport.
- `qa/scripts/remediation-solicitud-notes-readers-launch.test.cjs`: offline tests.

Only CREATE `listSolicitudNotes` or UPDATE `listClientDispersionNotes` is allowed
per invocation. This does not release the other financial endpoints. Inputs pin
integration HEAD `0b50559530d334120076c2ec371bd2b8030b93ea`, manifest348,
installed provenance/source inputs, Firebase configuration, CLI modules, helpers,
the private current-reader baseline, original dotenv, and unique private outputs.
No root Git HEAD is assumed because unrelated reviewed work can advance it.

## Lifecycle

Local checks verify the unchanged installed bundle and source snapshot. The
PowerShell wrapper imports the existing environment transaction only after
checking both LibraryOnly dependency hashes. Staging uses its original-byte
backup, compare-before-write and finally restoration behavior. It does not
overwrite an externally changed dotenv on restoration conflict. Logs, backup,
journal, input, metadata and ZIP remain private and ignored.

Execute performs a fresh current-reader observation, and CREATE also requires
structured Function and Run NOT_FOUND responses plus a complete bounded regional
name listing. This is observation, not atomic absence/CAS. The same checks run
again immediately before the selected mutation. No permission error, partial
listing or unreachable region establishes absence.

The Node preload installs synchronously before the real pinned Firebase CLI.
It rejects residual historical Notes/Hosting activation environment before
importing helper modules. Real predeploy hooks remain intact, with process-only
`BUNDLED_V1`; no build selector is written to runtime dotenv.

The reviewed upload guard is composed outside the inner transport wrapper. It
verifies all 1257 expected staged files, stream identity, signed destination and positive
PUT generation. The lifecycle contract verifies the exact singleton plan, actual
converter output and wire body/updateMask. Only the new reader may receive its
exact public callable invoker binding. Existing reader IAM is not rewritten.

All writes pass through a one-use `Client.request` permission. Direct POST,
PATCH, PUT, DELETE and OPTIONS are denied. Allowed wrapper requests validate
the exact origin, API version and authentication configuration. The Storage
permission matches the original stream and complete signed query only within
the approved upload call. Permissions are consumed before asynchronous work;
no wildcard Storage PUT is permitted. Writes use `redirect: manual` and zero
transport retries without modifying request bodies or update masks. Other CLI
mutations, including extensions, billing and cleanup, fail closed.

Operation polling pins the operation, Cloud Functions origin/v2, normal CLI
25-minute timeout and 10-second maximum backoff. Poll ownership is reserved
before awaiting, and the real returned Function is preserved. No automatic
rollback, retry, provider call, Task invocation or scheduler action is added.

Postflight verifies ACTIVE/Ready/100% traffic, runtime configuration, environment,
secret/VPC absence, four scaling surfaces and IAM. It retains the exact returned
source generation, downloads only that source, and compares both ZIP byte hash
and the full 1257-file staged set/CRC/content contract. Source equivalence does not prove
handler execution. The receipt distinguishes an unfinished lifecycle from final
postflight/source verification; no completion records are synthesized.

## Local evidence and remaining review

The earlier 48-test launcher suite passed without network. It covers direct-request
bypasses, client-origin/version/auth mismatch, one-use upload stream correlation,
manual redirects/zero retries, real installed CLI create/update/invoker call sites,
concurrent polling rejection, receipt order/schema/hash, residual activation
environment, singleton selection, and PowerShell LibraryOnly import.

The complete launcher is still a review candidate. Further postflight drift coverage and resolution of real CLI preparation
contracts are required before execution approval. No production input, rollout, new Function, IAM change or
source upload is claimed. Fresh observations are sequential and cannot prove
atomic configuration stability across all remote reads.

## Original absence and current local preflight

The original dotenv state is explicit: `PRESENT` with its byte hash or `ABSENT`
with a null hash. ABSENT staging uses CreateNew and records ownership; finally
removes only that exact file when its bytes still match the staged hash. External
changes remain for investigation. Identical-byte replacement by another process
is not detectable by this check. Synthetic fixtures exercise restoration after
failure, conflicts, rejection of an external pre-existing file, and journal
endpoint identity. Staging uses the validated public web key from the pinned
baseline and never prints it.

A real PreflightLOCAL passed with original dotenv ABSENT (tool `bcb30b`): zero
cloud reads, cloud writes and dotenv writes. The private input SHA is
`3fe4b7c2f4b5279a5e124e4cb22fcb3b2a68257dc4d37fe2cc5f727087278ac1`.
This proves local interfaces and pins only, not the whole deployment lifecycle.
The earlier input failed the obsolete upload-guard byte pin; that failed artifact
was retained. The accepted root disk guard is
`08f06c80de5a6af2274f2dc9c8b32b83a3cea779687b6a2f198a63a72980e5ae`.

The Windows supervisor assigns a suspended Node process to an owned Job Object before execution, with a 35-minute total deadline. CLI descendants cannot break away. A timeout is an uncertain result,
not cancellation of an already accepted cloud operation, and never triggers an
automatic retry or rollback. The child environment uses an explicit Windows
system-variable allowlist; credentials, emulators, proxies, API-host overrides,
historical activation controls and caller-provided Node hooks are excluded.

Two additional real prepare contracts were reproduced and corrected:
CLI-generated endpoint hash and deterministic EVENTARC environment. The original
pure contract rejected both in offline reproductions (`8a89ae`). The approved patch now passes 55 contract checks (41 prior assertions plus 14
new cases, `ca69e9`). The launcher binds the actual packer enumeration to the
verified 1257-file staged set and SHA-256 contents, then reproduces its concatenated
SHA-1 list in that enumeration order. It does not assume ZIP ordering. The
enumerator callback is restored in finally; the original packer result retains
its identity. CLI cache hash functions derive the endpoint hash using the actual
three-field backend environment insertion order.

The initial service identity substitute used two fixed IAM service-account GETs. Its synthetic tests did not establish that Google-managed service agents are directly queryable through that API. The launcher now uses the separately reviewed prerequisite observer (seven API-state GETs and one read-only project IAM-policy POST); neither account existence nor effective IAM is certified. The prepare call site ignores the return value.
No operation is fabricated. The real prepare call site passed with fake API
checks and read ports (`046ec3`), alongside the remaining 47 launcher tests.
Service-agent creation and all unapproved POSTs remain blocked. Execute is not approved by these local
checks.


### Lifecycle review and staged archive correction (2026-10-14)

The supervisor retains its job handle and confirms zero active associated processes before dotenv restoration. A shared cleanup deadline caps normal and exception paths at ten seconds; the short accounting drain uses that same budget. If cleanup cannot be verified, the staged dotenv, original backup and operation-lock marker remain for explicit recovery. No automatic retry or rollback occurs. KILL_ON_JOB_CLOSE limits orphaning after supervisor loss, but a crash does not provide a verified cleanup or restoration result. Local process termination does not cancel an accepted cloud operation.

The combined contract/launcher suite passed 104/104 checks (`437c4a`, independently `91ed53`). The focused real Windows job test passed again after the shared-deadline correction (`d88521`). It covers normal exit, timeout, a detached live child after parent exit, argument quoting, spawn failure, and PRESENT/ABSENT restoration versus retention when cleanup is uncertain. Historical fixture failures are retained: `e7cb47`/`4a6451` exposed delayed job accounting; `b73e83` used a non-detached child that Node itself terminated, so it did not establish the intended surviving-child condition.

Pack attempt `2f619f` failed before staging because the imported LibraryOnly script shadowed the private runner input argument; the private runner now saves/restores those arguments. Attempt `93337` failed its count gate: 935 installed files + 318 source files + three manifests equal 1,256 before dotenv; the staged dotenv makes the exact set 1,257. The corrected source-hash, archive and receipt contracts retain every legitimate file. Actual staged pack `81361/c24deb` subsequently passed: 1,257 files, ZIP SHA-256 `1f98bc90e6ab76549b36b887d9cd778f7b984717976189012f7d12795469129c`, sourceHash digest `903e96a4ad3d5198164b925935e61728ce9ac5c5214b7b00d75bb5d59dc61699`, zero cloud/upload calls. The journal records ENV_ABSENCE_RESTORED; root verified a clean candidate and absent dotenv (`77c57e`).


### Live prerequisite observation in prepare

The two pinned CLI generateServiceIdentity call sites share one live observation promise: seven fixed Service Usage GETs and the fixed project IAM-policy POST requesting policy version 3. The POST is a read-only HTTPS adapter operation, not a new permission in the general CLI mutation firewall. The original generation/polling methods remain unavailable. Return values stay undefined because the pinned prepare code ignores them; no operation is fabricated.

The observer requires exact project/API identities, ENABLED states and unconditional expected Pub/Sub/Eventarc service-agent bindings. It emits PREREQUISITES_OBSERVED with only response-record digest, counts and explicit false account-existence/effective-IAM flags. Plan construction and the pre-mutation callback require completed observation; a failed observation or receipt write cannot authorize the plan. Concurrent callbacks share at most eight reads with no retry, 64 KiB/API, 2 MiB/policy, 3 MiB aggregate, 30 seconds/read and a shared four-minute observation deadline. Later configuration drift remains possible; this is not an IAM lock or an authorization grant.

Historical synthetic IAM account-GET tests are superseded, not evidence of production reachability. Root's separate actual prerequisite observation succeeded with eight reads (`2aa76b`, evidence `b0bb01880ca6e56e6f9b9a3611846bfc1bda7877ab4187ed34e11490b13caee1`). Launcher transport has not been exercised in a production deployment. The seven APIs do not exhaust every possible whole-manifest requirement; unapproved enable/setup mutations continue to fail closed.


Final launcher regression: 59/59 passed without network (`4cca39`), independently repeated by root (`45165/8bc6fa`). Root full-source review (`580970`), test-delta review (`63ade4`) and independent final review found no remaining blocker in this bounded launcher scope. This authorizes packaging the reviewed tooling, not a claim that any new reader was deployed. Final execution requires freshly pinned input, fresh remote baseline checks and the normal guarded release flow.


### Scoped source-token experiment correction

Execute `2263` stopped at SOURCE_TOKEN_EXPERIMENT before a guard receipt or function operation was accepted. Root verified the owned job was empty, the original absent dotenv state was restored and the operation lock was removed (`0866d0`). This failure remains part of the release history; it is not a successful deployment.

The launcher now calls the pinned CLI native `experiments.setEnabled('functionsv2deployoptimizations', false)` in its own process before retaining the false-predicate assertion. This changes the CLI in-memory preference cache only; it never calls `flushToDisk`. The cleaned child environment excludes FIREBASE_CLI_EXPERIMENTS, preventing CLI startup from enabling the flag again. Other experiment values remain unchanged.

The installed-CLI test (`4867a7`) forbids configstore writes and real network, verifies unchanged other flags, then executes the real Fabricator createV2Function and updateV2Function with fake provider/poller ports. Both outgoing bodies preserve the exact storageSource and have no own sourceToken property; the scraper getToken port is never called. Later onPoll/debug handling is unchanged and remains in private logs: this is not a claim that all future provider metadata or logs are token-free. No automatic retry is introduced.

### Scoped OAuth refresh correction (prepared, not deployed)

Execute 14565 stopped with GUARD_ACTIVE only and three authentication warnings. Root verified OWNED_TREE_EMPTY_VERIFIED and ENV_ABSENCE_RESTORED at 17:56:25Z; no function operation was accepted. Offline reproduction ae3ec1 showed the native CLI refresh request was denied by our mutation boundary. This does not establish that the real refresh credential was invalid; credentials were neither read for reproduction nor changed.

The allowance is limited to the pinned native CLI multipart refresh contract: POST https://www.googleapis.com/oauth2/v3/token, auth false, no API version, five ordered fields, empty scope, native API client constants, exact logging flags and no extra options. Validation is bounded to 16 KiB and emits fixed error codes only. Ordinary mutation tickets remain mandatory for every other write. Redirects are manual and transport retries are zero.

The validator copies the exact validated bytes into a fresh owned Readable. The original FormData and its callbacks are never consumed. The owned stream has a nonwritable, nonconfigurable redacted toJSON because the installed apiv2 failure logger serializes fetchOptions even when skipLog is set. Fresh header and skipLog objects prevent later caller mutation. Direct Buffer forwarding is incompatible with this CLI (it JSON-encodes Buffer); a plain string would expose credentials through that failure logger.

Focused tests 602f5b passed 25/25: native auth refresh with synthetic credentials; real apiv2 to fake fetch on success and network failure; exact bytes despite original form/header/logging mutation and custom callbacks; captured logs without synthetic secrets; seventeen malformed refresh contracts; and five direct mutation denials. No real network, live refresh, credential edits, new input or deployment was performed. The first real-fetch fixture failed because the mock retained node-fetch's original default export; that fixture was corrected and the evidence preserved (fe663a, then e58466 and 602f5b PASS).
