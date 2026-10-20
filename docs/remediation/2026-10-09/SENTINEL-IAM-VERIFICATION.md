# Verificación reproducible de IAM runtime Sentinel

Estado comunicado por coordinación central al preparar este script: existe `projects/pay0-sentinel-observe/roles/sentinelRuntimeVerifier` con únicamente `iam.serviceAccounts.getAccessToken`; el binding temporal anterior fue retirado con exit0. Un mint previo funcionó tras aproximadamente80s de propagación. Una prueba anterior devolvió400 por usar la colección reservada `__sentinel_isolation_probe__`. **El aislamiento IAM runtime remoto todavía no está demostrado.** Este lote solo produjo y probó código local; no añadió bindings ni llamó a APIs remotas.

Script: `services/pay0-sentinel-observation/scripts/verify-runtime-iam.ps1`. Es standalone PowerShell5.1 compatible y usa gcloud únicamente para identificar la cuenta activa y capturar en memoria su access token. Rechaza impersonación configurada, overrides de credenciales/token y cuenta activa de servicio: espera al operador usuario actual. No crea/importa keys, habilita APIs, crea roles, usa TokenCreator amplio o cambia IAM de proyecto.

Modo predeterminado, sin gcloud ni red:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File services/pay0-sentinel-observation/scripts/verify-runtime-iam.ps1
```

Ejecución remota **pendiente de revisión central; no ejecutada por este agente**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File services/pay0-sentinel-observation/scripts/verify-runtime-iam.ps1 -Execute
```

## Contrato de ejecución

1. Lee el rol existente y exige exactamente el permiso mínimo. Policy de la SA `pay0-sentinel-observer@pay0-sentinel-observe.iam.gserviceaccount.com` se obtiene en versión3 y se conserva con etag.
2. Añade sobre esa SA un binding para el operador activo, rol exacto y condición temporal única `request.time < timestamp(...)` con expiración20min desde creación. Preserva otros miembros, grants, condiciones y campos. Confirma la policy releída antes de mint. Reintentos de policy releen etag; no sustituyen la policy por una copia antigua.
3. REST IAM Credentials `projects/-/serviceAccounts/...:generateAccessToken`, scope cloud-platform y `lifetime:600s`, con `x-goog-user-project:pay-0-system`. Máximo7 intentos,20s entre intentos de fallos compatibles con propagación/transitoriedad;403 sostenido no lleva a ampliar roles. El plazo por petición HTTP es20s. ExpireTime debe ser compatible con600s y tener al menos30s remanentes.
4. Con el token **runtime**, hace GET sobre rutas aleatorias `sentinelIsolationProbes/{GUID}`. Probes no envían quota-project financiero: un rechazo por serviceusage.services.use no debe confundirse con aislamiento. No lee cuerpos, ni siquiera si el servidor respondiera200 inesperadamente.

| Probe | Esperado |
|---|---:|
| Firestore pay-0-system/(default), documento sintético |403|
| Firestore pay0-sentinel-observe/(default), documento sintético |403|
| Firestore pay0-sentinel-observe/sentinel-observation, documento sintético |404|
| Storage bucket financiero pay-0-system.firebasestorage.app, objeto sintético |403|
| BeginTransaction named DB, readWrite sin operaciones |200|
| Rollback named DB |200|

El bucket está corroborado en `src/lib/firebaseClient.ts` y `BASELINE.md`. No hay set/update/create/delete/commit de Firestore ni carga/lectura de objetos reales. Begin+Rollback comprueba acceso real a esa DB; un404 aislado podría deberse a recurso ausente y no sería suficiente por sí solo. Los403 describen la operación denegada bajo esa identidad en ese momento; no certifican exhaustivamente ausencia de todos los permisos posibles, IAM heredado ni rutas futuras.

5. `finally` intenta Rollback si recibió una transacción válida y, independientemente de su resultado, retira solo miembro+rol+condición exactos de esta ejecución. Relee y comprueba ausencia; detecta también membresía con mismo título pero expresión cambiada concurrentemente. Si falla cleanup, emite CLEANUP_UNVERIFIED y exit1, aunque probes hayan pasado. No borra grants ajenos para producir un verde. La expiración20min limita el grant ante interrupción abrupta; no sustituye retirada verificada. Retirar el binding **no revoca el token ya emitido**: conserva su expiración600s. Tokens y transacción se mantienen solo en memoria y se descartan, sin promesa de borrado físico de memoria del proceso.

## Registro y recuperación

Solo códigos de etapa/enums/HTTPstatus van a consola y a `%TEMP%/pay0-sentinel-iam-verification-<GUID>.log`, creado únicamente con -Execute y fuera del repositorio. No transcript, bodies, policy, email del operador, IDs de documentos, token, cabeceras ni errores de proveedor. Un fallo de log no impide cleanup. No imprimir variables internas ni ejecutar con tracing/transcripción sensible añadida externamente.

Exit0 exige matriz completa y retirada comprobada. Exit1 significa NOT_VERIFIED; inspeccionar el último estado redaccionado y, si aparece CLEANUP_UNVERIFIED, revisar policy de la SA para rol/member/condición temporal de esta ejecución antes de repetir. No eliminar todo el rol ni todos los grants con prefijo similar. La terminación forzada del proceso puede impedir finally; el vencimiento del grant es la salvaguarda residual y la revisión central sigue siendo necesaria.

## Validación local realizada

`powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-runtime-iam.test.ps1`: **10 casos PASS, sin llamadas remotas**. Parser PowerShell PASS; transporte HTTP real con HttpMessageHandler .NET fake comprueba headers/status/lectura selectiva; fakes completos comprueban éxito tras4 esperas simuladas, add ambiguo,7 mints fallidos, rollback fallido, cleanup no confirmado, rechazo de rol más amplio, conservación de miembros/condiciones ajenos y merge sin bindings duplicados. Las esperas son simuladas, no se durmió20s ni se mintió token real. El modo default fue ejecutado y reportó DRY_RUN_NO_REMOTE_CALLS/NOT_VERIFIED.

Las líneas403/404/200 de esta prueba local son fixtures, **no resultados de producción**. Ejecución remota del script y verificación IAM efectiva permanecen pendientes.

Referencias primarias: [generateAccessToken y wildcard obligatorio](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken), [getIamPolicy](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/getIamPolicy), [BeginTransaction](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/beginTransaction).

## Ejecución remota central 2026-10-09

El script se ejecutó después de revisión central y de repetir las diez pruebas locales. Token runtime emitido HTTP200 tras propagación; Firestore financiero403, Storage financiero403, DB named documento sintético404 y Begin/Rollback200. Default aislada respondió404 en vez de403: resultado general NOT_VERIFIED/exit1, sin reinterpretar404 como denegación. Se investiga existencia de esa DB y una prueba negativa independiente. Binding temporal retirado y ausencia verificada (REMOVED_VERIFIED); no se crearon documentos ni se leyeron cuerpos de probes.
