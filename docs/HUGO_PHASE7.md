# HUGO LEARNING REPORT — PHASE 7

Date: 2026-09-22. Status: **COMPLETE as a controlled Learning Hardening II evaluation**. Tournament readiness: **NOT_READY**. Phase 4 remains **PARTIAL**. Phase 6 remains complete with its original limitations and artifacts unchanged. No deployment, OpenAI integration, training, fine-tuning, production-data ingestion or dataset upload occurred.

## 1. Executive summary

Phase 7 explains the seven Phase 6 `NO_EFFECT` families: all seven BEFORE responses already contained the expected behavior. Their most supported diagnosis is `EXPERIENCE_ALREADY_KNOWN`; the experience was `INFORMATIVE_ONLY`, and unchanged behavior was appropriate. The new analysis layer classifies all seven as `APPROPRIATE_STABILITY`, pending human review, while preserving the original Phase 6 classification.

The real-model suite grew from 10 to 28 frozen synthetic families across PAYMENTS, SOLICITUDES, IQ, PAYMENT_COMPLEMENTS, DOCUMENTS, MEMORY and CONVERSATION_REFERENCE. The preregistered automatic result was 10 `APPROPRIATE_CHANGE`, 5 `APPROPRIATE_STABILITY`, 0 `INAPPROPRIATE_CHANGE`, 1 `MISSED_BENEFICIAL_CHANGE`, 5 `INCONCLUSIVE` and 7 `PROVIDER_ERROR`. A family is `PROVIDER_ERROR` when any required arm lacks a complete provider response. Eight arms reached `MAX_TOKENS`; Hugo served graceful degradation for all eight.

This is automatic synthetic evidence. Human blind review is **0/28** and remains `AWAITING_HUMAN_REVIEW`. The model tournament gate therefore fails even though its dataset, criteria, HOLDOUT and neutral metrics are ready.

## 2. Architecture changes justified by evidence

Only two runtime changes were made:

1. A human-review callable stores a root-scoped current judgment and an immutable event for every revision. It records reviewer UID, timestamp, reviewed/skipped state, reasons and note. Review feedback remains evaluation data and does not acquire training authorization.
2. Structured-claim validation accepts an explicitly declared context alias such as `solicitudes[0] -> current_s61003`. Unknown aliases remain rejected. This addresses the measured Phase 6 context-ID mismatch without enabling structured output in production.

Provider-neutral evaluation semantics, retry decisions and error normalization live in pure Hugo contracts. Production model settings and routing were not changed.

## 3. Phase 6 no-effect diagnosis

For `document-review`, `invoice-mismatch`, `supplier-ack`, `amount-mismatch`, `bank-rejection`, `duplicate-payment` and `complement-status`, the expected behavior signal was present both BEFORE and AFTER. Retrieval was correct. The experience did not supply a new action that the model lacked. All seven are reanalyzed as:

| Field | Result |
| --- | --- |
| Phase 6 historical result | `NO_EFFECT` preserved |
| Phase 7 semantics | `APPROPRIATE_STABILITY` |
| Actionability | `INFORMATIVE_ONLY` |
| Most supported reason | `EXPERIENCE_ALREADY_KNOWN` |
| Human status | `AWAITING_HUMAN_REVIEW` |

The detailed artifact records BEFORE/AFTER context, raw output, served output, added experience and actual signal for every family. This corrects the interpretation, not the historical files.

## 4. Appropriate-effect method

Scoring was frozen before the Phase 7 calls:

- `APPROPRIATE_CHANGE`: BEFORE lacks a required useful behavior; AFTER adds it; the material counterexample does not copy it.
- `APPROPRIATE_STABILITY`: BEFORE and AFTER remain acceptable when history should not change the answer.
- `INAPPROPRIATE_CHANGE`: experience harms an acceptable answer or leaks into a material counterexample.
- `MISSED_BENEFICIAL_CHANGE`: an actionable experience was included but the required improvement did not appear.
- `INCONCLUSIVE`: the preregistered automatic rule cannot support a decision.
- `PROVIDER_ERROR`: a required arm failed independently of retrieval or Hugo policy.

These regex-based automatic criteria do not replace semantic human judgment.

## 5. Expanded suite and domain evidence

