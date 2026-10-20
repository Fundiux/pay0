# Reviewed pilot proposal; opt-in remains separate from activating the source sink.
variable "enable_observation_budget" {
  type    = bool
  default = false
}

provider "google" {
  alias                 = "observation_budget"
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
  region                = "us-central1"
}

resource "google_project_service" "observation_budget_api" {
  provider           = google.observation_budget
  count              = var.enable_observation_budget ? 1 : 0
  project            = var.project_id
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
  depends_on         = [google_project.observation]
}

resource "google_billing_budget" "observation_pilot" {
  provider        = google.observation_budget
  count           = var.enable_observation_budget ? 1 : 0
  billing_account = var.billing_account
  display_name    = "PAY0 Sentinel isolated pilot MXN 300"
  deletion_policy = "PREVENT"

  budget_filter {
    projects               = ["projects/756518473677"]
    calendar_period        = "MONTH"
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }
  amount {
    specified_amount {
      currency_code = "MXN"
      units         = "300"
    }
  }
  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
  # Omit all_updates_rule: default billing IAM recipients, no custom channel.
  lifecycle {
    precondition {
      condition     = var.project_id == "pay0-sentinel-observe"
      error_message = "This budget is restricted to the reviewed isolated observation project."
    }
  }
  depends_on = [google_project_service.observation_budget_api]
}
