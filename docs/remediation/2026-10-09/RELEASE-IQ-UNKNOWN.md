# Lote IQ: resultado incierto y bloqueo de repeticion

2026-10-09. Preparacion de solo lectura; no desplegado por este trabajo. Cambios origen `36270fb` y `365e100`, ya integrados; inspeccion local final en integracion `9616055`. No se ejecutaron IQ, operaciones financieras, Tasks remotos ni schedulers. No se modifico codigo.

## Alcance exacto de ejecucion

| Dominio | Export que puede llegar al POST modificado | Dependencias principales |
| --- | --- | --- |
| Deposito | `processIqPagoDepositOnDemandTask`, `processIqPagoDepositAutomaticTask`, `processIqPagoDepositCreateQueue` | pagoDepositCallables -> createPagoIqDepositFromQueueCoreH4D62C -> pagoDepositHttpCreateFlow -> depositHttpCreateCore + depositHttpCreateFirebaseAdapters |
| Solicitud/factura | `createSolicitudIq`, `processIqCreateOnDemandTask`, `processIqCreateQueue` | solicitudCreationCallables o solicitudCreateQueueCallables -> solicitudHttpCreateA53; cola usa runIqCreateInvoiceBatchHttpA53 |
| Dispersion | `createClientDispersionIq`, `processIqDispersionCreate` | dispersionCreationCallables -> runCreateClientDispersionIqCore -> dispersionHttpCreateCore |
| Comision, consumidor transitivo | `executeUserCommissionDispersion` | commissionDistributions/execution -> import dinamico de runCreateClientDispersionIqCore -> dispersionHttpCreateCore |

Son nueve ejecutores financieros. No omitir comisiones por tratarse de un import dinamico. Los exports de encolado `requestPagoIqSync`, `dispatchQueuedPagoIqCreation` y `enqueueSolicitudIqCreation` no ejecutan por si mismos el POST corregido; tampoco lo hacen los reconciliadores por consulta, el resolvedor de instrumentos ni la cancelacion de comisiones. No requieren publicacion solo por compartir modulo, pero sus contratos y autoridad diferida deben preservarse. La lista no autoriza un despliegue general de Functions.

Dependencias de autorizacion actuales incluyen authGuard, restriccion confiable, delegaciones y authorizeDeferredIntent; las Functions empaquetan tambien cambios integrados posteriores al parche HTTP. Revisar diff transitivo de cada ejecutor, no atribuir todo el candidato a dos commits pequenos. Conservar perfiles IQ, bindings secretos declarados, calendario/runtime por root, reservas, audit y conciliacion; nunca imprimir valores o respuestas de proveedor.

## Contrato y pruebas

El deposito deja OUTCOME_UNKNOWN ante respuesta ambigua y mantiene retryBlocked; solicitudes conservan UNKNOWN/OUTCOME_UNKNOWN y dispersiones OUTCOME_UNKNOWN. No liberar reserva por timeout, 5xx, cuerpo inesperado u otro resultado no inequívoco. La recuperacion por consulta existente puede vincular un resultado demostrado; ausencia de coincidencia no acredita ausencia de efecto ni autoriza reenviar.

Rechazos explicitos 400/401/403/404/405/410/413/415/422 conservan rechazo seguro segun contrato actual. La solicitud permite refresco tras 401 explicito y reautoriza antes del siguiente POST; no aplicar ese comportamiento a 504 u otra incertidumbre. No introducir limpieza/backfill de estados desconocidos al publicar.

- Ejecutado ahora en fuente y worktree integrada: `node qa/scripts/remediation-iq-ambiguous-outcomes.test.cjs` PASS. Veinticuatro combinaciones status/dominio, bloqueo real de claims de replay con un POST, controles422, refresh401 y fallo de recuperacion tras201 preservando UNKNOWN. Transporte falso; global.fetch rechaza red. No demuestra contrato real de IQ ni toda la cola batch.
- Gate previo documentado: `qa/scripts/remediation-financial-concurrency-run.ps1`, 17 escenarios PASS en demo-pay0-financial/Firestore18087, incluye deposito concurrente y nueve respuestas ambiguas, SafetyRuntime/fencing, REP y comisiones. No repetido ahora para no competir con despliegue Telegram. Root debe reservar ventana y repetir contra candidato congelado; runner usa config temporal, XDG aislado y DEBUG vacio, pero revisar aislamiento temporal/puertos tras los fallos ambientales previos de otros runners.
- Ademas: build Functions, discovery y predeploy del candidato; verifier de autorizacion; suites actuales de identidad/origen y autoridad diferida. Para comisiones, incluir las pruebas de dominio/ejecucion existentes con executor falso: la prueba de materializacion sola no acredita desembolso de legs. No ejecutar scripts audit IQ ni modos manuales reales como smoke.

