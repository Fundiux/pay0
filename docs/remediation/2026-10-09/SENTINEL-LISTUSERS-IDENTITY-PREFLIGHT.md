# listUsers: identidad dedicada, preflight de solo lectura

2026-10-10. Preparación; sin provisioning, plan/apply, deploy, firma, invocaciones ni lecturas de usuarios. No activa observación. Complementa SENTINEL-PRODUCER-AUTH.md y el contrato firmado implementado, sin sustituir sus gates.

## Evidencia publicada

Consulta GCF v2 a las 18:40:19Z: `listUsers` ACTIVE, Node22, revisión `listusers-00037-tik`, generación fuente `1790583721309928`, objeto `listUsers/function-source.zip`, bucket `gcf-v2-sources-751158244178-us-central1`. Runtime Compute compartido `751158244178-compute@developer.gserviceaccount.com`; 256Mi, CPU1, timeout60, max20, concurrency80, ALLOW_ALL; min/VPC no presentes. Secret bindings: cero.

Nombres env exclusivamente: EVENTARC_CLOUD_EVENT_SOURCE, FIREBASE_CONFIG, FUNCTION_SIGNATURE_TYPE, FUNCTION_TARGET, GCLOUD_PROJECT, LOG_EXECUTION_ID, PAY0_FIREBASE_WEB_API_KEY. No valores leídos a stdout ni guardados en el resumen privado. Preservar configuración por endpoint al cambiar identidad; no copiar dotenv de otro lote ni asumir defaults SDK equivalentes.

GET de `pay0-listusers-observer@pay-0-system.iam.gserviceaccount.com`: 404. Política de proyecto pay-0-system: identidad Compute actual tiene roles/editor, roles/eventarc.eventReceiver y roles/run.invoker, sin condiciones en esos bindings. Política de proyecto aislado: sin bindings directos para esas dos identidades. Esto NO inventaría IAM efectivo: faltan herencia, grupos, condiciones, deny policies y capacidad de impersonación/adjuntar SA.

KMS keyRings us-central1 en pay0-sentinel-observe devolvió403; ErrorInfo no contenía entradas con reason. Consulta independiente Service Usage confirmó `cloudkms.googleapis.com: DISABLED`. No se habilitó. No afirmar que el403 demuestra ausencia de clave ni denegación IAM efectiva. Existencia ring/key/version pendiente.

La revisión automática rechazó descargar el ZIP exacto al respaldo privado ignorado porque no encontró autorización específica para exportar un artefacto productivo que podría contener código/datos sensibles. No se reintentó ni cambió destino. Pin metadata disponible; comparación byte/semántica contra fuente publicada NO realizada. La revisión central decide si la autorización existente permite nueva evaluación. El siguiente análisis corresponde a fuente local, no se etiqueta como fuente productiva verificada.

## Dependencias funcionales locales y privilegio propuesto

`functions/src/modules/users/list.ts`: requireAuth; get users/uid; assertAuthorized síncrono a través del wrapper observado; consulta users por rootId, orden documentId y máximo201 documentos para página200. Devuelve campos del usuario, no consulta Auth Admin. No escrituras Firestore, Storage ni proveedor financiero. El wrapper `authorizationDenied.ts` usa disabledPort por código; signedLoggingWriter preparado tampoco activa nada. No ampliar el catch general ni observar errores posteriores a la decisión autorizativa.

El grafo ejecutado requiere lectura Firestore y decisiones puras authorization/restrictions/policy. El artefacto Functions compartido y su inicialización global deben revisarse antes de asegurar que identidad reducida funciona al cargar el entrypoint; un import de SDK no equivale por sí solo a una llamada o permiso requerido.

| Principal / alcance | Permisos propuestos | Gate |
|---|---|---|
| SA exclusiva listUsers, DB default pay-0-system | custom: datastore.entities.get, datastore.entities.list | SDK real get/query con fixture aislado; sin agregar permisos por anticipación |
| Misma SA, proyecto pay-0-system | custom: logging.logEntries.create | No logging.admin; filtro sink no restringe lo que un writer puede afirmar |
| Misma SA, CryptoKey exacta aislada | custom: cloudkms.cryptoKeyVersions.useToSign | Sin viewPublicKey, gestión o wildcard entre claves |
| Operador público de confianza | viewPublicKey exacto | Verificar SPKI SHA256, algoritmo y versión; no conceder al observer |
| Deployer autorizado | actAs sobre esta SA solamente | Auditar quién puede desplegar código con ella; no TokenCreator general |
| Observer | Sin ampliación | Verificación pública offline; sin KMS/impersonación/finanzas |

