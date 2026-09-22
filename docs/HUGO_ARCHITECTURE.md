# HUGO architecture

Updated: 2026-09-22. Historical proposals are labeled **PROPOSED**; implemented Phase 1–3 sections below take precedence where the architecture evolved.

## Vision and boundaries

HUGO is the future business intelligence layer for PAY0, Assets, TTT and later systems. It should converse, observe, relate evidence, propose, act within explicit authority, and evaluate outcomes. PAY0 owns its financial state and commands. Hugo stores memory, decisions and references, never a substitute master balance, payment or invoice.

**EXISTS TODAY:** Hugo runs in PAY0's Firebase deployment. `/hugo` and a floating chat use `src/services/agent007.ts` and `functions/src/modules/agent007/callables.ts`. `operationalContext` reads Firestore directly. `utils/logActivity.ts` invokes the Hugo observer. The complement command delegates to PAY0's automation and gates. See `docs/HUGO_STATE.md` for the exact baseline.

## Contracts

**IMPLEMENTED IN CURRENT PHASE:** `evals/hugo/contracts.mjs` validates Evidence and ToolResult in an offline adapter. It is not a production API.

**PROPOSED:**

| Contract | Meaning |
| --- | --- |
| EntityReference | `{sourceSystem, entityType, entityId, scope}`; opaque identity in its owning system. |
| Query | Read request with verified actor and scope. Must report no state changes. |
| Command | Mutation request with actor, permission, risk level, idempotency key and approval reference when required. |
| Event | Immutable observation of a committed source-system transition with event ID and version. |
| Evidence | `sourceSystem`, `sourceType`, entity reference, `retrievedAt`, `effectiveAt`, scope, completeness, kind. |
| ToolResult | Tool name, Query/Command, data, evidence, effects and error. |
| ActionResult | Command status, source operation ID, external uncertainty and effects. |
| PolicyDecision | Allow/deny/require human, actor, scope, rule, reason and decision time. |

Completeness is `COMPLETE`, `PARTIAL` or `UNKNOWN`. Evidence kind is `FACT`, `MEMORY`, `INFERENCE`, `USER_STATEMENT`, `RULE` or `UNKNOWN`. PAY0's current recent-row conversation context is `PARTIAL`; it cannot establish whole-system totals. A Query is invalid if it reports effects. The production migration must also enforce that invariant by separating reconciliation from reads.

## Authority and tool architecture

**PROPOSED:** A channel-independent Hugo conversation API calls a context builder, memory retrieval, policy engine and versioned tool router. PAY0, Assets and TTT connectors own their system-specific authorization and data translation. Levels are `READ`, `PROPOSE`, `EXECUTE_REVERSIBLE`, `EXECUTE_SENSITIVE`, `REQUIRE_HUMAN`. Confidence never grants authority. Commands need server-verified identity, root scope and idempotency; external unknown outcomes must not be replayed automatically. Preserve PAY0's current IQ gates and audit records through migration.

## Memory and evaluation

**PROPOSED:** Memory types include fact reference, rule, experience, user statement, preference, hypothesis, decision and outcome. Every item needs source, scope, validity and supersession metadata. Current operational facts must be refreshed from the source. Structured retrieval precedes any semantic search.

**IMPLEMENTED IN CURRENT PHASE:** `evals/hugo` supplies synthetic cases, dimension and severity labels, explicit observed results, comparison, and one executable legacy side-effect regression. Missing observations remain `UNEVALUATED`. Safety failures remain visible separately from explanatory quality. See `docs/HUGO_STATE.md` for baseline limits.

## Trace and channels

**PROPOSED:** A trace contains `traceId`, conversation ID, actor ID and root ID, timestamp, model/model version, prompt version, tools requested/executed, evidence references and completeness, memory IDs, policy decisions, actions and external status, latency, token usage, estimated cost, result and error. Store no private model reasoning or raw secrets. Retention and access rules must be defined before production collection. Web, mobile, voice, Telegram and WhatsApp should call the same conversation core through authenticated channel adapters; none is connected this way today.

## Decisions

1. Baseline and safety evals precede physical separation.
2. PAY0 remains the authority for finance and IQ.
3. Read tools must have zero writes; reconciliation becomes an explicit operation in a later phase.
4. No new Hugo collection, endpoint or provider integration is needed for Phase 0.

## PHASE 1 IMPLEMENTED — 2026-09-22

