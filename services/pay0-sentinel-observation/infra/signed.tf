variable "signed_trust_manifest" {
  description = "Reviewed public verification material only; empty trust accepts no signed producer. No IAM or signing key is created."
  type = object({
    schemaVersion = string
    producers = list(object({
      publisherId  = string
      audience     = string
      projectId    = string
      functionName = string
      serviceName  = string
      revisions    = list(string)
      roots        = list(string)
      actors       = list(string)
      keys = list(object({
        keyVersion = string
        algorithm  = string
        spkiPem    = string
        spkiSha256 = string
        status     = string
      }))
    }))
  })
  default  = { schemaVersion = "PAY0-SIGNED-TRUST@1", producers = [] }
  nullable = false
  validation {
    condition     = try(var.signed_trust_manifest.schemaVersion == "PAY0-SIGNED-TRUST@1" && length(var.signed_trust_manifest.producers) <= 8 && length(jsonencode(var.signed_trust_manifest)) <= 16384, false)
    error_message = "Signed trust requires schema PAY0-SIGNED-TRUST@1, at most eight producers and at most 16KiB of ASCII JSON."
  }
  validation {
    condition = try(alltrue([for p in var.signed_trust_manifest.producers :
      alltrue([for id in [p.publisherId, p.audience, p.serviceName] : can(regex("^[A-Za-z0-9_-]{1,128}$", id))]) &&
      !can(regex("(?i)sentinel", p.publisherId)) && p.projectId == "pay-0-system" && p.functionName == "listUsers" &&
      length(p.roots) == 1 && alltrue([for cohort in [p.revisions, p.roots, p.actors] :
        length(cohort) >= 1 && length(cohort) <= 100 && length(distinct(cohort)) == length(cohort) &&
        alltrue([for id in cohort : can(regex("^[A-Za-z0-9_-]{1,128}$", id))])
      ]) && length(p.keys) >= 1 && length(p.keys) <= 2
    ]) && length(distinct([for p in var.signed_trust_manifest.producers : p.publisherId])) == length(var.signed_trust_manifest.producers), false)
    error_message = "Signed producers require unique stable publishers, ASCII identifiers, listUsers in pay-0-system, one root and bounded unique revision/actor cohorts."
  }
  validation {
    condition = try(alltrue(flatten([for p in var.signed_trust_manifest.producers : [for k in p.keys :
      k.algorithm == "RSA_SIGN_PSS_3072_SHA256" && contains(["ACTIVE", "REVOKED"], k.status) &&
      length(k.keyVersion) <= 512 && can(regex("^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/locations/us-central1/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}/cryptoKeyVersions/[1-9][0-9]{0,9}$", k.keyVersion)) &&
      length(k.spkiPem) <= 2048 && can(regex("^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$", k.spkiPem)) &&
      can(regex("^[a-f0-9]{64}$", k.spkiSha256))
    ]])) && length(distinct(flatten([for p in var.signed_trust_manifest.producers : [for k in p.keys : k.keyVersion]]))) == length(flatten([for p in var.signed_trust_manifest.producers : p.keys])), false)
    error_message = "Trust keys require globally unique explicit KMS versions, public SPKI PEM syntax, SHA256 fingerprints and the reviewed RSA-PSS algorithm/status. Runtime performs cryptographic validation."
  }
}

locals {
  # Reconstruct closed serialized objects: no defaults or arbitrary fields enter
  # the verifier. Terraform typed-object conversion may discard caller extras.
  signed_trust_serialized = {
    schemaVersion = var.signed_trust_manifest.schemaVersion
    producers = [for p in var.signed_trust_manifest.producers : {
      publisherId  = p.publisherId
      audience     = p.audience
      projectId    = p.projectId
      functionName = p.functionName
      serviceName  = p.serviceName
      revisions    = p.revisions
      roots        = p.roots
      actors       = p.actors
      keys         = [for k in p.keys : { keyVersion = k.keyVersion, algorithm = k.algorithm, spkiPem = k.spkiPem, spkiSha256 = k.spkiSha256, status = k.status }]
    }]
  }
  signed_env = length(var.signed_trust_manifest.producers) == 0 ? {} : { SIGNED_TRUST_MANIFEST_JSON = jsonencode(local.signed_trust_serialized) }
  signed_origin_filters = [for p in var.signed_trust_manifest.producers : join(" AND ", [
    "resource.labels.project_id=${jsonencode(p.projectId)}",
    "resource.labels.service_name=${jsonencode(p.serviceName)}",
    "resource.labels.configuration_name=${jsonencode(p.serviceName)}",
    "(${join(" OR ", [for revision in p.revisions : "resource.labels.revision_name=${jsonencode(revision)}"])})",
    "jsonPayload.context.rootId=${jsonencode(p.roots[0])}",
    "(${join(" OR ", [for actor in p.actors : "jsonPayload.context.actorUid=${jsonencode(actor)}"])})"
  ])]
  # This is the previous expression verbatim, including whitespace/newlines.
  legacy_sink_filter = join("\n", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.location=\"us-central1\"",
    "logName=\"projects/pay-0-system/logs/pay0_security_observation\"",
    "jsonPayload.schemaVersion=\"PAY0-SECURITY-ENVELOPE@1\"",
    "(${join(" OR ", [for filter in local.origin_filters : "(${filter})"])})"
  ])
  signed_sink_filter = join("\n", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.location=\"us-central1\"",
    "logName=\"projects/pay-0-system/logs/pay0_security_observation\"",
    "jsonPayload.schemaVersion=\"PAY0-SECURITY-SIGNED@1\"",
    "(${join(" OR ", [for filter in local.signed_origin_filters : "(${filter})"])})"
  ])
  observation_sink_filter = length(var.signed_trust_manifest.producers) == 0 ? local.legacy_sink_filter : "(${local.legacy_sink_filter}) OR (${local.signed_sink_filter})"
  signed_legacy_disjoint = alltrue([for origin in var.allowed_origins :
    lower(origin.serviceName) != "listusers" && alltrue([for p in var.signed_trust_manifest.producers :
      lower(origin.serviceName) != lower(p.serviceName) && origin.publisherId != p.publisherId
    ])
  ])
}
