# Canonical PDF QRCode discovery cost

Candidate branch `fix/defer-canonical-pdf-qrcode` starts from integrated commit `6e2894975f4c244e215b8fa4683d522de242436c`.

Static search found one eager `qrcode` import in Functions source: `modules/documents/canonicalPdf.ts`. The package eagerly loads QR encoding and PNG, SVG, terminal and UTF-8 renderers. Both production consumers need it only inside async PDF rendering. The candidate retains the package/API and caches the same CommonJS export at first render. No endpoint/options/authentication/authorization logic changes.

Five fresh isolated Node processes measured `require(qrcode)` at 142.928, 139.889, 208.191, 242.348 and 169.658 ms (median 169.658 ms). The instrumented require graph counted 75 uncached module/builtin loads; it is not a count of 75 application files. These measurements include filesystem and instrumentation overhead and do not establish total Functions discovery savings. QR core cumulative cost was 53.8–109.1 ms and PNG renderer cumulative cost 57.2–88.9 ms. They must not be added because module intervals overlap.

The previously observed deletion import cost includes shared Firebase/Admin dependencies loaded first. Moving that module alone would largely move attributed time; no speculative deletion patch is included.

Validation completed after the shared emulator stopped:

- `node qa/scripts/remediation-canonical-pdf-deferred.test.cjs`: 15 checks PASS, including two byte-exact real QR PNG comparisons (220/180 px), no package load at module import, one cached package load shared by both renderers, unchanged exported functions and browser closure on PDF failure. Browser/PDF output is mocked; this does not claim a real Chromium/PDF visual test.
- Isolated baseline/candidate SDK `loadStack` with HTTP/HTTPS/net/fetch blocked: both expose 346 endpoints and the complete canonicalized manifest SHA256 `881e761f5e15e7cfc8a66f50a396b8f53aa93795043e1871f1dcd3b07dc17b68`. This includes endpoint options, required APIs, params and lifecycle hooks.
- The comparison used the same compiled integration index SHA256 `8d2e58a03a7ddc763fd0bcba7aab7b818b36fd27380f03cbab274f2196dc3fcb` and replaced only canonicalPdf with the corresponding TypeScript-transpiled baseline/candidate module in isolated processes. No integration artifact was edited. Baseline load: 5701.68 ms including QRCode 134.06 ms; candidate: 5463.21 ms, QRCode zero loads. The single total-time pair is illustrative, not a statistical guarantee of a 238 ms deployment improvement.

The private profiling scripts live in ignored local artifacts; the render regression is committed. The test accepts process-only `PAY0_QA_DEPENDENCY_ROOT` when running from an isolated checkout without its own dependencies. No install was performed.

No deployment, financial provider, or production data access occurred. Full Functions build and actual CLI discovery remain central integration gates; this task did not run a redundant global build. The 7-second startup and CLI 10-second thresholds remain unchanged.
