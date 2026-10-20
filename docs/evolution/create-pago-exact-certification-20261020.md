# createPago — exact artifact certification

The live base captured on 2026-10-20 is createpago-00062-yok, ZIP
07d05e50d00feba5dbe9eabcc4e8333cf52641752057a8aa0bafb94dd656316f.
The baseline failed stale-correction rejection. Porting only the receipt guards
then failed delegated creation when the grantor was disabled. Neither failed
artifact was deployed.

The release builder overlays the pinned ZIP, not a complete checkout. It ports
main's additive createPago receipt guards, adds transaction-scoped authorization,
and includes the current recursive delegation resolver and policy used by that
boundary. The candidate changes lib/index.js and the delegation resolver, adds
three narrow helper/policy files, and preserves 834 other files byte-for-byte,
including package, lockfile, financial formulas and every other handler body.
Only createPago may be deployed by its release group. No rules, UI, receipt-reader
endpoint, environment, IAM, scaling, timeout or traffic configuration is changed.

The emulator suite loads createPago through the exact artifact's package.main;
receipt fixtures use the independently deployed reader's artifact and its own
Firestore SDK instance. It checks eight-way duplicate contention, cross-actor
file deduplication, legacy missing claims, correction versions, actor/grantor
revocation, transaction-boundary revocation, delegated ownership/folios, six-way
manual contention, invalid amounts, atomic failure after staging payment writes,
sequence preservation, audit uniqueness and absence of reconciliation postings.
The previous source and a separately built safe-recovery artifact are exercised
against the resulting synthetic data. Recovery closes automatic receipt creation
while retaining permission checks and manual capture; restoring only the original
source would restore the known baseline defects. Runtime bytes and archive hashes
are checked before and after the suite. No production business calls are made.

The scoped deploy gate requires hash-bound behavior evidence for the financial
boundaries and a separately certified safe-recovery ZIP and input. Auth/startup
checks alone cannot approve this release. Tests and artifact receipts are private
local evidence; production must be revalidated immediately before source-only
publication. Concurrent change to createPago invalidates the captured baseline.
The reader/corrector and other concurrent releases are not deployment targets.
