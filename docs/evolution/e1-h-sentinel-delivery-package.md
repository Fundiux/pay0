# H1 — entrega acotada de Sentinel

Fecha: 2026-10-19. Preparación local; ninguna activación, cambio IAM, publicación de imagen, despliegue o invocación productiva.

Estado reconciliado del receptor: **DEPLOYED_NOT_VERIFIED**. Existe una revisión desplegada con la misma fuente que el contexto local; no corresponde reconstruirla. La entrega de extremo a extremo sigue pendiente: sink apagado y trust firmado vacío.

## Capacidad y discontinuidad comprobadas

El productor existente es exclusivamente la denegación de autorización de `listUsers`: `functions/src/modules/users/list.ts` relee el perfil y pasa UID/root al wrapper de `securityObservation/authorizationDenied.ts`. El wrapper conserva el error original y tiene presupuesto externo de 1000 ms. Su puerto por defecto devuelve `DISABLED`. También `signedLoggingObservationPort` está explícitamente deshabilitado. La fábrica `createPreparedSignedLoggingWriter` existe, pero ningún handler la conecta.

El receptor independiente `services/pay0-sentinel-observation` verifica OIDC de entrega y firma del productor, deriva el evento de la tupla firmada y persiste observaciones con cuota y recibo de deduplicación en una base aislada. La política es `OBSERVE_ONLY`, autoridad `NONE`, recuperación humana. `src/trusted-producers.json` tiene cero productores; no autoriza ninguna firma. El receptor rechaza `listUsers` por la vía sin firma incluso si una allowlist heredada se amplía.

Por ello, desplegar solo el módulo Sentinel de Functions no conecta la entrega. Tampoco basta habilitar un sink o una variable de entorno. No se propone cambiar autorización, añadir restricciones ni leer payloads financieros.

## Paquete local exacto

Se reutilizó `scripts/stage-build.mjs`, que verifica los hashes del core y del contrato firmado antes de copiar la whitelist. Contexto de 22 archivos:

`services/pay0-sentinel-observation/.build/context-jUDbKp`

Inventario privado: `output/sentinel-h1/context-manifest.json`. Commit observado: `1566ca700cf1c0acf5265e4b48d7fc00f64d3f0e`; la identidad efectiva del contexto son los hashes individuales del inventario, no los cambios concurrentes ajenos a Sentinel.

- SHA256 del inventario de rutas/hash/tamaños: `1cfaba7cfe522c9cfdecc3e09f05b5dbe5eda9f558dc11b8067de86316bfc5d8`.
- SHA256 del archivo manifest: `67a4dc4a28ba0e8165334a007e7276e264ba90e9c0c88ec7cb151fe8c1068ed9`.
- No es una imagen compilada ni un digest de Artifact Registry. El contexto incluye el Dockerfile, lock, fuentes y `cloudbuild.yaml`; no incluye credenciales, `.env`, fuentes financieras ni dependencias instaladas.

Verificación focal actual: `node --test qa/scripts/remediation-sentinel-signed.test.mjs qa/scripts/remediation-sentinel-signed-receiver.test.mjs qa/scripts/remediation-sentinel-service.test.mjs`: **23/23 PASS**, cero skips. Incluye 83 comprobaciones del contrato firmado con claves efímeras, no claves de producción. Se verificaron firma, caducidad, revisión/root/actor, rechazo de downgrade, reentrega, cuota atómica y errores de persistencia. No se repitió la auditoría general ni se cambiaron dependencias.

## Siguiente entrega concreta y orden

1. **Preservar receptor H1 existente.** No reconstruir ni crear infraestructura: la comparación exacta descrita abajo acredita equivalencia de los 22 archivos fuente. Conservar revisión, digest, identidad, límites runtime, DB y configuración de entrega. El siguiente trabajo H1 es validación autorizada de IAM/runtime y entrega sintética aislada, no otro despliegue de código idéntico.
2. **Identidad del productor H2, todavía apagado.** Reutilizar el root independiente `producer-infra`, con revisión de adopción/estado. La SA propuesta ya existe deshabilitada y KMS API está habilitada. Las lecturas de clave/versiones/IAM KMS devolvieron 403: no se conoce su estado y no se debe crear otra clave ni asumir ausencia. Deben comprobarse IAM efectivo, exclusividad de la SA y lectura SDK mínima; la condición de base permite leer otras colecciones de esa base, riesgo que debe aprobarse expresamente. No ampliar permisos para superar fallos. La preparación histórica no acredita infraestructura actual.
3. **Conexión H3, otro paquete revisable.** Capturar fuente/revisión reales de `listUsers`, conservar campos publicados como `username` y sus opciones runtime. Preparar overlay mínimo que componga las fábricas existentes, con revisión exacta, una cohorte root/actores, clave pública/fingerprint/version KMS reales y ventana fija de máximo 60 minutos. El receptor necesita el trust correspondiente; el sink debe permanecer apagado hasta comprobar identidad, persistencia aislada, presupuesto/alertas, reintentos y DLQ. No inventar IDs ni generar ahora una configuración aparentemente lista para activar.

