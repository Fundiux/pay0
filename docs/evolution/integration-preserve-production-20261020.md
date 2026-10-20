# Integration preserving operational controls — 2026-10-20

Parents: remote main `46b7e263208cbf0b30db0b93b873f691ba57d55d` and
accumulated candidate `fcfde14cf138d0683ce642aba5eb2238de2db10a`.
This is source integration, not certification of the complete checkout for production.

The existing E0 inventory and E1 integration matrix were reused. All 32 conflict
paths retain the accumulated candidate implementation. This is an explicit
preservation decision, not a claim that main equals production:

- Receipt entrypoints, identification, correction and UI retain actor-scoped
  correction versions, transactional content deduplication and human review.
- Recovery retains terminal-source checks, generation identity and retry budgets;
  the older main alternative could recreate completed generations.
- Quotations retain deleted-source rejection, exact root and delegated client
  checks before reading uploads. Provider configuration retains transactional
  independent provider updates and tenant-scoped safety controls.
- Modal retains focus restoration for nested dialogs and busy-close policies.
  Reports retains the provider anchor and operational/engineering controls.
- Modify/delete conflicts retain release tooling, regression tests, provenance
  and rollback controls. Automatic deletion would remove those protections.

The automatic merge also silently reverted or removed non-conflicting safety
code and documentation because main derives from a separately reconstructed
production checkout. Those changes were rejected: every pre-existing candidate
path is preserved byte-for-byte, except CI adds main's explicit authorization
policy check. No business code, dependency versions or rules are changed relative
to the accumulated candidate. Main's 29 added QA infrastructure files are retained.

The authenticated Batch 1 workflow remains pinned to historical source
`21e45105ccfeeb90c3f90f443884c4499547ebbf`. Its success must not be presented as
testing this merge. Docker is unavailable on the reviewed laptop; that container
suite requires a supported runner. The ordinary CI validates this merge's source.

Deployment requires a separate exact-source package against freshly queried
production metadata and preserved rollback artifacts. Never deploy this checkout
wholesale or infer an endpoint's source from this merge commit. Existing production
overlays can contain only selected parts of the candidate. Financial packages
remain gated on domain/emulator validation of their exact final artifacts.

## Local checks on the resolved merge

- Frontend clean dependency install and Next 15.5.27 build: PASS (47 generated pages).
  Used the repository's public CI fixture, with emulators enabled; not deployable configuration.
- Functions clean dependency install, normal build and lint: PASS.
- Offline package suite: 86/86 PASS; receipt identity selection after build: 5/5 PASS.
- Modal Chromium checks: PASS keyboard trap, nested focus, busy close protection,
  body lock, zero external actions.
- Authorization policy, capability registration and technology contract: PASS.
- Imported JavaScript syntax: 13 files PASS. No unresolved index entries.
- Initial broad test invocation included artifact-only and browser-fixture tests
  without their fixtures; those three failures are not claimed as passes. Identity
  was rerun after build and passed. Provider artifact and receipt route remain
  unverified on this merge until their exact artifact/fixture suites are prepared.

Current production metadata independently reconfirmed chat 00025-gok, SSR
00612-yuq, receipt parser 00016-qoc, corrector 00005-qej, recovery queue 00007-dov
and provider configuration 00008-des as ACTIVE. No new production deployment is
needed merely to reconcile Git history. No financial package is approved by this
source merge or by the public-fixture frontend build.
