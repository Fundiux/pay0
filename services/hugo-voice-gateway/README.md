# Hugo Voice Gateway

Long-lived Realtime sideband service. The integrated P0/P0.5 candidate still
requires human voice validation before traffic promotion. The existing canary
service keeps its current traffic; see
[`ASTRA-VOICE-IQ-STAGING-20260928.md`](../../docs/audits/ASTRA-VOICE-IQ-STAGING-20260928.md)
for the source and deployment reconciliation.

## Runtime contract

- Node 22 on Cloud Run with WebSocket support.
- `OPENAI_API_KEY` from Secret Manager.
- `HUGO_AUTHORIZE_URL` for the canonical Firebase callable session gate.
- `HUGO_DELEGATE_URL` for Hugo Core delegation.
- `HUGO_BUILD_COMMIT`, `HUGO_BUILD_BRANCH`, and `HUGO_BUILD_VERSION` identify the
  deployed source. Cloud Run sessions fail closed if immutable build metadata
  is missing; never fill these with a different source revision.
- The server-side voice contract is pinned to `gpt-realtime-2.1`, `marin`, and
  speed `1.0`; runtime environment values do not override this contract.
- Browser endpoint: `wss://<service>/voice`.

Build using the service directory as context:

```text
docker build services/hugo-voice-gateway
```

The browser owns media and presentation. This process owns session creation,
sideband tool events, deduplication and calls into the authorized Hugo Core.

## Confirmed interruptions

Realtime VAD detects turn boundaries but does not cancel an active response
automatically. The gateway waits 300 ms after `speech_started`. A matching
`speech_stopped` inside that window is recorded as a rejected interruption and
does not stop playback. Sustained activity is confirmed server-side, then the
gateway sends `response.cancel` and `output_audio_buffer.clear`. The browser
marks history as `INTERRUPTED` only after that confirmation.
