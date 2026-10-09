# Descarga Telegram sin bearer en URL HTTP

Estado: transporte preparado localmente, sin deploy ni cambios Logging. El consumidor identificado es webhook.ts /docprueba, que usa action.url en su botón. El enlace nuevo apunta a https://pay-0-system.web.app/descarga/documento#token=...; el fragmento no se envía como parte de la petición HTTP. Token permanece capability: no requiere sesión UI, pero servidor revalida identidad/perfil/root/entidad/documento/grant y generation antes del stream.

## Fuente e infraestructura

Cloud Logging define httpRequest.requestUrl como esquema, host, path y query: https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest . Cloud Run emite request logs separados de los logs de aplicación: https://docs.cloud.google.com/run/docs/logging . Exclusiones se aplican tras recibir entradas en Logging API: https://docs.cloud.google.com/logging/docs/routing/overview . Por tanto sanear logger.error no evita query en request log, y exclusión sola no elimina exposición de URL a navegador, proxies o rutas agregadas.

Metadata consultada únicamente con gcloud logging sinks list y proyección name/destination/disabled/includeChildren/exclusions.name/exclusions.disabled: sinks proyecto _Required y _Default, sin exclusiones listadas. No se consultaron entradas, requestUrl reales ni tokens. No acredita inventario de sinks agregados organización/folder ni política de captura de cuerpos externos.

## Contrato y transición

Nuevos records llevan transportVersion:2 y URL con fragmento. Handler acepta POST application/json {token} con body estricto, sin parámetros query, CORS origen concreto del app, sin cookies, sin bearer en mensajes/logs; GET nunca acepta tokens v2. OPTIONS solo habilita POST/Content-Type, y expone Content-Disposition para filename. El blob se descarga mediante URL local y se revoca después; token no se representa en DOM ni persistencia. Página elimina fragmento con history.replaceState antes de render e interacción. No hay analytics detectados en root layout/shell/imports revisados; cualquier futura instrumentación global debe respetar esta exclusión antes de capturar location.

GET de transición solo admite records anteriores sin transportVersion con createdAt servidor válido, caducidad original no mayor a createdAt+15min, y nunca más de15min desde emisión. No renueva ni reemite legacy. Records anteriores a la corrección sin generation segura continúan rechazados por política de objeto. Compatibilidad legacy no equivale a validar tokens antiguos inseguros.

Orden de publicación revisable:

1. Revisar destinos Logging agregados y captura externa. Si se conserva GET temporal, aprobar exclusión precisa para request logs de ese endpoint en todos los destinos aplicables. Nunca borrar evidencia histórica automáticamente.
2. Publicar primero SOLO telegramDownloadAction dual POST+GET legacy. Mantener webhook emisor antiguo durante este paso. Validar POST con capability sint?tica aislada y CORS; ning?n enlace nuevo depende a?n de Hosting.
3. Publicar Hosting con p?gina p?blica exacta /descarga/documento; revisar rutas adyacentes y descarga POST. Despu?s publicar webhook emisor nuevo. createTelegramActionToken est? empaquetado dentro de webhook: publicar solo el handler no cambia el emisor. No desplegar ambas Functions indiscriminadamente antes de Hosting; registrar revisi?n exacta de cada paso.
4. Registrar hora de retirada del último emisor legacy, esperar15min completos sin renovarlo y comprobar con tokens sintéticos aislados el contrato POST. No se realizó esta espera productiva ni se desplegó nada durante este lote.
5. Lote posterior retira GET definitivamente. Excluir o sanear requests con query token sigue siendo necesario para tráfico antiguo/malicioso: devolver405/410 no impide que plataforma registre la URL entrante. Nunca volver al emisor GET como rollback; mantener página y POST o restaurar revisión compatible.

Filtro temporal propuesto para _Default (NO aplicado):

```text
resource.type="cloud_run_revision"
resource.labels.service_name="telegramdownloadaction"
logName="projects/pay-0-system/logs/run.googleapis.com%2Frequests"
httpRequest.requestMethod="GET"
httpRequest.requestUrl=~"/telegramDownloadAction[?].*token="
```

Validar service_name y forma de ruta con metadata de Function/revisión y petición sintética sin secreto antes de aplicar; dominio run.app puede usar path raíz, lo cual requiere ajustar filtro de ruta sin ampliar a otros servicios. Excluir solo logs con query token en este servicio deja disponibles logs estructurados sanitizados, métricas y errores. _Required no es destino ordinario de request logs. Una exclusión _Default no modifica sinks organizacionales ni evita la recepción inicial en Logging; por eso es mitigación transitoria y no reemplaza POST.

## Verificación local

Suite backend remediation-telegram-token.test.cjs:10 PASS, con leases/reintentos/revocación, POST/CORS/OPTIONS, body/content-type malformados, v2 GET rechazado, nueva URL sin query y TTL legacy no extensible. Suite frontend:4 PASS; ejecuta m?dulo/funci?n render y handlers con hooks/DOM/fetch controlados (no navegador real), verifica borrado temprano, POST body/blob, errores sin token y clasificación pública exacta. Builds y publicación se coordinan con integración central. Sin llamadas Telegram, Storage, IQ ni descargas productivas.