`functions/src/modules/agent007/pay0Connector.ts` is an internal PAY0 read boundary. It receives server-derived `uid`, `rootId` and `superadmin` role; its six tools return PAY0 evidence, completeness and an in-memory trace with actor, tool, entity IDs, elapsed time and result/error. No trace collection or sensitive payload log was added. Exact folio queries return `UNKNOWN` for zero or multiple matches; bounded searches and complement status are `PARTIAL`. Errors propagate instead of becoming absence. This is a foundation, not a new public API.

Hugo's conversation context now gets solicitudes, pagos and complement status through that connector. Its Hugo-owned proposals and rules, and its direct PAY0 configuration reads, remain transition debt. `listAgent007Recommendations` and the context builder no longer invoke reconciliation. A separate authenticated `reconcileAgent007RecommendationsNow` command preserves the maintenance step for `/hugo` and the bubble before their lists. Message send/read receipt are commands with intended message-state writes. The existing IQ complement command stays on its original PAY0 path.

Phase 1 emulator checks compare business collections before and after connector reads, conversation context, recommendation listing and complement inventory; they verify cross-root isolation, missing evidence, propagated errors and explicit reconciliation. These checks do not establish model quality or provider behavior. The Phase 0 legacy baseline remains unchanged.

## PHASE 2 IMPLEMENTED — 2026-09-22

The Firebase callable now acts as a channel adapter and Hugo data repository for conversations, messages, recommendations and rules. `hugoCore/conversationCore.ts` takes channel, conversation ID, verified identity, message, bounded history and structured recent entity references. `hugoCore/contextBuilder.ts` selects four registered reads, labels context pieces as fact, memory, rule or unknown, and keeps a bounded model context. `hugoCore/toolRouter.ts` validates registered tool names, input shape, result owner and root scope. Its registry has seven PAY0 READ tools, each classified `sideEffect=NONE`; the seventh, `getIqCapabilities`, moves the two remaining direct PAY0 configuration reads behind the connector. The Core does not import Firebase, PAY0 persistence, IQ internals or Vertex. Its dependency constraint has an executable architecture test.

`hugoCore/modelContract.ts` is the model interface. `vertexGeminiAdapter.ts` contains the existing Gemini 2.5 Flash call and retry settings. `hugoCore/legacyPrompt.ts` holds the original prompt text with version `legacy-v1`; this phase does not change its intended meaning. Deterministic fallback remains and is distinguished from model output.

`traceStore.ts` records one sanitized trace with each successful conversation in the same Firestore batch as messages. It records actor/root/channel, prompt/model, requested and executed tools, evidence references, completeness, latencies, token usage when returned, policy and result status. It stores no prompt, message, response, secrets or chain-of-thought. Error traces use minimal metadata. Direct client access to `agent007Traces` is denied by the existing final Firestore rule. A daily maintenance function deletes up to 500 expired traces; the retention target is 30 days, subject to backlog. No pricing estimate is fabricated when cost cannot be calculated reliably.

`reconciliationMaintenance.ts` reacts to relevant solicitud/pago state transitions. It invokes the existing reconciliation service; the UI no longer initiates maintenance on every refresh. The explicit callable remains available for manual backfill of older pending recommendations. No IQ command, financial rule or provider flow moved.

**PROPOSED:** A second system would register tools and supply its own connector while the Core's model and channel interfaces remain. The context builder will need task-specific retrieval policies when new systems arrive. Later phases should extract Hugo data persistence behind an interface, add trace retrieval with scoped authorization, and move Hugo to an independent deployment only after identity and event delivery are designed.

## PHASE 3 IMPLEMENTED — 2026-09-22

`HugoConversationCore` depends on the small `HugoDataStore` contract for bounded conversation state. `FirestoreHugoDataStore` owns the six existing `agent007*` collection names and handles conversation/message batches, observation and recommendation access, learned-rule references, trace writes, queries and retention. Event observers and reconciliation use this adapter too. Hugo Core contains no Firestore SDK or collection name. The adapter deliberately keeps existing paths and document shapes. Transactional recommendation resolution and event observer paths use adapter-provided references so they retain their existing transaction boundaries. The Control Center remains an external projection consumer of two Hugo collections.

Hugo data comprises conversations, messages, observations, recommendations, learned rules and traces. PAY0 business data remains behind `Pay0Connector` READ tools in conversation construction; the existing IQ complement command and reconciliation remain PAY0-coupled integration paths. This split is logical inside one Firebase deployment. Physical separation still needs independent identity and root authorization, command gateway, event delivery and replay, Control Center projection feed, retention and deployment ownership.

