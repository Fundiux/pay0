# Selective dispersion document deployment helper

Prepared source only; no Execute or remote Preflight run by this change.
`scripts/deploy-dispersion-document-core.ps1` defaults to Preflight and supports
LibraryOnly/Execute. The coordinator must supply full reviewed ExpectedHead and
ExpectedEnvHash. Target is fixed to the clean integration worktree, never source.

Only initDispersionDocumentUpload, finalizeDispersionDocumentUpload and
deactivateDispersionDocument are selected. Revision/source pins come from
[the runtime preflight](RELEASE-DISPERSION-DOCUMENT-CORE-PREFLIGHT.md). It checks
ACTIVE, exact project/runtime/entry/source location and 60s/256Mi/CPU1/max20/
concurrency80, absent minimum/VPC, ALLOW_ALL and the observed compute SA. Named
JSON configuration fields preserve null positions.

Finalize alone must have exactly TELEGRAM_BOT_TOKEN, projectId pay-0-system,
secret TELEGRAM_BOT_TOKEN, version1. Init/deactivate must have no bindings; all
three must have no secret volumes. Since defineSecret does not pin a version,
metadata-only Secret Manager GET versions/latest?fields=name,state must return
ENABLED version1 in pay-0-system (or its fixed numeric project751158244178).
This gate runs before Preflight success and again immediately before staging.
No secret payload/access endpoint is called. Concurrent secret rotation after
the gate is still possible; coordinate rotation and verify exact runtime binding
after deployment. Metadata permission failure stops without widening IAM.

Remote user env must contain only the same public Firebase API key on all three.
Local dotenv bytes must match the supplied hash and narrow reviewed syntax; it
may additionally contain TELEGRAM_DOWNLOAD_TRANSPORT_MODE=POST_FRAGMENT. Only
the public key is staged. Unknown keys, duplicate syntax and extra dotenv files
fail. OAuth tokens and env comparisons remain in memory; no values are output.

Execute uses a CreateNew exclusive lock, verified byte backup and state/hash/
commit/selector journal in ignored `.firebase/document-evidence-deploy`. It
rechecks HEAD/clean tree and all three remote snapshots before staging. Generic
hash/CAS/serialization/native-capture utilities are reused from the IQ library
in LibraryOnly mode; no IQ snapshots, pins, configuration or selectors are used.
Native CLI output stays in a private ignored log, with DEBUG temporarily cleared.

On success, failure or postflight error, finally restores exact original bytes
unless a conflicting edit forces refusal and retention of the backup. After
success all three Functions must have new revisions/generations and identical
reviewed configuration/environment. There is no automatic retry or remote
rollback. Process termination can leave a lock/staged dotenv; inspect private
journal/hash evidence before manual recovery. The inherited filesystem CAS has
a small final-check/replace race; keep other dotenv editors/deployers stopped.

Preconditions outside this helper: integrate the document-core patch while
preserving canonical funding and notifier, run its105 cases and policy gates,
verify build output corresponds to the reviewed commit, pass manifest/discovery
and appropriate transaction checks. This helper does not invoke any callable or
send a notification. The existing USER recipient policy and notifier delivery
risks remain open; deployment success is not end-to-end delivery certification.

Validation: `node qa/scripts/remediation-dispersion-document-deploy-helper.test.cjs`
passed74 synthetic checks with remoteCalls0. Covers selector, config/source/env
drift, exact secret project/name/version, latest disabled/new-version rejection,
public-key-only staging, backup refusal, failure/abort restoration and CAS
conflicts. The three callable manifest test passed72 assertions SDK7.3.2/
CLI15.3.1 with network forbidden. No build or emulator was run by this change.