| Domain | Cases | Appropriate change | Appropriate stability | Missed | Inconclusive | Provider error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PAYMENTS | 7 | 5 | 1 | 0 | 1 | 0 |
| SOLICITUDES | 6 | 1 | 1 | 0 | 2 | 2 |
| IQ | 4 | 2 | 0 | 0 | 0 | 2 |
| PAYMENT_COMPLEMENTS | 3 | 2 | 1 | 0 | 0 | 0 |
| MEMORY | 3 | 0 | 2 | 0 | 0 | 1 |
| CONVERSATION_REFERENCE | 2 | 0 | 0 | 1 | 0 | 1 |
| DOCUMENTS | 3 | 0 | 0 | 0 | 2 | 1 |

Actual useful-change evidence exists in PAYMENTS, SOLICITUDES, IQ and PAYMENT_COMPLEMENTS under the automatic criteria. MEMORY demonstrates stability rather than beneficial change. DOCUMENTS and CONVERSATION_REFERENCE remain insufficient. Seven HOLDOUT cases received three runs each: 2 were stable appropriate, 3 unstable, 1 stable wrong and 1 had a provider error. One completion is therefore not treated as robust behavior.

The single automatic `MISSED_BENEFICIAL_CHANGE` is `p7-reference-ambiguous`. Its generic runner question included an explicit folio even though its frozen expected behavior was `ASK_WHICH_ENTITY`. The automatic score is preserved, but its causal diagnosis is `TASK_DESIGN_CONFLICT`; it is not evidence that Gemini ignored a valid clarification experience. Correcting the case requires a new dataset version rather than editing the frozen artifact.

## 6. Retrieval, behavior and adversarial evidence

All 24 families that expected a relevant experience retrieved and included one. Explicit experience-ID citation was 0; models generally used prose rather than internal IDs. Ten families showed the preregistered appropriate behavioral change. Retrieval is therefore measured separately from behavioral use.

Adversarial fixtures covered foreign root, similar but materially different facts, conflicting experiences, current facts overriding history, duplicate experience and supersession. No `INAPPROPRIATE_CHANGE` was detected. Conflict withheld selection and produced review behavior; wrong scope selected nothing; duplicates were bounded; the superseded record did not replace the active revision. The result is limited by automatic scoring and zero human review.

## 7. Representation ablation and compression

Four Phase 6 no-effect families ran with NONE, COMPACT, FULL, EXPLICIT_RELEVANCE and POSITION_FIRST. Every NONE response already contained the expected behavior. Compact and full both produced it in 4/4 cases. Explicit relevance and alternative placement produced it in 3/4.

Compact versus full was behaviorally equivalent on these four cases. Compact averaged 729.5 input tokens versus 874.5 for full, a **16.6% reduction**, and 998 versus 1,594 context characters, a **37.4% reduction**. This supports compact representation for efficiency, but does not prove a quality advantage on cases where the experience adds new knowledge.

## 8. Token and provider findings

Across the main and repeated full-flow arms, completed generative calls had medians of 723 input tokens, 83 visible output tokens, 431 reasoning tokens and 3,480 ms total flow latency. Eight arms reached `MAX_TOKENS`. All were withheld from the user and counted separately from reasoning quality.

An 18-call controlled matrix varied thinking budget, output limit, context size and compact/full representation. All 18 stopped normally and retained the required behavior. A 256-token thinking budget reduced median reasoning tokens to 239 in the selected case. A 6,389-character noisy context also completed 3/3 with a 512 thinking budget. These are promising isolated results; production remains unchanged because the broader unchanged full flow still failed intermittently. Final classification: **UNDERSTOOD_NOT_MITIGATED**.

The eval harness retries only canonical `RATE_LIMIT`, `TIMEOUT` and `SERVICE_UNAVAILABLE`, at most twice with 1s and 2s backoff. Latency includes retries. `MAX_TOKENS` is not retried by that provider-error policy because the production adapter already performs its bounded compact retry. There were no Phase 7 HTTP 429 responses; the policy and its bounds are regression tested.

## 9. Structured output and claim validation

The Phase 6 response used `solicitudes[0]`, a real context position that the schema allowed but the validator did not map to canonical evidence. The cause was `CONTEXT_ID_MISMATCH` plus an unconstrained evidence string, not a fabricated source. With an explicit declared alias the stored candidate validates; `solicitudes[99]` still fails.

This improves mechanical attribution only. Structured output has not shown better claim correctness, and explicit experience citation remained absent in the real suite. Production structured output stays disabled. Attribution readiness for a provider tournament is **PARTIAL**.

## 10. Full-flow safety

