# Functions CLI discovery — 2026-10-10

Status: implemented and locally tested; deployment pending.

Two IQ release attempts from a276e039 failed before upload. The second passed
the existing warmup/HTTP startup gate (2700/2931 ms), then the CLI's final HTTP
discovery exceeded its unchanged 10-second deadline. Both attempts restored
the exact local dotenv hash. No remote release is attributed to either attempt.
The underlying host/timing cause remains unproved.

Firebase CLI 15.3.1 and firebase-functions 7.3.2 already support fresh temporary
manifest output. The launcher selects this transport for Functions deployments
and removes inherited timeout extensions. This is a local CLI flag, not a
deployed Function environment setting. No SDK patch or static functions.yaml
is introduced. Existing startup limits remain unchanged.

The final Functions predeploy check now invokes the installed CLI Delegate with
synthetic demo configuration, using its real child environment and parser.
It rejects a static manifest, requires all 346 endpoints and critical names,
and enforces 7000 ms in addition to the CLI's unchanged 10-second deadline.
No handlers or financial providers are invoked. The existing HTTP gate remains.

Evidence:

- Actual HTTP and temporary-file discovery produced identical complete converted
  manifests (SHA256 213b001d69e9a4bb53aefea2728064aeee340918c09c7307b2d537c79dcee5c3).
- Earlier isolated actual CLI measurements: HTTP 3058 ms; file 4847 ms.
- Initial new gate on this candidate: 6860 ms, 346 endpoints, PASS. Margin is narrow;
  this does not prove elimination of intermittent host delays.
- Nine regression tests passed: launcher scope/environment isolation, manifest
  count/required exports/timing failures, owned hung-process cleanup, interruption rejection, and existing HTTP deadline handling. Final gate after cleanup: 4908 ms, 346 endpoints, PASS.
- Frontend/Functions rebuild not needed for this tooling-only change. Compiled
  Functions used for discovery were the verified a276e039 integration artifacts.

Recovery: revert the launcher transport change and final predeploy addition
together if the installed CLI contract changes. Never increase timeouts or
remove existing gates to force a release. Revalidate remote pins/configuration
before a new IQ release; preserve both failed journals as operational evidence.
