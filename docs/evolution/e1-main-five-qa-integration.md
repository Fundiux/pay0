# Reconciliation of five excluded main commits

Status: INCOMPLETE / NOT_INTEGRATED. Four component suites PASS; authenticated harness two startup failures, zero cases. No runtime delivery or main integration certified.

Scope: only commits8952ba4,853115c,b178011,5943d81,86157b6. No production queries or changes. Base is current published D3 UI2eaab272; comparison uses exact Git blob bytes, not ancestry or disk line endings.

| Commit | Capability | Content in published base | Next action |
| --- | --- | --- | --- |
|8952ba4|Modal focus/trap/restore, UiSelect keyboard/accessibility, DateScopeBar accessible picker, Clientes shared confirmation|Four functional files identical to main861|No UI port or rebuild needed|
|853115c|Authenticated emulator UI harness and rules smoke|QA files absent from delivery base|Prepare QA-only integration|
|b178011|Remove Reparar C00 control, keep backend callable; narrow QA expectation and product note|Clientes published blob identical to main, control absent|Preserve current publication; do not restore control silently|
|5943d81|Stage diagnostics and five focused QA aliases|Harness/aliases absent|Optional QA integration, no runtime or dependency changes|
|86157b6|Reports callable stubs for authenticated browser fixtures|QA-only missing|Carry with harness as one coherent QA package|

The root accumulated Clientes source still contains Reparar C00. It is a divergent source, not evidence that production lacks main capability. Replacing the published page with root would reintroduce a deliberately removed financial maintenance control. Underlying repairClientNumbersByAdminCallable remains in backend: authenticated admin/superadmin, policy guard, scoped query and root filter, batch writes client numbering and sequence counter. It is not a read-only UI convenience; its implementation renumbers the scoped sequence. The main commit message establishes deliberate removal, but does not establish a new authorized autonomous replacement. No SOFIA agent activation follows from its documentation note.

Recommendation: keep published absence and existing callable unchanged. If restoring that control is requested later, make it a separate explicit product decision with mutation/sequence review. There is no missing exclusive repair capability to invent in this delivery.

## Local candidate

qa-only-source.patch SHA0b2a1e302e453f8543e7f2d851a78bdc94e23b7f454b1abf988dffa02bd5c39f contains exactly nine QA/documentation files from main861 relative to2ea, no src files. package-script-additions.json contains six script aliases separately; no full package.json replacement, dependency/lock change, or duplicate esbuild restoration. Original main/source refs remain unchanged.

Apply only into a new private child of2ea or its future published successor, using git apply --check from the actual repository root, then apply. Add aliases with structured JSON editing after strict duplicate-key validation. Do not apply removal again or copy root Clientes. Check changed-file allowlist and four functional blob hashes against comparison-proof.json.

Syntax checks passed for the five harness config/setup/spec/rules modules. No browser/emulator test was executed; syntax is not an authenticated runtime PASS. The harness creates synthetic users and financial-looking fixtures ONLY in demo-pay0-ui-qa local Auth/Firestore. Global setup rejects other project IDs and non127.0.0.1 emulator hosts. Read its fixed ports3100/9099/8080 and confirm resources before running. No production credentials or traffic permitted. Existing client/DateScope/UiSelect component tests can run separately against exact candidate sources; no receipt tests or paused-family work required.

This is a prepared QA integration package, not a deployed capability or evidence of main ancestry integration. No merge/rebase/push, source change, endpoint invocation, financial mutation or production access occurred.

## Executed isolated QA

Private child `.firebase/modular-release/main-five-qa-source`, branch `qa/reconcile-main-five-20261021`, base2eaab272. Applied patch from actual clone root with check, then additive six script lines. No source/dependency/lock changes. Existing duplicate esbuild in historical base manifest was preserved, not silently cleaned by JSON rewrite. Four suites executed successfully in Chromium with all network aborted: Modal (focus trap/nesting/busy/body lock), UiSelect (keyboard/mouse/modal isolation/selection), DateScopeBar (open/escape/cancel/range/focus/outside), Clientes (RepararC00 absent at320/390/768/1440). Synthetic fixtures only, no financial service execution. Existing dependency junction used only for QA and removed afterward; no installation or build.

Authenticated reports scenario did NOT run: standard wrapper waited for occupied auxiliary emulator ports4400/4500/9150. Elevated read-only ownership check found listeners29464/14004; neither was stopped. Own pre-emulator wrapper33176 had no children and was stopped deliberately; session92460 exited-1, not PASS. Log retained in output/main-five-commit-reconciliation/authenticated-reports.log. Emulator lock from stopped owner, if present, must be handled by existing runner dead-owner recovery, never manually deleted without validation. Do not launch another run while another emulator owns ports. No credential/production access or fixture seeding happened in this attempt.

Next step: coordinate exclusive emulator slot, attach only local demo environment, rerun unchanged alias qa:ui:authenticated-emulator:datescopebar. No Next production build is needed for this QA-only integration. Full harness is not certified by component PASS. Root Clientes remains unchanged; its repair control is superseded by published/main absence and must not reappear through a future broad file copy.

## Auxiliary-port follow-up (preserved failures)

The port conflict was isolated without app changes: private Firebase config inside the clone used hub24400/logging24500/firestore.websocketPort29150, with required app Auth9099/Firestore8080/Next3100 unchanged. Config resides beside original firestore.rules; no missing-rules fallback or allow-all substitution. Existing wrapper copy changed only three availability-wait ports to the same private values, keeping demo guards/shared mutex. Ops reviewed this seam read-only. External listener processes were left intact.

Run70233 started local demo emulators successfully, then failed Next webServer readiness120000ms before any test/global-setup cases. Existing .next artifacts showed compilation through the deadline; one identical warm-cache rerun81467 was attempted, without timeout/assertion/source edits. It failed the same readiness120000ms/zero cases. Both logs remain in output/main-five-commit-reconciliation/authenticated-reports-private-ports{,-rerun}.log. Each run closed Firestore/Auth/hub/logging normally; JVM lease returned to Intel. Neither is an authenticated browser or rules PASS. No additional attempts are planned without a specific startup diagnosis. No claim that extending a timeout solves the issue.

Private config snapshot SHA29adda3e3c64e3001506fbca5e9b166cf9d652a15da41ee1f6a021ae48362bab and wrapper SHA6fdc8638fa30000de26c4ecb9472acdabd1a4b9ef6a304418e6a1c20e9ad615a are retained in output/main-five-commit-reconciliation/. This is local tooling evidence only; app sources and production helpers unchanged. Four component suites remain independently PASS; financial/backend authorization is not certified by their fakes or network-aborted tests.
