# Verification roles only

Separate Terraform root/state. Default false creates no roles. No grants, APIs,
SA, database, KMS, Cloud Run or runtime permissions. No credentials in HCL.
No init/plan/apply performed by this implementation. Before provisioning, inspect
whether either exact role already exists and who manages it; do not silently
adopt/delete/modify an existing role. Import exact reviewed roles only if needed.

Roles have prevent_destroy. Switching the flag back to false is NOT a cleanup
procedure. Cleanup removes only temporary bindings, not roles or whole policies.
Do not run this module with observer or producer state/backend configuration.
See docs/remediation/2026-10-09/SENTINEL-PRODUCER-IAM-GATE.md for gates.
