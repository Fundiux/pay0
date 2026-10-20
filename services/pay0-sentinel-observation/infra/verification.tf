# Roles alone grant no access. Verification scripts add and remove expiring
# bindings on one service account; never bind these roles at project level.
resource "google_project_iam_custom_role" "runtime_verifier" {
  project     = google_project.observation.project_id
  role_id     = "sentinelRuntimeVerifier"
  title       = "Sentinel runtime verification"
  permissions = ["iam.serviceAccounts.getAccessToken"]
}

resource "google_project_iam_custom_role" "canary_verifier" {
  project     = data.google_project.source.project_id
  role_id     = "canaryRuntimeVerifier"
  title       = "Disabled canary runtime verification"
  permissions = ["iam.serviceAccounts.getAccessToken", "iam.serviceAccounts.getOpenIdToken"]
}
