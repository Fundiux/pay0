# Preparacion IAM/KMS de listUsers

Root Terraform separado de `../infra`, sin referencia desde ese root, sin deployment Functions/Run ni wiring del productor. Defaults: provision cero recursos; SA deshabilitada si se aprovisiona; binding signer ausente; version KMS DISABLED. `signedLoggingObservationPort` y el wrapper de listUsers permanecen apagados por codigo.

No se ha ejecutado init/plan/apply/import ni creado recursos. API KMS aislada DISABLED y SA propuesta404 en preflight2026-10-10; no demuestra ausencia de ring/key/roles. Ver documento [SENTINEL-PRODUCER-PROVISIONING.md](../../../docs/remediation/2026-10-09/SENTINEL-PRODUCER-PROVISIONING.md).

No usar estado de `../infra`. Estado/plan/tfvars locales privados estan ignorados aqui; el operador debe fijar backend/locking revisado antes de provisioning real, sin credenciales en HCL ni Git. No ejecutar un plan creyendo que `enable_provisioning=false` evita autenticacion/refresco del proveedor. Despues de crear recursos, volver este flag a false intenta retirarlos: prevent_destroy protege identidad/clave/version, pero no todos los bindings. Es un switch de creacion inicial, NO un mecanismo de apagado operativo.

No se conceden actAs, TokenCreator, claves SA, roles compartidos ni IAM al observer. El gate de exclusividad real y la asignacion futura de SA a listUsers son trabajos distintos. La condicion Firestore limita database, no users ni campos. Este runtime sigue pudiendo leer documentos financieros dentro del alcance DB. No prometer IAM por coleccion.

Actualizacion candidata: enable_read_grant y enable_logging_grant son defaultsfalse independientes; provisioning no crea bindings por defecto. Base8bedd42 si creaba reader/logger con provisioningtrue. Roles stageGA/prevent_destroy. Ver SENTINEL-PRODUCER-PROVISION-PREFLIGHT.md para el nuevo gate; no apply autorizado por este texto.
