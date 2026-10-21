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

## Published identity retained during source integration

Production is `sendmytelegramtestnotification-00016-mix`, ZIP SHA-256
`5ca1d42ddef209abbf6b95d2c6f38fab5a0bb81c043a4c6a36966647aca62fcb`.
The immutable deployment recipe remains commit
`9c050c1b2e14295f7ce8492ef185580d751e233b`, with input SHA-256
`2466829f58391ee4749c0db25cf706ff7c2ac7cbe67335874a36312a02c100e7`.
Integrating the recipe and guards into main does not change these identities.

The exact module passed 23 transport cases and the real callable passed ten
integrated checks in disposable Firestore. Seventeen deployment guard tests
passed. The baseline's ten checks characterize its previous behavior; they
are not additional fixes. No real Telegram messages were sent.

One update was accepted. A DNS failure interrupted polling; its known operation
was reconciled with a GET-only recovery and the existing verified-state resume,
without dispatching a second update. Configuration, runtime, IAM, exact source
and anonymous HTTP401 were verified independently afterward.

Rollback remains the original `00015-ref` source and archive above. Its pinned
generation `1790583793494540` was re-read after publication. The existing receipt
requires a fresh exact own-state match before rollback. This PR is source and
CI integration only: no deployment, recovery replay, or authenticated sending.
