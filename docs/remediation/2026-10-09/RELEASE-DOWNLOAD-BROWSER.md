# Smoke de navegador real: descarga documental Telegram

Fecha: 2026-10-09. Estado: **PASS** contra integracion `a13ebb5`, que incluye `d08acda`, build Next `hb3MxkGq6c0DUxMisofKC` (47 paginas, build PASS comunicado por integracion). No autoriza Hosting ni Telegram por si solo.

## Alcance y aislamiento

Runner: `qa/scripts/remediation-download-browser-smoke.mjs`. Usa Chromium headless instalado y `next start` contra `.next/BUILD_ID` existente; no usa dev ni recompila. Servidor ligado a 127.0.0.1 en puerto libre. Contexto de navegador nuevo, sin sesiones ni secretos; service workers bloqueados. Todas las solicitudes externas se interceptan antes de red: el endpoint fijo recibe un PDF sintetico local y cualquier otro destino externo se aborta. Sin archivos productivos, mensajes Telegram ni cambios de datos remotos.

No se imprimen fragmentos, cuerpos, URLs de requests, tokens, errores crudos, trazas, screenshots ni salida del servidor. El runner solo informa nombres de checks y contadores. Los fragmentos son ficticios. El cierre verifica navegador desconectado y puerto del servidor liberado; no termina procesos ajenos.

## Hallazgo durante preflight

En build integrado `7b56c4c` (Next 47 paginas), entrada valida paso: borrado de fragmento, POST body sin query/referrer/cookies, blob local y PDF con bytes esperados. Entrada invalida desde documento nuevo mostro texto generico y no envio POST; tres rutas adyacentes redirigieron a login sin cuenta. Navegador y servidor cerrados.

La primera prueba al cambiar solamente el hash dentro del mismo documento fallo: la pagina conservaba estado anterior y no borraba el fragmento nuevo. Separar el escenario de entrada inicial permitio diagnosticarlo, pero no se acepto como sustituto de corregir hashchange.

## Correccion revisada

Commit `d08acda`: listener hashchange captura y borra el fragmento; un contador invalida respuestas anteriores y AbortController cancela su fetch. Se comprueba vigencia tras fetch y blob; una respuesta obsoleta no crea descarga ni cambia estado. Se ignoran eventos de hash superados; listener se reinstala correctamente en StrictMode y el unmount cancela peticiones pendientes. No cambia clasificacion publica de rutas.

Pruebas unitarias: 8 de pagina y 16 de transporte, **24/24 PASS**, mas verificador de politica PASS. Incluyen respuesta que ignora abort, token nuevo durante lectura de blob, fragmento invalido durante fetch y limpieza StrictMode/unmount.

## Comando reproducible

Desde fuente principal, con integracion ya construida:

```powershell
node qa/scripts/remediation-download-browser-smoke.mjs .worktrees/pay0-remediation-integration-20261009
```

El argumento tambien admite otra ruta local de candidato construido. La prueba no descarga navegadores ni acepta una URL remota de servidor.

## Criterios del smoke ampliado

1. Entrada valida: fragmento borrado antes del fetch; POST JSON correcto sin query, Authorization, cookies ni Referer; opciones no-referrer/no-store/omit; blob, nombre y bytes del PDF sintetico.
2. Reentrada de hash en el mismo documento: segundo token genera segunda descarga correcta sin remount; mantiene los controles de transporte.
3. Fragmento invalido durante POST retenido: hash borrado, signal abortado, mensaje generico y ninguna descarga o estado tardio al liberar respuesta.
4. Entrada invalida desde documento nuevo: mensaje generico, sin boton ni nueva llamada.
5. `/descarga/documento/otro`, `/descarga/documento-falso` y `/descarga`: redireccion a `/login`, sin pagina de descarga publica.

Esto acredita navegador/hidratacion/transporte cliente bajo interceptacion. No acredita IAM/CORS remoto, entrega Telegram, tokens reales ni autorizacion documental productiva. Estos gates y el drenaje del emisor legacy permanecen en RELEASE-FRONTEND-TELEGRAM.md.


## Resultado final del navegador corregido

Chromium headless real, `next start` loopback sobre el build anterior. Cinco grupos completos PASS:

- `valid_fragment_post_blob_download`
- `same_document_hash_reentry`
- `invalid_hash_aborts_pending_no_stale_download`
- `invalid_fragment_generic_no_fetch`
- `three_adjoining_routes_require_login`

Contadores: **3 POST sinteticos interceptados**, 0 solicitudes externas adicionales observadas/bloqueadas y **0 solicitudes remotas permitidas**. Dos transferencias generan descarga de bytes PDF sinteticos correctos; la tercera se mantiene pendiente y se aborta al introducir fragmento invalido, sin descarga tardia. El origen remoto fijo es simulado con CORS local; no se afirma postflight productivo.

Limpieza confirmada por el runner: `browserClosed=true`, `serverClosed=true`; puerto local liberado. Contexto/downloads temporales cerrados; salida del servidor drenada sin imprimirse. No se publicaron builds ni se incorporaron `.next`, sesiones o artefactos de navegador al commit.

Comprobaciones finales: 24/24 unitarias de pagina/transporte, policy verifier, build integrado de 47 paginas y smoke real ampliado PASS. La secuencia y drenaje de Telegram siguen siendo gates independientes; no desplegar consumidor dual antes del emisor puente y expiracion del ultimo token antiguo posible.