No se reprodujo un defecto nuevo durante esta preparacion. El modo PAY0_TEST_BASELINE de la suite usa HEAD dinamico y no es un fixture historico estable: no usarlo como prueba de la version productiva; el gate normal sin esa variable si ejercita codigo actual.

## Comparacion offline disponible

Se leyeron exclusivamente siete archivos src/modules/iq dentro del ZIP privado ya preservado `getAuthorizedDocumentDownloadUrl-pre-bridge.zip`, sin extraer todo ni abrir dotenv. ZIP SHA256 `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`. Corresponde al artefacto documental historico confirmado, **no** se ha demostrado que sea el artefacto efectivo actual de estos nueve ejecutores IQ.

| Fuente (EOL normalizado) | SHA256 historico | SHA256 integrado inspeccionado |
| --- | --- | --- |
| depositHttpCreateCore.ts | 494d9e3102472287431fab10ee12d382a370b0713d58f1ec549e5ad9264e1cdb | 738691803eb1d3388d4f5898f06cd8e0d8850a03fb4ab7f0951b9a49b8348973 |
| dispersionHttpCreateCore.ts | 530cb589e949f1e5d49e046bbdd27bec7031717310a77555e4892c785877d69a | 79b594567f2251bf034b9abb97015671f25b3dd3f08cf7d429c71edffdab6598 |
| solicitudHttpCreateA53.ts | 09fba8b252129169edf5f0ca4676beecbd8fb964690450e4c42af1b99e216e6f | bd78ff3287ec68d712f7ee51c05a49287356eecd5c5a59e867fe8f17ff90b52f |

Tambien difieren pagoDepositCallables, solicitudCreateQueueCallables, solicitudCreationCallables y dispersionCreationCallables. Por ello queda pendiente comparar fuente efectiva exacta de cada ejecutor y sus dependencias, guardas y exports contra candidato. No asumir que un rollback al ZIP historico restaura capacidades productivas actuales.

## Gates de publicacion y preservacion de pausas

1. Congelar commit integrado; verificar los nueve exports y diff transitivo con artefactos exactos de sus revisiones activas. Consultar solo metadata necesaria: revision/generacion/sourcehash, triggers/schedule/retry/concurrency, identidad y nombres de bindings, sin secretos. Conservar ZIP previos en directorio privado ignorado. Este paso remoto aun no se ejecuto en este subtask.
2. Acreditar pruebas anteriores sobre ese commit y comprobar configuracion local/remota por comparacion en memoria. Dotenv activo no hereda automaticamente claves remotas faltantes: preservar mapa ajeno y no arrastrar las tres variables temporales del puente Telegram inadvertidamente a este lote financiero. No escribir datos financieros para probar estados.
3. Antes y despues del deploy acotado, verificar que Cloud Scheduler `syncTodayIqInvoicesNow` y `checkPaymentComplementsDaily` siguen PAUSED (baseline regional: every24hours y 0 19 * * 1-5, respectivamente). Excluirlos del selector y no reanudarlos. Verificar tambien pausa/configuracion REP existente: REQUEST exige iqRequestEnabled===true ademas de master.enabled, iqEnabled y master.automation.aplicacionPagos; conservar exactamente sus valores vigentes y cuotas. No inferir pausa runtime actual solo desde codigo ni activar LOOKUP/REQUEST para probar. El alcance no requiere modificar esos documentos.
4. Revisar automatismos de los nueve ejecutores: un scheduler/Task activo puede efectuar trabajo pendiente inmediatamente al publicar; no tratar deploy como prueba sin efectos. No crear jobs, reiniciar estados, reenviar requests ni modificar colas. Root debe decidir el orden con evidencia de configuracion vigente, preservar pausas y no abrir una ventana parcial en la que otro ejecutor antiguo pueda repetir un efecto desconocido.
5. Postflight limitado a revision Ready/ACTIVE, fuente exacta, configuracion/pausas y rechazo sin autenticar para callables donde corresponda; no invocar Tasks/schedulers/manual confirm/preview para obtener evidencia funcional. Preview puede consultar IQ y no es un smoke offline. Idempotencia y efecto incierto quedan probados con proveedor falso; no usar dinero real como validacion.
6. Ante fallo, detener ese lote y preservar UNKNOWN/reservas/auditoria. Preferir correccion hacia adelante si volver al codigo anterior permitiria repetir un POST. No limpiar retryBlocked ni reenviar por expiracion de lease. Toda conciliacion productiva requiere su propio alcance y evidencia; este documento no la autoriza.

Pendientes: artefactos exactos por ejecutor, gate integrado completo, estado runtime contemporaneo y decision central de despliegue. No cierra AR03-AR05 ni la remediacion integral.
