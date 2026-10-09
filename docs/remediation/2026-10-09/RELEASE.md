# Publicación y recuperación

Primer lote publicado: logUnauthorizedRouteAttempt desde integración 6b8d2f7e35cb, rama remota integration/pay0-remediation-20261009. Main remoto sin cambios. Estado efectivo y recuperación en HANDOFF.md; las filas siguientes conservan detalle del candidato inicial, no son cierre global.

## Candidatos locales

Esta tabla conserva el candidato inicial. Para estado posterior a las 20:00 UTC, prevalece la actualizacion al final; en particular, el orden Telegram vigente exige emisor puente y drenaje antes del consumidor dual, Hosting y emisor final.

| Lote | Commit fuente | Verificación | Publicación |
|---|---|---|---|
| Reportes sin contención | 31a9f05 | 4 pruebas y build PASS | Publicado revision00012-zal; HTTP401 PASS; limpieza de binding de secreto pendiente |
| Materialidad QA | 6507598 | Contrato ejecutable PASS | Herramienta local |
| Delegaciones/reglas | 6859938 | 243 aserciones emuladas; build PASS | Revalidar integrado antes de reglas/callables afectados |
| OCR y memoria por root | a43658b | 11 pruebas PASS | parsePagoReceiptPdf y correctPagoReceiptSemanticField |
| Telegram | 6a894d0 | 6 pruebas PASS | Orden: consumidor compatible, Hosting de página, productor; ventana legacy 15 min |
| Dependencias | d66555b | Audit cero; builds y smokes PASS; npm ci limpio PASS | Se publica con lotes pertinentes |
| Resultado IQ incierto | 36270fb | 17 escenarios emulador PASS | Entradas de depósito afectadas, sin ejecutar depósitos de prueba reales |
| Integridad documental | b49db84 | 8 pruebas y build PASS | init/finalizeEntityDocumentUpload preservando continuidad CSF |
| Sentinel núcleo | 6f3f931 | 10 pruebas PASS | Sin export; servicio aislado pendiente |
| Inventario | 1de4d85 | 3 pruebas PASS | Snapshot estático; regenerar al congelar integrado |

## Artefactos previos preservados

- Reglas en %TEMP%/pay0-remediation-20261009-rules/. Firestore ruleset042bafab-3487-418e-8245-2416e19d1963, SHA256 E46B418E151684F983703A86B1FF6DD1C096FAF113929086F5F45397681E125D. Storage rulesetd37e96b3-5266-4a44-8ce6-c903a502a854.
- logUnauthorizedRouteAttempt revision00011-zev, generation1790583721294236, ZIP SHA256c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f; fuente activityLog idéntica a HEAD inicial.
- parsePagoReceiptPdf revision00012-fab, generation1790843385213011, ZIP SHA256329b31f7f23c0b87556a38034cc5ae6e0f9e64f8b5a2d0d51ec6cd8eda723a98; capacidades publicadas recuperadas antes del nuevo límite.
- telegramDownloadAction revision00014-lot, generation1789965997517317, ZIP SHA256250f7ab8072e11c58fd6fb864b5a117b94cef38e28deb5861ec578103696c220. telegramWebhook revision00031-yeg, generation1789965994022008 identificada; revalidar productor exacto.
- ZIP locales en %TEMP%/pay0-remediation-20261009-sources/. Solo fuentes seleccionadas extraídas; no .env ni secretos incorporados.

## Procedimiento por lote

1. Congelar commit integrado y ejecutar comprobaciones aplicables.
2. Reconsultar revisión/source generation y comparar dependencias con producción.
3. Registrar componentes exactos, configuración y recuperación. Mantener pausas REP/syncTodayIqInvoicesNow y no desplegar globalmente.
4. Publicar por el flujo Git permitido; GitHub main consultado: protected=false, sin reglas devueltas, SHA remoto7dfcd8a.
5. Desplegar componentes concretos, comprobar revisión efectiva y postflight seguro.
6. Un fallo bloquea solo ese lote. Si rollback reintroduce vulnerabilidad, priorizar contención compatible o corrección hacia adelante. Nunca repetir un efecto externo incierto.

## Estado confirmado posterior a las 20:00 UTC

- Backend documental y consulta de estado propio publicados desde `d4298e09fe66`: `streamPrivateDocument` revision `streamprivatedocument-00001-cig` (20:17:52.478459991Z) y `getMyRestrictionStatus` revision `getmyrestrictionstatus-00001-hay` (20:18:07.522711461Z). Ambos ACTIVE/Ready, trafico 100%, rechazo no autenticado HTTP401 PASS. No se publicaron reglas, Hosting ni writers por ese lote. Detalle: [RELEASE-DOCUMENT-BACKEND.md](RELEASE-DOCUMENT-BACKEND.md).
- Inventario secuencial del root seleccionado: 1,446 uploads, 1,361 elegibles, 1,357 con padre canonico y objeto real <=32 MiB, 85 inactivos. Los cuatro casos entityId-only quedaron diagnosticados con padre SOLICITUD ausente, prefijo coincidente y procedencia no verificada; no existe base para reparacion automatica ni para inventar padres. Siete tamanos registrados desconocidos son una dimension adicional, no registros a sumar. Entidades: 23 documentos, 13 activos validos y 10 inactivos; assets: cero. No constituye snapshot atomico ni cobertura de todos los roots. Detalle: [DOCUMENT-INVENTORY.md](DOCUMENT-INVENTORY.md) y [LEGACY-DOCUMENT-COMPATIBILITY.md](LEGACY-DOCUMENT-COMPATIBILITY.md).
- Sentinel E2E sintetico y deduplicacion PASS tras corregir aliases Pub/Sub: observer `00005-dgr`, dos HTTP200, RECORDED=1/DUPLICATE=1, receipt/incidente HTTP200, eventCount=1, authority=NONE y TTL valido. Ventana cerrada: canary `00006-6wv` Ready/DISABLED y sink apagado. Esto acredita el canario y su replay, no cobertura de productores financieros ni contencion. El intento inicial fallido se conserva en [SENTINEL-ROLLOUT.md](SENTINEL-ROLLOUT.md).
- Integracion publicada a su rama remota en `3fa5957`; cambio frontend posterior `d08acda` con build en progreso al registrar este hito. Estado temporal: `pendingFrontendHashFix/browser`. No atribuir a ese candidato un build final ni browser PASS hasta recibir evidencia. No hubo deploy Hosting ni Telegram de este lote y no se declara completada la remediacion.

Preflight offline del ZIP SSR productivo frente a integracion `7b56c4c`: 56 rutas app existentes conservadas y 57 en candidato, unica adicion `/descarga/documento`; rutas estaticas 44->45 y dinamicas 12->12. Configuracion de rutas equivalente; Next.js 15.5.25->15.5.27, Node22 en ambos. Sin metadata suficiente para atribuir commit fuente productivo. No se detecto perdida de rutas, pero esta comparacion no prueba equivalencia funcional completa ni sustituye los gates del frontend posterior. Preflight Telegram comunicado por integracion: ocho modulos comparados, iguales salvo `actionTokens`; no implica despliegue ni ejercicio de Telegram real. Orden, entorno y recuperacion en [RELEASE-FRONTEND-TELEGRAM.md](RELEASE-FRONTEND-TELEGRAM.md).
