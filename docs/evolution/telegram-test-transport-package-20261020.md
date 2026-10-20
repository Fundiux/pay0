# Telegram transport: bounded first delivery

Recover the pending transport package from `afe9ad2`, already present in main.
The audit identifies 46 transitively affected exports. This package deliberately
selects only `sendMyTelegramTestNotification`; other endpoints remain pending.
No real Telegram messages or financial operations are part of certification.

The baseline is the exact production generation of `00015-ref`, archive SHA-256
`c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
Keep every other runtime/source file unchanged. Overlay only the transport TS,
emitted JS and its map; verify the old emitted handlers match the audited base.
Exclude an environment file only after proving its values are already supplied
by the deployed environment and no runtime code loads it.

Certification must run the 23 transport cases on the exact emitted module and
the real package.main callable against disposable Firestore, including access,
disabled/unlinked accounts, success, redacted failures and a single attempt.
Keep the original canonical startup probe and receipt-bound source deployment
controller. Prepare rollback to the exact previous generation and preserve its
metadata, IAM and secrets. Deployment is allowed only after all gates pass.

Do not deploy the main checkout, financial endpoints, parser/corrector, Hosting,
gateway or the other Telegram consumers. Real authenticated audio remains pending.
