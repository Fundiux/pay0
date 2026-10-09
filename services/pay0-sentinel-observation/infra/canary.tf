variable "canary_image_digest" {
  type    = string
  default = null
  validation {
    condition     = var.canary_image_digest == null || can(regex("^us-central1-docker[.]pkg[.]dev/pay0-sentinel-observe/sentinel-images/canary@sha256:[a-f0-9]{64}$", var.canary_image_digest))
    error_message = "Provide the reviewed immutable canary image in the isolated repository."
  }
}
variable "canary_mode" {
  type    = string
  default = "DISABLED"
  validation {
    condition     = contains(["DISABLED", "CANARY_DRY_RUN", "CANARY"], var.canary_mode)
    error_message = "Only the fixed synthetic canary modes are allowed."
  }
}
data "google_project" "source" { project_id = "pay-0-system" }
resource "google_service_account" "canary" {
  project      = data.google_project.source.project_id
  account_id   = "pay0-observation-canary"
  display_name = "PAY0 synthetic observation publisher only"
}
resource "google_project_iam_custom_role" "canary_writer" {
  project     = data.google_project.source.project_id
  role_id     = "pay0ObservationCanaryWriter"
  title       = "Fixed observation canary log writer"
  permissions = ["logging.logEntries.create"]
}
resource "google_project_iam_member" "canary_writer" {
  project = data.google_project.source.project_id
  role    = google_project_iam_custom_role.canary_writer.name
  member  = "serviceAccount:${google_service_account.canary.email}"
}
resource "google_artifact_registry_repository_iam_member" "canary_image_reader" {
  project    = google_project.observation.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.source.number}@serverless-robot-prod.iam.gserviceaccount.com"
}
resource "google_cloud_run_v2_service" "canary" {
  project              = data.google_project.source.project_id
  location             = "us-central1"
  name                 = "pay0-security-canary"
  deletion_protection  = true
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  scaling {
    max_instance_count = 1
  }
  lifecycle {
    precondition {
      condition     = var.canary_image_digest != null
      error_message = "Canary deployment requires a built and reviewed image digest."
    }
  }
  template {
    service_account                  = google_service_account.canary.email
    timeout                          = "5s"
    max_instance_request_concurrency = 1
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.canary_image_digest
      resources {
        limits   = { cpu = "1", memory = "256Mi" }
        cpu_idle = true
      }
      ports { container_port = 8080 }
      env {
        name  = "PAY0_SOURCE_PROJECT_ID"
        value = "pay-0-system"
      }
      env {
        name  = "OBSERVATION_PUBLISHER_MODE"
        value = var.canary_mode
      }
      startup_probe {
        http_get { path = "/healthz" }
      }
    }
  }
  depends_on = [google_project_iam_member.canary_writer, google_artifact_registry_repository_iam_member.canary_image_reader]
}
