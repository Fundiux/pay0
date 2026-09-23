# Hugo system evolution

## Runtime boundaries

- Hugo is a fourth system at `/systems` with its own authenticated shell at `/hugo`.
- Access remains limited to `superadmin`; no PAY0 role or authorization policy was expanded.
- `GLOBAL` and `PAY0` conversations use separate IDs. Existing PAY0 conversation history keeps its legacy ID.
- The dashboard reads Firestore summaries and traces. Rendering it never invokes a language model.
- Conversation messages, attention items and technical traces remain separate surfaces.

## Providers and token limits

- Gemini remains the configured default for operator work.
- OpenAI is an optional adapter. It requires both `HUGO_OPENAI_ENABLED=true` and the server-only `OPENAI_API_KEY`; otherwise the dashboard reports `NOT_CONFIGURED` and no request is attempted.
- Programmer requests prefer OpenAI only when it is configured. Operator requests use Gemini.
- A second provider is called only after a normalized availability, timeout or rate-limit failure. A normal response never causes a duplicate call.
- `HUGO_GEMINI_MAX_OUTPUT_TOKENS` can raise Gemini's output budget from the unchanged default of 1200 up to 8192.
- `HUGO_OPENAI_MAX_OUTPUT_TOKENS` defaults to 8000 and is bounded between 1000 and 32000.
- Provider, model, latency, errors and available token usage are persisted in traces and aggregated without another model call.

## Conversation behavior

- The PAY0 bubble no longer polls every 20 seconds.
- It loads when the menu or conversation opens and after an explicit send.
- New content follows the bottom only while the operator is already near the bottom.
- While older messages are being read, a button offers to move to the newest message.
- Pending decisions appear in Hugo's attention dashboard instead of being inserted into chat history.

## Capability boundary

The dashboard exposes the implemented registry: seven PAY0 read capabilities and the existing gated IQ payment-complement request. Assets and TTT are shown as not connected. No financial mutation, REP gate, Firestore rule or production data path was changed.

## Activation checklist

1. Configure a server-side provider secret and explicit enable flag.
2. Freeze model, prompt, output budget, reasoning effort and fallback policy.
3. Run DEVELOPMENT and VALIDATION cases and compare completion, quality, latency and tokens.
4. Review the destination provider's data handling before sending PAY0 context.
5. Use HOLDOUT once only after the acceptance criteria are fixed.
