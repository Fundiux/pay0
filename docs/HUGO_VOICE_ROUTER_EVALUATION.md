# Hugo Voice Router evaluation

Status: controlled candidate; not deployed.

## Boundary

Production remains on `gpt-realtime-2.1`. The candidate adds the Realtime function
`delegate_to_hugo_core`, an authenticated backend callable, three explicit routes,
and separate cost fields. PAY0 data access starts only after backend authorization.

The local candidate now includes `services/hugo-voice-gateway`, a long-lived WebSocket
service intended for Cloud Run. The browser sends its Firebase token and WebRTC offer
to this gateway and no longer receives or executes function calls. The gateway checks
the session through `authorizeHugoVoiceGatewaySession`, opens the Realtime call, joins
the server sideband, and becomes the sole owner of `delegate_to_hugo_core`.

For the stated requirement that tool execution must not depend on browser listeners,
sideband is required. Cloud Run is the appropriate PAY0 runtime because the WebSocket
must remain open for the life of the call. The production topology should be:

1. Browser authenticates with Firebase and sends its SDP offer to the Hugo voice gateway.
2. Gateway verifies the Firebase identity, creates the OpenAI WebRTC call, captures the
   returned `call_id`, binds it to `uid`, `rootId` and the Hugo conversation, and returns
   only the SDP answer to the browser.
3. Gateway attaches `wss://api.openai.com/v1/realtime?call_id=...` using the server secret.
4. Sideband owns every `delegate_to_hugo_core` call, executes it once with idempotency,
   authorizes role plus module plus entity scope, and returns `function_call_output`.
5. Browser owns microphone, playback and local UI events. It never executes a PAY0 tool.

The old browser relay has been removed locally. Production remains unchanged until the
gateway image, authorization callable, delegation callable and frontend configuration
are explicitly approved and deployed as one rollbackable release.

## Routes

1. `ECONOMIC_VOICE`: ordinary conversation stays in the voice runtime.
2. `DETERMINISTIC_TOOL`: Hugo Core authorizes and uses bounded PAY0 read tools; delegated model cost is zero.
3. `BRAIN_MODEL`: Hugo Core supplies bounded context and selects the configured stronger model.

Model selection never changes the authenticated root scope.

## Root cause reproduced on 2026-09-24

Production creates a Realtime session without tools and explicitly tells the model it
has no operational access. Commit `746be1e` adds the delegation transport, but its Hugo
Core tool set originally covered only solicitudes, pagos, complementos and IQ. It had no
tool for effective permissions, system catalog, users or client ownership. The connector
and router were also restricted structurally to `superadmin` instead of evaluating the
canonical role plus module policy per capability.

The local Phase 2 candidate now routes these domains through reusable backend tools:

- `getAuthorizedCapabilities` reads effective role and module permissions.
- `getSystemCatalog` returns registered systems filtered by effective access.
- `countClientsForUser` first authorizes `usuarios.view` and `clientes.view`, restricts
  user discovery to the caller root and hierarchy, then counts only clients the target
  user can actually view through direct or active delegated access.

These are capability-level changes. They contain no UID, email, or user-specific answer.

## Cost linkage

`sessionId -> turnId -> responseId -> delegationId -> toolCallId`

The voice session stores audio usage and `voiceCostUsd`. Delegations store provider,
model, token usage, latency, `delegatedModelCostUsd`, `externalToolCostUsd`, and
`transcriptionCostUsd`. Unknown provider prices remain `null` instead of being guessed.

## Controlled comparison

The harness in `evals/hugo/realtime-model-comparison.cjs` fixes the same three scenarios
for `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`. A live run must record naturalness,
Spanish comprehension, interruptions, repetitions, latency, context, names, amounts,
tool selection, delegation, and actual usage cost. It must run in an isolated evaluation
deployment before changing the production model.

## Cancellation contract

Every OpenAI `call_id` is an idempotency key. A duplicate event is ignored. Barge-in
cancels work only while it is still `PENDING`. Work already `RUNNING` is retained and
its real outcome remains auditable; completed or irreversible effects are never reported
as cancelled. This Phase 2 surface exposes read tools only. Any future command tool must
add its own durable idempotency key and terminal status before joining this gateway.

## Deployment dependencies and rollback

The gateway requires `OPENAI_API_KEY`, Application Default Credentials,
`HUGO_AUTHORIZE_URL`, `HUGO_DELEGATE_URL`, and optional pinned model/voice variables.
The frontend requires `NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL`. Deploying the frontend before
the gateway would disable new calls, so the safe order is callables, gateway health check,
then frontend. Rollback restores the previous frontend bundle and scales the gateway to
zero; the existing Realtime session callable remains available during the migration.
