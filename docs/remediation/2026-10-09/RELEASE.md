# Publicación y recuperación

Primer lote publicado: logUnauthorizedRouteAttempt desde integración 6b8d2f7e35cb, rama remota integration/pay0-remediation-20261009. Main remoto sin cambios. Estado efectivo y recuperación en HANDOFF.md; las filas siguientes conservan detalle del candidato inicial, no son cierre global.

## Candidatos locales

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

## Segundo lote preparado: incidencias y OCR

Candidato integrado ed86559 (FI-01 raíz obligatoria y FI-02 solicitud transaccional) sobre merge68799eb; frontend47 páginas y Functions PASS antes de FI-02, predeploy obligatorio recompila FI-02. Pruebas de raíz, carrera, replay, política, linaje, IQ24casos y Telegram/AppCheck18 PASS. No se publicará todo el backend.

Componentes exactos: resolveClientDispersionIncident, requestClientDispersionIncident, parsePagoReceiptPdf, correctPagoReceiptSemanticField. Preflight remoto: todos ACTIVE, único env custom PAY0_FIREBASE_WEB_API_KEY, sin bindings secretos. Las capacidades productivas de OCR/corrección se recuperaron previamente; ambos usan el mismo ZIP SHA256329B31F7F23C0B87556A38034CC5AE6E0F9E64F8B5A2D0D51EC6CD8EDA723A98. Incidencias usan ZIP previo C50F0D7A95BB24CAF156022AE1145503D34F2110F9C39DF71921EE52A190DB1F. Archivos completos preservados en TEMP privado.

Preversiones: resolve revision00022-wum/generation1790583779087600; request revision00022-rom/generation1790583779318022; parse revision00012-fab/generation1790843385213011; correct revision00001-zod/generation1790843316135075. Diff real financing: únicamente helper de delegación vigente y correcciones FI-01/FI-02, sin pérdida de capacidades productivas. Rollback ordinario reintroduciría fallo de raíz o carrera: preferir corrección hacia adelante o contención focal. Sin pruebas de mutación real de incidencias ni OCR de documentos productivos; postflight no autenticado y metadata primero, simulaciones/emuladores para efectos.
