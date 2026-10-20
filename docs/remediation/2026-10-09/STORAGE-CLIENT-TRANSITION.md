# Storage client transition: compatibility gates

## Deployment update 2026-10-09 23:05 UTC

Integration c29260b (including isolated fix055f17b and portable fixture) is pushed. The corrected callable is deployed: getauthorizeddocumentdownloadurl-00004-vat ACTIVE/Ready,100% traffic; source generation1791586901568255, updateTime23:03:00.551536764Z. Timeout30s/memory256Mi/no secret references unchanged. CLI exit0. Unauthenticated synthetic uploadId POST401/UNAUTHENTICATED; no real document access tested. Functions build, policy verifier,13 focused checks and normal predeploy96 rules+42 simulated downloads PASS. The historical red integration evidence below predates this release. Historical signed URLs, generation pinning, post-validation authority changes, Storage fallback retirement and legacy provenance remain unresolved as described below.

Review: 2026-10-09. Read-only code/artifact review; this document is the sole edited file. No rules changes, production data writes, document downloads or provider effects.

## Decision

Hosting publication does not retire already-loaded bundles or alternative clients. Keep the delegated Storage read fallback until an explicit client transition and upload recovery gate is satisfied. No finite wait based only on Hosting publication proves old clients have disappeared. Authentication token refresh/sign-out does not itself guarantee a new JavaScript bundle. A version gate added to new code cannot retroactively execute in old tabs.

Searches of principal and integration src found no service-worker update listener, application minimum-version gate, forced document reload or storage/unauthorized recovery for this transition. Ordinary data refresh functions named reload are not document reloads. No inventory establishes that alternative clients do not exist.

## Consumer matrix

| Consumer in old bundle | Behavior if delegated Storage reads are removed | Gate |
|---|---|---|
| uploadDispersionDoc.ts + DispersionDocsModal | getDownloadURL runs after upload but BEFORE finalize. Denial skips finalize, leaving uploaded evidence pending. Modal alerts, clears file selector, and has no resume checkpoint or reload recovery. | Blocking compatibility defect for old tabs. Confirm session transition and drain pending uploads, or design an explicit pending-upload recovery workflow before cut. |
| uploadSolicitudDoc.ts | Finalize precedes optional getDownloadURL; error becomes empty URL. | Finalization survives. Opening later uses legacy callable in old bundle. |
| uploadEntityDocument.ts | Finalize precedes optional URL mint; error becomes empty URL. | Entity branch is not part of the proposed three-family cut. |
| EntityDocumentsPanel / assets/documents | Error display only; no reload or transport fallback. | Their owner-only branches remain unchanged by proposed cut. |
| DocsModal / PagoDocsModal / DispersionDocsModal / pagos / materialidad | Old wrappers invoke getAuthorizedDocumentDownloadUrl by uploadId and open returned signed URL. | Preserve callable request/response during migration; do not equate Storage-rule denial with signed-URL revocation. |
| Alternative clients | Repository does not prove inventory or upgrade status. | Identify consumer owners/contracts before claiming compatible retirement. |

The integrated new frontend has zero getDownloadURL/getBlob/getBytes calls. Its authenticated POST/blob transport removes five previous SDK sites. This proves candidate source migration, not adoption by every session.

## External workflows and references

- Public /firma/{token} uses signature callables. Submission writes through Admin Storage and creates a canonical uploads record; it does not need browser SDK reads. The resulting signature is opened through its uploadId in DocsModal.
- Constancia generation reads signature bytes and writes PDF through Admin. /verificar/constancia/{token} calls getPublicConstanciaVerification, which returns integrity metadata (folio, names, hash, active/date), not Storage bytes or a download URL.
- Materiality documentRefs contain canonical upload ID and storagePath. The current UI uses the ID with the authorized-document wrapper; storagePath in the projection is not itself evidence of SDK transport. External consumers of those references have not been inventoried.
- documentDeliveryJobs accepts optional downloadUrl/url alongside storagePath. This review does not establish every external worker's retrieval contract; preserve references and do not rotate bearer tokens by inference.
- Telegram capability streaming and corporate signed URLs are separate transports; the three Storage fallback changes do not migrate them. Admin SDK bypasses client rules and requires its own authorization.

## Current legacy callable versus candidate

