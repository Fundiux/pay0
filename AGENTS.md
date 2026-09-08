# AGENTS.md — PAY0 system guide

## Purpose and architecture

PAY0 is a Spanish-language financial operations application. It is a Next.js
14 App Router frontend backed directly by Firebase Authentication, Firestore,
Storage, and Firebase Cloud Functions v2. There is no separate REST server.

- Frontend: `src/app/` routes, `src/components/` UI, `src/services/` Firebase
  callable clients/data access, and `src/lib/` shared client-side utilities.
- Backend: `functions/src/index.ts` exports callables and triggers; domain logic
  is organised under `functions/src/modules/<domain>/`.
- Firebase: `firebase.json`, `firestore.rules`, `firestore.indexes.json`, and
  `storage.rules`; deployment target is `pay-0-system` in `us-central1`.
- Main domains include users/access, clients, companies/despachos, solicitudes,
  pagos/payment applications, wallet/financing/dispersiones, documents,
  materiality, IQ integration, Telegram, and WhatsApp delivery.

Use the `@/*` alias for frontend imports. The frontend is intentionally client
heavy: pages call typed wrappers in `src/services/`, which invoke callable
Functions through `src/lib/firebaseClient.ts`.

## Startup and verification

Use Node 22 for the Functions package; the frontend currently builds with the
repository lockfile and Next.js 14.

```powershell
npm ci
npm run build
Push-Location functions; npm ci; npm run build; Pop-Location
```

For local Firebase work, populate the ignored `.env.local` with the
`NEXT_PUBLIC_FIREBASE_*` values and set `NEXT_PUBLIC_USE_EMULATORS=true` when
using emulators. The emulator host defaults to `127.0.0.1` and ports are
declared in `firebase.json`.

Useful focused checks:

```powershell
node scripts/verify-authorization-policy.mjs
npx playwright test --config playwright.mat.config.ts
npx playwright test --config playwright.config.mjs
```

`playwright.config.mjs` is headed and optionally uses Opera GX; configure
`PAY0_QA_BROWSER_PATH` if needed. It starts `npm run dev` automatically.

Do not treat `npm run qa:pay0` as a reliable gate yet. Its materiality check
still reads `pay0-archivo-tecnico/MATERIALIDAD-CANON.md`, which was deliberately
archived outside Git during repository cleanup. It also writes audit output.
Repair that test's fixture/source contract before enabling it as CI.

## Security and data rules

This is a financial system. Prefer small, auditable changes and preserve
idempotency, sequence/folio invariants, transaction boundaries, audit events,
and terminal-status protections.

- Client route guards and hidden UI are not authorization. Every sensitive
  callable must authenticate and use `assertAuthorized`/the relevant domain
  authorization helper before reading or mutating data.
- Enforce ownership/root scoping (`rootId`), user role, client delegation, and
  despacho/company access on the server. Do not trust IDs or role data supplied
  by the browser.
- Keep Firestore and Storage rules restrictive. A rule change requires a
  matching backend/frontend authorization review and targeted emulator or rules
  testing; deploy rules only with explicit approval.
- `config/authorization-policy.json` is the canonical role-policy input.
  `src/lib/roles.ts`,
  `functions/src/modules/users/authorizationPolicy.generated.ts`, and the
  generated block in `firestore.rules` must remain consistent. Do not hand-edit
  the generated backend file; update the policy and run
  `node scripts/verify-authorization-policy.mjs`.
- Keep credentials, service accounts, private keys, `.env*`, session data, and
  production responses out of Git and logs. Never put secrets in
  `NEXT_PUBLIC_*` except Firebase's intended public web configuration.

## Change conventions

- Add or change a frontend callable by updating the Function export in
  `functions/src/index.ts` (or its re-export), the appropriate backend module,
  and the matching wrapper in `src/services/`. Keep request/result types near
  the service boundary where practical.
- Put new business rules in the relevant backend domain module, not in a page
  component or as an unguarded direct Firestore mutation.
- For financial mutations (pagos, solicitudes, advances, dispersions), inspect
  existing domain/service/transaction code before editing. Preserve canonical
  statuses, financial postings, audit-log writes, and retry-safe behavior.
- For document uploads, use the existing init/upload/finalize callable flows;
  do not bypass their authorization or metadata validation with direct Storage
  writes.
- Keep route additions synchronized with `src/lib/roles.ts` and
  `RouteAccessGuard`. Unknown authenticated routes intentionally fail closed.
- Maintain Spanish user-visible copy and the existing dark Tailwind styling.
  Avoid broad formatting rewrites in large operational pages.

## Repository hygiene and deployment

- `__untracked_archive/` contains preserved operational history and is ignored.
  Do not restore or commit it incidentally.
- `.next/`, `node_modules/`, Functions `lib/`, Firebase state, logs, browser
  sessions, backups, and generated reports are local artifacts. Do not commit
  new versions. Existing checked-in historical QA report artifacts should be
  cleaned up in a dedicated change, not propagated.
- Keep `package-lock.json` and `functions/package-lock.json` aligned with their
  respective package manifests when dependencies change.
- `npm run firebase:deploy` deploys Firestore rules and indexes. Deploying
  Functions is performed from `functions/` with `npm run deploy`. Both target
  production, so never deploy, alter production data, or run a live IQ/WhatsApp
  action without explicit user approval.

## Git workflow

- Commit each completed, coherent change with an expressive imperative message
  that says what changed, for example: `Add server-side client delegation
  validation`. Do not bundle unrelated cleanup, generated output, or local
  artifacts into the same commit.
- Keep `main` as the stable integration branch. For a feature, bug fix, or other
  line of work that is larger than a small self-contained change, create and
  work on a descriptive branch from current `main`, such as
  `feature/client-import` or `fix/payment-reconciliation`.
- At the start of work, inspect the current branch and working tree. If the
  requested work is a different line from the active branch, first consider
  whether that branch should be committed and merged into `main` (or otherwise
  finished) so work does not accumulate on unrelated branches. Explain the
  recommendation in plain language.
- Never merge, rebase, delete a branch, force-push, or push a branch to the
  remote without the user's explicit approval. If a merge conflict occurs,
  preserve both sides and ask for direction when the intended resolution is not
  clear.
- Before a commit, inspect `git status` and `git diff`; after it, report the
  branch, commit hash, and checks run. Keep the working tree clean unless the
  user intentionally has work in progress.

## Before handing off a change

1. Run the narrowest relevant checks, plus both frontend and Functions builds
   for cross-boundary changes.
2. Run the authorization-policy verifier for any role, route, rule, or user
   access change.
3. State which checks passed, which were not run, and any production dependency
   (Firebase, IQ, Telegram, WhatsApp) that was intentionally not exercised.
4. Review `git diff` for generated files, credentials, and unrelated history
   before committing.
