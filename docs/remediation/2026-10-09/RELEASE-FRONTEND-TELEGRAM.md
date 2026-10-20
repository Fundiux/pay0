# Preflight frontend Hosting y transporte Telegram

Fecha: 2026-10-09. Revision de integracion `c6a1c6b`, merge que incluye `15ee8c4`. Trabajo limitado a lectura, pruebas sinteticas y este informe. Sin deploy, cambios de codigo, mensajes Telegram ni mutaciones remotas. Los comandos de publicacion siguientes son un plan para integracion, no operaciones ejecutadas.

## Decision y dependencias

Orden corregido tras comparar artefacto real: **telegramWebhook LEGACY_BRIDGE -> drenar emisor antiguo -> telegramDownloadAction dual -> Hosting -> telegramWebhook POST_FRAGMENT**. El consumidor HTTP es `telegramDownloadAction`, exportado desde `functions/src/modules/telegram/actionTokens.ts`. El productor es `telegramWebhook`, exportado desde `functions/src/modules/telegram/webhook.ts`: unico caller de `createTelegramActionToken`, en `/docprueba`. No existe un deploy independiente de `createTelegramActionToken`. Desplegar solo el consumidor no cambia el emisor empaquetado en webhook.

| Componente | Candidato / contrato | Evidencia disponible |
| --- | --- | --- |
| Puente autenticado | `streamPrivateDocument`, POST IDtoken, chunks 8 MiB, maximo 32 MiB, generation/autoridad actual | Desplegado `00001-cig`, ACTIVE/Ready/401; RELEASE-DOCUMENT-BACKEND.md |
| Restriccion propia | `getMyRestrictionStatus`; UI trustedRestrictionV1, sin writer | Desplegado `00001-hay`, ACTIVE/Ready/401; frontend aun pendiente |
| Consumidor Telegram | `telegramDownloadAction`: POST JSON capability y GET legacy acotado | Remoto consultado: ACTIVE `telegramdownloadaction-00014-lot`, trafico latest, actualizado 2026-09-21T04:46:59.759292105Z; metadata no demuestra contrato nuevo |
| Hosting | site `pay-0-system`, fuente `.`, frameworksBackend us-central1 | Publica pagina exacta `/descarga/documento` y consumidores del puente; no es publicacion aislada de una sola pagina |
| Emisor Telegram | `telegramWebhook`: tokens v2, URL web.app con fragmento, TTL <=15 min | Remoto consultado: ACTIVE `telegramwebhook-00031-yeg`, trafico latest, actualizado 2026-09-21T04:46:46.192492280Z; candidato pendiente |

Las dos consultas remotas solo proyectaron nombre, estado, revision, timestamp y trafico; no se imprimieron variables, tokens, correos ni bindings secretos. El consumidor candidato no declara secretos. El webhook declara TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y PAY0_WEB_CONTROL_CODE: conservar referencias/versiones autorizadas, nunca imprimir valores ni rotarlas en este lote.

## Revision de codigo y dependencias

Node 22, Next 15.5.27, React 18, Firebase SDK 12 y Functions SDK 7 segun manifests integrados. No se reinstalaron dependencias. package.json tiene dos entradas iguales esbuild=0.28.2: redundancia preexistente, no divergencia de version demostrada ni razon para cambiar lockfiles durante este rollout.

`RootClientShell` permite solo `/descarga/documento` como ruta publica; vecinas conservan autenticacion. La pagina borra el fragmento antes de render/fetch, no incorpora analytics y envia POST body con credentials omit/no-store/no-referrer. Su endpoint es fijo us-central1/pay-0-system/telegramDownloadAction; el origen admitido es exactamente `https://pay-0-system.web.app`. Los enlaces nuevos usan ese dominio: no probar capacidades en previews, firebaseapp.com o dominios distintos esperando CORS exitoso. App Check excluye esta ruta publica; no activar enforcement ni canary App Check como parte de Hosting.

