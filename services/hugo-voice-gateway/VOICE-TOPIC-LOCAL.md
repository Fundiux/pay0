# Durable private-topic voice flow

Candidate derives from the published gateway source commit
6f4a27e2d60c4280e7ec9cf5b8db3f8880f9f2e4. Existing provenance links that
source to image1411300a and a 2978-file build manifest; no production write or
new image build is implied by this local candidate.

Five tools are appended to the fifteen existing tools. They take no model
arguments. The gateway derives origins and exact topic labels from the socket's
observed native USER transcripts, preserving CLIENT_TRANSCRIPT_NOT_FACT.

1. SESSION correction: the gateway saves the observed completed HUGO source and
   native USER correction through saveHugoVoiceHistory, waits for its receipt,
   invokes the existing correction branch, then accepts the matching SESSION ACK.
2. User says `Recuerda esta indicación para el tema: <label>`. The request tool
   saves that USER turn and waits before requesting the server challenge linked
   to the committed SESSION correction/version. It returns confirmationText for
   the model to read literally, with durablePersisted:false.
3. A later native USER turn must say that complete confirmationText. The gateway
   saves it and waits before confirming the challenge. Wrapper ok/route and
   delegationId are checked, then the Work-provided pure receipt module checks
   the projected domain result. Only a valid durable ACK produces a success
   message. An isolated yes, forged model label, wrong version/content/topic,
   another challenge or missing history receipt cannot do so.
4. Selection requires `Usa el tema: <label>`; clearing requires
   `Quita el tema activo`. Both persist the exact USER turn and await the
   protected callable response. Normal delegated queries persist current history
   and forward nativeSessionId separately from the RTC call ID. The backend
   reloads the owner/root/gateway-bound explicit selection before retrieval.
5. `Retira la indicación del tema: <label>` retires only the validated memory
   receipt held by this socket through the existing protected D3 reviewer. Older
   memories remain manageable through the existing protected review UI; the
   gateway does not infer IDs from arbitrary model arguments.

Per-socket state is bounded and cleared on disconnect or native-session change.
Abort/current-socket checks occur after awaited effects. Failed/uncertain effects
never produce an optimistic persisted ACK. Server idempotency reconciles a retry;
there is no automated financial, provider or external-message action.

Server wiring adds only fixed protected HTTP clients to the existing
saveHugoVoiceHistory and reviewAgent007MemoryCandidate endpoints. Credentials,
runtime IAM, authentication/canary checks, Realtime model/voice and prior tools
remain unchanged. No transcript is added to gateway logs.

Tests run entirely in the certified AppContainer. Provider and callable traffic
is mocked; the WebSocket test uses only loopback within the same container SID.
Passing tests do not certify real microphone/audio quality, JWT exchange, a
production build/image, or deployed availability. Backend artifact and gateway
image must be released and checked together before claiming end-to-end use.
