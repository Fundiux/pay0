# Revisión independiente e inventario: evidencia local del 9 de octubre de 2026

## Alcance y procedencia

Se leyó íntegramente `C:/Users/ebarr/.codex/.chatgpt-projects/g-p-69fba34a72408191b274bbb88d38802e/review-security-sentinel-2026-10-07/analisis-independiente.html` (SHA-256 `C6E9ADC7FE0D97374666D7FC45C2BD9D909A8028CEA3AF1F1491330EF2BDD642`). Sus seis secciones cubren alcance, inventarios, S-01–S-10, R-01–R-10, plan y valoración de los 24 informes. No se confunde su registro de lectura con una nueva lectura íntegra de los 24 informes por este revisor.

Se contrastaron los CSV locales `docs/audits/pay0-security-sentinel-2026-10-07/ATTACK-SURFACE.csv` y `AUTOMATIONS.csv`, las definiciones indicadas a continuación y sus consumidores. HEAD observado: `1f694607dcc94b1af557249f7334af7cd22a8afb`. El expediente declara otro baseline: `d206a6c812218dd83ebfe0a45dc8e365c62e6a1f`. Las líneas de este documento corresponden al árbol local inspeccionado; no se atribuyen automáticamente al baseline histórico ni a producción. Había archivos no seguidos ajenos a esta revisión. No se modificó código ni se consultó producción.

Dictamen: la revisión independiente sostiene remediación y reproducción aislada antes de respuesta automática Sentinel. No certifica explotación, ausencia de controles ni seguridad productiva. S-10 tiene prioridad junto con S-01/S-02; conectar directamente el backend al `securityLock` originado por reportes cliente puede convertir ruido falsificable en denegación efectiva. La preservación forense y recuperación mínima deben comenzar antes de Sentinel. S-03 exige separar redacción del bearer del contrato de reintentos. S-06 y S-07 requieren aceptación propia, incluidos límites de parsers y aceptación externa seguida de timeout.

## R-02/R-03: clasificación y configuración por definición

La lectura estructurada de los CSV confirma 406 filas: 236 callables, 4 HTTP, 18 triggers Firestore, 14 schedulers, 4 Tasks, 20 exports sin resolver, 54 páginas, 45 declaraciones Firestore y 11 Storage. `AUTOMATIONS.csv` contiene 36 filas. Son conteos del expediente, no un censo actualizado completo del runtime.

Los 20 exports indirectos están resueltos en `functions/src/modules/controlCenter/automation.ts:27`: `dirtyTrigger(path,module)` retorna `onDocumentWritten` con `document:path`, `region:us-central1`, `memory:512MiB`, `retry:true`. No tienen horario. Cada fila debe conservar su ID `AS-FN-<nombre>` y agregarse a AUTOMATIONS como trigger, con anclas separadas para export, instancia y fábrica.

| Export | Documento observado | Módulo | Línea de automation.ts |
|---|---|---|---:|
| queueControlCenterSolicitud | solicitudes/{documentId} | solicitudes | 36 |
| queueControlCenterPago | pagos/{documentId} | pagos | 37 |
| queueControlCenterFacturama | facturamaInvoices/{documentId} | facturama | 38 |
| queueControlCenterMateriality | materialityOperations/{documentId} | materialidad | 39 |
| queueControlCenterDispersion | clientDispersions/{documentId} | wallet | 40 |
| queueControlCenterHugo | agent007Recommendations/{documentId} | hugo | 41 |
| queueControlCenterApplications | pagoAplicaciones/{documentId} | pagos | 42 |
| queueControlCenterBalances | balanceAccounts/{documentId} | wallet | 43 |
| queueControlCenterMovements | balanceMovements/{documentId} | wallet | 44 |
| queueControlCenterAdvances | clientAdvances/{documentId} | wallet | 45 |
| queueControlCenterLearning | agent007LearnedRules/{documentId} | hugo | 46 |
| queueControlCenterRecovery | operationRecoveryJobs/{documentId} | recuperacion | 47 |
| queueControlCenterExpenses | recognizedExpenses/{documentId} | gastos | 48 |
| queueControlCenterIqInvoice | iqInvoiceJobs/{documentId} | iq | 49 |
| queueControlCenterIqCreate | iqCreateJobs/{documentId} | iq | 50 |
| queueControlCenterIqStatus | iqStatusJobs/{documentId} | iq | 51 |
| queueControlCenterIqReceipt | iqPagoReceiptJobs/{documentId} | iq | 52 |
| queueControlCenterIqDeposit | iqPagoDepositStatusJobs/{documentId} | iq | 53 |
| queueControlCenterWhatsapp | documentDeliveryJobs/{documentId} | whatsapp | 54 |
| queueControlCenterTelegram | telegramClientNotificationEvents/{documentId} | telegram | 55 |

