# Signed observation receiver: prepared, not activated

Local wiring only. Producer port remains DISABLED. No IAM, trust key provision,
deployment, sink activation, provider request or real event is part of this change.

The optional public `SIGNED_TRUST_MANIFEST_JSON` defaults to the empty
PAY0-SIGNED-TRUST@1 manifest. Its raw JSON is bounded to 16KiB and parsed with the
existing duplicate-key/depth/node rejecting parser. Startup constructs the real
RSA-PSS verifier before metadata credentials or Firestore. Empty trust accepts no
signed producer. Malformed keys fail startup; the config parser alone is not a
cryptographic key validator. No environment flag enables the producer writer.

The authenticated Pub/Sub path retains its current envelope/LogEntry bounds and
OIDC checks. A PAY0-SECURITY-SIGNED@1 payload goes exclusively through the real
verifier; missing/invalid signature or unknown key never falls back to canary.
Signed LogEntry uses the fixed dedicated logName, exact cloud_run_revision labels,
configuration_name equal to service_name, and outer insertId/timestamp equal to
the verified UUID/occurrence time. Root/actor, event type/origin and all event data
come from the verified tuple, never an alternate event object or delivery fields.

Unsigned listusers service names (case-insensitive) are rejected even if someone
widens a legacy origin list. The same applies to all services in the signed trust
manifest. Startup config rejects service or publisher overlap between the signed
and legacy lanes. The existing allowlisted canary envelope remains compatible;
its labels are still not cryptographic proof of producer identity. Signing another
service must never be implemented by adding it to that legacy list.

Invalid signed envelopes receive permanent HTTP204 before detector invocation;
only the existing aggregate INVALID_ENVELOPE metric is emitted. Storage failures
and circuit-open remain HTTP503; permanent receipt-content conflicts remain ACKed
by the unchanged detector/HTTP result mapping. No payload, key signature, root,
actor or document identifier is added to responses or metrics.

Replay semantics remain ab30e32: one root/publisher/actor/event identity across
three origin slots, identical semantic contents duplicate without writes, altered
contents conflict without rewriting evidence. Delivery message IDs, signature
bytes and transport timestamps are not replay identity. Changing root/actor or
publisher creates another namespace; no global UUID uniqueness is claimed.

Activation still requires the separate dedicated producer SA/key IAM review,
exact runtime/revision and root/actor cohort, finite rollout window, bounded
instances/budgets, preserved authorization behavior, and explicit coordinated
release. A signature proves key possession and assertions, not autonomous proof
of the actual runtime revision. Detector receives only public keys; no sign
permission or financial authority is added.

Prepared suite: `qa/scripts/remediation-sentinel-signed-receiver.test.mjs` uses an
ephemeral synthetic RSA3072 key, the real verifier and detector, memory-only
persistence and loopback HTTP. Covers downgrade, default empty trust, resource and
context mismatch, signed cohort/expiry rejection, duplicate JSON config keys,
unchanged canary, immutable replay/conflict and permanent ACK versus store retry.
It requires the existing reviewed `.build/core` artifact. After the coordinator
released the CPU window: new receiver suite 9/9 PASS; existing service suite
13/13 PASS; existing signed contract/verifier suite 83 checks PASS. The latter
also verifies source hashes against the reviewed core manifest. No build,
emulator, external network, IAM or deployment was exercised by this change.
