# Two-reader release contract (inert draft)

Scope: create only listSolicitudNotes and update only listClientDispersionNotes, using separate singleton invocations and the full348 candidate. No deployment, network adapter, CLI hook installation, credentials, IAM changes or integration source changes are implemented by this module. The financial14 baseline analysis remains separate; the two-reader slice does not require financial runtime changes.

Owned files are scripts/lib/solicitud-notes-release-contract.cjs, qa/scripts/remediation-solicitud-notes-release-contract.test.cjs and this document. Root and integration bundles remain untouched. Production candidate source is0b505595 with bundleae84134 and accepted full manifestd21e5d0; these full pins belong in the future reviewed launcher input. The pure contract validates the supplied canonical candidate hash and count348. It does not autonomously choose or trust a new candidate hash.

## Closed conversion contract

makeContract captures a clone of candidateBuild, its SHA256, full existing-reader baseline and SHA256, Group1 runtime environment and SHA256, approved labels and SHA256, exact verified upload storageSource, and the validated packer sourceHash. Hashes use sorted-object canonical JSON; the launcher must separately pin raw input-file bytes. CLI toBackend/functionFromEndpoint/fieldMasks and cache hash function references are captured at factory creation. No later mutation of caller configuration or ports changes the contract.

The baseline requires ACTIVE Node22,256MiB,60s,CPU1,concurrency1,max20, absent min/VPC/secrets, ALLOW_ALL ingress, one matching runtime identity across Function/service/revision, and service/template/revision scaling20. Existing direct Function IAM is empty and Run IAM has only the current public invoker binding. This is direct-policy preservation, not proof of effective IAM powers or authorization. The existing runtime identity is read from the approved private baseline; it is never logged.

prepareEndpoint first compares the complete CLI-resolved source endpoint to the pinned candidate, allowing only explicitly validated CLI metadata (environment, approved labels, exact source, default codebase, targeted flag, current Run ID, security level resolved CPU, and derived endpoint hash). It returns a clone. Only null runtime options are preserved explicitly: max20, exact baseline identity, ALLOW_ALL; min and VPC properties are removed, not replaced with null. Candidate memory/timeout/concurrency/trigger cannot be overridden. Both source readers are required to match this initial nullable contract; later source changes fail closed and require review.

Group1 contains the intended public web configuration plus generated FIREBASE_CONFIG and GCLOUD_PROJECT. All three values must match the approved existing-reader baseline, without printing any value. Timing and Telegram variables are rejected. FUNCTION_TARGET/LOG_EXECUTION_ID and GOOGLE_NODE_RUN_SCRIPTS are added exactly as the real CLI does. The baseline environment is closed to those three keys, exact existing FUNCTION_TARGET/LOG_EXECUTION_ID, and optional known EVENTARC_CLOUD_EVENT_SOURCE. Any other extra key fails rather than being dropped under a whole-map PATCH. Existing EVENTARC_CLOUD_EVENT_SOURCE is copied literally into the UPDATE conversion output, never staged in dotenv and never inherited by CREATE. Both readers require the CLI deterministic EVENTARC route for their exact endpoint. UPDATE must also match that field in the existing baseline; CREATE receives its own route. Full postflight verifies that exact value. Run template and revision independently require concurrency1,60s,one container and CPU1/256Mi limits.

assertRequest validates the complete JSON-serialized outgoing body and exact method/resource/query. PATCH updateMask is computed using the original CLI fieldMasks behavior, with map fields treated exactly as updateFunction does. It must omit min/VPC/secret fields and include the explicit approved max/identity/ingress values. This does not equate an omitted request property with an absent response property. The create request is restricted to the fixed regional Functions collection and exact functionId. Positive nonzero upload generation is required; the future launcher must bind that storageSource to the verified upload receipt.

assertPlan permits exactly one create for the new reader or exactly one update for the existing reader. It rejects deletes, skips, opposite actions, another region/project/codebase, duplicate endpoints and delete-and-recreate. It validates a plan; it does not itself run the Fabricator or install interception.

Before assertRequest, the caller must pass fresh baseline equality checks, and for creation a structured404 NOT_FOUND plus complete regional listing without the new reader and with the existing reader, with no unreachable locations. The module validates these observations, but only the future bounded read adapter can provide fresh remote evidence. There is no atomic lock against changes between those observations and mutation. Root's earlier observation alone is not sufficient for a later launch.

