# listUsers: identidad dedicada, preflight de solo lectura

2026-10-10. Preparación; sin provisioning, plan/apply, deploy, firma, invocaciones ni lecturas de usuarios. No activa observación. Complementa SENTINEL-PRODUCER-AUTH.md y el contrato firmado implementado, sin sustituir sus gates.

## Evidencia publicada

Consulta GCF v2 a las 18:40:19Z: `listUsers` ACTIVE, Node22, revisión `listusers-00037-tik`, generación fuente `1790583721309928`, objeto `listUsers/function-source.zip`, bucket `gcf-v2-sources-751158244178-us-central1`. Runtime Compute compartido `751158244178-compute@developer.gserviceaccount.com`; 256Mi, CPU1, timeout60, max20, concurrency80, ALLOW_ALL; min/VPC no presentes. Secret bindings: cero.

Nombres env exclusivamente: EVENTARC_CLOUD_EVENT_SOURCE, FIREBASE_CONFIG, FUNCTION_SIGNATURE_TYPE, FUNCTION_TARGET, GCLOUD_PROJECT, LOG_EXECUTION_ID, PAY0_FIREBASE_WEB_API_KEY. No valores leídos a stdout ni guardados en el resumen privado. Preservar configuración por endpoint al cambiar identidad; no copiar dotenv de otro lote ni asumir defaults SDK equivalentes.

GET de `pay0-listusers-observer@pay-0-system.iam.gserviceaccount.com`: 404. Política de proyecto pay-0-system: identidad Compute actual tiene roles/editor, roles/eventarc.eventReceiver y roles/run.invoker, sin condiciones en esos bindings. Política de proyecto aislado: sin bindings directos para esas dos identidades. Esto NO inventaría IAM efectivo: faltan herencia, grupos, condiciones, deny policies y capacidad de impersonación/adjuntar SA.

KMS keyRings us-central1 en pay0-sentinel-observe devolvió403; ErrorInfo no contenía entradas con reason. Consulta independiente Service Usage confirmó `cloudkms.googleapis.com: DISABLED`. No se habilitó. No afirmar que el403 demuestra ausencia de clave ni denegación IAM efectiva. Existencia ring/key/version pendiente.

La revisión automática inicial rechazó descargar el ZIP al respaldo privado ignorado. Root aportó autorización literal del encargo y comprobó el destino dentro del workspace ignorado; una nueva revisión aprobó la misma acción. Descarga central exit0: 6053816 bytes, generación1790583721309928, SHA256 `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`. Rechazo resuelto mediante revisión, no workaround. Comparación offline posterior limitada a whitelist de módulos de usuarios/guard y list.js compilado; sin extraer env ni ejecutar el artefacto.

### Comparación exacta del artefacto

| Archivo publicado | SHA256 | Resultado |
|---|---|---|
| src/modules/users/list.ts | 551add9879c1d5294dd29ff5ec31ffa2a6d412709af9bc64e019bd86600fe92e | Misma consulta/perfil/options; publicado sin wrapper observado |
| src/utils/authGuard.ts | 19617aa6df563e0ebc4d6acb0bc59142b6fdaf36b2db42d6a0384f9cbf47a78e | Fuente añade respuesta específica ACCOUNT_RESTRICTED/CONTACT_SUPPORT |
| src/modules/users/authorization.ts | d30947e30357207dfc8488c0988b5e563dbe4c16124179bcbc1c124ca1267e56 | Fuente añade evaluación trustedRestriction antes de bypass y rechazo de rol vacío |
| src/modules/users/defaultModules.ts | d0271c7df9bd88c0ce2eb4d9542718eabc3333dbe8ccc280510031b3abeec493 | Igual al normalizar finales de línea |
| src/modules/users/authorizationPolicy.generated.ts | 83e88167b224377e3f36c773a17cf25ebfdaf2f1a50bf73bd20137144beebe95 | Texto idéntico |
| lib/modules/users/list.js | 8efe3560940c44b2b7b47f00a983bdc318a73b1cd6e2146e486d80c33a39e5d1 | Compilado inspeccionado estáticamente, nunca ejecutado |

`restrictions.ts` y `securityObservation/authorizationDenied.ts` no existen en el ZIP publicado. Restricción y wrapper son cambios reales del próximo candidato, no capacidades de esta revisión productiva. El camino publicado sigue siendo get perfil + query users, sin Auth Admin ni escrituras; no se certifica aquí el grafo entero de inicialización de index.

Hallazgo de compatibilidad: publicado incluye `username: x.usernameNormalized ?? x.username ?? null`, ausente en fuente principal. **Integración ya conserva ese campo**; no es un bloqueo nuevo de integración, pero impide copiar list.ts principal completo encima. Preservar ese hunk al integrar futura identidad/wiring y probar el contrato de salida. Comparación semántica normaliza CRCRLF/CRLF, sin modificar el archivo del ZIP.

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

Comparación whitelist del artefacto completada; preservar username que integración ya tiene. KMS API deshabilitada/existencia desconocida; SA ausente; IAM efectivo y exclusividad sin cerrar; compatibilidad SDK/startup con SA mínima sin probar. No tests CPU, builds ni emuladores. Metadatos y respaldo privados limitados bajo .firebase/sentinel-producer-preflight, fuera de Git. No se declara este lote listo para activación.
