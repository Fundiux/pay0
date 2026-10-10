# Local SDK compile cache for discovery

Candidate: fix/firebase-discovery-cache-20261010, based on integration3a78bcc.
The full actual CLI lifecycle probe reproduced STARTUP_LIMIT at7279ms without
this change. The following cross-spawn ENOENT is secondary to exit1, not proof
of a missing executable. No new IQ deployment was attempted during diagnosis.

The installed CLI strips NODE_COMPILE_CACHE from its SDK child environment.
The existing HTTP warmup uses a Node-version-scoped temporary cache; the final
actual CLI previously did not use it. The first side-effect import now enables
that same cache only when FUNCTIONS_CONTROL_API is exactly true. Normal runtime
imports perform no cache initialization. No endpoint, financial operation,
authorization, deployed environment or SDK package is changed.

This uses the installed Node22.23.2 API. It caches dependencies loaded after the
entrypoint starts, not index compilation already completed or the SDK already
loaded. Node validates cache applicability and reports optimization failures
without throwing; normal module load errors remain fatal. NODE_DISABLE_COMPILE_CACHE
in the child disables this optimization; the CLI does not propagate that variable
from its parent. No claim of a parent-side opt-out is made.
[Node API](https://nodejs.org/download/release/v22.23.2/docs/api/module.html#moduleenablecompilecachecachedir).

Validation:

- Three focused tests PASS: ordinary runtime/opt-out no IO, exact cache path and
  optimization-miss handling, and emitted CommonJS first-require ordering.
- Functions build11684 PASS; frontend unchanged.
- Complete converted actual CLI manifest unchanged: 346 exports and SHA256
  213b001d69e9a4bb53aefea2728064aeee340918c09c7307b2d537c79dcee5c3. Measured2941ms.
- Actual CLI lifecycle hook PASS4151ms with no timeout extension.
- Existing HTTP startup gate: first run warm4781ms/strict8324ms FAIL. Retained as
  failure evidence, not omitted. Host CPU sample afterward was77-86%, with other
  applications contributing; causation of every delay remains unproved. No
  unrelated process was stopped or reprioritized.
- Subsequent coordinated run warm2948ms/strict2361ms PASS. The7s release and10s
  CLI limits remain unchanged, and every real deploy must pass them again.

The improvement addresses the measured child-cache mismatch; it does not promise
elimination of all host scheduling delays. Rollback removes the first import and
its helper, returning to uncached actual CLI discovery; no data migration or
runtime business behavior needs recovery. Local bytecode cache is outside the
repository and is not part of the Functions upload.
