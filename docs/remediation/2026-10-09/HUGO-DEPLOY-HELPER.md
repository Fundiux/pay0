# Selective Hugo evidence deployment helper

Prepared locally; no deployment or remote preflight executed by this change.
`scripts/deploy-hugo-evidence-preserving-env.ps1` defaults to read-only Preflight;
`-Mode LibraryOnly` (or `-LibraryOnly`) only defines functions. Execute is explicit.

The coordinator must supply the reviewed integration commit as a full 40-character
`-ExpectedHead` and the approved original dotenv SHA256 as `-ExpectedEnvHash`.
No HEAD is inferred or automatically advanced. Workspace is fixed to
`.worktrees/pay0-remediation-integration-20261009`; it must be clean. The source
branch is never the deployment target. Build, manifest/historical tests and final
compiled-artifact validation remain coordinator prerequisites; this tool does not
prove generated `lib` corresponds to HEAD by checking Git alone.

The only selector contains linkAgent007VerifiedExperience,
createAgent007LearningExperience, createAgent007LearningDraft and
linkAgent007LearningOutcome. Preflight pins the four revisions/generations in
[HUGO-RUNTIME-ARTIFACT-PREFLIGHT.md](HUGO-RUNTIME-ARTIFACT-PREFLIGHT.md), ACTIVE state,
exact project/source object/runtime/entry point, 30s/256Mi/CPU1/max20/concurrency80,
absent minimum/VPC, ALLOW_ALL and the observed compute service account. Any secret
environment binding or secret volume fails. Named configuration fields preserve
null positions. Postflight requires all four to have new revision/generation,
same configuration and exactly the same sole user env key/value.

Cloud metadata is read through allowlisted Functions GETs with selected fields,
30s timeout and no redirects. OAuth tokens and environment values remain in
memory; errors are redacted. No metadata payload is saved. User env must contain
only PAY0_FIREBASE_WEB_API_KEY, equal across the four Functions. The original local
dotenv must match the supplied hash and simple reviewed syntax; it may additionally
contain TELEGRAM_DOWNLOAD_TRANSPORT_MODE=POST_FRAGMENT, which is never staged for
these Hugo Functions. Duplicate keys, extra files, unknown keys and ambiguous
syntax fail closed. This is intentionally narrower than a general dotenv parser.

Execute acquires an exclusive CreateNew lock under ignored
`.firebase/hugo-evidence-deploy`, writes a verified CreateNew byte backup and a
private journal containing time/state/commit/hash/selector only, and rechecks the
workspace and all four remote snapshots before staging. The temporary dotenv has
only the shared public key. The IQ helper is dot-sourced LibraryOnly for generic
hash/map/serialization/CAS/native-process capture utilities; IQ plans, selectors,
credentials bindings and runtime expectations are not used. Native Firebase
output is retained only in a private ignored log; DEBUG is cleared temporarily.

Staging and restoration use the existing atomic-replace/hash CAS primitive. The
original bytes are restored in finally after success, deploy failure or postflight
failure; external concurrent edits cause refusal and preserve the backup. The
process lock does not make the filesystem and cloud transactional. A killed process
can leave a staged dotenv/lock, and a partial cloud update can leave a mixed group.
Inspect the private journal and exact hashes before manual recovery. Never delete
a stale lock or retry automatically; never overwrite an unexpected dotenv. There
is no automatic remote rollback. Generic CAS retains the known tiny filesystem
race between its final hash check and atomic replacement; operators must keep
other dotenv editors/deployments stopped during Execute.

Local checks: `node qa/scripts/remediation-hugo-deploy-helper.test.cjs` exercises
synthetic snapshots, exact selector, drift rejection, public-key-only staging,
backup refusal, failure/abort restoration and concurrent-edit refusal. The
separate manifest test uses real SDK/CLI transformations without network; on this
machine set PAY0_FIREBASE_TOOLS_ROOT to the installed roaming npm firebase-tools
directory because the nvm global npm root does not contain that CLI. Neither test
publishes Functions or contacts a provider.

Validation: synthetic helper suite passed 69 checks with zero remote calls.
Manifest suite passed 92 assertions across four exports using firebase-functions
7.3.2 and firebase-tools 15.3.1. No build or emulator was run by this change.
