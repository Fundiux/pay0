# Verificación del runtime canario DISABLED

Estado: script implementado y probado localmente; **no se ejecutó `-Execute`**. La revisión central debe crear/revisar el rol mínimo y autorizar la ventana sin despliegues concurrentes antes de los dos bindings temporales. El script no crea roles, no activa CANARY, no modifica el servicio, no publica y no escribe documentos.

## Proxy y evidencia previa

La ejecución central reportó POST anónimo 403 y token del operador 401, con audiencia de OAuth del SDK, no del servicio. La documentación permite usar proxy con credenciales del usuario; no evita IAM ni demuestra la identidad de la SA. [Autenticación de desarrolladores](https://docs.cloud.google.com/run/docs/authenticating/developers), [comando proxy](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/proxy).

El SDK instalado confirma que `lib/surface/run/services/proxy.py::_GetFreshIdToken()` devuelve `config_helper.Credential(store.LoadFreshCredential()).id_token`. No adapta la audiencia al servicio. Por ello se descarta como puente para resolver este caso y para probar las denegaciones de la SA; no se inició un proxy.

Lecturas REST v2 independientes, sin cambios IAM ni invocación, verificaron URI `https://pay0-security-canary-o4tesftjlq-uc.a.run.app`, latestReady/Created con nombre completo de `pay0-security-canary-00001-fmm`, tráfico 100% con revisión **corta**, SA canario esperada y modo DISABLED. Se corrigió el preflight a ese contrato real. Allowlist exacta incluye también `https://pay0-security-canary-751158244178.us-central1.run.app`; ninguna URL suministrada libremente por el operador.

## Contrato de ejecución propuesto

Archivo: `services/pay0-sentinel-observation/scripts/verify-canary-runtime.ps1`. Sin flags produce `DRY_RUN_NO_REMOTE_CALLS`. `-LibraryOnly` define funciones sin red. `-Execute` queda para revisión central.

1. Rechaza overrides de credenciales/impersonación. Toma la cuenta de usuario activa y su access token en memoria. Requiere servicio y revisión fija DISABLED, IAM habilitado y tráfico 100% sin rollout.
2. Requiere rol preexistente `projects/pay-0-system/roles/canaryRuntimeVerifier` con **exactamente** `iam.serviceAccounts.getAccessToken` y `iam.serviceAccounts.getOpenIdToken`, sin signBlob, actAs u otros permisos.
3. Añade binding condicional con vencimiento a veinte minutos: usuario actual → ese rol, **solamente** sobre `pay0-observation-canary@pay-0-system.iam.gserviceaccount.com`. Añade otro: esa SA → `roles/run.invoker`, **solamente** sobre el servicio canario. No añade roles a nivel proyecto.
4. Get/SetIamPolicy usa versión 3 y etag, conserva los otros bindings y confirma cada alta. El método Run getIamPolicy es GET con `options.requestedPolicyVersion=3`; el método SA usa POST. [Run getIamPolicy](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/getIamPolicy), [Run setIamPolicy](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/setIamPolicy).
5. Mint de access token con `lifetime=600s` y scope cloud-platform. Mint de ID token con audience igual a la URI validada e includeEmail. Cada mint permite como máximo siete intentos, separados por veinte segundos, ante respuestas transitorias/propagación. Tokens nunca se imprimen, escriben ni pasan como argumentos de procesos.
6. Revalida metadata DISABLED/revisión/tráfico antes de cada POST vacío. Espera **503 y código PUBLISHER_DISABLED**; 503 genérico no sirve. Reintenta solamente 403 de propagación de invoker, hasta siete intentos. No reintenta una aceptación ni un error de aplicación.
7. Access token de la SA: GET de rutas aleatorias inexistentes `sentinelIsolationProbes/{GUID}` en Firestore financiero, DB nombrada del observador y Storage financiero. Los tres deben devolver 403; 404/200/401 no pasan. Sin cuota en estas peticiones para evitar confundir una denegación de `serviceusage.services.use` con aislamiento. Nunca lee los cuerpos, incluso ante 200 inesperado.
8. `finally` retira primero invoker y luego el binding sobre SA, aunque un alta haya tenido respuesta ambigua o falle cualquier prueba. Elimina exactamente miembro/rol/condición creados y conserva cambios ajenos. Relee ambas policies y falla si queda nuestro título/miembro incluso con expresión modificada concurrentemente. No certifica cleanup solo por la respuesta de SetIamPolicy.

La mutación de policies no es una transacción conjunta: un fallo intermedio activa la limpieza de todos los intentos. Matar el proceso o perder conectividad puede impedir el finally; las condiciones limitan entonces el grant temporal a veinte minutos. Los logs locales en TEMP contienen únicamente enums/status. No guardar transcripciones HTTP ni cuerpos de respuesta.

## Vida de tokens y límites

`generateIdToken` no acepta lifetime: el ID token de SA dura aproximadamente una hora. Retirar el binding de mint **no revoca un token ya emitido**. El access token permanece utilizable hasta su caducidad de diez minutos; el ID token conserva su validez criptográfica hasta una hora, aunque el permiso de invocación retirado deja de autorizarlo cuando propaga IAM. No se guarda ninguno. [API generateIdToken](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken), [tipos de token](https://docs.cloud.google.com/docs/authentication/token-types).

La decodificación local de claims verifica audiencia, email, issuer y expiración como comprobación estructural; Cloud Run verifica la firma. La metadata y el POST no son atómicos: mantener la ventana sin cambios de tráfico/revisión evita que otro despliegue cambie modo entre ambas operaciones. Un preflight fallido evita todo POST, pero no reemplaza esa coordinación.

## Verificación local

`powershell -NoProfile -File qa/scripts/remediation-canary-runtime.test.ps1`: **20 casos PASS**, transporte falso, sin red. Incluye adapter HTTP real sobre handler simulado, lectura del código DISABLED503, no lectura de cuerpos financieros, allowlist de host, dos URLs reales y URL maliciosa, tráfico/revisión cambiados, rol amplio, modo activo, audiencia inválida, propagación acotada, alta ambigua, fallo del segundo binding, fallo de cleanup, 503 incorrecto y 404 inconcluso. Comprueba además conservar un miembro concurrente y no certificar retirada si cambia la condición con nuestro título.

Dry-run PASS. Preflight real **solo GET**: `DISABLED_PINNED_VERIFIED`. Aún no hay evidencia de POST autenticado ni de denegaciones usando token de la SA canario; no deben presentarse los fakes como prueba de producción.

## Ejecución central remota

2026-10-09: verificador revisado y20fakes repetidosPASS; rol exacto creado mediante planTerraform deunrecurso sinbindings permanentes. Execute devolvió CANARY_RUNTIME:PASS. ACCESS/ID mint200 tras propagación; POST autenticado503/PUBLISHER_DISABLED; GETs sintéticos Firestore financiero403, DBnamedaislada403 yStoragefinanciero403. RUN_BINDING y SA_BINDING retirados con ausencia verificada. Ninguna observación emitida, ningún documento/archivo leído o escrito. Identidad de invocación propia confirma que el401 del token de operador con audienciaOAuth ajena no era fallo del publisher.

Los roles de verificadores observer/canary quedan declarados en infra/verification.tf; rolobserver existente importado al estado. Ninguno se asigna a nivel proyecto. Conservan solamente permisos de mint requeridos y no autorizan su uso sinbinding explícito temporal.
