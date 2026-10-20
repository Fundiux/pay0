# Dispersion document core release

Published and verified 2026-10-10 from integration commit
`a276e0397bb2e7e7494ae9dd7588efa8a0537c93`, pushed on
`integration/pay0-remediation-20261009` before deployment. Main was not changed.
Only initDispersionDocumentUpload, finalizeDispersionDocumentUpload and
deactivateDispersionDocument were selected. Helper d1061c6, Execute session24864
exit0; independent runtime postflight43604 exit0.

| Export | New revision | Source generation | Function update UTC |
| --- | --- | --- | --- |
| initDispersionDocumentUpload | initdispersiondocumentupload-00016-zot | 1791655185415852 | 2026-10-10T18:01:05.794306876Z |
| finalizeDispersionDocumentUpload | finalizedispersiondocumentupload-00017-jaz | 1791655261723468 | 2026-10-10T18:01:14.288182901Z |
| deactivateDispersionDocument | deactivatedispersiondocument-00017-rob | 1791655262587650 | 2026-10-10T18:01:24.396909381Z |

All three are ACTIVE, Cloud Run Ready, with exactly100% traffic to the new
revision. Ready times respectively18:01:04.932424Z,18:01:13.979437Z and
18:01:23.698561Z. Empty unauthenticated POST returned401 on each; authenticated
uploads, financial actions and Telegram sends were not exercised.

Runtime comparison preserved node22,60s,256Mi,CPU1,max20,concurrency80, absent
minimum/VPC, ALLOW_ALL and the same runtime SA. Only finalize binds
TELEGRAM_BOT_TOKEN version1; no other secrets or volumes were introduced.
User environment stayed public-key-only. Latest secret metadata was checked
before deployment; this is not an atomic lock against external key rotation.

Private journal/backup: `.firebase/document-evidence-deploy/c7b26b3d1ccd4f19aff8f65c2dc150f7/`.
Original dotenv restored18:01:54.9398117Z and independently verified SHA256
`572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856`.
Do not rerun the helper Execute: its prior-revision pins are now obsolete.

The release revalidates current actor, parent, client and delegation authority
inside document mutations, preserves canonical USER funding ownership, validates
object metadata, and makes READY replay preserve the original version without
reviving retired uploads or duplicating document audit events. No historical
records were rewritten. Runtime options were explicitly preserved.

Gates:105 document cases,72 manifest assertions, policy verification and Functions
build PASS; exact candidate financial emulator17 scenarios and USER withdrawal110
checks PASS, fakeExecutorCalls3 and realIqPosts0. Ambiguous IQ24, instrument29,
staging81, deferred authorization/effects/wiring and commission domain checks PASS.
Normal deployment prechecks and document-access emulator also passed. Strict
discovery5,264ms stayed below7,000ms; final CLI discovery/upload succeeded.

Notifier code is unchanged (normalized SHA256
`c8d05301e19f4b6e7613fcaf9961ae54855a62f5bab10ea7890d631a06a0ce25`).
The existing USER no-send behavior remains. READY replay can still invoke the
legacy notifier; its claim race, retry semantics and latest-generation download
remain open. This release does not certify idempotent Telegram delivery or a full
authenticated operational E2E flow. Recipient policy is still pending.

Previous revisions, exact generations and preserved ZIPs are listed in
[the preflight](RELEASE-DISPERSION-DOCUMENT-CORE-PREFLIGHT.md). All old archives
have SHA256 `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
Keep recovery material private. Prefer a compatible forward correction;
redeploying the old source would restore the authorization/replay gaps. Recovery
must recheck current revisions and preserve configuration; no automatic rollback
or retry was performed.