The automatic signal matrix records 18 model-right/system-right, 3 model-wrong/system-safe and 4 model-wrong/system-wrong families. Eight provider failures produced graceful degradation. These counts use preregistered lexical acceptance signals and are not human correctness labels.

The two deterministic fixture tasks bypassed generation. Current facts and scope remained dominant. No new deterministic rule was promoted: repeated learning results and human review are not strong enough to justify additional compilation beyond the Phase 6 experiment.

## 11. Task classes and external dependency

This controlled workload contains:

| Class | Cases | Percent |
| --- | ---: | ---: |
| MODEL_NOT_REQUIRED | 2 | 7.1% |
| GENERATION_ONLY | 3 | 10.7% |
| STRUCTURED_REASONING | 20 | 71.4% |
| OPEN_REASONING | 1 | 3.6% |
| HUMAN_REQUIRED | 2 | 7.1% |

The percentages describe the selected eval workload, not production traffic. Exact status/amount and proven deterministic policies belong in model-free execution. Routine wording and summaries are candidates for a renderer or future small model. Cross-evidence reconciliation remains open reasoning. Release decisions, conflict resolution and rule approval remain human tasks.

## 12. Human review

`/hugo` now presents one blind workflow for the 18 Phase 4 and 10 Phase 6 comparisons, including task, evidence, A/B responses and acceptance criteria. It distinguishes reviewed, skipped and incomplete. A later change creates `REVIEW_REVISED` while preserving the prior event. The Firestore emulator confirmed persistence, reviewer identity, revisions and cross-root isolation.

No person submitted a judgment during this phase. Human preference, acceptance rate, both-bad rate and correction rate remain **NOT_MEASURED**. Phase 4 therefore remains **PARTIAL**.

## 13. Dataset, governance and privacy

The frozen tournament candidate contains 28 cases: 13 DEVELOPMENT, 8 VALIDATION and 7 HOLDOUT. Its SHA-256 digest is recorded in the manifest. Every case stores expected and forbidden behavior, criticality, evidence boundaries, automatic rules and human dimensions. Tests reject digest or HOLDOUT changes. Any semantic change requires a new version.

Provider-neutral metrics are task success, critical failure, hallucination, unknown handling, clarification, experience use, negative transfer, human preference, human correction, input/output/reasoning tokens when exposed, latency, provider errors and cost when reliably known. Retry, stochastic-run and reasoning-intent policies are frozen. Cost is not estimated without an execution-time price source.

The privacy demonstration pseudonymizes root/entity IDs, removes names, email, tax/account identifiers, documents, URLs, free text and raw amounts, and buckets financial data. It passes on a rich synthetic fixture. Operational export remains **NOT_READY** because managed salt, retention, operational sampling and privacy approval are absent.

## 14. Tournament readiness and Phase 8

Readiness is **NOT_READY**. Dataset freeze, HOLDOUT, preregistration, workflow, provider-neutral metrics and adapter independence pass. Meaningful human review fails at 0/28. Token reliability fails because `MAX_TOKENS` remains intermittent in the unchanged full flow. Full-flow stability is `REVIEW`.

Phase 8 should be **Human Review and Token Reliability Gate**:

1. complete a meaningful blind sample across both historical phases;
2. publish acceptance, preference, both-bad and correction rates with revision history;
3. run the bounded-thinking candidate over all DEVELOPMENT and VALIDATION cases without touching HOLDOUT;
4. require no regression in appropriate effect, safety or human preference;
5. rerun the frozen HOLDOUT once under a newly versioned configuration only after the decision rule is locked;
6. approve a provider tournament only if human and token gates pass.

Do not add another provider in Phase 8 unless those gates are met.

## 15. Plain-language conclusions

**Would testing GPT against Gemini now tell us something useful?** Not enough to justify the cost or select a model. The benchmark mechanics are much better, but no human has judged the existing pairs and intermittent token exhaustion would make provider comparison unfair.

**Is Hugo failing to learn because it cannot remember, cannot retrieve, or the model does not use what Hugo knows?** Memory and retrieval worked: 24/24 expected relevant cases were included. Seven old no-effect cases did not need a changed answer. In the expanded suite, ten cases changed appropriately, one missed a beneficial change, and token failures prevented conclusions in others. The remaining bottleneck is a mix of model use, stochastic stability and token reliability, not memory loss.

**If Gemini changed today, what problem would we try to solve?** The measured targets are more consistent use of actionable experience, fewer token-limit failures, stronger reasoning on clarification and documents, and better human preference. Latency and cost should be measured later, but neither is a substitute for correctness and safety.
