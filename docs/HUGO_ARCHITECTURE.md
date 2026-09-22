# HUGO architecture

Updated: 2026-09-22. **PROPOSED** unless a section says **EXISTS TODAY** or **IMPLEMENTED IN CURRENT PHASE**.

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
