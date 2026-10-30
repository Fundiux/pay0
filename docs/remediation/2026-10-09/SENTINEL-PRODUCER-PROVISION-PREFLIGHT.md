# Producer disabled provisioning preflight candidate

2026-10-10. Preparation only; no cloud calls, IAM writes, API enablement or resources
created by this task. Root reports runtime IAM gate c9586d7/session94266 PASS and
independent cleanup PASS: three bindings absent, two synthetic paths404, canary
DISABLED. This proves the synthetic conditional read test, not the future producer
identity, exclusivity, startup, signature transport or current existence of resources.

Reviewed base8bedd42 had reader/logger bindings whenever provisioning=true. Its
signing flag alone did not mean all grants were off. The approved narrow change
adds independent enable_read_grant and enable_logging_grant defaultsfalse alongside
existing signingflagfalse; roles now explicitly stageGA/prevent_destroy. Existing
SA disabledtrue and version DISABLED are unchanged. Provisioning=true with these
defaults creates eight resources (API, SA, three roles, ring, key, version), no IAM
bindings. Default provisioningfalse creates zero. Independent flags cannot create
resources without provisioning. 52 local checks PASS including Terraform console
combinations, no provider auth/plan/apply. No runtime or observer trust changes.

Private review helper: .firebase/producer-provision-preflight/preflight.mjs and
preflight.test.mjs. Defaultoffline. Explicit --read-only accepts OAuth token via
stdin only and performs fixed GETs, at most9requests/120s/15sperrequest/64KiBbody,
no retries/redirects. Output enums/counts only. SA metadata/uniqueId/disabled, exact
three custom roles, KMS API states on both projects, and fixed ring/key are checked.
Version listing is one page20; nextPageToken means INCOMPLETE_REVIEW, never absence.
No public/private key export, signatures, logs or users records. Source KMS API is
observed only, never enabled; actual KMS key resides in isolated project.

Prior SA404 is historical only: requery exact project/email, avoid wildcard project.
403 means unknown, not absent. API DISABLED blocks KMS observation; no inference of
ring/key absence is made. Existing resources always require adoption/ownership/state
review, even if metadata matches; script never sets provisionReady=true. It does not
inspect inherited IAM or prove that no external principal can sign/administer an
existing key. Before apply, central review must inspect existing state ownership,
project/key IAM and exclusivity, any resources found, and a closed Terraform plan reviewed in memory, without -out or exporting a plan.
No blind import, no substitute identity, no use of observer state. No remote helper
execution until reviewed. API enablement, if required to inventory KMS, is a separate
minimal reviewed step followed by another preflight before any key creation.

Target reviewed plan: onlyeight creates, zero deletes/updates/imports/bindings, values
SA disabledtrue, keypurpose ASYMMETRIC_SIGN, skip_initial_version_creationtrue,
RSA_SIGN_PSS_3072_SHA256/SOFTWARE, version DISABLED, exact fixed projects/names.
Version ID is assigned by server; never assume1. API documents create defaults to
ENABLED if state is omitted; explicit DISABLED is therefore essential. Provider
implementation/internal transitions still require verification; no claim of atomic
never-enabled creation. No grants plus disabled SA protects producer capability,
but existing administrative KMS principals remain outside that narrow guarantee.
[Version creation](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/create),
[version state and nonexportable material](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions),
[SA GET](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/get).

Disabling KMS does not revoke previous offline signatures or observer trust. Do not
activate SA/version/grants/writer in this provisioning batch. Afterwards verify
metadata exact, key version DISABLED, SA disabled, no three intended bindings;
retain IDs privately for recovery. Do not turn provisioningfalse into rollback:
prevent_destroy protects roles/identity/key, and removal is a separate reviewed plan.

Offline schema validation of the updated flags: fmt -check PASS and terraform
validate PASS with google7.46.1 already cached, in private copy
.firebase/producer-schema-grant-flags-20261010. No init/network/plan/apply.
Sandbox initially denied provider checksum read; narrow elevated local validation
passed. 52 local checks remain PASS. Central read-only preflight26245 was launched
by root separately; this agent did not duplicate that call and makes no claim about
its pending result. Commit excludes all private artifacts and root work in progress.

## Central execution checkpoint

2026-10-10: API-enable helper reviewed by root,15 synthetic checks PASS. Execute39508
finished ENABLED_VERIFIED with exactly1POST to isolated project; source KMS API
remained DISABLED. Independent read-only inventory confirmed SA/three roles and
key ring absent. No keys, identity, bindings, signatures or runtime were created.
The enable helper and journal remain private in .firebase/producer-kms-api-enable.

Separate producer Terraform root initialized offline and validated with Google7.46.1;
its committed lock matches verification-infra exactly. Neither observer nor
verification state owns this API. Import adopted only the already-enabled API.
The first post-validator incorrectly rejected three zero-instance IAM containers
that Terraform includes in state. No import retry: corrected strict validation and
21tests PASS confirmed one exact API instance, three known empty containers and zero
active bindings. State serial1; SHA256
fb4eab889b6cfe3af6dc26ca9c5af20bdfc2923fb653c6cf4cd11669fbe358a0.

Plan-review42842: Terraform exit2, seven creates, zero updates/replacements/deletes.
Output existed only in memory, SHA256
c529b1694dd1ebe49bc721f5904c453dd51cc2217180169f57bd908101841642.
Strict parser still rejects an unknown computed schema field; no acceptance or apply.
Diagnostic schema review remains open. Empty resource containers do not grant IAM.

Exact provider source v7.46.1 was reviewed: CryptoKeyVersionCreate includes configured
state in its initial POST; configured DISABLED is not implemented as create-enabled
then PATCH. This does not prove server-internal atomicity or binary/source lineage.
SA disabled, grants absent and remote version state remain required verification.