Exportación pública local: `functions/src/index.ts:2845`, `:2846` y `:2848`. Reclasificar estas veinte filas históricas deja 38 triggers y 56 automatizaciones dentro de ese conjunto; no prueba que el código actual solo tenga 56 automatizaciones.

La fábrica llama `projectSource` y `markControlCenterDirty`; inventariar únicamente colecciones literales del archivo omite los efectos transitivos. `automation.ts:13` escribe `controlCenterDirtyRoots/{rootId}`; `projections.ts:81` lee origen y `analyticsContributions`, puede leer una solicitud padre (`:92`), y escribe contribuciones, `analyticsEvents`, y subcolecciones `facets`, `buckets`, `revisions`, `incidents` de `analyticsRoots`. Hay transacción y comparación de firma (`:113`), lo cual es evidencia de un mecanismo local de deduplicación, no certificación de todas las carreras. `automation.ts:57` consume raíces sucias y llama `buildControlCenterSnapshot`; `:82` programa esa reconciliación cada 15 minutos. Debe conservarse ese grafo causal.

| Función | Evidencia actual | Corrección de inventario |
|---|---|---|
| enqueueAutomaticPaymentComplement | `functions/src/modules/paymentApplications/complementAutomation.ts:480` | onDocumentWritten, pagoAplicaciones/{applicationId}, retry true; horario NO_APLICA |
| executeAutomaticPaymentComplement | mismo archivo `:498` | onDocumentWritten, paymentComplementJobs/{jobId}, retry true; horario NO_APLICA |
| checkPaymentComplementsDaily | mismo archivo `:553` | onSchedule, `0 19 * * 1-5`, America/Mexico_City, retryCount 0 |
| processIqPagoDepositAutomaticTask | `functions/src/modules/iq/pagoDepositCallables.ts:3746` | onTaskDispatched; horario NO_APLICA; retryConfig maxAttempts 3, minBackoffSeconds 300, maxBackoffSeconds 900, maxRetrySeconds 1800; maxConcurrentDispatches 1, maxDispatchesPerSecond 1 |
| processIqPagoDepositCreateQueue | mismo archivo `:3774` | scheduler vecino con `every 1 minutes`; no transferirlo a la Task |

El CSV inspeccionado ya sitúa la Task de depósito en pagoDepositCallables.ts:3746. No confundirla con `processIqCreateOnDemandTask`, definida en `functions/src/modules/iq/solicitudCreateQueueCallables.ts:1264`; las menciones antiguas a ese archivo requieren identificar primero el símbolo exacto. R-10 es una advertencia sobre anclas, no prueba de que todas las referencias antiguas pertenezcan a la Task de depósito.

Otras anclas R-10 resueltas: `preparePagoFinancialPosting` es callable en `functions/src/index.ts:2667`, importa el core en `:17` y llama `functions/src/modules/deposits/context.ts:307`. `diagnosePagoFinancialContext` es callable en index.ts:2746, importa en :21 y su core se define en `functions/src/modules/deposits/diagnose.ts:68`. No usar la primera aparición del nombre como definición.

