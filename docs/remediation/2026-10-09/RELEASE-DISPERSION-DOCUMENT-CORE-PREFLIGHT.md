# Dispersion document core: deployed artifact preflight

Read-only cloud review, 2026-10-10. Candidate base `5a4457e` plus the private
document-core integration patch below. No uploads, clients, notification records,
Storage object contents, Telegram messages or provider business calls were read.
No integration worktree mutation, tests, build or deployment was performed.

## Exact observed group

Project `pay-0-system`, region `us-central1`. All three Functions are ACTIVE,
runtime nodejs22, entry point equal to export name. Source bucket is
`gcf-v2-sources-751158244178-us-central1`; object is
`<export>/function-source.zip`.

| Export | Revision | Source generation | Update UTC |
| --- | --- | --- | --- |
| initDispersionDocumentUpload | initdispersiondocumentupload-00015-joz | 1790583786531570 | 2026-09-28T08:23:46.702605942Z |
| finalizeDispersionDocumentUpload | finalizedispersiondocumentupload-00016-vab | 1790583786793238 | 2026-09-28T08:23:48.978132334Z |
| deactivateDispersionDocument | deactivatedispersiondocument-00016-kaf | 1790583789261431 | 2026-09-28T08:23:41.553605386Z |

Common service configuration: timeout60s, memory256Mi, CPU1, maxInstances20,
concurrency80, minInstanceCount absent/null, ingress ALLOW_ALL, VPC connector and
egress settings absent/null, runtime SA
`751158244178-compute@developer.gserviceaccount.com`. Missing minimum is recorded
as absent, not an explicit zero setting.

Init and deactivate have no secret environment bindings or secret volumes.
Finalize has exactly one secret environment binding: key and secret
`TELEGRAM_BOT_TOKEN`, projectId `pay-0-system`, version `1`; no secret volumes.
Only names/project/version were inspected, never secret contents.

All three contain the single non-platform environment key
`PAY0_FIREBASE_WEB_API_KEY`. In-memory comparison against the integration dotenv
at read time found equal values, no differing/remote-only/local-only keys. **This
was while the coordinator's Hugo deployment had staged a public-key-only dotenv.**
It is a comparison to that instantaneous file, not certification of the original
restored dotenv or its hash. Recheck the restored file and approved hash before a
document release. No values were emitted or retained. Runtime-managed keys were
excluded from the user-environment comparison.

## Recovery artifacts and source whitelist

Each ZIP was downloaded with its exact `gs://...#generation` selector into ignored
`.firebase/dispersion-document-preflight/<export>-<generation>.zip`. All three
complete archives have SHA256
`c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
Recovery ZIPs may contain private configuration, so they must remain ignored;
inspection opened only these four source entries:

| ZIP entry | Exact SHA256, identical across the three ZIPs |
| --- | --- |
| src/modules/dispersionDocuments/service.ts | 044da80195ec215f95cf367ed6e3dba84561a504d747e42dcc8b8008a7128c89 |
| src/modules/dispersionDocuments/callables.ts | 3460a9645ef6b260584b29c8928d968a9358f7237171ac59e6bf7bf8af55f19b |
| src/modules/dispersionDocuments/domain.ts | b81036ab06fd046d1a843818cda2de3d5aeb6f1c52bb80320ca8dc7bd5fb8c5e |
| src/modules/financing/dispersionFunding.ts | e321a52163acb712478bf3bc7267bae90e1c4bd5007cfe371487b9ba97e6544b |

Callables, domain and canonical funding helper match `5a4457e` after line-ending
normalization. The sole service difference is integration's replacement of a
direct userClientAccess active/root/permission check with
`getCurrentClientDelegationAccess(uid, clientId, operateDispersiones)` and its
import. Production already has the canonical USER funding ownership helper and
the notifier's `private_user_withdrawal` early return. They are not new behavior
introduced by the private patch.

## Private patch boundary

`.firebase/document-finalize-integration.patch`, SHA256
`bfe3a086ec1841af451699238e3c1525ff02034d26fccf4ac2855977aac9b3c8`, is based on
`5a4457e`, 31,462 bytes, 18 hunks and four files: service, shared test harness,
90 authority cases and 15 finalize replay cases. It incorporates the core changes
from `ad18928`/`4cd3475`, not notifier `0281323`/`91fe872`.

The patch preserves the canonical funding import and calls its actual helper
inside current transactional authority validation. Additional safe-ID validation
remains; the harness recursively loads the real helper and asserts it was loaded.
Init creates PENDING metadata under current authority; finalize validates exact
object metadata and upload identity, pins the observed generation and preserves
READY replay without reviving retired records; deactivate revalidates and audits
atomically. It does not change financial state or invent historical metadata.

`git apply --check` passed against a private copy of the exact base. The patch was
then applied only to that ignored private copy for static comparison, never to
integration. The notifier section from its export through EOF is identical in
production, base and patched candidate; SHA256
`c8d05301e19f4b6e7613fcaf9961ae54855a62f5bab10ea7890d631a06a0ce25`.
Callables/options/domain remain untouched. The prepared 105-case harness has not
been run against the integrated candidate; prior source tests are not an
integration certification.

## Omitted runtime options and release gates

The three callable declarations specify cors/60s/256MiB; finalize additionally
references `defineSecret(TELEGRAM_BOT_TOKEN)`. Global options specify only region.
They omit preserveExternalChanges, min/max, concurrency, ingress, VPC and runtime
SA. Static inspection of installed firebase-functions7.3.2
`lib/runtime/manifest.js` shows initV2Endpoint resets omitted minInstances,
maxInstances, ingressSettings, concurrency, serviceAccountEmail and vpc unless
preserveExternalChanges is true. Explicit memory/timeout override their reset
slots. CPU is resolved later; observed CPU1 is not independently pinned here.
No SDK/CLI transformation test was executed for these three exports in this review.

Before release, prepare the narrow options follow-up: preserveExternalChanges:true
plus explicit maxInstances20/concurrency80, retain timeout60/memory256 and current
secret declaration. Validate the actual manifest/update masks and named null fields
with the reviewed CLI. DefineSecret names the secret, not version1: verify the
resolved deployment binding remains the observed project/name/version, rather
than assuming preservation if CLI resolves a newer latest version.

Then integrate only the reviewed hunks, run adapted105 cases, authorization policy,
Functions build, discovery and appropriate transaction contention gates. Recheck
remote revision/generation/configuration immediately before release and use exact
env staging/restoration and postflight comparison. Publish only the three exports
listed above, after coordinating the restored dotenv and deployment window.

Notifier is not required to enforce upload state/authorization invariants. Its
existing delivery race, retry behavior and latest-generation download remain
open, and finalize still invokes it after READY replay. The preserved USER early
return is compatibility evidence, not resolution of the pending recipient policy.
This candidate does not certify immutable/idempotent Telegram delivery or claim
end-to-end closure. No delivery-triggering smoke call belongs in this preflight.
