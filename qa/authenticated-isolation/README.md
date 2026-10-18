# Authenticated Batch 1 QA isolation

Functional candidate: `21e45105ccfeeb90c3f90f443884c4499547ebbf`.

- The workflow is manual-only and has `contents: read` permissions.
- It builds dependencies while networking is available, then runs with `--network none`, a read-only root filesystem, no Docker socket, no credentials, and a non-privileged UID.
- The image starts Auth, Firestore, and Functions emulators with project `demo-pay0-ui-qa`.
- `run.mjs` seeds no production data; Playwright global setup creates only deterministic QA accounts and data in the emulators. It invokes the real `logAuthEventCallable` with an Auth Emulator token and verifies its Firestore audit record. Other page callables remain local browser stubs to avoid financial mutations.

Infrastructure provenance: `origin/main@d9fa8f55008f7bd59f92262b472ecb96187a4121`, successful isolation run `39123045600`.