## R-05/R-06: rutas canónicas, métodos e identidad estable

Las coincidencias de nombres observadas son subcolecciones distintas. Prefijo Firestore completo: `/databases/{database}/documents`.

| Ruta relativa completa | Match en firestore.rules | Métodos declarados |
|---|---:|---|
| /users/{uid}/costos/{costId} | 263 | read :264; write :265 |
| /despachos/{docId}/costos/{costId} | 276 | read :277; write :282 |
| /clients/{docId}/costos/{costId} | 312 | read :313; write false :324 |
| /solicitudes/{docId}/notas/{notaId} | 351 | read :352; create :359; update,delete :366 |
| /pagos/{pagoId}/notas/{notaId} | 379 | read :380; create,update,delete false :387 |
| /clientDispersions/{docId}/notas/{notaId} | 610 | read :611; create,update,delete false :620 |

Esta resolución elimina la ambigüedad de esas seis rutas; no certifica todas sus condiciones. Conservar condiciones completas y las múltiples concesiones de una misma ruta/método (ejemplo `pagoAplicaciones`, read en :391 y :412). El catch-all de :672 debe permanecer como cláusula independiente. En Storage incluir el prefijo `/b/{bucket}/o`, rutas actuales :501/:519/:537 y legacy :621/:626/:631, junto con los comodines de :636/:640.

Propuesta de IDs: clave de superficie `servicio|ruta_canónica|método_normalizado`; ID de cláusula separado y estable con nombre semántico mantenido en un registro. Expandir read/write para comparaciones sin perder el método original. Conservar `legacy_id`, ancla, hash de condición, hash de fuente y commit como metadatos; no construir el ID con la línea ni con el hash mutable de la condición. Si cambian nombres de comodines, aplicar normalización por posición para evitar cambios artificiales de identidad. Múltiples cláusulas no se sobrescriben por compartir ruta/método.

## Contrato propuesto para reparar el extractor

1. Resolver exports, imports, alias y fábricas mediante AST TypeScript; recorrer argumentos de la definición exacta y resolver constantes usadas. Conservar `UNKNOWN` con motivo cuando no se pueda resolver estáticamente; prohibir ventanas de texto vecinas.
2. Separar schedule/timeZone, retry de Firestore, retryCount/retryConfig de Scheduler y retryConfig/rateLimits de Tasks. Distinguir `NO_APLICA`, `NO_DECLARADO`, `LITERAL` y `REFERENCIA_RESUELTA`; no inferir defaults desplegados.
3. Extraer reglas con pila de bloques y parser consciente de strings, comentarios y comodines. Una expresión regular aislada que cuente llaves también puede confundir `{docId}` con delimitadores de bloque.
4. Mantener resources_read/resources_written por handler y dependencia, efectos externos, ámbito root, productores/consumidores y mecanismo de idempotencia observado. Colecciones de archivo completo pueden conservarse solo como pista de búsqueda.
5. Clasificar fronteras públicas/token/bootstrap por revisión semántica; R-04 sigue pendiente para las 54 páginas y todos los callables. Un nombre de wrapper no acredita autenticación obligatoria.
6. Generar artefactos nuevos versionados y una tabla de correspondencia; conservar los CSV históricos como evidencia. `REPOSITORY_CONFIG` y `DEPLOYED_UNKNOWN` separados de estado de pruebas.

## Pruebas de aceptación propuestas (no ejecutadas aquí)

