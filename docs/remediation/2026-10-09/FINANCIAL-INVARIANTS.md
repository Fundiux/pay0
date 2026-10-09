# Financial invariants: targeted incident resolution

Date: 2026-10-09. Candidate: isolated `.worktrees/private-document-bridge-20261009`, based on integration HEAD `6b8d2f7`. This financial hunk is independent of the private-document bridge and must be staged separately. No production operations, external provider calls, deployment, REP enablement or syncToday changes.

## FI-01: cross-root financial incident resolution (P1, reproduced and fixed locally)

`functions/src/modules/financing/callables.ts`, exported `resolveClientDispersionIncident`, authenticates a superadmin and checks incident/status/amount inside a transaction, but the baseline never compares the persisted dispersion root with the actor root. The integrated funding-owner guard only checks USER withdrawals; CLIENT funding returns without validation. A root-A superadmin supplying the ID of a root-B CLIENT dispersion in REGISTRADA / SOLICITADA / CANCELACION reaches the canonical financial reverser and marks the foreign dispersion CANCELADA. The earlier S07 suites cover external IQ uncertainty and duplicated requests, not this local financial authority boundary.

Minimal correction: require the current dispersion's nonempty rootId to equal the actor rootId inside the same transaction, immediately after reading it and before calling either the funding guard or financial reversal. Empty/missing historical root fails closed; do not infer ownership from the caller. Preserve existing USER cancellation restriction, incident decision validation, audit path and terminal replay guard.

Synthetic executable: `qa/scripts/remediation-financial-incident-root.test.cjs`. It extracts the real callable callback through TypeScript AST, uses real authorization and funding-owner helpers, and substitutes only Firestore, timestamps, audit sink and financial reverser. The fake transaction commits writes only after callback success. No Firebase initialization or real balances; fetch throws. It does not prove actual Firestore transaction retry or ledger arithmetic.

Before: `PAY0_EXPECT_VULNERABLE=1 node qa/scripts/remediation-financial-incident-root.test.cjs` loads immutable git baseline 6b8d2f7. Observed one foreign-root reversal invocation and two committed synthetic writes. External effects zero.

After: default command against working source passes three foreign/missing/blank-root denials with zero reversal calls and zero writes; own-root cancellation calls the reverser once; replay fails terminal precondition and the reversal count stays one; USER funding still denied; RECHAZADA resolves the incident without a monetary reversal. Authorization-policy verifier and focused diff check pass. Global builds and real emulator financial execution were not run for this small hunk; parent owns integration/build gates.

## Audit trace and remaining scope

Sources: architecture audit `05-FINANCIAL-INTEGRITY.md` (wallet/dispersion authority, cancellation/terminal regressions); integral audit `05-FINANCIAL-AND-OPERATIONAL-INTEGRITY.md` (posting/reversal and reservation consistency); `09-TESTS-AND-REGRESSION-GAPS.md` specifically requires commission-wallet-dispersion negatives for reversal, terminal reservation and foreign root. Earlier `FINANCIAL.md` records S07 request/claim/quota/unknown and trigger replay coverage.

| Area inspected | Evidence and decision |
|---|---|
| REP claims/quota/unknown | Existing S07 suites address these; no new provider request or pause change. No claim of complete REP correctness. |
| Commission materialization/preflight | Main source lacks some integration capabilities. Integrated service/userEarnings recheck updateTime transactionally and preserve terminal legs; do not report stale preflight status risk as an unfixed defect. |
| USER commission cancellation | execution.ts deliberately separates reversal and route release, and CANCELLING can replay idempotently. A failure between transactions is a recovery scenario requiring further end-to-end accounting tests, not independently proven double credit. No code change here. |
| Reservation/earning reversal | forwardOnly.ts has projected state for released legs and explicit insufficient-earning rejection. Repeated earning-account accumulation and legacy malformed allocations require a valid canonical-writer fixture before asserting a defect; no speculative fix. |
| Local incident correction | FI-01 confirmed against current integrated callback and fixed with a six-line root boundary. Source principal also lacks this root check, but it was not edited. |

Remaining meaningful suites: payment correction after first posting, application/reservation sums across concurrent transactions, complete USER cancellation with crash/replay between global and per-despacho reversals, and reservation/earning conservation over valid split routes. This report closes only FI-01 locally, not the overall financial audit.
