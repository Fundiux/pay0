resource "google_service_account" "builder" {
  project      = google_project.observation.project_id
  account_id   = "pay0-sentinel-builder"
  display_name = "Sentinel image builder only"
  depends_on   = [google_project_service.apis]
}
resource "google_storage_bucket" "build_source" {
  project                     = google_project.observation.project_id
  name                        = "${var.project_id}-build-source"
  location                    = "US-CENTRAL1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
}
resource "google_storage_bucket_iam_member" "builder_source" {
  bucket = google_storage_bucket.build_source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.builder.email}"
}
resource "google_artifact_registry_repository_iam_member" "builder_images" {
  project    = google_project.observation.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.builder.email}"
}
resource "google_project_iam_member" "builder_logs" {
  project = google_project.observation.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.builder.email}"
}
