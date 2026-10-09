# Dispersion document finalization replay

Source-only correction, 2026-10-09. Integration and production unchanged.

Actual finalizeDispersionDocumentUploadCore could replace its own READY upload,
increment its version and audit again on replay. It also revived INACTIVE,
REPLACED, DELETED and FAILED records, and ignored an upload root change occurring
during Storage exists(). Initial regression:1/8 PASS,7/8 FAIL.

The finalization transaction now reads its target before querying active versions.
It rejects changed scope/object identity and retired/deleted states; an existing
READY/active upload returns its valid existing version without writes or a second
audit. Only PENDING/active=false proceeds through the existing replacement flow.
The public response remains ok/uploadId/status/active/version. No notification
contract was changed.

Validation:15/15 synthetic tests execute the actual TypeScript service with fake
Firestore/Storage and authorization dependencies. Transactions are serialized in
this harness; this is not proof of SDK conflict retry behavior. Tests cover first
finalization, repeated and simultaneous calls, four retired states, root/object
identity changes during lookup, replacement and malformed READY version. No real
files/messages/providers. Functions build PASS; no frontend/rules changed.

Remaining release gates are material: current actor/parent/delegation revalidation,
USER-funded ownership, actual object metadata/generation validation and targeted
emulator contention. The automatic Telegram notification performs read-then-set
rather than a transactional claim and retries FAILED recipients as a whole;
replay idempotency of the upload does not fix duplicate notification or uncertain
external delivery. Do not expose pending-upload recovery or cut old Storage reads
until these compatibility and authorization prerequisites have been addressed.
Historical version sequences and stored records are not repaired by this change.
