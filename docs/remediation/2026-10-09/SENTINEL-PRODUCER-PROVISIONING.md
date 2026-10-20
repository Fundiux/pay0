# Productor listUsers: propuesta IaC aislada

2026-10-10. Solo preparacion local; ningun plan/apply/import, API habilitada, grant, clave, SA, deployment o activacion. Modulo independiente `services/pay0-sentinel-observation/producer-infra`; no modifica main.tf/signed.tf del observer. No agrega permisos al detector ni autoridad financiera.

## Contrato y fases

Proyecto fuente fijo pay-0-system; KMS fijo pay0-sentinel-observe/us-central1. SA propuesta pay0-listusers-observer; ring listusers-observation; key listusers-observation-signing. Variables no permiten elegir proyecto/identidad/algoritmo/permisos arbitrarios. `enable_provisioning=false` produce counts0; `service_account_disabled=true`; `enable_signing_grant=false`. Si se provisiona, CryptoKey omite version inicial automatica y recurso de version explicito pide DISABLED, algoritmo RSA_SIGN_PSS_3072_SHA256/SOFTWARE. No leer/exportar private key ni siquiera en outputs.

Tres roles custom: get/list Firestore condicionados a projects/pay-0-system/databases/(default), Logging create en source, useToSign en aislado. Solo el binding KMS depende del segundo flag y va a CryptoKey exacta, nunca proyecto/ring/wildcard. Version exacta futura se toma de metadata, no se inventa /1. SA/clave/version prevent_destroy; destruir bindings o alternar enable_provisioning NO es rollback operativo seguro. IAM usa member aditivo, no policy/binding autoritativo que borre otros miembros.

Deshabilitado por defecto no garantiza que Terraform con credenciales no consulte APIs. Las pruebas previstas son locales sin proveedor ni plan. No se ofrece comando apply. Activacion de SA, version y binding debe ser un cambio posterior revisado con funcionalidad listUsers todavia apagada; activacion del writer requiere otro lote. No declarar que el proveedor crea una version sin transicion interna ENABLED hasta verificar su implementacion: sin signer grant y SA deshabilitada se mantiene cerrada la capacidad runtime durante provisioning.

## Estado real y adopcion

Preflight: SA GET404; KMS list403 sin ErrorInfo.reason y Service Usage confirma API DISABLED. Esta configuracion propone habilitar solo Cloud KMS aislado cuando se autorice provisioning. IAM source, Logging/Firestore source y permisos del operador requieren inventario, no se habilitan APIs financieras por comodidad. SA dedicada no se importa como si existiera. Antes de plan real: reconsultar SA, roles custom, ring/key/version exactos y politica efectiva. Si aparecen recursos preexistentes, detener creacion y revisar propietario/estado; importar solo el recurso exacto al estado independiente con direccion indexada [0], tras comprobar que no esta administrado por otro state. No importa identidades Compute, observer o canary; no suplanta recursos del root ../infra.

ID SA esperado para eventual import: projects/pay-0-system/serviceAccounts/pay0-listusers-observer@pay-0-system.iam.gserviceaccount.com. Ring/key IDs regionales exactos; version descubierta numericamente. No ejecutar import de ejemplo ni generar state a mano. Roles pay0ListUsersReadOnly/pay0ListUsersObservationLogger en source y pay0ListUsersObservationSigner en aislado tambien requieren inspeccion antes de adopcion.

## Gates que este codigo no demuestra

- IAM efectivo/herencia/grupos/deny y exclusividad: quien puede impersonar SA o adjuntarla a otro workload. No dar TokenCreator. Deployer necesita actAs acotado sobre SA y permisos Functions/Run de su flujo existente; estos grants NO estan incluidos y no se presumen disponibles. Administradores IAM siguen dentro de frontera administrativa.
- Lectura get/query SDK con SA minima, incluyendo startup real del artefacto compartido. No AuthAdmin/SecretManager/Storage/Firestorewrites/PubSub. Permisos faltantes se diagnostican, no se amplian automaticamente. Condicion DB no aisla colecciones: existe capacidad de leer datos financieros; aceptacion de ese riesgo permanece explicita.
- listUsers preserva username publicado que integracion ya conserva, opciones60s/256Mi/CPU1/max20/con80 y env por endpoint. No copiar modulo principal completo que omite username. No desplegar desde este root Terraform.
- Verificar clave publica SPKI/fingerprint, algoritmo/estado/recurso exacto y trust manifest revisado. Observer sin KMS; rotacion mantiene publisher estable y max2keys. Disabled KMS no revoca firmas previas offline; revocar trust separado ante compromiso.
- Deadline750ms compartido, techo externo1000ms, un intento, inflight1/6min/20proceso, cohorte y ventana<=60min. No son cuotas globales; replicas/reinicios multiplican firmas. Preservar sink apagado, OBSERVE_ONLY y ausencia de restricciones financieras.

## Evidencia de condicion DB y limites de la prueba

La documentacion oficial de [permisos por base de datos](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions) muestra igualdad `resource.name` con `projects/PROJECT_ID/databases/DATABASE_ID` y define PROJECT_ID como ID del proyecto. Explica que la condicion se aplica a REST/client libraries, con excepcion de acceso por consola Google Cloud. Esto fundamenta el literal pay-0-system/(default), sin reemplazarlo por numero ni documento/coleccion. La [tabla de permisos API](https://firebase.google.com/docs/firestore/security/iam#required_permissions_for_api_methods) asigna batchGet/get a entities.get y runQuery a entities.get+entities.list; no requiere databases.get para estas lecturas sin transaccion.

Es evidencia documental, no prueba de la SA inexistente ni de IAM efectivo. Antes de provisioning/identidad se mantiene gate de ensayo sintetico en entorno aislado con politica equivalente: get/query permitidos en DB prevista, denegados en otra DB, y writes denegados. Confirmar identidad de la llamada y recurso evaluado mediante evidencia acotada, sin leer users productivos. Los emuladores no prueban IAM Google. Policy Troubleshooter ayuda al modelo pero no sustituye el ensayo del SDK y no debe usarse con recursos inventados como si acreditara runtime.

## Validacion local

- `node qa/scripts/remediation-sentinel-producer-iac.test.mjs`: PASS42. Whitelist11recursos, permisos exactos, condicion DB, key/SA deshabilitados y cinco combinaciones de flags con Terraform console en modulo sin proveedor. Sin auth/plan/cloud.
- Terraform fmt aplicado y esquema `terraform validate` PASS con proveedor Google7.46.1 ya cacheado, copia privada del HCL/lock en .firebase y entorno sin credenciales. No init, descargas, plan o apply. Primer validate fallo por Access denied al checksum bajo sandbox; repeticion escalada acotada PASS sin cambiar HCL ni permisos.
- Comentario de version expresa solo estado solicitado DISABLED; no garantiza una transicion interna desconocida del servidor.

No afirmar que estos checks equivalen a plan limpio, exclusividad efectiva o compatibilidad runtime. El ensayo sintetico IAM real permanece pendiente antes de provisioning.

Fuentes: [IAM Firestore](https://firebase.google.com/docs/firestore/security/iam), [CryptoKey Terraform](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/kms_crypto_key), [asymmetricSign](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign). IAM de firma se aplica a CryptoKey; exactitud de version se exige tambien en contrato backend.
