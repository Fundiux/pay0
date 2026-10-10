# IQ scaling PATCH diagnostic

2026-10-10 UTC. Local read-only investigation, Firebase CLI 15.3.1. No cloud mutations or IQ calls by this investigation.

## Observed discrepancy, not a resolved cause

Coordinator reports successful group 1 deploy: automatic revision 00002-tud and scheduler 00021-vuq. Automatic Cloud Functions maxInstanceCount changed from absent to 20; old Cloud Run revision 00001-gox omitted scaling.maxInstanceCount, new revision has 20. Current Run service also has service-level max 20 and template-level max 20. No predeploy Run service snapshot establishes its earlier service-level limit. Absence on an old revision does not establish an unlimited service.

Group 2 was stopped by postflight. Preserve that gate; do not normalize absent to 20 or restore an unproven default.

## Real CLI boundary test

`node qa/scripts/remediation-iq-deploy-patch-boundary.test.cjs`: PASS, four synthetic cases (absent/null/1/20). Loads installed CLI functionFromEndpoint and updateFunction; intercepts Client.patch and prohibits HTTP/HTTPS/fetch. Does not load PAY0 handlers. Asserts both body presence/value and updateMask, including absence of a parent serviceConfig mask that could reset children.

Absent maxInstances remains absent through PATCH. Null is an explicit reset and is masked. Values 1 and 20 are explicitly masked and transmitted. Thus this test reproduces the preservation boundary, NOT the unexplained remote insertion of 20. It does not simulate or certify server defaults.

The previous 73-assertion SDK/CLI suite ended at functionFromEndpoint/fieldMasks; this extends coverage through updateFunction. Initial local invocation located a different npm global prefix and failed MODULE_NOT_FOUND; resolution now follows APPDATA Firebase installation as the deploy wrapper, with an explicit PAY0_FIREBASE_TOOLS_ROOT override. No test assertion was removed.

## Installed CLI evidence

- `lib/gcp/cloudfunctionsv2.js`: functionFromEndpoint uses renameIfPresent for maxInstanceCount. updateFunction adds environment metadata and computes fieldMasks; it does not insert max 20. DEFAULT_MAX_INSTANCE_COUNT=100 is used only in a quota warning.
- `lib/deploy/functions/release/fabricator.js:updateV2Function`: forms the API function and invokes the above PATCH; it does not read a Run service to copy scaling. Following the update, it sets invoker IAM where applicable.
- `lib/deploy/functions/backend.js:loadExistingBackend`: ordinary path reads Functions v2. Run-service discovery is gated by functionsrunapionly. Current local experiment booleans only were inspected: functionsrunapionly=false; functionsv2deployoptimizations=true. These are current local settings, not a captured deployment request.
- `lib/bin/cli.js:43`: deletes firebase-debug.log on exit code <2 when DEBUG is absent. Integration wrapper explicitly deletes DEBUG. No firebase-debug file remained anywhere in integration after successful CLI exit. Therefore the actual request cannot be reconstructed from that log; no raw log or environment was printed.

## Primary contract and next gate

[Functions v2 PATCH](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch) defines updateMask as the list of fields updated, with all fields updated if no mask is provided. The synthetic captured request has a nonempty mask excluding max when absent.

[Cloud Run maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances) distinguishes service-level and revision-level limits and documents default 100 per revision. [Functions quotas](https://docs.cloud.google.com/functions/quotas) also documents a default of 100 for second-generation HTTP functions. These sources do not establish 20 as a universal Cloud Functions default. App Engine defaults are a different product and are not evidence here.

Inference only: provider-side reconciliation with a previously configured service-level value may explain the result, but absence of a prior service snapshot and actual PATCH projection prevents proving it. Do not claim it as root cause.

Next safe evidence is a restricted projection from retained audit/request metadata, if available, of method/name/updateMask/scaling/concurrency, plus predeploy service-level scaling. Do not log request bodies, environment, headers, credentials, or tokens. Future runtime fingerprints should preserve attribute identity with a key-to-value object, including explicit null/absence, rather than positional PowerShell arrays that drop nulls. Any decision to pin max explicitly is an operational change needing a justified target, not restoration of a proven former value.