assertIamWrite allows only the new reader's exact Run service with the sole approved public callable invoker policy. Existing-reader IAM writes fail. The future orchestration guard must allow this only after a successful exact create, enforce once-only operation/IAM sequencing, and independently compare the existing IAM policy after update. This pure module is not a complete mutation firewall or lifecycle state machine.

## Verification and remaining launcher work

Root reviewed all three files and independently ran the 41 tests successfully (299da3). Independent review also reproduced rejection of extra environment keys and Run runtime drift, preservation of the existing EVENTARC value, and acceptance of the real CLI singleton plans. That initial 41-test checkpoint remains historical. Real prepare later reproduced CANDIDATE_ENDPOINT_DRIFT for CLI endpoint.hash and ENDPOINT_ENV for its generated EVENTARC field (8a89ae). The reviewed correction passes 55 tests (41 adapted assertions plus 14 additional checks, ca69e9; root 3358a0). The test title explicitly describes baseline comparison rather than atomic CAS. These checks cover the inert contract, not deployment execution.

Separately, private cursor compatibility check dc2150 passed 12 valid old/new pairs and six invalid pairs using the published reader source and candidate AST helpers. It verifies cursor serialization and input parsing only; it does not establish complete callable, authorization, pagination, or financial rolling compatibility. No cloud calls were made by that check.

Tests use synthetic values with installed real Firebase CLI toBackend/functionFromEndpoint/createFunction/updateFunction; apiv2 POST/PATCH are intercepted, and HTTP/HTTPS/fetch are denied. They check complete body/mask, omitted versus null properties, no input mutation, pins, wrong scope/config/env/source/IAM, partial or denied absence, fresh checks, singleton plans and captured ports. No Firebase handler, finance provider or secret value is accessed. No Functions or frontend build is required for this inert Node tooling change.

Before activation: review this source; pin the actual CLI/modules and input; adapt the real prepare/Fabricator callsite without changing candidate discovery or source; use the reviewed upload guard with expectedEndpointCount348 and singleton filter; stage Group1 with journal/CAS/finally restoration; bind archive/hash/generation proof; enforce one mutation and exact operation polling; obtain fresh metadata/absence; and perform full GCF/Run/revision/IAM/source postflight. The source build and installed provenance remain frozen. The new reader's explicit cap20 is a proposed create contract, not a historical setting. No commit or launch is implied by these local tests.

## Launcher preparation evidence (2026-10-14)

The launcher binds the actual packer enumeration order, exact 1257-file staged set and
SHA-256 file contents to the returned concatenated SHA-1 sourceHash. ZIP order
is not assumed. The pure contract derives endpoint.hash using pinned CLI hash
functions, that sourceHash, validated backend environment insertion order with
EVENTARC excluded, and the endpoint's empty secret configuration. An arbitrary
40-character hash is rejected.

The separate launcher suite passed 48 tests (046ec3; root b29481), including the
real CLI prepare call site with existing service identities verified through fake
GET ports. No service identity operation is fabricated or authorized to create.
ABSENT/PRESENT dotenv staging has explicit ownership, journal and restoration.
StageDryRunCAS 6e17eb passed, restored original absence, retained the correct
endpoint in every journal event and left the candidate clean. No cloud calls
or deployment occurred in those local gates.

The obsolete upload-guard pin caused a preserved earlier GUARD_348_PIN failure;
the reviewed disk pin was subsequently verified explicitly. Private packLOCAL
attempt 2f619f failed before staging because dot-sourcing reset its InputFile
parameter. Its runner now saves/restores its arguments around LibraryOnly import;
attempt 93337 then failed EXPECTED_COUNT. The earlier 1256-file proof had no
dotenv: 935 installed outputs + 318 source files + three manifests. Staging adds
one file, so the contract now requires 1257 without excluding any existing file.

Root reran all 55 pure-contract and 49 launcher tests: 104/104 PASS (91ed53).
The actual pinned CLI pack subsequently passed locally (81361/c24deb), with
1257 files, ZIP SHA256
1f98bc90e6ab76549b36b887d9cd778f7b984717976189012f7d12795469129c
and sourceHash SHA256
903e96a4ad3d5198164b925935e61728ce9ac5c5214b7b00d75bb5d59dc61699.
Input53856efc pins that run; journal confirms ENV_ABSENCE_RESTORED and root77c57e
confirms the candidate remains clean with no dotenv. Network was blocked;
actualUploadVerified remains false. The fake IAM account-GET prerequisite above
is historical and is being replaced by explicit observation of existing APIs and
project role bindings; those observations do not certify managed-account
existence or effective IAM. No deployment is claimed.