- Fixture con los veinte factories: todos deben resolver tipo, path, retry y línea de instancia, e integrar el censo de automatizaciones sin duplicados.
- Fixture con trigger/Task/scheduler adyacentes: ni `0 19 * * 1-5` ni `every 1 minutes` deben contaminar handlers vecinos; verificar opciones de retry de cada familia.
- Imports alias, re-exports multilínea y wrapper con core: distinguir importación, definición callable, handler y export.
- Reglas anidadas anteriores: seis rutas distintas; expandir métodos y conservar dos cláusulas read de pagoAplicaciones. Strings/comentarios con llaves y comodines recursivos no rompen la pila.
- Insertar líneas/comentarios antes de reglas y comprobar IDs idénticos; modificar una condición cambia su hash, no identidad; reportar colisiones de cláusulas explícitamente.
- Para Control Center, eventos repetidos/fuera de orden, borrado de origen, cambio de root, fallo entre proyección y marca sucia, y actualización durante reconciliación. Comprobar que métricas no se suman dos veces y una raíz recientemente modificada no se elimina de pendientes. Ejecutar únicamente en fixtures/emulador.
- Cobertura completa: cada export desplegable aparece una vez, cada automatización referencia superficie, y todo campo derivado tiene fuente o estado desconocido explícito. No exigir ciegamente el conteo histórico de 296 exports.

Validación realizada: lectura completa del HTML, consulta de hashes, agrupación CSV con Import-Csv, búsqueda de símbolos con rg y lectura de implementaciones. No se ejecutaron builds ni pruebas runtime: este entregable es revisión documental de un ámbito acotado. Continúan pendientes inventario actualizado completo, parser implementado, pruebas del extractor, prueba de eficacia de autorización y correspondencia con despliegue.

## S-03 implementado: descarga temporal con contrato explícito

Cambios locales: `functions/src/modules/telegram/actionTokens.ts`, helper puro `functions/src/modules/telegram/downloadTokenPolicy.ts` y `qa/scripts/remediation-telegram-token.test.cjs`.

El emisor localizado es `/docprueba` en `functions/src/modules/telegram/webhook.ts:463`. Genera enlaces para `uploads` activos seleccionados por `getLatestSolicitudDocumentForTelegram` en repository.ts:515. El emisor ahora comprueba perfil, autorización canónica, identidad Auth habilitada, root, entidad, upload activo y ruta correspondiente antes de emitir. Fija `storageGeneration` obtenida de GCS y no persiste una segunda copia del bearer en el documento. TTL explícito entre 1 y 15 minutos (15 por defecto), sin NaN, infinito ni coerción de cadenas.

Cada GET revalida identidad Auth y, dentro de la transacción de adquisición, perfil, entidad, upload y permisos actuales. Para un actor sin propiedad directa se reutiliza `requireClientOperationalAccess` con `operateSolicitudes`/`operateDispersiones`. La delegación se incorpora al conjunto de lecturas transaccionales y se vuelve a comprobar con `delegationIsCurrent` y `normalizeClientAccessPermissions`; un delegado válido conserva acceso y uno revocado/vencido lo pierde. Se verifica coincidencia explícita de root y cliente. La dependencia `clientDelegations/policy.ts` pertenece al trabajo S-10 compartido, no se modificó en este subtrabajo.

Contrato: un lease transaccional de 70 segundos admite una sola transferencia concurrente; una transferencia iniciada se corta a los 55 segundos (timeout de función 60). Cada inicio consume uno de tres intentos máximos dentro del TTL original. Una respuesta completada marca CONSUMED; un corte/error libera el lease para reiniciar la descarga del mismo objeto y generación. Ranges se rechazan para evitar estados ambiguos. Expiración exacta, `status` distinto de ACTIVE y `revokedAt` niegan nuevas adquisiciones. La liquidación nunca reemplaza una revocación concurrente. Una revocación no retira bytes ya entregados ni interrumpe por sí sola una transferencia ya autorizada. Si se pierde la persistencia de la liquidación, se mantiene el lease hasta vencer y el presupuesto de intentos limita la recuperación; no se promete exactamente una entrega de red.

