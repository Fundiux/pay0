# Hugo model evaluation

## Current state

The frozen comparison is `hugo-phase9-devval-v1`. It contains 18 synthetic cases across conversation, PAY0 operations, reasoning, programming, tools and security. Twelve cases are DEVELOPMENT and six are VALIDATION. The dataset contains no HOLDOUT records.

No real calls were made while preparing this phase because neither OpenAI nor Google credentials were present in the isolated worktree environment.

## Controlled credential setup

Create a project-scoped OpenAI service credential in the OpenAI platform. Store it in an approved server secret manager or inject it into the evaluation process from the operating system. Do not put it in `.env`, source code, Firestore, browser storage or any `NEXT_PUBLIC_*` variable.

The evaluation process requires these server environment values:

```text
HUGO_OPENAI_ENABLED=true
OPENAI_API_KEY=<injected by the secret manager>
HUGO_OPENAI_MODEL=gpt-6-sol
HUGO_OPENAI_REASONING_EFFORT=low
HUGO_OPENAI_MAX_OUTPUT_TOKENS=25000
HUGO_GEMINI_MAX_OUTPUT_TOKENS=8192
HUGO_EVAL_CONFIRM=DEVELOPMENT_VALIDATION_ONLY
```

Google Application Default Credentials must also be available to the process. The runner refuses real execution unless the OpenAI flag, OpenAI key, Google credential indicator, explicit confirmation, allowed split and closed HOLDOUT checks all pass. Before the first request it scans repository files for the exact active key and rejects execution if it finds it.

Build Functions, inspect readiness without calls, and then run one allowed split:

```powershell
Push-Location functions; npm run build; Pop-Location
node evals/hugo/phase9/run-comparison.cjs
node evals/hugo/phase9/run-comparison.cjs --execute --split=DEVELOPMENT
node evals/hugo/phase9/run-comparison.cjs --execute --split=VALIDATION
```

The command without `--execute` performs no model call. A/B arms have no retries and no fallback so every provider receives one independent request. Normal Hugo traffic retains its single-provider and maximum-one-fallback policy.

## Frozen conditions

Both providers use the same `hugoV2Prompt` builder, controlled evidence, empty history, memory policy and declared capability catalog. GPT-6 Sol uses reasoning effort instead of temperature; this unavoidable difference is recorded in the frozen configuration. Experimental cases have no external side effects and cannot call IQ.

The result records model, input/output/reasoning tokens, total tokens, latency, estimated cost, errors, retries, fallback and response. Costs use frozen public list prices and remain estimates until reconciled with provider billing.

The OpenAI contract is grounded in the official [GPT-6 Sol model page](https://developers.openai.com/api/docs/models/gpt-6-sol), [Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) and [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning). Gemini estimates use the official [Vertex AI pricing page](https://cloud.google.com/vertex-ai/generative-ai/pricing).

## Human review

`/hugo/evaluation` presents Response A and Response B without provider identity. The reviewer records preference and structured reasons. Provider identity appears only after saving the judgment. Reviews remain in the browser until exported; they do not become memory or training data.

Useful-response counts and cost per useful response remain empty until the blind review is complete. No overall winner is computed; analysis stays grouped by capability.

## Architecture

Hugo Core owns identity, conversation, context, memory and learning. The model router receives intent, profile, risk, complexity and required-capability signals. Tool authorization remains in the deterministic Tool Router and connector layer. A stronger model never receives additional permissions.

PAY0 remains the only connected domain. Assets and TTT can later add connectors behind the same Tool Router without duplicating Hugo Core. The provider interface remains generic enough for a future local adapter; no local model was installed.
