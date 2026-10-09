# Preflight frontend Hosting y transporte Telegram

Fecha: 2026-10-09. Revision de integracion `c6a1c6b`, merge que incluye `15ee8c4`. Trabajo limitado a lectura, pruebas sinteticas y este informe. Sin deploy, cambios de codigo, mensajes Telegram ni mutaciones remotas. Los comandos de publicacion siguientes son un plan para integracion, no operaciones ejecutadas.

## Decision y dependencias

Orden: **telegramDownloadAction -> Hosting -> telegramWebhook**. El consumidor HTTP es `telegramDownloadAction`, exportado desde `functions/src/modules/telegram/actionTokens.ts`. El productor es `telegramWebhook`, exportado desde `functions/src/modules/telegram/webhook.ts`: unico caller de `createTelegramActionToken`, en `/docprueba`. No existe un deploy independiente de `createTelegramActionToken`. Desplegar solo el consumidor no cambia el emisor empaquetado en webhook.

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
2. **Compatibilidad de capabilities ya emitidas:** GET dual no admite cualquier record viejo. Exige generation, ACTIVE, TTL original <=15 min, createdAt valido y sin transportVersion. Capturar fuente previa autorizada y contrastar campos de emision sin leer tokens reales. Si el productor viejo carece de generation, no anunciar continuidad de sus enlaces: definir una ventana controlada de retirada de emision y expiracion o un emisor transitorio compatible. Nunca relajar generation ni reemitir tokens inseguros para aparentar compatibilidad. Este punto afecta la transicion Telegram, no los documentos canonicos del puente.
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

Ejecutado ahora en c6a1c6b: **14/14** tests Telegram/pagina PASS, policy verifier PASS, frontend build env **7/7** PASS. No se repitieron builds globales ni emuladores para evitar colision con integracion; quedan como gates de publicacion.

## Orden de publicacion propuesto (no ejecutado)

1. Registrar revision/fuentes previas del consumidor y webhook, version live de Hosting y backend/rewrite generado; guardar artefactos en espacio privado ignorado. Verificar permisos/secret bindings por conteos y nombres permitidos, no valores.
2. Tras gates y decision de compatibilidad legacy, desplegar **solo consumidor**:

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
5. Solo con Hosting/consumer acreditados, publicar **solo emisor**:

```powershell
firebase deploy --project pay-0-system --only functions:telegramWebhook --non-interactive
```

No cambia registro externo del webhook ni ejecuta sendMessage. Verificar revision Ready y secretos declarados sin valores. Prueba de URL v2/emision en harness falso; `/docprueba` productivo manda Telegram y crea token, no es un postflight inocuo.
6. Registrar hora del ultimo emisor legacy, esperar sus 15 minutos completos sin extender TTL. Si quedan emisores viejos vivos, la ventana no ha terminado. Retirar GET en lote separado con evidencia; la llegada de URLs viejas puede seguir dejando query en request logs incluso si se rechaza la descarga.

## Recuperacion

- Antes del emisor v2: ante fallo del consumidor, detener secuencia; no publicar productor. Restaurar solo revision compatible previamente verificada, conservando guardas de objeto/autoridad. Mantener UI actual si aun no cambio.
- Despues de Hosting, antes de emisor: restaurar release Hosting previo si corresponde y verificar backend framework/rewrite asociado. Mantener bridge y restrictionStatus publicados, pues restaurar frontend no exige retirarlos. Firebase conserva historial de releases/versiones para rollback; no asumir que ese rollback revierte cada servicio backend independiente. [Firebase: releases y versiones](https://firebase.google.com/docs/hosting/manage-hosting-resources).
- Despues de emisor v2: preservar pagina `/descarga/documento` y consumidor POST durante toda vigencia de capabilities. No volver al productor GET ni retirar pagina para resolver un fallo ajeno. Corregir hacia adelante o restaurar un bundle ya compatible con la pagina; si solo existe bundle previo sin pagina, primero contener especificamente la nueva emision mediante un cambio revisado y dejar expirar capabilities antes de ese rollback. No apagar indiscriminadamente todo webhook por una falla de descarga.
- No borrar tokens, documentos o evidencia; no alterar datos financieros. La descarga ya entregada no se puede revocar retroactivamente.

Este plan no cierra S03/S06/S10 ni la remediacion integral. Mantener pausas REP/syncToday y rollout independiente de Sentinel.
