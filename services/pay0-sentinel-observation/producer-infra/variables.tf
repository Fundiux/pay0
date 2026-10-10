variable "enable_provisioning" {
  description = "Explicit reviewed provisioning only; never deploys or activates listUsers."
  type        = bool
  default     = false
  nullable    = false
}

variable "service_account_disabled" {
  description = "Keep the new identity disabled until exclusivity and functional gates pass."
  type        = bool
  default     = true
  nullable    = false
}

variable "enable_signing_grant" {
  description = "Separate reviewed permission gate; version remains DISABLED in this module."
  type        = bool
  default     = false
  nullable    = false
}

locals {
  source_project      = "pay-0-system"
  observation_project = "pay0-sentinel-observe"
  region              = "us-central1"
  database_resource   = "projects/pay-0-system/databases/(default)"
  producer_account_id = "pay0-listusers-observer"
  provision_count     = var.enable_provisioning ? 1 : 0
  signer_count        = var.enable_provisioning && var.enable_signing_grant ? 1 : 0
  read_permissions    = ["datastore.entities.get", "datastore.entities.list"]
  log_permissions     = ["logging.logEntries.create"]
  sign_permissions    = ["cloudkms.cryptoKeyVersions.useToSign"]
}
