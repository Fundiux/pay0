# Proposed bundled Functions release path

Design only, after candidate `502db33`. No default build/predeploy, deployment helper, cloud configuration or installed artifact has been changed by this document. The candidate gates and final hashes are recorded in INTERNAL-BUNDLE-CANDIDATE.md.

## Verified current behavior

The local Firebase CLI is 15.3.1. Its installed `gcp/cloudfunctionsv2.js` create and update functions both set `buildConfig.environmentVariables.GOOGLE_NODE_RUN_SCRIPTS` to an empty string. The corresponding [tagged official source](https://github.com/firebase/firebase-tools/blob/v15.3.1/src/gcp/cloudfunctionsv2.ts) explicitly disables automatic npm build. This is inspected client behavior, not a claim that a new cloud build has run.

Google's Node buildpack normally runs a package build script, but `GOOGLE_NODE_RUN_SCRIPTS` takes precedence over `gcp-build`; an empty value suppresses those configured build steps. Consequently adding a gcp-build verifier alone would not execute through this Firebase CLI path. We should retain the existing CLI mechanism and verify its contract, rather than patching the SDK or inventing a cloud verification step. [Official Node buildpack documentation](https://docs.cloud.google.com/docs/buildpacks/nodejs#execute_custom_build_steps_during_deployment).

The installed `deploy/functions/prepareFunctionsUpload.js` exports a local `prepareFunctionsUpload(projectDir, sourceDir, config, additionalSources, runtimeConfig)` function. It packages files using `fsAsync.readdirRecursive`, with default ignores node_modules and .git, plus Firebase debug logs and the runtime-config file handled separately. Hidden paths are not globally excluded by this Functions packer. The repository's `**/.*` exclusion belongs to Hosting, not Functions. Thus functions/.debug/compiled is eligible for packaging, subject to an actual archive-content gate. No production env file was opened or printed for this inspection.

Current firebase.json invokes a normal build initially and again indirectly through qa:client-csf-create and qa:document-access. Installing the bundle only once before these hooks is insufficient: a later TypeScript build would replace lib/index.js before final CLI discovery. All existing release gates must remain.

## Minimum implementation proposal

Use a process-only explicit build selector, initially defaulting to NORMAL. A reviewed release helper may request BUNDLED_V1 for its child build/deploy process. Unknown values fail closed; the selector is never written into dotenv or deployed runtime configuration. There is no automatic fallback after a bundled gate fails.

1. Add `scripts/build-functions.mjs`, and change only the package build command to this dispatcher. NORMAL executes the existing TypeScript and canonical copier steps. BUNDLED_V1 invokes the proven private builder, then a bounded installer. Every nested npm build inherits the same selector, so early and final discovery both read the bundle. Preserve an explicit build:normal command for local recovery. Do not remove or reorder functional/emulator gates.
2. Add `scripts/install-functions-internal-bundle.mjs`. It accepts only a validated candidate under the ignored worktree directory, with the expected source/package/lock hashes and complete output manifest. Recheck source input hashes after compilation; reject symlinked input/output paths or a concurrent build. Never recursively clean functions/lib.
3. Preserve normal per-module JS files needed by existing local tests by copying the candidate's enumerated raw compiler output into functions/lib. Copy only enumerated canonical assets and .debug/compiled files from the validated artifact. Install the linked map, then lib/index.js last, while holding an owned build lock. Existing unrelated generated files remain inert. Package main stays lib/index.js; runtime exports/options and external dependencies stay unchanged.
4. Before changing any target, record a private journal and exact prior bytes/hashes for overwritten files. Check hashes before replacement and restoration. An interruption or mismatch leaves deployment blocked until explicit reconciliation; never overwrite a concurrent mutation. Each successful install writes a small provenance record and verifies every installed allowlisted output. This is controlled multi-file installation, not an atomic directory transaction.
5. Add a final local `verify-functions-upload-artifact` gate immediately after real CLI discovery. Call the installed CLI's unmodified local packer with controlled ignored TEMP/TMP, capture its ordinary path/size logging privately, and inspect the ZIP in memory. Verify lib/index.js, linked map, every mapped .debug source and canonical asset against installed provenance. Verify source/package/lock preservation by hashes. Never print env contents or broadly extract an archive; preserve the existing dotenv/config selection contract without adding inputs.

Explicit file scope for that next implementation: the new dispatcher/installer/packer verifier and their tests, the existing builder exports where needed, functions/package.json, the final firebase.json verification hook, and .gitignore entries for functions/.debug and its generated provenance. Private journals/backups stay under .firebase. No module under functions/src needs to change.

The private builder need not run TypeScript twice: its raw output can refresh the ordinary module files before installing the bundled entry. Existing stale maps for unreachable old modules must not become part of an asserted bundle read set; fallback NORMAL regenerates its own maps. The final bundle's linked map and all its referenced compiled sources must always be current and verified.

The proof boundary remains explicit: a local packer test verifies an equivalent local ZIP and detects ignored hidden files, but it is not the actual later upload. The release process freezes source/config from that gate through CLI packaging; postflight verifies the actual returned source generation and selected ZIP entries. This closes the distinction without hooking or monkeypatching Firebase's upload operation.

## Required local gates before activation

- Build-dispatch fakes: omitted/NORMAL retains the previous command contract; BUNDLED_V1 repeats after every nested build; unknown selectors fail; selector remains process-only.
- Installer fakes: outside workspace, reparse points, source/lock drift, output tamper, partial writes, interruption and external mutation all stop; restoration checks hashes and touches only its journaled paths. No recursive deletion or broad cleanup.
- Repeat two complete final builds and compare all outputs. Verify installed bytes match provenance after every predeploy build. Existing candidate runtime154, lineage/deferred, WASM, Telegram23, source-map and financial17 gates must operate on the installed entry too.
- Installed CLI API contract test with a fake transport: create and update retain an explicitly empty GOOGLE_NODE_RUN_SCRIPTS, normal service options stay unchanged and no real API request occurs. Pin the reviewed CLI version/code hash; a CLI upgrade requires revalidation.
- Invoke the actual local CLI packer against an isolated fixture including .debug, maps, assets, package lock, ordinary source and synthetic env content. Assert all required entries and hashes, node_modules exclusion and redacted output. A package gcp-build check must not be counted as an executed cloud gate.
- Preserve the complete 346-export manifest and all option/env/config hashes. Run both the unchanged seven-second guard and SDK's unchanged ten-second discovery path on the installed entry. Do not replace discovery with a static manifest.

## Cloud preflight, postflight and recovery

Before an explicitly reviewed selective release, pin HEAD, source tree, package/lock, CLI and artifact hashes. Reuse existing per-endpoint env/secret/options/queue/schedule preservation helpers, updating their fixed expected HEAD only after integration. Take fresh revision/source-generation snapshots and retain their private backup artifacts. No scheduler/task invocation, financial replay, queue mutation or changed pause flag is needed for this packaging change.

After an authorized release, verify selected Functions and Run revisions are ACTIVE/Ready with expected traffic and unchanged runtime/service/env/secret settings. Read only the public build-control field to confirm GOOGLE_NODE_RUN_SCRIPTS is present and empty. Match the exact returned source generation, privately recover that source ZIP if authorized, and compare only the approved bundle/map/debug/assets/package/lock entries. Inspect build-step/provenance metadata for unexpected compilation without printing raw logs. Source ZIP equality plus build controls is source/provenance evidence, not proof that every handler or PDF/provider flow ran in the container.

Local recovery: stop any release, reconcile the owned build lock/journal, then choose NORMAL explicitly and rerun its complete gates. No cloud rollback follows automatically. Bundled retry: rebuild from the same reviewed source, verify all hashes/gates and proceed only through the normal release coordinator. Remote rollback, if separately selected, uses the preserved prior revision/source/config plan for the exact endpoints; it does not replay uncertain financial operations.

Acceptance remains pending implementation and review of this installer/dispatcher/packer path. The opt-in candidate alone cannot be used as a claim that Firebase currently deploys bundled bytes.
