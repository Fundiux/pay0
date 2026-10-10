terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.0" }
  }
}

# Separate state/root. No provider credentials or impersonation are configured.
provider "google" {
  project = local.source_project
  region  = local.region
}

resource "google_project_service" "kms" {
  count              = local.provision_count
  project            = local.observation_project
  service            = "cloudkms.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "producer" {
  count        = local.provision_count
  project      = local.source_project
  account_id   = local.producer_account_id
  display_name = "PAY0 listUsers signed observation producer"
  disabled     = var.service_account_disabled
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_custom_role" "reader" {
  count       = local.provision_count
  project     = local.source_project
  role_id     = "pay0ListUsersReadOnly"
  title       = "PAY0 listUsers database reader"
  permissions = local.read_permissions
  stage       = "GA"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_member" "reader" {
  count   = local.reader_count
  project = local.source_project
  role    = google_project_iam_custom_role.reader[0].name
  member  = "serviceAccount:${google_service_account.producer[0].email}"
  condition {
    title      = "OnlyPay0DefaultDatabase"
    expression = "resource.name == '${local.database_resource}'"
  }
}

resource "google_project_iam_custom_role" "logger" {
  count       = local.provision_count
  project     = local.source_project
  role_id     = "pay0ListUsersObservationLogger"
  title       = "PAY0 listUsers observation log creator"
  permissions = local.log_permissions
  stage       = "GA"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_member" "logger" {
  count   = local.logger_count
  project = local.source_project
  role    = google_project_iam_custom_role.logger[0].name
  member  = "serviceAccount:${google_service_account.producer[0].email}"
}

resource "google_kms_key_ring" "producer" {
  count      = local.provision_count
  project    = local.observation_project
  name       = "listusers-observation"
  location   = local.region
  depends_on = [google_project_service.kms]
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "producer" {
  count                         = local.provision_count
  name                          = "listusers-observation-signing"
  key_ring                      = google_kms_key_ring.producer[0].id
  purpose                       = "ASYMMETRIC_SIGN"
  skip_initial_version_creation = true
  version_template {
    algorithm        = "RSA_SIGN_PSS_3072_SHA256"
    protection_level = "SOFTWARE"
  }
  lifecycle {
    prevent_destroy = true
  }
}

# Requested final state only; no claim about internal server transitions.
resource "google_kms_crypto_key_version" "producer" {
  count      = local.provision_count
  crypto_key = google_kms_crypto_key.producer[0].id
  state      = "DISABLED"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_custom_role" "signer" {
  count       = local.provision_count
  project     = local.observation_project
  role_id     = "pay0ListUsersObservationSigner"
  title       = "PAY0 listUsers exact key signer"
  permissions = local.sign_permissions
  stage       = "GA"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "signer" {
  count         = local.signer_count
  crypto_key_id = google_kms_crypto_key.producer[0].id
  role          = google_project_iam_custom_role.signer[0].name
  member        = "serviceAccount:${google_service_account.producer[0].email}"
}
