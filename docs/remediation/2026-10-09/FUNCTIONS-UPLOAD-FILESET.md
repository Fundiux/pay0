# Exact Functions source ZIP file set

Status: local candidate only, based on integration 9a729e3. No deployment or cloud reads performed for this correction. Full installed-bundle verification remains pending integration review and an explicit CPU window.

## Observed defect

Offline inspection of the saved notes source ZIP found 1,578 files against 1,251 expected files: zero missing files, zero expected-content mismatches, and 327 additional files. All additional files matched current local source hashes. The extras were 315 historical normal-build .js.map files and 12 auxiliary files (local bundle provenance, lint/ignore configuration, five scripts and three tests). There were zero additional runtime JS files under lib; the auxiliary scripts/tests contain executable JavaScript and are excluded from upload. This evidence does not establish when those map files were originally built and does not show mixed executable JS.

The local upload gate previously checked each expected entry but never compared the complete set. Its reported filesVerified was the number of expected matches, not the number of files in the archive. The independent notes verifier correctly rejected the extra files. The dotenv LF/CRLF/BOM parser was separately tested; it was not the cause of this failure.

## Correction

Firebase CLI 15.3.1 prepareFunctionsUpload uses fsAsync.readdirRecursive with functions.ignore, or node_modules/.git defaults when ignore is absent. It does not apply .gcloudignore or .gitignore. Its minimatch predicates are ORed, with matchBase and dot enabled; a negated pattern is not an ordered reinclude operation.

The explicit configuration retains node_modules/.git exclusions, excludes the named auxiliary files and scripts/test directories, and excludes root lib maps except index.js.map plus maps nested under lib. It preserves lib/index.js.map and .debug/compiled. No local historical artifact is deleted. Runtime source inspection found no references to the excluded scripts/test directories; package main remains lib/index.js, and no gcp-build/install/prepare lifecycle scripts exist. The pinned real CLI converter test verifies GOOGLE_NODE_RUN_SCRIPTS is empty for create and update. Local manual verification/seed npm commands remain available because exclusion only affects upload.

The gate now requires equality of all non-directory ZIP entry names and expected names, rejects duplicate expected names, then verifies every expected SHA. Extra, missing or duplicate expected entries yield the bounded ZIP_FILESET_MISMATCH code. Changed contents still yield ZIP_CONTENT_MISMATCH. The parent gate requires exactFileSet=true and both counts to match. Unknown future artifacts are rejected rather than added to expected implicitly. A future provenance-owned map excluded by policy also fails closed and requires policy review.

## Local evidence

- Actual CLI packer: six synthetic archive runs PASS (original eight-file fixture, missing expected debug file, retained historical extras without policy, exact policy, unknown executable extra, altered expected executable). No network or deployed endpoint invocation.
- Actual CLI fsAsync matcher and package lifecycle tests plus diagnostic tests: 9/9 PASS. Fixtures cover nested index maps, root index map, debug source, node_modules/.git defaults and unsafe negation semantics.
- The tests verify excluded files remain present locally; values and source payloads are not emitted.
- Functions/frontend builds are not required for these packaging-only changes and were not run. The full installed-artifact pack gate remains pending review; no production repack/release was run. No application code changed.

## Historical verifier scope

The prior bundled-download postflight matchArchive iterates expected bundle/runtime entries and compares hashes. The IQ6 verifier imports that same pinned matcher and applies it to six ZIPs. These checks proved matchedEntries (a subset), not global source-ZIP equality. Their verified runtime hashes remain valid; this gap alone neither invalidates those hashes nor implies executable JS mixing. Their exclusion claims must not be extended beyond their actual assertions.

## Release gate

Review and integrate this packaging-only candidate; rebuild with the reviewed BUNDLED_V1 contract and run the exact real-packer gate against the installed artifact and staged dotenv. A subsequent notes release must be update-only because the endpoint now exists. Independent postflight must retain strict source ZIP equality and source/config/revision checks. No automatic expected-set expansion, normal-map deletion, create rerun or Hosting release is authorized by this document.

## Actual upload stream guard (inert candidate)

The shared verifyArchiveBytes verifies CRC, safe paths, exact names and SHA against a supplied buffer. Both the predeploy pack gate and the new isolated functions-upload-verified-stream.mjs reuse this contract. A future launcher must supply pinned CLI modules, exact expected inputs, private temporary scope and endpoint/config pins; no launcher is activated here.

