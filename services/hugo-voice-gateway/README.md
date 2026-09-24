# Hugo Voice Gateway

Candidate long-lived Realtime sideband service. It is intentionally not deployed.

## Runtime contract

- Node 22 on Cloud Run with WebSocket support.
- `OPENAI_API_KEY` from Secret Manager.
- `HUGO_AUTHORIZE_URL` for the canonical Firebase callable session gate.
- `HUGO_DELEGATE_URL` for Hugo Core delegation.
- Optional `HUGO_REALTIME_MODEL` and `HUGO_REALTIME_VOICE`; defaults remain
  `gpt-realtime-2.1` and `marin` until the controlled comparison is complete.
- Browser endpoint: `wss://<service>/voice`.

Build using the service directory as context:

```text
docker build services/hugo-voice-gateway
```

The browser owns media and presentation. This process owns session creation,
sideband tool events, deduplication and calls into the authorized Hugo Core.