Las lecturas IAM de Firestore no quedan limitadas a la colección users por usar ese path en TypeScript. El custom role de lectura puede leer información financiera dentro de su alcance de base de datos: riesgo residual explícito. Condición por database requiere validación del recurso reconocido, nunca una promesa de aislamiento por colección. Evitar roles/datastore.user o editor, que concederían escrituras. No pedir Auth Admin, Secret Manager, Storage, Pub/Sub publisher ni escritores de restricciones para listUsers. [Permisos oficiales Firestore](https://firebase.google.com/docs/firestore/security/iam).

Propuesta nueva, no recurso comprobado: ring `listusers-observation`, key `listusers-observation-signing`, proyecto pay0-sentinel-observe, región us-central1, ASYMMETRIC_SIGN / SOFTWARE / RSA_SIGN_PSS_3072_SHA256. Versión numérica exacta se obtiene después de crear/revisar; no asumir /1 existente. IAM firma se vincula a CryptoKey; el allowlist de versión está en el contrato. [Permiso asymmetricSign](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign), [IAM KMS](https://docs.cloud.google.com/kms/docs/reference/permissions-and-roles).

## Provisioning futuro y pruebas sintéticas propuestas

1. Congelar pin/ZIP validado y grafo de carga; revisión de IAM efectivo y exclusividad. Inventariar grants heredados, TokenCreator/getAccessToken/getOpenIdToken/signBlob/signJwt, grupos, agentes de servicio y quién puede adjuntar la SA. Incluir otros workloads: cuenta exclusiva no basta si cualquiera puede desplegar bajo ella. No quitar permisos del Compute compartido como parte de este lote.
2. Declarar recursos en módulo IaC independiente: API KMS aislada, SA sin keys descargables, custom roles y bindings exactos, ring/key. Mantener observación apagada. Revisar plan solo cuando root abra ese lote; ahora no se creó módulo ni recurso.
3. Fixtures de políticas, sin nube: caso mínimo aceptado; rechazar permisos write/AuthAdmin/Storage/SecretManager, signer en default/observer/push/canary, wildcard de clave, identidad productora compartida, TokenCreator o actAs amplio, versión/algoritmo/proyecto equivocados. Estas pruebas de forma NO prueban IAM efectivo real.
4. Prueba posterior controlada de identidad/SDK con documentos sintéticos en entorno aislado: get/query funcionan; writes y otras capacidades denegadas. Identidad de la prueba debe ser la SA real prevista o una réplica de política demostrada, no credenciales del operador. `testIamPermissions` con token del operador NO certifica runtime. No crear fixtures users productivos ni leerlos como parte de este preflight.
5. Cambiar únicamente identidad de listUsers con observación deshabilitada, preservando opciones/env/invocación callable. Gate funcional explícito y revisión de cold start antes de añadir firma. Rollback separado de identidad no reactiva unsigned ni concede KMS a Compute.
6. Gate criptográfico sintético posterior: identidad esperada, firma exacta, CRC32C, firma manipulada denegada, observer incapaz de firmar/impersonar. Pin público revisado y revisión real productora; jamás publicar una private key. No ejecutar esta etapa todavía.
7. Activación requeriría otro lote: cohorte root/actor explícita, revisión exacta, ventana no renovable <=60min, sink separado, budgets y apagado comprobados. Ningún gate actual autoriza activación.

Deadline compartido750ms para metadata+KMS+Logging, guard exterior<=1000ms; un intento sin retry financiero. Límites1 inflight,6/min,20/proceso no son cuotas globales: réplicas y reinicios multiplican capacidad. Máximo publicado20/concurrency80 se preserva y exige evaluar multiplicación de coste; no afirmar cap global120/min. Cuotas durables del observer no limitan firmas ya realizadas. El receptor conserva OBSERVE_ONLY/authority NONE, no controla dinero ni restricciones. Medir presupuesto frío/caliente y coste con ventana finita antes de activar, sin ampliar deadline para ocultar errores.

## Pendientes concretos

Artefacto exacto bloqueado por revisión automática; KMS API deshabilitada/existencia desconocida; SA ausente; IAM efectivo y exclusividad sin cerrar; compatibilidad SDK/startup con SA mínima sin probar. No tests CPU, builds ni emuladores durante ventana IQ. Metadatos privados limitados bajo .firebase/sentinel-producer-preflight, fuera de Git. No se declara este lote listo para activación.
