terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google      = { source = "hashicorp/google", version = "~> 7.0" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 7.0" }
  }
}
provider "google" {
  project = var.project_id
  region  = "us-central1"
}
provider "google-beta" {
  project = var.project_id
  region  = "us-central1"
}
variable "project_id" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id)) && var.project_id != "pay-0-system"
    error_message = "A separate observation project is required."
  }
}
variable "billing_account" {
  type      = string
  sensitive = true
}
variable "image_digest" {
  type    = string
  default = null
  validation {
    condition     = var.image_digest == null || can(regex("@sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "Provide the reviewed immutable container digest."
  }
}
variable "allowed_origins" {
  type    = list(object({ projectId = string, publisherId = string, logName = string, serviceName = string, revisions = list(string), roots = list(string), actors = list(string) }))
  default = []
  validation {
    condition     = length(var.allowed_origins) <= 8
    error_message = "Provide explicit canary origins."
  }
  validation {
    condition     = alltrue([for origin in var.allowed_origins : length(origin.roots) == 1 && length(origin.actors) > 0 && length(origin.revisions) > 0 && origin.projectId == "pay-0-system" && origin.logName == "projects/pay-0-system/logs/pay0_security_observation"])
    error_message = "Each origin requires exactly one root, explicit actors/revisions and the reviewed source project/log."
  }
}
locals {
  origin_filters = [for origin in var.allowed_origins : join(" AND ", [
    "resource.labels.service_name=${jsonencode(origin.serviceName)}",
    "(${join(" OR ", [for revision in origin.revisions : "resource.labels.revision_name=${jsonencode(revision)}"])})",
    "jsonPayload.context.rootId=${jsonencode(origin.roots[0])}",
    "(${join(" OR ", [for actor in origin.actors : "jsonPayload.context.actorUid=${jsonencode(actor)}"])})"
  ])]
}
variable "activate_sink" {
  type    = bool
  default = false
}
resource "google_project" "observation" {
  project_id          = var.project_id
  name                = "PAY0 Sentinel Observation"
  billing_account     = var.billing_account
  auto_create_network = false
  deletion_policy     = "PREVENT"
}
resource "google_project_service" "apis" {
  for_each           = toset(["firestore.googleapis.com", "run.googleapis.com", "pubsub.googleapis.com", "iam.googleapis.com", "logging.googleapis.com", "firebaserules.googleapis.com", "firebase.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com"])
  project            = google_project.observation.project_id
  service            = each.key
  disable_on_destroy = false
}
resource "google_service_account" "runtime" {
  project      = google_project.observation.project_id
  account_id   = "pay0-sentinel-observer"
  display_name = "Sentinel observation only"
  depends_on   = [google_project_service.apis]
}
resource "google_service_account" "push" {
  project    = google_project.observation.project_id
  account_id = "pay0-sentinel-push"
  depends_on = [google_project_service.apis]
}
resource "google_artifact_registry_repository" "images" {
  project       = google_project.observation.project_id
  location      = "us-central1"
  repository_id = "sentinel-images"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}
resource "google_firestore_database" "observation" {
  project                 = google_project.observation.project_id
  name                    = "sentinel-observation"
  location_id             = "us-central1"
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.apis]
}
resource "google_project_iam_custom_role" "writer" {
  project     = google_project.observation.project_id
  role_id     = "sentinelObservationWriter"
  title       = "Sentinel isolated transaction writer"
  permissions = ["datastore.databases.get", "datastore.entities.get", "datastore.entities.create", "datastore.entities.update"]
}
resource "google_project_iam_member" "writer" {
  project = google_project.observation.project_id
  role    = google_project_iam_custom_role.writer.name
  member  = "serviceAccount:${google_service_account.runtime.email}"
  condition {
    title      = "OnlyObservationDatabase"
    expression = "resource.name == 'projects/${var.project_id}/databases/sentinel-observation'"
  }
}
resource "google_firestore_field" "ttl" {
  for_each   = toset(["quotas", "receipts", "incidents", "sentinelAdmission"])
  project    = google_project.observation.project_id
  database   = google_firestore_database.observation.name
  collection = each.key
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}
resource "google_firestore_field" "evidence" {
  for_each   = { receipts = "event", incidents = "evidence" }
  project    = google_project.observation.project_id
  database   = google_firestore_database.observation.name
  collection = each.key
  field      = each.value
  index_config {}
}
resource "google_firebaserules_ruleset" "deny" {
  project = google_project.observation.project_id
  source {
    files {
      name    = "firestore.rules"
      content = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }"
    }
  }
  depends_on = [google_firebase_project.observation]
}
resource "google_firebase_project" "observation" {
  provider   = google-beta
  project    = google_project.observation.project_id
  depends_on = [google_project_service.apis]
}
resource "google_firebaserules_release" "deny" {
  project      = google_project.observation.project_id
  name         = "cloud.firestore/sentinel-observation"
  ruleset_name = google_firebaserules_ruleset.deny.name
  depends_on   = [google_firestore_database.observation]
}
resource "google_pubsub_topic" "events" {
  project    = google_project.observation.project_id
  name       = "pay0-security-observe-v1"
  depends_on = [google_project_service.apis]
}
resource "google_pubsub_topic" "dead" {
  project                    = google_project.observation.project_id
  name                       = "pay0-security-observe-dead-v1"
  message_retention_duration = "86400s"
  depends_on                 = [google_project_service.apis]
}
resource "google_project_service_identity" "pubsub" {
  provider   = google-beta
  project    = google_project.observation.project_id
  service    = "pubsub.googleapis.com"
  depends_on = [google_project_service.apis]
}
resource "google_service_account_iam_member" "push_token" {
  service_account_id = google_service_account.push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.pubsub.email}"
}
resource "google_cloud_run_v2_service" "observer" {
  lifecycle {
    precondition {
      condition     = var.image_digest != null && length(var.allowed_origins) > 0
      error_message = "Full deployment requires a reviewed immutable image and explicit canary origins; only bootstrap targets may omit them."
    }
  }
  project              = google_project.observation.project_id
  name                 = "pay0-sentinel-observer"
  location             = "us-central1"
  deletion_protection  = true
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "10s"
    max_instance_request_concurrency = 4
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.image_digest
      resources {
        limits   = { cpu = "1", memory = "256Mi" }
        cpu_idle = true
      }
      ports { container_port = 8080 }
      dynamic "env" {
        for_each = {
          OBSERVATION_PROJECT_ID  = var.project_id
          OBSERVATION_DATABASE_ID = "sentinel-observation"
          PUSH_SERVICE_ACCOUNT    = google_service_account.push.email
          # Stable default run.app URL derived from project number, not service.uri cycle.
          PUSH_AUDIENCE        = "https://pay0-sentinel-observer-${google_project.observation.number}.us-central1.run.app"
          ALLOWED_ORIGINS_JSON = jsonencode(var.allowed_origins)
        }
        content {
          name  = env.key
          value = env.value
        }
      }
      startup_probe {
        http_get { path = "/healthz" }
        initial_delay_seconds = 0
        period_seconds        = 10
        failure_threshold     = 3
      }
    }
  }
  depends_on = [google_project_iam_member.writer, google_firebaserules_release.deny]
}
resource "google_cloud_run_v2_service_iam_member" "push" {
  project  = google_project.observation.project_id
  location = google_cloud_run_v2_service.observer.location
  name     = google_cloud_run_v2_service.observer.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.push.email}"
}
resource "google_pubsub_subscription" "events" {
  project                    = google_project.observation.project_id
  name                       = "pay0-security-observe-v1"
  topic                      = google_pubsub_topic.events.id
  ack_deadline_seconds       = 20
  message_retention_duration = "86400s"
  retain_acked_messages      = false
  expiration_policy { ttl = "" }
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead.id
    max_delivery_attempts = 5
  }
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.observer.uri}/pubsub"
    oidc_token {
      service_account_email = google_service_account.push.email
      audience              = "https://pay0-sentinel-observer-${google_project.observation.number}.us-central1.run.app"
    }
  }
  depends_on = [google_service_account_iam_member.push_token, google_cloud_run_v2_service_iam_member.push]
}
resource "google_pubsub_topic_iam_member" "dead_writer" {
  project = google_project.observation.project_id
  topic   = google_pubsub_topic.dead.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_project_service_identity.pubsub.email}"
}
resource "google_pubsub_subscription" "dead_review" {
  project                    = google_project.observation.project_id
  name                       = "pay0-security-observe-dead-review-v1"
  topic                      = google_pubsub_topic.dead.id
  message_retention_duration = "86400s"
  retain_acked_messages      = false
  expiration_policy { ttl = "" }
}
resource "google_pubsub_subscription_iam_member" "dead_reader" {
  project      = google_project.observation.project_id
  subscription = google_pubsub_subscription.events.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_project_service_identity.pubsub.email}"
}
resource "google_logging_project_sink" "events" {
  project                = "pay-0-system"
  name                   = "pay0-sentinel-observe-v1"
  destination            = "pubsub.googleapis.com/${google_pubsub_topic.events.id}"
  unique_writer_identity = true
  disabled               = !var.activate_sink
  filter = join("\n", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.location=\"us-central1\"",
    "logName=\"projects/pay-0-system/logs/pay0_security_observation\"",
    "jsonPayload.schemaVersion=\"PAY0-SECURITY-ENVELOPE@1\"",
    "(${join(" OR ", [for filter in local.origin_filters : "(${filter})"])})"
  ])
}
resource "google_pubsub_topic_iam_member" "sink" {
  project = google_project.observation.project_id
  topic   = google_pubsub_topic.events.name
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.events.writer_identity
}
