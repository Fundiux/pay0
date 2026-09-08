# PAY0 System

PAY0 is a Next.js application with Firebase services and Cloud Functions.

## Local development

1. Create `.env.local` with the required local Firebase and application settings.
2. Install dependencies with `npm ci`.
3. Run `npm run dev`.

Firebase rules and indexes are managed from the repository root. Cloud Functions
are maintained in `functions/`.

## Repository hygiene

Local credentials, generated output, session data, logs, and the historical
working archive are excluded from Git. The archive is intentionally retained
locally at `__untracked_archive/` and is not part of the repository history.