The authenticated `listAgent007Traces` and `getAgent007Trace` callables require superadmin and derive `rootId` from the server user record. List queries use a 30-day default, reject windows above 31 days, cap pages at 50 and use a root-scoped cursor. Secondary filters are applied to each bounded scan page; a sparse filtered page can be empty while a next cursor exists. The `/hugo` inspector displays resolved entity references, tool/source/completeness, evidence and memory references, policy metadata and timings. Trace metadata contains no prompts, message text, response text, secret, or chain-of-thought. Provenance is operational evidence, not a model explanation. The exact question is not retained in the trace, so the “why” view is useful but incomplete.

`hugoCore/memoryContract.ts` defines a Phase 4 shape for FACT, RULE, EXPERIENCE, USER_STATEMENT, PREFERENCE, HYPOTHESIS, DECISION and OUTCOME with provenance, confidence, validity, verification, supersession and status. No existing records were migrated. Phase 4 should first fix observed retrieval and calibration failures, then add typed memory only where historical evidence is needed.

## PHASE 4 IMPLEMENTED — 2026-09-22

The web callable selects `hugo-v2`; `legacy-v1` and its prompt function remain available for historical evaluation. `HugoConversationCore` still accepts an injected model and a `HugoDataStore`. `contextBuilderV2.ts` exposes COMPLETE, PARTIAL and UNKNOWN with an explicit scope and meaning for each tool result. `EXACT_FOLIO` completeness does not imply a root-wide count. There is no complete aggregate/count tool today: `getPay0OperationalSummary` is also a bounded PARTIAL sample. A deterministic policy answers root-wide total questions without asking Gemini when no complete aggregate exists. A narrow post-check replaces unsupported exhaustive model claims on partial evidence; it does not attempt general natural-language censorship. Trace policy metadata records replacement. The `hugo-v2` prompt adds concise provenance, completeness, memory precedence and ambiguity instructions while preserving the legacy prompt unchanged.

`conversationState.ts` stores an active verified PAY0 entity, recent entities, pending ambiguity, last intent and turn in the existing conversation document. Exact successful tool reads establish an active entity; an unknown folio does not. An active reference expires after 30 minutes or four further turns, and explicit topic switches clear it. Two plausible entities cause clarification. A two-entity comparison can refer to both, while “el otro” remains ambiguous. State loading rejects a foreign root and verifies conversation owner in the data store. Old conversations without v2 state start empty; raw history remains available to the model but is not trusted as structured entity identity.

`agent007Memory` is the new Hugo-owned Memory v2 collection. Records include kind, root and entity scope, source, entity reference, confidence, effective/verification/expiry times, status, supersession and optional decision/outcome links. New explicit human teaching enters as CANDIDATE; reviewed preferences or user statements may become CONFIRMED. FACT requires complete source evidence; RULE requires a separate explicit promotion path and is not created by model text. Hypotheses stay candidates. Deterministic identity deduplicates equivalent candidates. Supersession preserves the prior document as historical. Existing `agent007LearnedRules` counters continue for compatibility but are excluded from v2's confirmed-rule context. Resolving a recommendation now also creates a scoped CONFIRMED DECISION memory; an observation is linked only when its root and case match. A final OUTCOME is not inferred from the approval itself.

Memory retrieval uses root and exact entity keys, status, validity and scope. At most four confirmed relevant Memory v2 items and two same-entity legacy activity observations enter context; old observations are labeled `UNVERIFIED_LEGACY`. No mass migration occurred. Current verified PAY0 facts take precedence over historical FACT snapshots, human decisions and observations. When structured claims disagree, context records the conflict instead of merging values. User statements can be useful for matters PAY0 does not own but cannot override current PAY0 operational state. The context budget is 10,000 serialized characters (approximately 2,500 tokens); low-trust observations and lower-priority memories are removed before current facts. Trace metadata records considered, selected and included memory IDs, reasons, category counts and approximate tokens without storing full memory content.

The supervised Memory v2 workflow exposes root-scoped diagnostics, candidate creation and candidate review to superadmin. No chat sentence or model speculation writes durable confirmed memory automatically. The `/hugo` diagnostics show record type, source, entity, verification, age, status, supersession and observed use in a bounded recent trace page. A static eval panel shows separate dimensions and the latest controlled run; it is not a production analytics service.

**Retention and physical separation.** Active entity state expires logically after 30 minutes/four turns; legacy conversation messages keep their existing retention. Context is process-local. Traces retain their 30-day cleanup target. Memory records have optional `validUntil`; historical outcomes and superseded records are not automatically deleted in this phase. Independent deployment still needs its own authorization source, event feed, PAY0 command gateway, projection integration and operational retention process. The new Firestore indexes and Functions are not deployed by this change.

