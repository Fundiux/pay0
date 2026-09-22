# HUGO state

Updated: 2026-09-22. Phase: **0 — baseline and evaluation foundation**. Source baseline commit: `332df25`.

## EXISTS TODAY

- UI: `src/app/hugo/page.tsx`, `src/components/HugoFloatingBubble.tsx`, `src/components/HugoComplementInventory.tsx`; callable wrappers: `src/services/agent007.ts`, `src/services/paymentComplements.ts`.
- Server: `functions/src/modules/agent007/{callables,observer,reconciliation,capabilities}.ts`; exports in `functions/src/index.ts`. `functions/src/utils/logActivity.ts` calls the observer, including transaction and batch forms.
- Firestore: `agent007Observations`, `agent007Recommendations`, `agent007LearnedRules`, `agent007Conversations`, `agent007Messages`. Direct context reads: `solicitudes`, `pagos`, `paymentComplementRequests`, `paymentComplementConfigs`, `iqIntegrationConfigs`. Complement automation also owns `paymentComplementJobs`, `paymentComplementQuotas`, `pagoAplicaciones`, `uploads` and experiment collections beginning `hugo`.
- Model: Vertex AI `gemini-2.5-flash` in `agent007/callables.ts`; inline system prompt describes an internal PAY0 assistant. Fallback is deterministic text. Last 10 messages enter the model prompt; 12 are loaded for context. Memory is legacy observations, proposals and rule counters. The conversation reads PAY0 directly; there is no general tool router.
- Automation: `agent007/capabilities.ts` recognizes an explicit complement request and queues PAY0's IQ complement flow. `paymentApplications/complementAutomation.ts` provides trigger execution and a `0 19 * * 1-5` Mexico City scheduler. Telegram and WhatsApp are PAY0 integrations, not Hugo conversation channels.
- Access: `actor()` requires authentication, superadmin and server-derived root. `/hugo` is also guarded in `src/lib/roles.ts`. The production side effects, ID and role boundaries must remain intact.

## Legacy READ side effects

| Entry point | Write path | Classification | Proposed separation |
| --- | --- | --- | --- |
| `sendAgent007Message` → `operationalContext` → `reconcileAgent007Recommendations` | Recommendation `set(..., {merge:true})`: presentation fields; `OC_FISCAL_REVIEW` may become `SUPERSEDED` or `OBSERVATION_ONLY`; payment/bank review may become `RESOLVED_BY_SYSTEM_EVENT` | Legacy reconciliation needed for fresh actionable status, but accidental as a read dependency | Explicit reconcile command or event consumer, followed by pure Query |
| `listAgent007Recommendations` → same reconciler | Same write and timestamp | Same | Same |
| `sendAgent007Message` itself | Creates two messages and updates conversation; explicit conversational persistence | Necessary command behavior, not a pure Query | Keep as command; separately enforce read-only context collection |
| `markAgent007MessagesRead` | Sets `read` and `readAt` on up to 80 messages | Necessary mutation behind a command-like name | Classify as Command |
| `getHugoComplementInventoryPage` → `inventoryPage` → `classify` → `assessLocalIqRecovery` | No write found in this source path; recovery helper states it is a deterministic preview | Read-only by code inspection | Add zero-write emulator guard in Phase 1 |

`reconciliation.ts` performs up to 100 pending recommendation reads per invocation and writes when presentation or terminal status changes. The executable Phase 0 regression test demonstrates a `SUPERSEDED` write for an issued solicitud. This is a known failure against the future Query contract, not a production behavior change. `logActivity.ts` also writes Hugo observations after a PAY0 event; that is an event side effect rather than a read path.

## IMPLEMENTED IN CURRENT PHASE

- Offline, dependency-free eval schema and runner: `evals/hugo/framework.mjs`, `cases.mjs`, `run.mjs`.
- Contract validators and minimal adapter for partial legacy samples: `evals/hugo/contracts.mjs`.
- Synthetic reference dataset: 15 cases across eight domains. No production names, amounts, credentials or responses are copied.
- Deterministic framework and legacy reconciliation tests. The baseline deliberately marks all model judgments `UNEVALUATED` until a captured, approved run is supplied; it records one known READ write failure. This avoids claiming unmeasured accuracy.

Run `node --test evals/hugo/*.test.mjs evals/hugo/*.test.cjs` after building Functions, then `node evals/hugo/run.mjs baseline`. To score recorded observations, use `node evals/hugo/run.mjs evaluate observations.json result.json`; compare two results with `node evals/hugo/run.mjs compare before.json after.json`. Observation input maps case IDs to check IDs and booleans. Keep actual sensitive observations outside Git.

## PROPOSED / pending

Phase 1: characterize every apparent read boundary in emulator, make reconciliation explicit, add source-scoped PAY0 Query/Command adapter and trace envelope behind current callables, and verify no IQ behavior or permission regression. Then expand deterministic tests for root isolation, no write reads and command idempotency; recorded model evals require a safely captured legacy run and human rubric. Physical app separation, Assets, TTT, embeddings and voice remain later phases.

Risk: offline fixtures establish a repeatable scoring contract, but they do not establish live Gemini accuracy, token cost, production data distributions or deployed configuration. No production data was read or changed in Phase 0.
