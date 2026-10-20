# Voice startup: source integration after publication

Integrate only the two-file voice startup fix from published source
`af1a884270d427244b5a78feed123b5e9be89aaf`, plus its tests and CI wiring.
The production overlay is based on `f1df4a2835e37db725897bd97a26475437d88637`;
this integration is based on GitHub main `48741917ff2b3f0a856e64ebd267a3760ec2faac`.
Do not merge the overlay's unrelated production history into main.

Startup can be cancelled, times out after 45000 ms, releases late microphone
tracks, and rejects stale attempts. Eleven lifecycle tests exercise the actual
component handlers. CI also checks the gateway contract and compiled frontend.

This is source integration only. Do not deploy or rebuild production artifacts.
The published ZIP SHA-256 remains
`9d4321facd660bc9ec0d319883982698aa5ace21a59127508c7411be1ba6549b`,
Hosting `89de9f0862d03d49`, SSR `ssrpay0system-00616-ret`.
The tested optimized Hugo chunk SHA-256 is
`c5918c76eab3ee8f23db424b354d7a7c6ea3ea5571d9f5f64eb743d89805f9cb`.

Rollback stays pinned to Hosting `40a3d90573d2a52b`, SSR `00614-qep`, source
`f1df4a2835e37db725897bd97a26475437d88637`, and ZIP
`31aab2ff68a319b1b251e6b4bc29ae4ed790da8a916dd792c157d3cd50d9a1ad`.
The existing deployment receipt and rollback controller require a fresh exact
match to our own release before restoring Hosting and SSR together.
Do not overwrite concurrent changes, financial code, or deployment evidence.

Authenticated real audio, R2 comparison, session correction, reread and
withdrawal remain **PENDING**. Synthetic startup tests do not certify real audio.