Read-only metadata query confirmed ACTIVE getauthorizeddocumentdownloadurl-00003-xuj, source generation 1790583836497870, updateTime 2026-09-28T08:24:21.108225229Z. Output was limited to state/revision/source generation/update time; no tokens, environments or document data. Preserved artifact getAuthorizedDocumentDownloadUrl-pre-bridge.zip has SHA256 C50F0D7A95BB24CAF156022AE1145503D34F2110F9C39DF71921EE52A190DB1F (provenance in LEGACY-DOCUMENT-COMPATIBILITY.md). Only selected TypeScript modules were read in memory; no configuration was extracted.

The deployed artifact signs a path-based GCS URL for 300 seconds. Its packaged access/authGuard modules lack the new grantAuthority lineage resolver and trusted-restriction guard. Deploying streamPrivateDocument did not update this separately exported callable.

The integration candidate functions/src/modules/documents/authorizedDownload.ts already invokes resolveAuthorizedDocumentObject. That resolver reads user, upload, operation and grant ancestors in a transaction; assertAuthorized reaches decideUserAuthorization/evaluateTrustedRestriction. Delegation passes transaction:tx to requireClientOperationalAccess. USER-funded dispersion and root boundaries remain explicit.

Wire compatibility remains: callable name getAuthorizedDocumentDownloadUrl, input {uploadId}, output {ok:true,uploadId,url,expiresInSeconds:300}, CORS true, timeout30s, memory256MiB. No wrapper change is needed for existing callers. New frontend wrappers continue to use the POST/blob bridge instead.

This is stricter authorization, not full semantic equivalence: the shared resolver rejects pending/unknown statuses, inactive/deleted parents and malformed identifiers more explicitly. READY/ACTIVE/FINALIZED and active blank-status legacy are supported. Four entityId-only historical records already failed the prior resolver and remain rejected; no parent is inferred. Inventory evidence covers 1357 valid uploads and13 active entity documents of one root, not all tenants or orphan objects.

Residual signed-URL limits: candidate still signs a path without generation pinning, performs signing after its authorization transaction, and does not revalidate authority for each later GET. A URL already delivered can remain usable for up to its expiry. Do not advertise stream-level revocation guarantees for this compatibility callable. Legacy grants with no provenance still retain their separately documented compatibility allowance.

## Next executable backend compatibility lot

No additional implementation is required merely to route this callable through the integrated central resolver. Before a one-function publication, add focused contract tests that exercise the actual callable with the resolver and a counting fake signer:

1. Preserve {uploadId} request, URL response and expiresInSeconds=300; verify production signer expiry uses now+300000 with bounded synthetic clock. Test all three operation families, flat historical and docs layouts, signature/constancia/REP upload types and legitimate USER funding.
2. Deny active/malformed trusted restriction including superadmin, inactive actor, ancestor revoke/module removal/root change, foreign document/parent and invalid lineage. Signer count must remain zero on denial.
3. Exercise unchanged old wrapper against callable protocol, plus new wrapper POST/blob contract separately. Preserve expected not-found for missing object and sanitize provider errors.
4. Existing verify-authorized-document-download.cjs provides42 successful role/type combinations and8 denials, but does not by itself cover the complete trusted-restriction/ancestor matrix or precise300s wire assertion. Reuse its demo-only emulator guard; add rather than weaken assertions.
5. Run Functions build, focused synthetic and demo-emulator tests, export discovery and the normal release gate. Capture current revision for rollback. Proposed deploy scope is only getAuthorizedDocumentDownloadUrl, performed later by the coordinator; no deployment was executed in this review.

This backend lot improves authorization for old bundles while retaining their protocol. It does not repair old uploadDispersionDoc ordering and therefore does not unlock Storage fallback retirement by itself.

## Storage cut remains separate

Candidate local implementation remains three read-only helper fallback removals, covering six matches (three docs and three flat). Keep prepared writes and owner/root/USER branches. Require48 negative restriction cases and legitimate delegate bridge positives, client adoption/recovery evidence, and explicit handling of alternative clients. A bounded operational maintenance window may accept interruption with recovery, but must not be labelled seamless compatibility. Do not hide actions, invent parents, silently finalize uncertain uploads, or revoke historical URLs without a separate approved migration.

## Executed compatibility regression: signing race remains open