El cierre funcional requiere un ensayo autorizado de extremo a extremo: denegación original sin cambios, firma aceptada una vez, duplicado sin doble débito, observación únicamente en base aislada y ninguna operación financiera. Las pruebas locales no sustituyen ese ensayo.

## Línea base remota de solo lectura

Proyecto `pay0-sentinel-observe` activo. Cloud Run `pay0-sentinel-observer`, revisión `pay0-sentinel-observer-00006-spv`, recibe 100% del tráfico. Imagen `us-central1-docker.pkg.dev/pay0-sentinel-observe/sentinel-images/observer@sha256:c4841dab1e20e3cd125d63adc22fac15d4414db7c44f084ccad881f0f6f98549`. Runtime: SA `pay0-sentinel-observer@pay0-sentinel-observe.iam.gserviceaccount.com`, timeout 10 s, concurrencia 4, máximo una instancia, CPU 1 y memoria 256 MiB. Ingress permite la red pública, pero IAM invoker contiene únicamente la SA push; no se observó invocación pública anónima.

La DB `sentinel-observation` existe en `us-central1`, Firestore Native, con protección contra borrado. IAM versión 3 confirma el rol custom `sentinelObservationWriter` condicionado exactamente a esa DB; permisos `datastore.databases.get`, `datastore.entities.get/create/update`. La política directa de la SA runtime no tiene bindings. Esto describe permisos directos consultados, no certifica ausencia de herencia, grupos o privilegios del operador.

La subscription `pay0-security-observe-v1` entrega a `/pubsub` con SA push y audiencia configurada; DLQ conserva máximo cinco intentos y backoff 10–600 s. La SA push concede OpenIDTokenCreator al agente Pub/Sub del proyecto. El sink fuente `pay0-sentinel-observe-v1` está **disabled=true**. El runtime tiene una fila de origen legado; no se imprimieron sus identificadores. No existe override `SIGNED_TRUST_MANIFEST_JSON` y el archivo incorporado en la imagen tiene productores vacíos.

Registry y bucket de fuentes existen. Builder `pay0-sentinel-builder@pay0-sentinel-observe.iam.gserviceaccount.com` tiene Writer en ese repositorio, ObjectViewer en el bucket y LogWriter en el proyecto; la política directa de su SA está vacía. El bucket exige prevención de acceso público y acceso uniforme. No se modificaron estos permisos ni se ejecutó Cloud Build.

Cloud Build regional `140322af-4c09-40f2-a315-c0f8eeb03f1c` terminó SUCCESS y produjo el digest desplegado. Se descargó únicamente su archivo fuente privado para comparar: **22/22 archivos idénticos byte a byte, cero añadidos, ausentes o distintos** respecto al contexto H1. Archivo fuente SHA256 `243e0ff5795e01f476db9e93a6a30a60f1cf899296a8ade6e40df242765dc1cd`. No se infiere reconstrucción binaria reproducible: la equivalencia comprobada es de fuente y el digest real lo acredita Cloud Build.

Evidencia privada en `output/sentinel-h1/`:

| Archivo | SHA256 |
| --- | --- |
| `remote-baseline.json` | `f032abc12ca6c12542cb56c83811e7738d0182dd3c594bbc5b4dbdf1669554c4` |
| `remote-addendum.json` | `9033f2c5e9abfbd623713fddb5278fc8f071cdf882150e94294f96383a0a2bd7` |
| `remote-iam-v3.json` | `70bc0c87e7616dc646584d18c0eafde9fb5a5e9010713a95a2a7c478aff5bef7` |
| `service-account-iam.json` | `70a06312404d7f329b07493705615f3e666aa0303520d8e503b3e7632f60d92b` |
| `source-comparison.json` | `d0c272e9b1f5dad8e12ca5b2c42f1f9ed47e17c0b83a77d6a1b730a66e3f8649` |

Las consultas iniciales al endpoint global de Cloud Build y algunas políticas devolvieron 404; se resolvieron usando región `us-central1` y el CLI de IAM. El pseudo-rol `_withcond_` de IAM versión 1 no era un rol ausente: versión 3 recuperó la condición real. Los 403 KMS permanecen como límite explícito, no ausencia de recursos. No se consultaron documentos de observaciones ni claves privadas.

## Reversión y límites

El corte operativo es deshabilitar el sink y retirar/revocar el trust del productor; restaurar la revisión anterior del productor si se conectó. Deshabilitar KMS evita firmas nuevas, pero no invalida por sí solo firmas ya emitidas: revocar trust es independiente. No usar `enable_provisioning=false` como rollback, pues intenta retirar recursos/bindings. Retener recibos hasta su TTL evita reentregas ambiguas.

Este paquete deja lista la fuente del receptor y la secuencia exacta de integración. Sigue pendiente aprobación de infraestructura/coste/identidad y la evidencia remota indicada. No afirma que Sentinel esté activo ni que un despliegue aislado complete la capacidad.
