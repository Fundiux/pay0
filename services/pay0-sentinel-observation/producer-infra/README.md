# Preparacion IAM/KMS de listUsers

Root Terraform separado de `../infra`, sin referencia desde ese root, sin deployment Functions/Run ni wiring del productor. Defaults: provision cero recursos; SA deshabilitada si se aprovisiona; binding signer ausente; version KMS DISABLED. `signedLoggingObservationPort` y el wrapper de listUsers permanecen apagados por codigo.

No se ha ejecutado init/plan/apply/import ni creado recursos. API KMS aislada DISABLED y SA propuesta404 en preflight2026-10-10; no demuestra ausencia de ring/key/roles. Ver documento [SENTINEL-PRODUCER-PROVISIONING.md](../../../docs/remediation/2026-10-09/SENTINEL-PRODUCER-PROVISIONING.md).

No usar estado de `../infra`. Estado/plan/tfvars locales privados estan ignorados aqui; el operador debe fijar backend/locking revisado antes de provisioning real, sin credenciales en HCL ni Git. No ejecutar un plan creyendo que `enable_provisioning=false` evita autenticacion/refresco del proveedor. Despues de crear recursos, volver este flag a false intenta retirarlos: prevent_destroy protege identidad/clave/version, pero no todos los bindings. Es un switch de creacion inicial, NO un mecanismo de apagado operativo.

No se conceden actAs, TokenCreator, claves SA, roles compartidos ni IAM al observer. El gate de exclusividad real y la asignacion futura de SA a listUsers son trabajos distintos. La condicion Firestore limita database, no users ni campos. Este runtime sigue pudiendo leer documentos financieros dentro del alcance DB. No prometer IAM por coleccion.

Actualizacion candidata: enable_read_grant y enable_logging_grant son defaultsfalse independientes; provisioning no crea bindings por defecto. Base8bedd42 si creaba reader/logger con provisioningtrue. Roles stageGA/prevent_destroy. Ver SENTINEL-PRODUCER-PROVISION-PREFLIGHT.md para el nuevo gate; no apply autorizado por este texto.


## Disabled provisioning: observed state, not creation guarantee

The first reviewed provisioning attempt55536 created resources but its postflight
rejected service-account disabled=false and asymmetric version PENDING_GENERATION.
Root subsequently disabled both explicitly and verified disabled=true/DISABLED,
eight active resources and zero direct grants. State reconciliation is a separate
refresh-only operation; no creation retry, state editing or history deletion.

Provider google7.46.1 ServiceAccount Create does not send disabled and returns
without invoking Update; its Read records the returned disabled flag. Update
uses the separate :disable API. See [exact provider SA source](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v7.46.1/google/services/resourcemanager/resource_google_service_account.go).
KMS Create sends requested state but immediately reads the server result without
waiting for generation or disabling afterwards. [Exact KMS provider source](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v7.46.1/google/services/kms/resource_kms_crypto_key_version.go)
SHA25637b661c847dedd9a1c968ed42c7dcb129726e59d250e36ac04739ce297dd907e.
[Google's version-state contract](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions#CryptoKeyVersionState)
says pending generation cannot be disabled and automatically becomes ENABLED.
A requested DISABLED value is therefore not a disabled-at-birth guarantee.

SA and version now have unconditional lifecycle postconditions requiring observed
disabled=true and DISABLED, with fixed errors. Every reader/logger/signer binding
explicitly depends on both resources so failed postconditions block those grants,
including the signer whose key reference alone did not depend on the version.
All grant defaults remain false. These conditions detect provider-returned states;
they neither prevent transient enabling nor continuously monitor later drift.

For future creation: retain zero grants, stop on a failed postcondition, explicitly
reconcile generation and disable using reviewed fixed targets, verify by GET, then
refresh-only local state. No automatic reapply, ignore_changes, containment
provisioner or automatic grant phase. Any future activation requires separate
review and an explicit change to this disabled-phase contract; simply setting
service_account_disabled=false intentionally cannot satisfy its postcondition.
If the requirement is never enabled at any instant, this creation path does not
meet it; defer version creation until a separately reviewed transition instead.

Local verification:58 focused checks PASS; terraform fmt and validate PASS in a
private copy using cached provider7.46.1, without plan/apply or cloud requests.
The first sandbox validate failed provider-cache checksum access; the same offline
validation under the authorized Windows account passed. Historical source-pins
and operational state were not edited by this change.