Transición: tokens antiguos sin generación fijada fallan cerrado y deben regenerarse; no se borran registros ni evidencia. Considerar la ventana de 15 minutos del contrato anterior al preparar un despliegue, sin asumir que todos los TTL históricos respetaban ese límite. El tipo SEND_DOCUMENT_EMAIL no tiene consumidor localizado y ahora se rechaza explícitamente en este emisor de descargas.

Logs de aplicación: solo códigos constantes, sin bearer, URL, path, mensaje crudo de proveedor ni stack. Se establecen no-store, no-referrer y nosniff. Las URLs todavía transportan el bearer en query por compatibilidad con botones existentes: retención/redacción de request URLs en infraestructura, proxies o navegadores queda pendiente de verificación operativa. Otros flujos de envío directo Telegram no pasan por esta URL y requieren revisión propia; no se enviaron mensajes reales.

Pruebas ejecutadas: `node --test qa/scripts/remediation-telegram-token.test.cjs` PASS, 6 pruebas sintéticas contra el handler transpilado con Firestore/Auth/Storage simulados: TTL y estado, adquisición concurrente exclusiva, generación fijada y consumo, tres fallos/reintentos máximos y redacción, identidad/root/objeto/upload rechazados, delegado vigente frente a revocado/vencido, revocación durante streaming preservada. `npx tsc --noEmit` en functions PASS. No prueban transacciones reales, infraestructura ni efectividad del helper de autorización simulado; los contratos de esos helpers requieren las pruebas S-10/S-01 correspondientes. No se desplegó ni se consultó proveedor alguno.

### Compatibilidad productiva S-04 y ampliación de pruebas

Se incorporaron exclusivamente `src/modules/pagos/receiptPdfCallables.ts`, `receiptSemantics.ts` y `receiptLearning.ts` del artefacto productivo `TEMP/pay0-remediation-20261009-sources/parsePagoReceiptPdf.zip`; no se inspeccionaron ni extrajeron secretos. Se conserva el lector semántico, `analysisId`, `readerVersion`, identificación, caché y corrección humana existentes. Encima se aplican reserva de cuota antes de procesar/consultar caché, límite base64 previo a decodificar, máximo cinco páginas PDF verificadas y fallos genéricos de OCR. Un PDF cuyo conteo no se puede comprobar se rechaza; una respuesta parcial o una página OCR con error tampoco se entrega como éxito. Las entradas antiguas de caché sin `processingPolicyVersion:2` se vuelven a analizar bajo el nuevo límite.

Las nuevas memorias de corrección usan hash(rootId, patternKey) en su identidad. Lectura legacy únicamente como fallback cuando falta la identidad nueva y el registro pertenece al mismo root; no hay migración, borrado ni promoción automática. Se mantiene CANDIDATE y el consejo no sustituye evidencia ACCEPTED.

`qa/scripts/remediation-ocr-quota.test.cjs`: diez pruebas sintéticas PASS, incluidos cuota concurrente, caché/semántica/identificación preservadas, PDF largo rechazado, error OCR sin datos proveedor, claves por root, correcciones simultáneas de distintos roots y fallback legacy aislado. Las seis pruebas S-03 también pasan tras revalidar rootId/targetUid/clientId en la segunda lectura transaccional de delegación.

Despliegue S-03: el emisor está incorporado en `telegramWebhook`; una futura publicación coherente debe incluirlo junto con `telegramDownloadAction`, además de las dependencias compartidas correspondientes. Auth `getUser` está fuera de la transacción Firestore: cambios de estado Auth posteriores a esa comprobación no se sincronizan atómicamente con los documentos y se reconocen como una ventana residual.

Inventario AST: primera generación escrita, con 56 automatizaciones y veinte factories correctamente resueltos. Verificación automatizada y revisión de dos identidades históricas sin mapping quedan pendientes mientras se prioriza compatibilidad OCR; no se declara terminado todavía.

### Inventario reparado reproducible: cierre del pendiente