Confirmed explicit root preferences can be retrieved across entities; root user statements still require narrower context and are excluded. A supervised callable creates a verified EXPERIENCE only when a same-root activity observation, its linked recorded human decision and a later terminal PAY0 activity event share the case. It does not infer success from recommendation approval. Evidence checks for totals select the requested domain, so an aggregate for solicitudes cannot justify a total for pagos.

## PHASE 5 — HUGO LEARNING CORE

Hugo owns the persistent intelligence layer. Channels call `HugoConversationCore`; it composes PAY0 tool evidence, conversation state, Memory v2, verified learning experiences and Hugo policies. `HugoModelRequest` is the provider-neutral interaction contract. `VertexGeminiAdapter` translates that request to Gemini today; a future adapter may consume the same request. The adapter and its model configuration are components of Hugo, not the owner of memory, policy, learning history or evaluation. PAY0 remains the source of current business truth.

`LearningExperience` stores a structured task, reference-only input/context/evidence, exact root and entity scope, material features, optional model metadata, human decision/correction, verified outcome, expected behavior, lifecycle, quality, eligibility, split, source versions and revision. It stores neither hidden reasoning nor entire conversations/documents. Source references can include multiple systems; Phase 5 only verifies PAY0 and Hugo sources. A draft can begin from an observation and its linked human decision, accept a correction, and wait for a later terminal outcome before becoming VERIFIED. A separate backfill builder accepts a Phase 4 verified EXPERIENCE memory only when observation, human decision and later terminal activity outcome have exact matching root, case and links. Missing relationships fail closed. Corrections use coded behavior/reason fields and create an immutable revision snapshot and ledger event. A correction never becomes a universal RULE automatically.

`HugoLearningStore` is separate from the PAY0 connector and Memory v2 data store. `FirestoreHugoLearningStore` initially persists experiences, immutable revisions and append-oriented `agent007LearningLedger` events under root-scoped queries. The Core sees only the interface. Retrieval matches domain, task and entity type and rejects mismatched structured material features such as issue code, status, bank or instrument. At most two experiences enter a reason request; the trace records considered, selected and included IDs. A later retrieval is also recorded in the ledger when possible. Current PAY0 facts retain precedence. A verified experience may be historical guidance, not proof of a current business state.

Training eligibility is deterministic and inspectable: a clear task, resolved ambiguity, valid scoped evidence, human feedback, verified outcome, expected behavior and VERIFIED state are required. A protected HOLDOUT/GOLDEN case is ineligible. Split assignment is a supervised operation; once protected, a case cannot be reassigned to TRAIN. Original revisions remain available after correction or split changes. A verified record can therefore be useful in context while still being ineligible for training.

`evals/hugo/learning/export.cjs` produces canonical JSONL and a manifest with dataset/schema/policy/sanitizer versions, split counts, exclusions, timestamp and source/content digests. Export is explicit and the Firestore-backed CLI is emulator-only in this phase. The sanitizer exports a strict structured whitelist, pseudonymizes source IDs with a supplied salt and rejects unsafe features. Regex alone is not treated as a complete privacy solution for arbitrary future text. The synthetic Phase 5 fixture demonstrates one TRAIN record and one excluded HOLDOUT. Phase 4 model failures are preserved separately as GOLDEN/HOLDOUT evaluation assets by reference and digest; their historical raw output is unchanged.

The learning ledger distinguishes STORED, RETRIEVED, USED, LEARNED and TRAINED. `LEARNED` requires a controlled later behavior change from a verified experience with current facts held constant; `TRAINED` requires changed model weights, which Phase 5 does not do. A synthetic policy experiment and a FakeModelAdapter full-Core experiment demonstrate an appropriate later change and a material counterexample. They establish architectural portability and a narrow model-free learning effect, not improved Gemini reliability or production performance. Knowledge compilation reports structured RULE_CANDIDATE groups only after repeated verified support, including contradictions; it never promotes a rule automatically.

In-context learning is immediate retrieval and use. Rule/policy learning is future supervised compilation into deterministic behavior. Model learning would be optional future fine-tuning or distillation; no training, local deployment, provider upload, embeddings or vector database is part of Phase 5. A future local adapter must consume `HugoModelRequest`, return `HugoModelResponse`, respect context/action constraints and report available latency/usage. A future model router may classify LOCAL, FAST_EXTERNAL and STRONG_EXTERNAL capability, but must escalate on uncertainty, novelty, conflict or risk rather than optimize cost alone. Model certification would require Hugo's same evidence, memory, dataset and HOLDOUT evaluation before changing defaults. Physical separation must preserve identity/root authorization, Hugo store ownership, event delivery, PAY0 connector/command boundaries and accumulated intelligence.