La pagina Telegram usa capability temporal y blob local; es un flujo distinto del puente IDtoken de usuarios autenticados. El puente ahora abastece wrappers/uploads/entityDocuments/assets y recuperacion UI consulta el callable propio. Ambos endpoints nuevos ya estan desplegados. No publicar writers, reglas ni todas las Functions para obtener estas dependencias.

Hosting usa integracion de frameworks, no `output: export`: la CLI puede generar/actualizar backend de framework incluso al publicar Hosting. Revisar nombres exactos y rewrites generados en el artefacto privado antes de aceptar su alcance; no inventar un nombre de servicio SSR. [Firebase: Next.js con Hosting](https://firebase.google.com/docs/hosting/frameworks/nextjs).

## Gates y bloqueadores concretos

1. **Consumidor remoto todavia no acreditado como dual:** su revision es anterior al lote. Antes del emisor nuevo, publicar consumidor y verificar POST/CORS. Hosting puede contener la pagina sin enlaces emitidos, pero no marcar Telegram operativo hasta verificar consumidor y pagina juntos.
2. **Incompatibilidad confirmada y transicion implementada localmente:** el productor desplegado carece de generation. Sus tokens vigentes reciben 403 del nuevo consumidor, aun con GET/TTL validos. Publicar primero el emisor LEGACY_BRIDGE y drenar los anteriores como se detalla abajo. Nunca asignar generation retrospectivamente ni relajar su verificacion. Este punto afecta la transicion Telegram, no los documentos canonicos del puente.
3. **HEAD final y artefacto Hosting:** repetir build/gates en la revision finalmente publicada y conservar version Hosting anterior mas backend/rewrite asociado. Los builds anteriores de 47 paginas no certifican automaticamente este HEAD ni el adaptador generado. Revisar que el bundle no apunte a emuladores y que las 7 variables de build esten validadas sin mostrar valores.
4. **Prueba de navegador aun pendiente:** los tests locales usan React/DOM/fetch falsos. Antes de publicar el emisor, verificar hidratacion real, borrado del fragmento, ruta exacta, vecinas protegidas y ausencia de captura global de location. El test de descarga con contenido debe ser sintetico/aislado, no `/docprueba` productivo.
5. **Logging GET transitorio:** DOWNLOAD-TRANSPORT.md documenta posible bearer en request logs y propuesta de mitigacion. No se verificaron aqui sinks agregados ni captura externa. No afirmar eliminacion total de exposicion mientras siga GET; ninguna exclusion sustituye POST ni elimina historia ya registrada. Si el gate existente exige exclusion transitoria, revisarla en su alcance preciso antes del consumidor; no conceder IAM amplio ni borrar logs.

Los 4 uploads entityId-only sin padre canonico son defectos preexistentes: el resolver previo tambien los rechaza. No son regresion nueva ni razon para conceder fallback. Inventario del root0: 1357 uploads y 13 entityDocuments con padre/objeto <=32 MiB; 1446 uploads recorridos, 23 entidades, 0 assets. No es evidencia de otros roots/URLs historicas/permisos de todo actor. Mantener defectos visibles y transporte anterior disponible; no retirar direct reads, tokens ni reglas en este lote. Evidencia: DOCUMENT-INVENTORY.md y LEGACY-DOCUMENT-COMPATIBILITY.md.

## Comandos de verificacion local

Desde `.worktrees/pay0-remediation-integration-20261009`, secuenciales; reservar ventana de builds/emuladores con integracion:

```powershell
node --test qa/scripts/remediation-telegram-token.test.cjs qa/scripts/remediation-download-page.test.cjs
node scripts/verify-authorization-policy.mjs
node qa/scripts/verify-frontend-build-env.mjs
npm run qa:document-ui
node qa/scripts/remediation-private-download.test.cjs
node qa/scripts/remediation-private-download-ui.test.cjs
node qa/scripts/remediation-restriction-ui.test.cjs
node qa/scripts/remediation-restriction-ui-wiring.test.cjs
npm --prefix functions run build
npm run qa:functions-discovery
npm run qa:document-access
npm run build
```

Detener al primer exit !=0. `qa:document-access` fija demo-pay0-document-access y emuladores loopback; no sustituir por pay-0-system. Los predeploy Functions incluyen otros gates: inspeccionarlos antes de cada ejecucion, no omitirlos para acelerar. No usar `npm run firebase:deploy` (publica reglas/indexes), ni `npm --prefix functions run deploy` (todas Functions), ni qa:pay0 como sustituto.

Preflight inicial en c6a1c6b: **14/14** tests Telegram/pagina PASS, policy verifier PASS, frontend build env **7/7** PASS. Lote posterior de transicion en fuente: **20/20** pruebas (16 backend +4 pagina) y policy verifier PASS. No se repitieron builds globales ni emuladores para evitar colision con integracion; quedan como gates de publicacion.

## Orden de publicacion propuesto (no ejecutado)

1. Registrar revision/fuentes previas del consumidor y webhook, version live de Hosting y backend/rewrite generado; guardar artefactos en espacio privado ignorado. Verificar permisos/secret bindings por conteos y nombres permitidos, no valores.
2. Preparar las tres variables SERVER del webhook en configuracion privada revisada (ninguna NEXT_PUBLIC):
   - `TELEGRAM_DOWNLOAD_TRANSPORT_MODE=LEGACY_BRIDGE`
   - `TELEGRAM_DOWNLOAD_LEGACY_STARTED_AT` con instante UTC exacto `YYYY-MM-DDTHH:mm:ss.sssZ`.
   - `TELEGRAM_DOWNLOAD_LEGACY_DEADLINE` con instante UTC posterior, como maximo 60 minutos despues del inicio.

No fijar ventana antes de completar builds: consumirla durante compilacion puede impedir el rollout. Fechas malformadas, futuras al inicio, ventana demasiado larga o vencida fallan cerrado; el deadline no cambia al reiniciar. Debe revisarse el mecanismo de inyeccion Firebase de estos valores sin sobreescribir otros env/secrets. Este lote no configura valores remotos.

Publicar **solo telegramWebhook en modo puente**. El codigo emite generation validada desde metadata, v1 y GET compatibles con el consumidor viejo. Confirmar revision nueva Ready/trafico 100% y ausencia de rutas/tags hacia el productor antiguo. Esperar 15 minutos desde la ultima emision antigua posible, incluyendo solicitudes en vuelo. El webhook tiene timeout 60 s: si solo se conoce el instante de corte de trafico, reservar al menos ese minuto adicional antes de empezar los 15 min; no asumir que el corte termina requests ya aceptados. Verificar ausencia de otras revisiones emisoras; no consultar bodies/tokens de logs. La prueba sintetica reproducible acredita campos, no observa la ultima emision productiva.

```powershell
firebase deploy --project pay-0-system --only functions:telegramWebhook --non-interactive
```

Con drenaje confirmado y ventana puente aun vigente, desplegar **solo consumidor**:

```powershell
firebase deploy --project pay-0-system --only functions:telegramDownloadAction --non-interactive
```

3. Postflight sin capability: metadata Ready/trafico y OPTIONS de origen permitido 204, origen ajeno 403, POST `{}` permitido 400 antes de acceso a token/Storage. Estos controles no prueban descarga completa. Ejemplo sin secreto ni cuerpo impreso:

```powershell
curl.exe -s -o NUL -w '%{http_code}' -X OPTIONS 'https://us-central1-pay-0-system.cloudfunctions.net/telegramDownloadAction' -H 'Origin: https://pay-0-system.web.app' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
curl.exe -s -o NUL -w '%{http_code}' -X OPTIONS 'https://us-central1-pay-0-system.cloudfunctions.net/telegramDownloadAction' -H 'Origin: https://invalid.example' -H 'Access-Control-Request-Method: POST'
curl.exe -s -o NUL -w '%{http_code}' -X POST 'https://us-central1-pay-0-system.cloudfunctions.net/telegramDownloadAction' -H 'Origin: https://pay-0-system.web.app' -H 'Content-Type: application/json' --data '{}'
```

No token en query, shell, historial, screenshot o logs. No ejecutar GET con capability real como smoke. No llamar webhook ni comandos Telegram reales.

4. Publicar Hosting con su wrapper de entorno validado y predeploy propios:

```powershell
npm run firebase:deploy:hosting
```

Registrar release/version y cualquier backend framework actualizado. Verificar pagina publica sin fragmento (error generico, sin autenticacion requerida); pruebas de navegador con fragmento ficticio solo contra fetch interceptado, sin enviarlo al backend real. Verificar login y rutas existentes con mocks/lecturas autorizadas sin operaciones financieras; guard trustedRestriction y descargas completas se prueban en fixtures aislados.
5. Solo con Hosting/consumer acreditados, retirar las variables puente o configurar explicitamente `TELEGRAM_DOWNLOAD_TRANSPORT_MODE=POST_FRAGMENT` (default seguro), y publicar **solo emisor final**:

```powershell
firebase deploy --project pay-0-system --only functions:telegramWebhook --non-interactive
```

No cambia registro externo del webhook ni ejecuta sendMessage. Verificar revision Ready y secretos declarados sin valores. Prueba de URL v2/emision en harness falso; `/docprueba` productivo manda Telegram y crea token, no es un postflight inocuo.
6. Registrar hora del ultimo emisor puente GET, esperar sus 15 minutos completos o su deadline anterior sin extender TTL. Si quedan emisores viejos vivos, la ventana no ha terminado. Retirar GET en lote separado con evidencia; la llegada de URLs viejas puede seguir dejando query en request logs incluso si se rechaza la descarga.

## Recuperacion

- Antes del emisor v2: ante fallo del consumidor, detener secuencia; no publicar productor. Restaurar solo revision compatible previamente verificada, conservando guardas de objeto/autoridad. Mantener UI actual si aun no cambio.
- Despues de Hosting, antes de emisor: restaurar release Hosting previo si corresponde y verificar backend framework/rewrite asociado. Mantener bridge y restrictionStatus publicados, pues restaurar frontend no exige retirarlos. Firebase conserva historial de releases/versiones para rollback; no asumir que ese rollback revierte cada servicio backend independiente. [Firebase: releases y versiones](https://firebase.google.com/docs/hosting/manage-hosting-resources).
- Despues de emisor v2: preservar pagina `/descarga/documento` y consumidor POST durante toda vigencia de capabilities. No volver al productor GET ni retirar pagina para resolver un fallo ajeno. Corregir hacia adelante o restaurar un bundle ya compatible con la pagina; si solo existe bundle previo sin pagina, primero contener especificamente la nueva emision mediante un cambio revisado y dejar expirar capabilities antes de ese rollback. No apagar indiscriminadamente todo webhook por una falla de descarga.
- No borrar tokens, documentos o evidencia; no alterar datos financieros. La descarga ya entregada no se puede revocar retroactivamente.

Este plan no cierra S03/S06/S10 ni la remediacion integral. Mantener pausas REP/syncToday y rollout independiente de Sentinel.


## Comparacion historica y evidencia de transicion

Se consulto metadata de `telegramWebhook-00031-yeg` y se descargo por GET la generacion exacta **1789965994022008**, sin exponer token ni origen privado. ZIP SHA256 `250f7ab8072e11c58fd6fb864b5a117b94cef38e28deb5861ec578103696c220`. Solo se extrajeron actionTokens.ts y webhook.ts; no .env. Hash original actionTokens.ts: `dc62dc7779379e1092ca994937abc5b1591577d2e573a6470409e801f9371335`; webhook.ts: `46f957f23a0dba1916611b7a9cb88347763436481dc490838468984c09a07e4c`.

El emisor historico guarda createdAt servidor y expiresAt; `/docprueba` fija 15 minutos. El helper generico antiguo no limita el maximo, pero ese es su unico caller observado. No guarda storageGeneration, attempts ni transportVersion. Su consumidor GET lee status/actionType/expiresAt/storagePath, obtiene metadata y transmite el objeto por path; ignora campos nuevos. Por tanto acepta tokens puente con generation y v1, pero **el consumidor antiguo sigue sin fijar generation ni revalidar autoridad**: esos controles de lectura llegan al desplegar el dual. Esta ventana no se presenta como remediacion completa ni ampliacion de la seguridad del lector anterior.

El nuevo emisor bridge mantiene validacion actual de actor/root/documento/delegacion, Auth y metadata. Guarda generation al emitir, v1, inicio/deadline durables y `expiresAt=min(now+TTL,deadline)`; comprueba ventana antes de lecturas y de nuevo tras metadata. El default final sigue v2 y fragmento. V2 nunca admite GET. V1 GET exige ventana durable valida, TTL original <=15 min y deadline vigente. No hay backfill, renovacion de tokens anteriores ni cambio automatico a v2 cuando vence bridge.

Fixture historico normalizado solo en EOL, mas cabecera de procedencia: `qa/scripts/fixtures/remediation-telegram-legacy-actionTokens.ts.fixture`; no entra al compilador de aplicacion. Tests ejecutan funciones reales transpiladas con SDK/Storage/Auth falsos: emisor viejo -> consumer nuevo **403**, bridge -> consumer viejo **200**, bridge -> consumer dual **200**; v2 GET **410**. Tambien prueban ventana invalida/vencida, no extension por reinicio, cambio tras metadata y generacion ausente sin migracion implicita. Ningun token o dato productivo se incorpora al fixture.

Si la ventana vence antes de completar el rollout, falla solo la emision de la capability en este camino; no pasar a POST sin pagina ni extender fechas automaticamente. Detener, revisar estado efectivo y programar otra ventana explicita si corresponde. Preservar el consumidor viejo hasta completar drenaje, y luego no restaurarlo para aceptar enlaces inseguros.

Validacion final del lote puente: `npm --prefix functions run build` PASS, 20/20 pruebas sinteticas, policy verifier y diff check PASS. No cambio frontend ni build frontend adicional en este lote; integracion repetira los gates del candidato final antes de Hosting.

## Preflight Hosting y entorno, solo lectura (2026-10-09)

Consulta REST acotada a tres releases y metadata de version/backend, posterior al merge de integracion `fec3f8b`. No se publico Hosting ni Functions, ni se modificaron archivos dotenv. El primer GET sin proyecto de cuota devolvio 403; con `x-goog-user-project: pay-0-system` la lectura fue satisfactoria. Credencial gcloud capturada exclusivamente en memoria, sin ADC persistente ni token en URL/salida.

| Release live | Version FINALIZED | Hora UTC |
| --- | --- | --- |
| 1791573963658000 | a664c1d18ee7c39a | 2026-10-09T19:26:03.658Z |
| 1791535911430000 | c4404dcc2a714e61 | 2026-10-09T08:51:51.430Z |
| 1791504821072000 | 9271d35e5ceb98fa | 2026-10-09T00:13:41.072Z |

El rewrite vigente `**` apunta a Cloud Run `ssrpay0system`, region `us-central1`, tag `fh-a664c1d18ee7c39a`. Ese tag corresponde a revision `ssrpay0system-00586-xeg`, 100% de trafico; la Function asociada figura ACTIVE. La version se creo a las 19:21:44.273534Z y finalizo a las 19:26:03.950964Z. Son lecturas secuenciales, no una fotografia atomica; repetir metadata minima antes de publicar si hubo otra release.

Artefacto fuente exacto del backend conservado localmente en `.firebase/hosting-preflight/ssrpay0system-00586-xeg-source.zip` (directorio ignorado verificado), generacion `1791573723377224`, 84,421,954 bytes, SHA256 `ea0a79c43e0d974e38d9cb481b90246990f81bd850051d145a9dc811753a6a0a`. No se extrajo ningun archivo. Tratar el ZIP como privado porque puede contener configuracion empaquetada; nunca incorporarlo a Git. Es respaldo de fuente SSR, no exportacion completa de archivos Hosting ni imagen ejecutable independiente. La API publica de archivos lista metadata; no se uso como si ofreciera un ZIP integral. Conservar version y tag/revision actuales durante rollout; la recuperacion sigue dependiendo de retencion y compatibilidad del backend, no solo del ZIP. [API files.list](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions.files/list), [gestion de releases](https://firebase.google.com/docs/hosting/manage-hosting-resources).

### Inyeccion de las tres variables servidor: procedimiento pendiente, no ejecutado

Inspeccion del CLI instalado: `functions/env.js` carga `.env`, luego `.env.pay-0-system` (o alias, no coexistir ambos); los ultimos valores prevalecen. `deploy/functions/prepare.js` construye `environmentVariables` desde ese mapa y variables Firebase. Solo conserva variables remotas anteriores automaticamente cuando **no** se uso dotenv. La integracion tiene `functions/.env.pay-0-system`; se verifico el nombre, sin imprimir contenido. Establecer las tres variables solamente en el proceso PowerShell no acredita su persistencia en Functions.

1. Desde la worktree de integracion, resolver el dotenv efectivo y comprobar en memoria que no hay alias conflictivo ni claves duplicadas del puente. Obtener solo para comparacion en memoria el mapa de entorno remoto de `telegramWebhook`; contrastar las claves no gestionadas automaticamente con el mapa dotenv efectivo. Emitir exclusivamente conteos y booleanos de igualdad, nunca valores, hashes de valores individuales ni errores con contenido dotenv. Si falta o difiere una clave ajena al puente, detener y reconciliarla antes de cualquier deploy; no eliminarla implicitamente. Revisar secretos declarados separadamente, sin leer valores ni trasladarlos a dotenv.
2. Una vez terminados los gates y justo antes del deploy puente, respaldar bytes originales y SHA256 del archivo en directorio privado ignorado. Cambiar exclusivamente `TELEGRAM_DOWNLOAD_TRANSPORT_MODE`, `TELEGRAM_DOWNLOAD_LEGACY_STARTED_AT` y `TELEGRAM_DOWNLOAD_LEGACY_DEADLINE`; preservar byte a byte lineas ajenas. Si no existian, anexarlas con separacion de linea valida. Rechazar sintaxis ambigua/duplicados en vez de reformatear todo el archivo. Fechas UTC exactas, ventana <=60 minutos, fijadas una sola vez; no renovarlas al reintentar. Parsear resultado en memoria y comprobar igualdad de todas las claves restantes y contrato temporal antes de reemplazo atomico local.
3. Desplegar exclusivamente `functions:telegramWebhook` en el orden ya descrito, con DEBUG ausente y sin `--debug`. Mantener los mismos instantes durante el drenaje y despliegue del consumidor. No lanzar despliegue general de Functions: el dotenv es comun al source, aunque el selector acota la actualizacion.
4. Tras acreditar Hosting y consumidor, preparar la misma sustitucion acotada con modo explicito `POST_FRAGMENT` y retirar solo los dos timestamps. Publicar exclusivamente el webhook final; verificar modo efectivo y ausencia de timestamps mediante booleanos en memoria. Mantener archivo local coherente con el estado final confirmado, preservando todas las otras claves. Si se aborta una fase, restaurar bytes locales originales con verificacion de hash, pero recordar que restaurar archivo local **no** revierte una revision remota ya publicada; registrar el modo remoto efectivo antes de cualquier recuperacion.

El wrapper `run-with-frontend-build-env.mjs` resuelve `PAY0_BUILD_ENV_FILE` o `.env.local` y despues superpone el entorno de proceso, valida las siete variables publicas requeridas y ejecuta Hosting. No usarlo para inyectar las tres variables servidor ni convertirlas en `NEXT_PUBLIC_*`. Tampoco limpia DEBUG por si mismo: retirarlo del proceso antes de ejecutar el wrapper y restaurar el estado previo al terminar. `run-firebase-clean-env.mjs` si lo retira para sus hijos, pero no sustituye la validacion del wrapper frontend. `firebase.json` usa `hosting.source` y `frameworksBackend`, por lo que `--only hosting` puede construir/actualizar SSR; root conserva responsabilidad de builds/gates y revision del plan efectivo.

Este preflight no prueba login, descarga real, compatibilidad del nuevo bundle ni recuperacion ejecutada. No se enviaron mensajes Telegram, no se leyeron documentos productivos y no se aplicaron cambios remotos.

## Ejecucion iniciada a las 21:29 UTC

El candidato integrado `9616055` ya publico exclusivamente el emisor puente. `telegramwebhook-00032-yud` figura ACTIVE, actualizado a las 21:45:52.949115927Z; consulta posterior a las 21:47:22 UTC confirma Ready y 100% del trafico, sin tags de la revision anterior. Los tres controles remotos coinciden con la ventana fija 21:29:52.042Z–22:29:52.042Z y modo LEGACY_BRIDGE. POST vacio sin credenciales devuelve 401; no se enviaron comandos ni mensajes Telegram. Predeploy completo PASS; log privado ignorado en la worktree de integracion.

El primer cambio local de dotenv termino despues del reemplazo pero antes de finalizar su journal; no hubo deploy en ese intento. Se verificaron hashes y se reconcilio el estado sin cambiar bytes ni renovar fechas. La correccion adicional `4ff7818` permite recuperar el journal PREPARED solo cuando coinciden archivo destino y respaldo; tiene 20 pruebas. No se atribuye una causa de filesystem que no fue demostrada.

Orden operativo actualizado: **emisor puente → Hosting durante drenaje → consumidor dual despues de drenaje → emisor final**. Hosting comenzo despues de terminar el deploy del emisor y comparte frontend ya probado; no hay emision v2 mientras sigue LEGACY_BRIDGE. Este orden reduce la ventana sin hacer depender enlaces GET antiguos de la nueva pagina. No declarar Hosting publicado hasta verificar release/rewrite/revision efectivos.

El timeout HTTP de 60 segundos no demuestra terminacion del codigo antiguo: Cloud Run puede continuar ejecutandolo despues de responder 504. La revision `telegramwebhook-00031-yeg` reporta Active=False/Retired y Ready=True/Retired desde 21:45:52.322896Z, observado de nuevo a las 21:48 UTC. La documentacion oficial define RETIRED como infraestructura retirada, distinto de RETIRING. Se conserva espera adicional hasta **22:04:51 UTC**, mas reconsulta de trafico/retirement y resumen acotado de expiraciones antiguas. Las metricas antiguas no devolvieron series entre 20:00 y 21:48; eso **no** se interpreta como cero instancias. [Timeout Cloud Run](https://docs.cloud.google.com/run/docs/configuring/request-timeout), [revision retirada](https://docs.cloud.google.com/run/docs/managing/revisions).

Este hito no acredita todavia consumidor, Hosting ni emisor final. La ventana no se renueva automaticamente y el consumidor anterior permanece hasta satisfacer el gate.

## Hosting y consumidor verificados; emisor final en curso (22:30 UTC)

- Gate drenaje revalidado a las 22:13 UTC: revision antigua Retired, nueva 100% sin tags anteriores; consulta completa de createdAt>=21:20 devolvio cero documentos. TTL15min y unico caller historico constatados en fuente preservada. La consulta no cubre registros sin createdAt ni se presenta sola como prueba global.
- Hosting publicado a las 22:24:52.603Z: release `1791584692603000`, version FINALIZED `de6ff585fd68735d`, rewrite `fh-de6ff585fd68735d` hacia `ssrpay0system-00588-guh`, ACTIVE/Ready/100%. Fuente generation `1791584454126203`; Cloud Build `23ec7084-02a6-411d-b995-2efe46e84d40` SUCCESS. La etiqueta anterior `fh-a664c1d18ee7c39a` sigue apuntando a `00586-xeg`; se conserva para recuperacion compatible.
- Smoke publico con harness `59e96f5` PASS: seis grupos, 3 POST sinteticos interceptados, 136 lecturas remotas (128 assets), cero POST reales, tres solicitudes same-origin bloqueadas por politica, sin service workers y navegador cerrado. Acredita la pagina publica y su transporte simulado; no una descarga autentica de documento productivo ni login con usuario real.
- Consumidor `telegramdownloadaction-00015-lap` ACTIVE desde 22:28:11.460139737Z; Ready/100% verificado. OPTIONS origen permitido204, ajeno403 y POST vacio400. Deploy selectivo CLI exit0 y predeploy PASS. El primer comando npx fallo antes de Firebase por resolucion del ejecutable; reintento con firebase.cmd instalado, sin repetir una mutacion ya efectuada.
- Solo tras ambos gates se aplico dotenv final con helper `4ff7818`: POST_FRAGMENT, timestamps retirados, claves ajenas preservadas. Hash anterior `82af969ec8e25f00c117c067b15f0f8bbdce52732cfd3f67eec0c95b0bc7c255`, nuevo `572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856`; estado FINAL_APPLIED conserva ventana original como tombstone. Emisor final en sesion89352, log privado `final-producer-deploy.log`, candidato9616055 sin cambios tracked.
- La ventana vencio **22:29:52.042Z** antes de terminar el emisor final. El codigo puente falla cerrado para nuevas emisiones en ese intervalo; no se extendio ventana ni se enviaron comandos Telegram para probarlo. Registrar fin del intervalo solo cuando la revision final este Ready y con trafico efectivo. No declarar todavia finalizado S03.

## Emisor final publicado y verificado (22:39 UTC)

`telegramwebhook-00033-dav` ACTIVE, updateTime22:38:08.063533223Z, source generation1791585367914722. Modo remoto POST_FRAGMENT y ambos timestamps legacy ausentes. Conserva exactamente los tres bindings declarados TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y PAY0_WEB_CONTROL_CODE; no se leyeron sus valores. Cloud Run Ready desde22:38:04.567970Z; a las **22:39:27.9702131Z** se confirmaron100% de trafico, ausencia de tags alternos y POST vacio401. CLI exit0/predeployPASS.

El intervalo conservador de emision puente cerrada queda registrado desde22:29:52.042Z hasta la comprobacion22:39:27.9702131Z; la revision final ya figuraba ACTIVE a las22:38:08. No se extendieron fechas ni se enviaron mensajes para medir ese intervalo. El tombstone local FINAL_APPLIED permanece para impedir renovaciones accidentales. Se completo la transicion de transporte del lote; no supone cierre global de S06/S10 ni prueba con destinatario real.

Candidato publicado: integracion9616055; helper local de entorno4ff7818 y harness publico59e96f5 usados como herramientas independientes, sin atribuirles cambios al bundle. Hosting/consumidor/emisor final cuentan con version efectiva y postflight seguro, y los casos positivos de emision/descarga siguen acreditados por fixtures aislados. Despues de v2, preservar pagina y consumidor POST: no restaurar productor/consumidor GET inseguros ni retirar la pagina para recuperar otro fallo.
