# Internal Functions bundle: isolated candidate

Status: experimental base 2613559 passes the gates below. No activation, integration, deployment or provider calls. Integration freshness remains pending.

The isolated branch starts at `26135597ce50f23818150a696218d17079e44596`. Integration subsequently added Telegram transport changes in `c92f0b7`; those must be incorporated and retested before any release decision. Earlier private PoC measurements covered two pairs only and do not establish stability.

## Opt-in build contract

`functions/package.json` keeps its normal `main`, build and deployment scripts. The additional command is:

```powershell
npm --prefix functions run build:bundle:candidate -- --output .firebase/internal-bundle-candidates/review-1
```

The explicit output must be a fresh, ignored directory under this worktree. The builder never recursively deletes an output. It compiles the same Functions tsconfig, transforms only compiled internal modules, bundles those modules with esbuild 0.28.2 and keeps all packages external. Node 22, CommonJS, non-minified output and retained names are explicit. No runtime or discovery timeout is changed.

The TypeScript lexical checker distinguishes free CommonJS context identifiers from local bindings. Free `__dirname`/`__filename` preserve each original module's location relative to the artifact's `lib`; shadowed identifiers remain unchanged. Unreviewed dynamic require, require aliases, module metadata, relative require.resolve and dynamic scope construction fail closed. The existing external sql.js WASM resolver is retained. Source maps refer to relative transformed compiled files packaged with the candidate, without absolute local paths or embedded sources.

The asset copier accepts an output library directory. Its no-argument CLI still copies to the normal Functions library and public brand path. Candidate mode copies canonical resources into its own library and does not rewrite public assets. Before release, asset path/hash equivalence and PDF resource behavior must pass.

Dependency scope: the 440 previous lock entries remain unchanged apart from the root devDependency declaration; 27 exact esbuild/platform entries are added from the existing repository lock. The offline package metadata command failed before modification; no installed dependencies were changed. Manifest and lock both pin esbuild exactly to 0.28.2.

## Runtime verification contract

`functions-bundle-harness.cjs` verifies the candidate SHA against provenance and executes the exact bundled bytes. An in-memory suffix exposes the existing esbuild CommonJS factories for QA; it neither changes their bodies nor persists test exports. Internal domain modules are not substituted or loaded from TypeScript in bundle mode.

The dedicated runtime suite covers real bundled authorization, deposit uncertain-result handling through a synthetic external fetch, real canonical asset reads, real QR PNG generation and PDF lifecycle with a synthetic browser. This is not visual browser/PDF validation. The existing 17-case financial concurrency suite accepts `PAY0_QA_BUNDLE_ARTIFACT`; its existing demo project and local port checks remain mandatory, and its default TypeScript path is unchanged. Bundle mode retains internal HTTP/policy code and replaces only the external provider transport.

## Evidence and outstanding gates

- AST context suite: 23 checks PASS, including shadowing, shorthand properties, aliases and unsupported resolution paths.
- Runtime on the exact bundle: 154 checks PASS, including 63 canonical asset bundles, 2 real QR PNG comparisons, synthetic PDF lifecycle, authorization and uncertain IQ result preservation. No browser or real provider starts.
- Lock comparison: 440 unchanged entries, 27 added esbuild entries, exact manifest/lock alignment.
- First scratch compile and diagnostic compile: each stopped at the local 180-second wrapper timeout, without TS errors, stderr or emitted modules. These are failed compilation attempts, not discovery measurements or bundle regressions. Static comparison shows only outDir/sourceMap overrides, the same `include: ["src"]`, and 315 source files totaling 3,472,950 bytes. Cause remains unproven.

Normal `npm run build` then passed in the isolated worktree. A supervised full candidate build compiled in 61,845 ms. The intermediate esbuild sandbox attempt could not resolve its directory; approved local escalation succeeded without dependency installation. A separate optional CIM metrics request expired at automatic review before execution and was discarded. Neither event changed discovery thresholds.

Verified experimental artifact:

- Bundle SHA-256: `a9f32a13b29f2660f676f0ceab05a6b16a4a825382e33550d9c724ba07452636`.
- Source map SHA-256: `592f2e94cc07cc6315ab9e090768f40b2e7ee82f35b9c587d28c46453ce6c3dc`.
- 278 bundled modules; exactly two context adjustments (`cotizaciones/callables.js` and `documents/canonicalBundle.js`).
- All 616 artifact files matched byte for byte between the split diagnostic artifact and the full reproducible builder. The split artifact is explicitly marked provisional; it is not a second complete builder run.
- All 298 asset paths and hashes match the pre-existing integration library produced by the previous copier. All 278 map sources resolve to packaged relative compiled sources, without embedded sources or absolute worktree paths.
- Full delegation lineage suite PASS against existing bundle factories, including permission intersection, grantor lifecycle/ownership/root/expiry, cycles/depth, four transaction retries with zero unauthorized writes, removal and legacy provenance behavior. Additional deferred checks cover 12 lifecycle/scope/permission/restriction changes, a revoked grantor and a restricted superadmin. Internal authorization is not mocked.
- sql.js WASM test PASS: two real initializations, bundled dynamic require.resolve executed, synthetic SQLite table parsed and validated. Storage/Firestore/bzip input are synthetic, and the test intentionally stops before writing the first product. No remote reads or writes.
- Financial emulator suite: 17 PASS lines, exit 0, demo-pay0-financial only, ports 18087/14407/14507; worker races, UNKNOWN/replay safety, REP quota and conserved commission cents run from bundled modules with a fake provider transport. Emulators shut down.
- Real CLI FILE discovery: 2,826.01 ms, 346 endpoints, child closed, unchanged 7,000/10,000 ms guards. Full wire hash `0e3f543bc7e23b7e49b06713cf9666069e8ec1eaec151a01261d7467ce21a875`, full converted CLI build hash `9d9bf27f15d47a695fee37d14959d89f0b57af6692ea49534d838dc426967cdb`, environment hash `f5ecb950f3f67d74f286832de9ee53905fe9a5f8899b0c7845ee5e2dee2333b1`, config hash `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`: all equal the 2613559 baseline. Parser instrumentation delegates unchanged to the installed CLI parser; no static manifest or replacement parser is used.

The ignored artifact node_modules junction is a test-only dependency scaffold added **after** all output/provenance/reproducibility comparisons. It is outside the recorded deployable output set; it must not be shipped. Package install remains the dependency mechanism for a real release.

Pending acceptance: commit the opt-in candidate, incorporate the exact Telegram transport change into this isolated branch, then rebuild and repeat the relevant functional/full-manifest gates against that final source. One cold and one repeat CLI observation provide only small-sample evidence, not a stability percentile. No candidate activation or deployment is authorized by these results alone.