Implementado `scripts/build-remediation-inventory.mjs` y pruebas `qa/scripts/remediation-inventory.test.mjs`. Comando: `node scripts/build-remediation-inventory.mjs`. Lee íntegramente ambos CSV históricos sin alterarlos y escribe nuevos ATTACK-SURFACE.csv/AUTOMATIONS.csv en esta carpeta. No usa reloj en la salida; el mismo árbol y dependencias producen los mismos bytes. Cada definición actual incluye hash SHA-256 de su archivo; la procedencia histórica se resuelve contra `d206a6c812218dd83ebfe0a45dc8e365c62e6a1f` y conserva legacy_ids/legacy_anchor.

TypeScript AST + checker resuelven aliases, imports, reexports, instancia de fábrica, retorno constructor y opciones literales/constantes por argumento. La fábrica dirtyTrigger resuelve veinte triggers retry=true sin horario. Opciones Scheduler/Task/Firestore permanecen separadas; NO_APLICA/NO_DECLARADO/UNRESOLVED no equivalen a defaults desplegados. Export/definición/constructor/cadena de fábrica tienen anclas independientes.

El parser de reglas trata strings/comentarios como opacos y mantiene pila de bloques incluyendo wildcard de path; compone ruta completa y expande read/write por método. Conserva todas las condiciones y anclas de cláusulas coincidentes. IDs derivan de servicio+ruta normalizada por posición de wildcard+método; no de línea. Los dos matches raíz históricos que inicialmente parecían sin correspondencia son contenedores sin allow propio: se representan como SCOPE_ONLY, evitando calificarlos como endpoints o controles ejecutables. Los 406 IDs históricos quedan mapeados.

Clasificación auth: INTERNAL identifica solamente el constructor de automatización (no acredita IAM). SESSION_OBSERVED/TOKEN_OBSERVED expresan evidencia textual localizada dentro del AST del handler y hasta tres saltos de helpers, con presupuesto máximo de 1500 nodos. Nunca significan certificación de todas las ramas. UNKNOWN se mantiene sin evidencia suficiente. UI evalúa AST de `RootClientShell.isLoginPage` por ruta, diferenciando login/firma/verificaciones públicas de setup-superadmin que realmente queda envuelto en RequireAuth. PUBLIC_TOKEN_UI significa página pública parametrizada por token, no autorización del endpoint de datos. Todas las filas permanecen NOT_CERTIFIED y deployment UNKNOWN.

Pruebas PASS: tres pruebas de inventario (parser estructural y estabilidad frente a inserción de líneas/renombrado de wildcard, round-trip CSV, resolución AST completa con veinte factories, horarios/retry, rutas canónicas, imports, clasificación UI, unicidad, integridad entre CSV y 406 IDs históricos). La tabla de reglas crece al representar métodos efectivos y nuevas reglas; no debe compararse el total bruto nuevo con 406 como si midieran la misma unidad.

Limitaciones: no calcula grafo transitorio completo de recursos leídos/escritos ni demuestra idempotencia; no analiza IAM/publicación, condiciones dinámicas, opciones globales Firebase ni defaults del SDK; fábricas con múltiples returns o expresiones no soportadas quedan desconocidas. El presupuesto de auth puede omitir helpers profundos y la aparición de una guardia no acredita ejecución en todas las ramas. Un cambio de contrato del RootClientShell exige revisar la interpretación UI. Fuentes actuales no fijan SHA de producción; el manifiesto de despliegue es evidencia separada.

Verificación final de este subtrabajo: generación actual 747 filas de superficie (reglas desglosadas por método), 56 automatizaciones y 406 identidades históricas mapeadas, cero sin correspondencia. Suite OCR ampliada a once pruebas PASS: también comprueba selección exacta de páginas PDF verificadas y rechazo de respuesta parcial o error de página. `npx tsc --noEmit` pasó después de restaurar los módulos semánticos y aplicar S-04; no se ejecutaron builds globales desde este subtrabajo.
