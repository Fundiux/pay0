# Hugo Voice Router evaluation

Status: controlled candidate; not deployed.

## Boundary

Production remains on `gpt-realtime-2.1`. The candidate adds the Realtime function
`delegate_to_hugo_core`, an authenticated backend callable, three explicit routes,
and separate cost fields. PAY0 data access starts only after backend authorization.

The current candidate uses the WebRTC data channel as a relay for the function call.
The browser receives only the authorized result returned for that turn; it receives
no PAY0 credential, global dataset, permission record, or direct Tool Router access.

This relay is not a persistent OpenAI sideband connection. A true sideband transport
needs a long-lived backend service that joins the Realtime call and owns tool events.
Cloud Functions callables are request scoped, so the sideband service must be evaluated
as a separate Cloud Run service before production deployment.

## Routes

1. `ECONOMIC_VOICE`: ordinary conversation stays in the voice runtime.
2. `DETERMINISTIC_TOOL`: Hugo Core authorizes and uses bounded PAY0 read tools; delegated model cost is zero.
3. `BRAIN_MODEL`: Hugo Core supplies bounded context and selects the configured stronger model.

Model selection never changes the authenticated root scope.

## Cost linkage

`sessionId -> turnId -> responseId -> delegationId`

The voice session stores audio usage and `voiceCostUsd`. Delegations store provider,
model, token usage, latency, `delegatedModelCostUsd`, `externalToolCostUsd`, and
`transcriptionCostUsd`. Unknown provider prices remain `null` instead of being guessed.

## Controlled comparison

The harness in `evals/hugo/realtime-model-comparison.cjs` fixes the same three scenarios
for `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`. A live run must record naturalness,
Spanish comprehension, interruptions, repetitions, latency, context, names, amounts,
tool selection, delegation, and actual usage cost. It must run in an isolated evaluation
deployment before changing the production model.
