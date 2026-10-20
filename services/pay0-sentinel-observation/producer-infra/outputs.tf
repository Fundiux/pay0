output "prepared_identity" {
  value = var.enable_provisioning ? google_service_account.producer[0].email : null
}

output "disabled_key_version" {
  description = "Metadata only, not public key trust. Do not infer version number or enabled status."
  value       = var.enable_provisioning ? google_kms_crypto_key_version.producer[0].name : null
}

output "producer_deployment_managed" {
  value = false
}