New qa/scripts/remediation-legacy-download-authority.test.cjs transpiles the actual callable, shared resolver, lineage access, policy and authorization modules from an explicit --source-root. Only SDK/storage/Firestore are synthetic. The default signer is exercised, not replaced with an always-successful callback; getSignedUrl calls are counted. Network fetch is forbidden. No build or emulator was run for this test-only lot.

Executed against both .worktrees/private-document-bridge-20261009 and .worktrees/pay0-remediation-integration-20261009: **8/10 PASS, 2/10 FAIL**, exit1 intentionally preserved. The principal checkout currently has no documents/authorizedDownload.ts; invoking there gives SOURCE_MISSING exit2 instead of silently selecting integration. Both candidate checkouts are read-only targets.

Passed: exact callable wire result and actual signer expiry now+300000 (bounded timing tolerance); valid actor; active trusted restriction for admin and superadmin; malformed restriction; revoked ancestor grant; revoked ancestor delegation module; actual unchanged old callable wrapper; candidate bridge wrapper selecting uploads/documentId and returning local blob.

Failed invariant: changing actor restriction or revoking ancestor inside the fake Storage exists() causes the callable to invoke getSignedUrl once and return a URL. The evidence changed AFTER its authorization transaction and BEFORE signing. These two tests require denial and zero signatures; they remain red and must not be described as a passing release gate. Existing Firestore transaction correctness does not remove this cross-service gap.

Proposed next domain change, not implemented here: separate object existence/metadata lookup from signing; re-run the current-authority resolver after that await and immediately before getSignedUrl, also ensuring the resolved document/path is unchanged. Preserve the300s wire contract and sanitization. This narrows the demonstrated race; it cannot make Firestore and GCS signing one atomic transaction, pin legacy URL consumption to current authorization, or revoke URLs already delivered. Generation pinning remains a distinct existing limitation. Coordinator approval is required before domain edits.

Reproduction commands (no remote actions):

```powershell
node qa/scripts/remediation-legacy-download-authority.test.cjs --source-root .worktrees/private-document-bridge-20261009
node qa/scripts/remediation-legacy-download-authority.test.cjs --source-root .worktrees/pay0-remediation-integration-20261009
```

### Follow-up: isolated postlookup correction implemented

With coordinator authorization, only private-document-bridge functions/src/modules/documents/authorizedDownload.ts was changed. The worktree was clean except for an unrelated untracked coverage report, preserved. Production and integration were not modified. The actual default path now performs exists(), then resolves current authority again, compares document revision/storagePath/expectedGeneration with the original resolution, and only then calls getSignedUrl. The optional injected signer contract remains compatible; it also receives post-resolution validation.

The suite now includes document path, stored generation and parent changes during exists(). Corrected isolated candidate: **13/13 PASS**. Unmodified integration: **8/13 PASS,5/13 FAIL**, each failed race issues exactly one signature. This is deliberate before/after evidence, not a green integration gate. No additional build was run because the coordinator reserved that window; compilation remains a release gate for the domain commit.

The correction closes the demonstrated asynchronous lookup window and refuses changed document identity instead of signing the old path with new metadata. Authority can still change after the final validation; Firestore and GCS signing are not atomic. The URL remains path-based and usable until expiry, with no per-GET revalidation. Do not claim generation-pinned or retroactively revocable legacy URLs.

### Portable legacy wrapper fixture

The legacy wrapper regression now loads qa/scripts/fixtures/legacy-authorizedDocuments-ae21267.ts.fixture relative to the test file, independently of cwd or whether the current checkout has migrated to POST/blob. Fixture bytes were extracted with git show from commit ae21267816a8e698beedc916a03ecbd04a8c8040, path src/services/authorizedDocuments.ts, with no content edits or configuration files. SHA256 (LF-normalized solely for cross-platform checkout line endings): 04ae913b5bcac350e7afb9833e56f24d451e5137fa6b6c182ad30b64b587cecd. The test asserts this hash before transpiling the actual historical wrapper. Candidate resolver and current wrapper still load from explicit --source-root; no integration files are changed by the runner.

Validation against integration eb76f98:13/13 PASS from principal cwd with explicit candidate path, and13/13 PASS from integration cwd with the principal script absolute path and --source-root . . Both runs use the same versioned historical fixture and perform zero external actions. No build rerun for this test-only portability change.
