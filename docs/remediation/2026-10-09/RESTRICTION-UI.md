# S01/S02: own restriction status and recovery UI

2026-10-09, principal source only. No deployment, production reads, App Check frontend canary or restriction writer/revoker export. Parent integrates and runs global builds.

RouteAccessGuard no longer reads securityLock or invokes the legacy unlock-code callable. A legacy active lock cannot block this UI, and the UI does not show its incident folio or request a code. Existing legacy security service export and backend canje remain available for old clients; they confer no trusted restriction authority.

If the authenticated profile owns a trustedRestrictionV1 field (including null/malformed), the guard calls getMyRestrictionStatus with an empty payload. It first renders validation, then follows the backend's redacted own-state result. ACTIVE/INVALID restrict; NONE/EXPIRED/REVOKED clear. Inconsistent response shapes, transport failure and a 15-second timeout show fixed recovery text and do not render protected children or trigger route redirects. Superadmin route privileges never bypass this check.

Recovery offers Actualizar estado and Cerrar sesion plus the instruction to contact the organization's administrator through the usual channel. No phone, email, new support endpoint or nonexistent operational process was invented. Sign-out invokes Firebase signOut directly; it does not depend on the financial/audit permission that a restricted user lacks. Error text is fixed and raw errors/tokens/incident fields are not logged or displayed.

The helper refreshes ACTIVE at expiry or at most 60 seconds, and focus/visible/manual refresh requery. Expiry never authorizes locally; if the client clock disagrees, server status still governs and minimum retry delay is one second. Request generations and disposal discard out-of-order results and late responses after timeout. Each render result is tied to account UID plus restriction-marker fingerprint, and the callable checks current Auth UID both before and after awaiting status.

useUserProfile adds profileUid while preserving profile/loading for existing consumers. Snapshot state stores UID and profile together; a mismatched account immediately returns null/loading before effects run. Disposed subscription callbacks cannot write an older account's profile. RouteAccessGuard also requires profileUid===user.uid. This avoids an old unrestricted profile briefly rendering children during an account change.

services/security now sends an explicit allowlist of route diagnostic fields; it does not spread caller input or transmit locationHref/referrer/userAgent. Client reports remain diagnostic OBSERVE_ONLY, not account authority. index.ts adds only getMyRestrictionStatus from the existing restrictionsCallables module; issueTrustedUserRestriction and revokeTrustedUserRestriction remain unexported.

## Evidence

- remediation-restriction-ui.test.cjs PASS: actual pure session helper and callable wrapper with fake clock/promises; legacy absent marker, malformed markers, server response consistency, expiry requery, timeout, stale/disposed responses, diagnostic allowlist and legacy service compatibility.
- remediation-restriction-ui-wiring.test.cjs PASS: actual guard component and profile hook under a minimal fake React hook scheduler; first render gated, superadmin INVALID blocked, legacy-only zero queries, focus refresh, account UID mismatch and old snapshot/result ignored, no redirect while restricted. This is not a browser/React integration test.
- h4-d76-a3.mjs PASS 10/10: historical UI expectations updated from legacy Telegram/code blocking to trusted status and OBSERVE_ONLY; retained backend canje hash/one-use/export compatibility checks. Its first pre-update run also failed on obsolete Telegram-blocking backend expectations already removed by earlier S02.
- Scoped TypeScript program for RouteAccessGuard/security/useUserProfile/trustedRestrictionUi plus imported dependencies and Next declarations PASS. First run exposed DOM/Node timer union; corrected to UiTimer and rerun passed.
- Authorization-policy verifier and focused git diff --check PASS. No global frontend/Functions builds run here; parent owns those gates.

Files: src/components/RouteAccessGuard.tsx; src/services/security.ts; src/lib/useUserProfile.ts; new src/lib/trustedRestrictionUi.ts; functions/src/index.ts (one export); qa/scripts/h4-d76-a3.mjs; two new remediation-restriction-ui tests; this document.

## Rollout limits

Backend status export must be deployed before the matching UI encounters trustedRestrictionV1 profiles; a missing callable fails closed into recovery. This work does not activate any writer, revoke restrictions, invent restriction records or close the remaining Storage/Firestore rollout gates. UI is not server authorization. The existing profile-read recovery exception remains required for restricted users, and browser logout/focus behavior should be exercised in final cross-boundary acceptance.
