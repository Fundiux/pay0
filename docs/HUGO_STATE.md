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

## PHASE 1 IMPLEMENTED — 2026-09-22

- New internal `Pay0Connector`: `functions/src/modules/agent007/pay0Connector.ts`. Tools: `getSolicitud`, `searchSolicitudes`, `getPago`, `searchPagos`, `getPaymentComplementStatus`, `getPay0OperationalSummary`. Results carry PAY0 scope, completeness, evidence and an in-memory trace. The summary is available but not yet used by Hugo's conversation.
- Migrated conversation reads: solicitudes, pagos and complement requests in `operationalContext`. Direct reads still present there: Hugo's recommendations and learned rules, plus PAY0's `paymentComplementConfigs` and `iqIntegrationConfigs`. Thus **2 of 5 PAY0 collection families read directly by the old context remain direct (40%)**; counting the original five families `solicitudes`, `pagos`, `paymentComplementRequests`, `paymentComplementConfigs`, `iqIntegrationConfigs`. The separate IQ complement command and recommendation reconciliation also access PAY0 directly, outside that read denominator.
- `listAgent007Recommendations` and `operationalContext` no longer reconcile. `reconcileAgent007RecommendationsNow` is an authenticated command. `/hugo` and `HugoFloatingBubble` call it before loading proposals to preserve their current visible workflow; the bubble's 20-second refresh still initiates maintenance. `sendAgent007Message` retains intentional conversation-message writes, but its context read no longer changes proposal business state.
- Emulator test: `qa/scripts/hugo-phase1-emulator-smoke.cjs` verifies read purity across business collections, scope, provenance, UNKNOWN, PARTIAL, error propagation, repeat reads and explicit reconciliation. The existing conversation smoke now invokes maintenance explicitly. The complement inventory smoke already asserts unchanged collection sizes; Phase 1 smoke also checks its empty-root path.
- Phase 0 baseline files and result remain unchanged: `0 PASS / 1 known FAIL / 14 UNEVALUATED`. The known FAIL is historical behavior at commit `d8d60b2`, corrected in Phase 1. The Phase 1 emulator executes a synthetic subset of seven case assertions (`solicitud-found`, `solicitud-missing`, `pago-found`, `sample-boundary`, `root-isolation`, `action-denied`, `read-reconciles`); observations are stored in `evals/hugo/phase1-emulator-observations.json` and can be scored with `node evals/hugo/run.mjs evaluate evals/hugo/phase1-emulator-observations.json`. This is **Phase 1 evidence**, not a retroactive legacy model score. Other case outcomes remain unmeasured.

### Remaining limitations

The connector wraps existing root-scoped Firestore reads, because the legacy context had no reusable PAY0 query service. PAY0 data ownership and authorization remain server side; no financial command moved. Exact folio duplicates are `UNKNOWN`, and bounded searches cannot prove total counts. The trace is returned in process and may be passed to later telemetry, but is not persisted. Gemini was not called: a comparable model eval needs an isolated credential with approved cost ceiling, fixed synthetic fixtures, pinned prompt/model settings, recorded outputs and human review. Phase 2 should migrate remaining PAY0 configuration reads, make the trace schema versioned, capture a safe legacy model run, and add event-driven reconciliation so UI refreshes need not trigger maintenance.

## PHASE 2 IMPLEMENTED — 2026-09-22

- Conversation response construction moved from `agent007/callables.ts` into `agent007/hugoCore/{conversationCore,contextBuilder,toolRouter,modelContract,legacyPrompt}.ts`. The callable still owns Firebase authentication, Hugo collection reads and message persistence. This is logical separation inside the existing deployment.
- Vertex call moved to `agent007/vertexGeminiAdapter.ts`; model remains Gemini 2.5 Flash. Prompt text is versioned `legacy-v1`; fallback output is identified separately from `MODEL_RESPONSE`.
- `Pay0Connector.getIqCapabilities()` owns reads of `paymentComplementConfigs` and `iqIntegrationConfigs`. The conversation Core now performs **0 direct PAY0 Firestore reads across the original five PAY0 collection families**. Hugo collection reads in the callable remain direct. The IQ complement command in `capabilities.ts`, PAY0 source reads in `reconciliation.ts`, and source-change triggers are outside the conversational READ boundary and remain coupled to PAY0.
- Seven registered READ tools: the six from Phase 1 plus `getIqCapabilities`. Router checks role, input, tool registration, owner and root scope. Connector normalizes PAY0 documents before returning data to the Core. Bounded searches stay `PARTIAL`; an absent or ambiguous exact folio stays `UNKNOWN`.
- `agent007Traces` stores sanitized, versioned traces server-side. Successful conversation traces are batched atomically with messages. Error traces contain minimal metadata. Retention target is 30 days via `expiresAt` and `purgeExpiredHugoTraces` at 03:00 Mexico City; backlog above 500 documents per day may extend retention. Existing Firestore rules deny client access by default. Trace retrieval API is not exposed.
- `reconcileHugoOnSolicitudChange` and `reconcileHugoOnPagoChange` trigger only on relevant status/invoice field changes. `/hugo` and the bubble no longer call maintenance while loading; `reconcileAgent007RecommendationsNow` remains for explicit older-case backfill. Trigger deployment and production behavior were not exercised.
- Phase 0 baseline and Phase 1 observations remain historical. Phase 2 synthetic observations in `evals/hugo/phase2-emulator-observations.json` score 7 PASS, 0 FAIL, 8 UNEVALUATED on the same 15 cases. No live-model or human-review score is claimed. `model-harness.mjs` accepts an explicitly supplied isolated adapter, and `human-review-template.json` keeps subjective ratings separate. A real Gemini eval still needs approved isolated credentials, cost bounds and recorded outputs.

### Phase 2 debt

The callable still knows Hugo Firestore collections and the existing sensitive IQ command. The context builder currently selects PAY0 tools; a second system needs a new retrieval policy, not a Core rewrite. Event-driven reconciliation does not backfill records created after an already-terminal PAY0 event; use the explicit maintenance callable for those. The trace cleanup function must be deployed with the other Phase 2 Functions before retention is active. Voice, Assets, TTT, RAG and full Memory v2 remain out of scope.

### Model evaluation procedure

Run `node evals/hugo/model-harness.mjs ./path/to/isolated-adapter.mjs ./ignored-output.json` only after supplying an adapter that exports `async generate(caseData)`. The adapter must identify its model and prompt version and use only the synthetic `evals/hugo/cases.mjs` fixtures. For a future Gemini run, configure an isolated Google Cloud project/credential with Vertex access, explicit maximum calls and spend, no production Firestore or IQ access, and record raw outputs in an ignored location. Then score deterministic checks separately with `evals/hugo/run.mjs` and use `human-review-template.json` for subjective review. No Gemini call was made in Phase 2; no live model quality score exists.
