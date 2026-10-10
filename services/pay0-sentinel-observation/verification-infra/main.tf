terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

# Separate state/root. Does not replan observer or producer runtime resources.
provider "google" {
  project = "pay0-sentinel-observe"
}

variable "enable_verification_roles" {
  type    = bool
  default = false
}

resource "google_project_iam_custom_role" "access_verifier" {
  count       = var.enable_verification_roles ? 1 : 0
  project     = "pay-0-system"
  role_id     = "canaryAccessVerifier"
  title       = "Temporary canary access token verifier"
  stage       = "GA"
  permissions = ["iam.serviceAccounts.getAccessToken"]
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_custom_role" "synthetic_reader" {
  count       = var.enable_verification_roles ? 1 : 0
  project     = "pay0-sentinel-observe"
  role_id     = "sentinelSyntheticReader"
  title       = "Synthetic database read IAM verifier"
  stage       = "GA"
  permissions = ["datastore.entities.get", "datastore.entities.list"]
  lifecycle {
    prevent_destroy = true
  }
}