The guard checks the real prepareFunctionsUpload result before returning it, intercepts deploy.createReadStream and passes the verified buffer to storage.upload. It rejects a changed disk ZIP before stream creation; changes after stream creation cannot change the buffer body. A different stream, path, destination, codebase/endpoint or second dispatch is rejected. The alternative uploadObject/upsertBucket route is blocked. The receipt records archive SHA/counts, the upload URL response storageSource and the actual PUT generation header. The launcher must bind those values to the ensuing GCF request and independent postflight. Generation may be absent or the documented 0/'0' placeholder in generateUploadUrl's source; it is replaced by the positive completed PUT generation. A positive prior generation must agree. URL/query credentials and body bytes are never emitted.

Sixteen additional local tests PASS, exercising actual CLI prepareFunctionsUpload, uploadSourceV2, and storage.upload with fake API transport; they cover successful exact body, pre/post-stream disk changes, alternate body, uncertain dispatch replay, unexpected files, duplicate expected names, endpoint scope and unprepared upload. This constrains wrapper dispatch; it does not claim to disable lower HTTP transport retries. The guard's archive bound is 100 MiB; it retains one archive buffer until upload completion. This is a local launcher memory bound, not a Functions runtime setting.

During implementation an extraction retained a reference to source (five synthetic failures), and two tests initially attempted the real CLI preferences path. The extraction was fixed and fixtures now isolate XDG_CONFIG_HOME before CLI imports. Final shared packer regression passed all six scenarios; stream tests passed 16/16 and prior diagnostics/matcher tests passed 9/9. No production credential reads or network requests were required.

### Full CLI backend and signed destination correction

Root review caught that CLI prepare retains all 347 endpoints in payload.functions.wantBackend; matchingBackend is only used for selected checks. The first one-endpoint harness did not prove compatibility with actual deploy orchestration. The corrected guard requires the 347 IDs derived from the launcher-pinned complete manifest, preserves the complete backend, validates every endpoint project/region/platform and exactly one targetedByOnly notes flag, and checks context.filters exactly. The fixture uses 347 synthetic endpoints with real CLI getEndpointFilters, prepare.updateEndpointTargetedStatus and deploy.deploy; it mocks IAM and upload transport only. It does not claim to load the actual deployed manifest. The launcher must derive approvedEndpointIds from its separately pinned complete manifest.

After PUT, the actual uploaded generation is inserted into the same storageSource object retained by CLI uploadSourceV2, then included in receipt(). A conflicting prior generation denies completion. This binds the ensuing update to immutable uploaded bytes rather than an unversioned latest object. Tests prove real CLI return behavior with absent generation and conflict denial.

The approved host policy is storage.googleapis.com, not an assertion about previously observed signed URLs. Official GCF generateUploadUrl documentation describes a Cloud Storage signed URL: https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl . Official Storage XML endpoint documentation includes storage.googleapis.com: https://docs.cloud.google.com/storage/docs/request-endpoints . A different returned host fails before PUT and requires a separate review of a safe projection; no fallback is automatic. URL is bound exactly to the authenticated fixed-project/region GCF response and must use HTTPS, no userinfo/fragment/port and signed query fields. No equality is invented between the upload staging bucket and storageSource bucket.

The GCF reference documents generation default 0. Both numeric 0 and string '0' are treated solely as unspecified placeholders, then overwritten on the same source object after the PUT header is verified. The two placeholder variants are covered by the sixteenth test. No placeholder is accepted in the final receipt or ensuing GCF source binding.


## Empty dynamic extensions contract (2026-10-11)

CLI 15.3.1 prepareDynamicExtensions returns empty payload/context when no extensions
are desired or present; Functions prepare still attaches both objects. The upload
guard previously rejected the truthy empty payload before upload. An offline
reproduction using real prepare reproduced UPLOAD_EXTENSIONS; this matches the
failure interval without proving an unrecorded production exception.

The guard permits only an absent extensions property or an own data property
containing an exact empty plain object, on both context and payload. It rejects
null, own undefined, arrays, symbols, extra/nonenumerable keys, inherited properties,
accessors and custom/null prototypes. It requires nonInteractive === true.
It does not remove objects or skip the real CLI deploy/release paths.

Real CLI empty extensions deploy still performs a billing read. In noninteractive
mode disabled billing aborts rather than enabling billing. Empty provisioning has
no products; no extension tasks are created. Empty release returns immediately.
The synthetic integration test uses real prepare/deploy/release, fake billing and
network denial, checking unchanged empty inputs and zero extension mutations.
No launcher, cloud or integration worktree changes were made.
