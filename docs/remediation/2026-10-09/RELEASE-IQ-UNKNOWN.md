# Lote IQ: resultado incierto y bloqueo de repeticion

## Estado efectivo 2026-10-10 00:14 UTC

Integracion congelada a71a8b8; segundo intento Execute98895 publico grupo1 con
CLIexit0, pero su postflight detecto maxInstanceCount automatic ausente ->20 y
detuvo grupo2. Journal81afbf222ec64ef396eb76b4e1e17a98 confirma restauracion exacta
dotenv SHA572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856.

| Funcion | Revision efectiva / source generation | Estado comprobado |
| --- | --- | --- |
| AutomaticTask | 00002-tud /1791590626272187 | ACTIVE, update00:03:58.147423399Z; RunReady00:03:57.862046Z, trafico100 |
| CreateQueue | 00021-vuq /1791590513946575 | ACTIVE, update00:03:58.931454300Z; RunReady00:03:58.658946Z, trafico100 |
| OnDemandTask | 00034-jot /1790638545672827 | Version anterior, ACTIVE, no publicacion nueva |

Runtime actualizado sigue timeout540/memoria2Gi/CPU1/concurrency80/computeSA y
secretos2/1; userenv conserva publickey y timing1 en grupo1. Automatic ahora
max20 en servicio y revision; scheduler conserva20. No atribuir el cambio a un
default CLI: 73gates de manifest y cuatro PATCH reales interceptados sin red
demuestran omision del campo y de su updateMask. Debuglogreal no disponible
porque CLI lo elimina al terminar exitosamente; cuatro registros Audit Run
Create/Replace no contienen request/response. Falta snapshot anterior de scaling
del servicio, por lo que causa y limite efectivo previo siguen sin demostrar.

Postflight de colas/pausas PASS: ambas RUNNING, 1dispatch/s, 1concurrente, burst10;
onDemand retry1/60..300 y automatic3/1800/300..900, maxDoublings16. Scheduler
deposito ENABLED cada minuto; syncToday y REP permanecen PAUSED. No lecturas de
payloads ni invocaciones. La recuperacion propuesta despliega solo onDemand con
sus pins/configuracion exactos; no vuelve a publicar grupo1 ni declara resuelto
el drift. Sin rollback inseguro ni liberacion de UNKNOWN.

Predeploy grupo1 completo PASS, discovery2.608s/346 y gates normales. El intento
anterior19308 fallo antes de upload; su stderr incompleto motivo fixaaf5be2.
No hubo relajacion del guard de discovery ni de assertions. Historico inferior
describe los estados anteriores y queda superado por esta matriz efectiva.

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


## Preflight remoto exacto de los nueve ejecutores

Consulta posterior de solo metadata y GET de artefactos: nueve Functions ACTIVE y nueve ZIP recuperados sin error. No hubo deploy, mutacion cloud, lectura de dotenv, ejecucion de artefactos ni llamada IQ. Credencial en memoria, proyecto de cuota pay-0-system, redirects rechazados, timeout y limite de descarga; evidencia privada ignorada en `.firebase/iq-unknown-preflight/`. No usar el ZIP documental anterior como sustituto de estas fuentes efectivas.

| Export | Revision reportada por Functions | Generacion exacta | Grupo ZIP | Comparacion de siete TS |
| --- | --- | --- | --- | --- |
| processIqPagoDepositOnDemandTask | processiqpagodepositondemandtask-00034-jot | 1790638545672827 | A | 7 DIFF |
| processIqPagoDepositAutomaticTask | processiqpagodepositautomatictask-00001-gox | 1791370236816575 | B | TS ausente; 7 JS DIFF |
| processIqPagoDepositCreateQueue | processiqpagodepositcreatequeue-00020-naz | 1791370286964567 | B | TS ausente; 7 JS DIFF |
| createSolicitudIq | createsolicitudiq-00057-tar | 1790638545651227 | A | 7 DIFF |
| processIqCreateOnDemandTask | processiqcreateondemandtask-00009-qey | 1791410490996895 | C | TS ausente; 7 JS DIFF |
| processIqCreateQueue | processiqcreatequeue-00019-dut | 1791410577000980 | C | TS ausente; 7 JS DIFF |
| createClientDispersionIq | createclientdispersioniq-00022-hoy | 1790638546049323 | A | 7 DIFF |
| processIqDispersionCreate | processiqdispersioncreate-00011-nor | 1790638545671737 | A | 7 DIFF |
| executeUserCommissionDispersion | executeusercommissiondispersion-00002-fow | 1790638545592528 | A | 7 DIFF |

| Grupo | SHA256 ZIP | Bytes por ZIP | Formato |
| --- | --- | --- | --- |
| A | 8eb3cdb9f23e011defe720e4ccd09edd0fe50a50318d6ed56df5a0cb78a6b056 | 6058026 | TS + JS + maps |
| B | 56e1e34b6282a4e44fc4c9bff4c3b019e96ca81ff9ee3597d68308def8016561 | 3893649 | JS + maps, sin TS seleccionado |
| C | 07d05e50d00feba5dbe9eabcc4e8333cf52641752057a8aa0bafb94dd656316f | 7697319 | JS + maps, sin TS seleccionado |

Cada ZIP se conserva como `<export>-<generation>.zip`; metadata.json y comparison.json relacionan los nueve artefactos exactos. Los siete modulos son depositHttpCreateCore, dispersionHttpCreateCore, solicitudHttpCreateA53, pagoDepositCallables, solicitudCreateQueueCallables, solicitudCreationCallables y dispersionCreationCallables. La comparacion TS usa `git show 9616055:<ruta>` y normaliza solo EOL. En A, hashes de los tres cores coinciden con los historicos de la tabla anterior, pero los cuatro consumidores no son intercambiables con aquel ZIP documental. Esa diferencia confirma por que era necesario recuperar cada artefacto exacto.

B y C no contienen esos TypeScript; sus source maps tampoco incorporan sourcesContent. No declarar igualdad o reconstruccion TS que no se pudo demostrar. Se compararon sus siete JavaScript contra lib local existente: todos DIFF; las siete fuentes locales correspondientes si coinciden byte a byte normalizadas con 9616055. Este chequeo no acredita por si solo que lib se genero con ese commit: el gate de build congelado sigue necesario. Los hashes completos JS actuales/anteriores quedan en compiled-comparison.json privado; matriz compacta de cores desplegados:

| Core JS | Grupo A SHA256 | Grupos B y C SHA256 |
| --- | --- | --- |
| depositHttpCreateCore | 5656c6144678e017d3991c87a668e4ec5a797088f6071854425b92bca3e0fe10 | 0551b1384887306730b2b93469daf7b4120553459497b515d25fd405b910ff32 |
| dispersionHttpCreateCore | 26cea82b194395235700dfeb394b5f35c6b80760067bd7687329e19ae6a33315 | 00aeb50f3394a0ffddaa477e1c55ce933c4278e01be5c498c63f0a2127f2b37e |
| solicitudHttpCreateA53 | 513698f853b6443aeb8f4ca27fe09545e5241da75ee0740d5ab7377a70753f3d | b60bff16a7811cc3eb756b83f462569fb83bea9107b68ea0324cc27f6f9d058b |

B/C coinciden en seis de los siete JS; difieren en solicitudCreateQueueCallables (B e45578198f146340ee28053abc16aaaa2ba06abb4cb550a6a14f0a2d572141ae; C 9756aadadc98f39d637004bc13f0617425a2cbbcc56aeb5291ba4e99c9b7e409). No reducir esta diferencia a un cambio de empaquetado sin revisar la semantica. En ninguno de los tres grupos aparece el identificador nuevo unequivocalRejection en los tres cores; es evidencia estatica acotada, no una prueba de efectos de proveedor.

Compatibilidad: inventario y recuperacion de fuentes exactas completos 9/9; equivalencia semantica NO acreditada. El siguiente gate debe revisar hunks de los consumidores y JS-only, sus imports transitivos y opciones por endpoint, ejecutar el build y suites falsas sobre el candidato congelado y comprobar pausas contemporaneas. Las lecturas de metadata reportan revision de Functions, no un inventario exhaustivo de tags/trafico Cloud Run ni del backlog de Tasks. No se consultaron configuraciones financieras ni credenciales de IQ.

Recuperacion: hay respaldo exacto por endpoint, con generacion inmutable y hash, no una version comun supuesta. No restaurar automaticamente el grupo A/B/C si reintroduce la clasificacion ambigua insegura; preservar reservas/UNKNOWN y preparar correccion hacia adelante. La existencia del ZIP no constituye un rollback ensayado ni certifica permisos, opciones runtime o disponibilidad futura del backend. No se han cerrado los demas gates de este documento.


## Revision semantica y decision del gate

Decision actual: **FALTAN GATES; no declarar publicable el lote de nueve**. Se revisaron selectivamente los hunks JS de B/C y diferencias A/B sin ejecutar artefactos. No se identifico una capacidad productiva eliminada por el candidato en esos hunks; existen cambios de autorizacion y dos pruebas sinteticas con loaders desactualizados que impiden declarar validacion completa.

- B->C en solicitudCreateQueueCallables introduce guard de solicitud eliminada, claim transaccional condicionado a QUEUED/FAILED_RETRYABLE y fuente vigente, skip del claim nulo y retorno sin transporte para lote vacio. Las cuatro protecciones estan conservadas en el candidato. El Task sigue usando readEnabledIqAutomationRoots (no consume lease de scheduler al consultar habilitacion).
- Depositos B conserva la generacion de upload/receipt, el Task automatico y error transaccional que no vuelve a abrir estados financieros terminales. Candidato agrega reautorizacion de actor/recurso antes de POST y UNKNOWN conservador, sin retirar aquellos controles. El Task on-demand A recibe tambien mejoras de generacion/dispatcher y telemetria ya presentes en B: revisar sus dependencias transitivas junto al adaptador, no solo core HTTP.
- En los tres cores se conserva la forma de la solicitud y recuperacion por consulta; cambian la clasificacion conservadora y hooks de autorizacion. El refresco401 de solicitud sigue acotado y reautoriza. No hay nuevo segundo POST tras504 en el test sintetico aprobado.
- Interpretar cada modulo segun el handler real: los paquetes B/C contienen copias antiguas de dispersionCreationCallables y solicitudCreationCallables, pero sus Functions efectivas son deposito/cola. **createSolicitudIq, createClientDispersionIq, processIqDispersionCreate y executeUserCommissionDispersion corren grupo A**, que ya contiene requireIqAssociatedName, identidad IQ persistida, funding USER e instrumento verificado. No presentar esas funciones como migradas desde username o sin esos controles solo porque B/C empaquetan copias ajenas. El candidato preserva estas capacidades A y agrega autoridad vigente antes del efecto. Readiness de datos no fue consultada y no se infiere.
- Candidato mantiene auditoria can?nica pay0ActivityLog, guardas de reserva forward-only, retencion iqExecutionHeld y ejecucion USER por solicitud de comision. La comparacion selectiva no certifica todos los imports ni estados de negocio.

Metadata runtime leida en esta ventana, sin valores secretos: todos 2GiB; timeout540 salvo createSolicitudIq300. IQ_CREDENTIALS_KEY version2 en los nueve; TELEGRAM_BOT_TOKEN version1 adicional en los seis de deposito/solicitud. MaxInstances/concurrency: deposito on-demand1/1, automatico max no devuelto/80, deposito scheduler20/80; solicitud manual20/1, Task1/1, scheduler20/80; dispersion manual1/1 y scheduler1/1; comision2/80. Ausencia de max en metadata no se interpreta como cero. Preservar opciones efectivas y revisar diff de plan; ningun valor secreto fue leido.

Scheduler regional actual: processIqPagoDepositCreateQueue y processIqCreateQueue ENABLED cada minuto; processIqDispersionCreate ENABLED cada cinco minutos, America/Mexico_City. syncTodayIqInvoicesNow PAUSED cada24horas y checkPaymentComplementsDaily PAUSED 0 19 * * 1-5, misma zona. No se cambiaron esos estados. Esto verifica pausa Scheduler, no valores de los documentos runtime REP/roots, que siguen fuera de esta lectura de metadata. Deploy de un scheduler habilitado puede comenzar trabajo pendiente; no constituye una prueba sin efectos.

Pruebas adicionales ejecutadas sobre integracion: remediation-deferred-effects PASS (proveedores falsos) e iq-origin-identity15/15 PASS (lib existente, no rebuild). Dos gates fallaron antes de ejercitar escenarios: commission-iq-instrument-binding-smoke rechaza el nuevo import ../automationSafety/runtime y iq-staging-external-actions-smoke intenta resolver node:async_hooks como archivo TypeScript. Son fallos reproducibles de loaders de test, no evidencia de fallo de dominio. Correccion propuesta: inyectar solo reserveProtectedRequest/observeProtectedResponse falsos, verificar contadores por llamada y cero admisiones con transporte cerrado, sin cargar Admin real. La integracion esta congelada por deploy central; no afirmar tests corregidos/PASS hasta aplicacion coordinada y ejecucion posterior.

Pasos necesarios para publicar: resolver loaders en ventana permitida y pasar sus escenarios; gate financiero17 en emulador coordinado; build/discovery y suites deferred/UNKNOWN sobre commit final; inspeccion de imports y configuracion efectiva de los nueve handlers (incluido comision); postflight de pausas sin activar REP/syncToday. No se propone cambio de dominio ni una migracion de associatedName sin evidencia. Posible subdivision por deposito3, solicitud3 y dispersion/comision3 exige mantener todos los ejecutores de cada identidad de efecto en el mismo sublote para no dejar un camino antiguo con replay inseguro; la decision central debe incluir trabajos activos y fuente exacta, no solo nombres de Functions.

Incidencia local de coordinacion: un patch de los dos loaders enviado antes de recibir el congelamiento quedo pendiente de IPC y termino aplicandose durante la ventana. Detectado a las 22:01:03Z (coordinacion ya lo observo a las 22:00:50Z); se verificaron los hashes exactos de mis hunks y se restituyeron solo esos cambios a las 22:01:25Z. Diff normal/cached y status final vacios tras refresh a las 22:01:40Z. Propuestas preservadas exclusivamente como .proposed.patch privadas bajo .firebase/iq-unknown-preflight; no se ejecutaron tests modificados ni cambio dominio. Los dos gates siguen pendientes de correccion en ventana autorizada.


## Cierre de gates sinteticos aislados y propuesta del siguiente lote

Worktree `fix/iq-synthetic-runtime-gates`, base 9616055 y commit de tests `a18533d4ab32ed77bc5352a29fa04b30cdba4773`. Los dos loaders quedaron corregidos fuera de integracion: instrumento IQ29 checks PASS y transporte aislado81 checks PASS. Los mocks cuentan reserva/observacion por request; transporte deshabilitado no entra al runtime. No se carga Firebase Admin real en esos smokes. Dependencias reutilizadas por NODE_PATH temporal, sin install, junction, build ni emulador; integracion permanece sin tocar.

Gates adicionales estrictamente sinteticos ejecutados en esa worktree:

| Gate | Resultado | Alcance |
| --- | --- | --- |
| remediation-deferred-wiring.test.cjs | PASS | Siete sitios productivos de dispatch pasan callback de autorizacion; 18 consumidores conservan identidad canonica |
| remediation-deferred-authorization.test.cjs | PASS | Cambios de lifecycle/rol/root/restriccion/delegacion bloquean admision y prePOST; UNKNOWN no se degrada |
| remediation-deferred-effects.test.cjs | PASS | Proveedores IQ/Facturama falsos; identidad modificada antes del efecto no envia; lookup durable y propietario USER preservados |
| Harness local de funciones TS extraidas, sin importar modulo productivo | 15 checks PASS | markJobProcessing rechaza fuente ausente/eliminada y estados terminales/UNKNOWN/AUTH_STOPPED; claim de job QUEUED usa contador vigente y stale replay no escribe; matchesPagoGeneration y gracia45min conservadas |

El harness del ultimo renglon se ejecuto en memoria, no se incorporo como test permanente y no prueba concurrencia Firestore real. La suite financiera17 con emulador sigue siendo el gate de transaccion/concurrencia; no sustituirla por un mock secuencial. No se repitieron builds ni se usaron puertos compartidos o red real. Los tests de UNKNOWN y origen15/15 anteriores siguen identificados con su propio candidato y no se presentan como nueva ejecucion de este lote.

Comparacion de opciones AST de los nueve exports contra metadata ya preservada: timeout/memoria, nombres de bindings y schedules declarados concordantes. `USER_COMMISSION_IQ_SECRET` enlaza IQ_CREDENTIALS_KEY. Los maxInstances/concurrency explicitos conservan 1/1 para Tasks on-demand y dispersiones y max2 para comision. Los limites remotos20/80 donde source omite opciones dependen de defaults/herencia de CLI; verificar plan efectivo, no escribir20 ni80 por deduccion. Retry/rate de Tasks declarados: on-demand deposito/solicitud maxAttempts1, backoff60..300s, dispatch1/s y concurrent1; automatico deposito maxAttempts3, backoff300..900s, maxRetry1800s, dispatch1/s y concurrent1. Falta comparacion de metadata Cloud Tasks exacta, pues Functions serviceConfig no contiene esos limites; no afirmar igualdad remota de colas a partir del AST.

**Decision actual: siguiente candidato concreto recomendado, deposito3**, compuesto exclusivamente por processIqPagoDepositOnDemandTask, processIqPagoDepositAutomaticTask y processIqPagoDepositCreateQueue. Deben ir juntos: comparten identidad/claim y no conviene conservar un ejecutor viejo que clasifique504 como rechazo seguro. El trigger dispatchQueuedPagoIqCreation ya existe y encola; no incluirlo automaticamente solo por compartir archivo. Este sublote reduce alcance frente a mezclar factura, dispersion y retiro de comision. No se declara listo para desplegar hasta los gates restantes enumerados abajo.

Los otros seis pueden prepararse como dos sublotes posteriores: solicitud3 (createSolicitudIq + Task + scheduler) y dispersion/comision3 (createClientDispersionIq + scheduler + executeUserCommissionDispersion). No excluir comision del tercero. No se detecto perdida de capacidad efectiva en los siete modulos seleccionados; todavia no se acredita equivalencia de todos sus imports ni migracion de estados de negocio.

**No bloquear por un falso positivo de associatedName:** createSolicitudIq y los ejecutores reales de dispersion/comision corren grupo A, donde esas guardas ya estaban. B/C empaquetan copias antiguas de esos modulos pero no las invocan desde sus handlers de deposito/cola. Las pruebas de separaci?n login/Asociado son relevantes, pero falta de lectura de perfiles no demuestra un nuevo requisito introducido en esas Functions. No se propone backfill ni consulta de valores privados por esa diferencia.

Restan para deposito3: (1) incorporar commit de dos tests cuando termine congelamiento y fijar SHA de release; (2) suite financiera17 y build/discovery/predeploy coordinados sobre ese candidato; (3) comparar metadata exacta de las dos colas Tasks (retry/rate/state) y revisar configuracion/env/identidades sin valores en salida; (4) revisar delta transitivo de pagoDepositHttpCreateFlow/adapters/pagoImmediateDispatch/automationRuntime/authorizeDeferredIntent contra cada artefacto correspondiente, especialmente el on-demand A frente a automatico/scheduler B; (5) plan efectivo que preserve limites, pausas REP/syncToday y no reactive nada; (6) decision central de ventana con automatismos ENABLED y postflight de revision/hash/config, sin crear jobs ni probar efectos financieros. Recuperacion sigue usando ZIP propio por funcion; no restaurar un clasificador inseguro ni liberar UNKNOWN para simular exito. No hay gate de datos associatedName agregado a deposito3.


## Cloud Tasks y Scheduler: gate de metadata deposito3

Lectura GET acotada iniciada **2026-10-09T22:38:40.119Z**, proyecto pay-0-system/us-central1. Vinculo por codigo: pagoDepositCallables declara el destino processIqPagoDepositOnDemandTask; pagoImmediateDispatch.AUTOMATIC_PAGO_TASK declara processIqPagoDepositAutomaticTask; ambos pasan functionName a getFunctions().taskQueue(functionName). El SDK usa us-central1 para nombres simples. Se consultaron esas dos colas exactas, no un listado de tareas. API v2beta3 con readMask y fields exclusivamente name/state/rateLimits/retryConfig/stats; Scheduler con proyeccion sin destino ni headers. [Contrato GET con stats explicitas](https://docs.cloud.google.com/tasks/docs/reference/rest/v2beta3/projects.locations.queues/get).

| Cola | Estado | Dispatch/s; concurrentes; burst | Retry efectivo |
| --- | --- | --- | --- |
| processIqPagoDepositOnDemandTask | RUNNING | 1; 1; 10 | maxAttempts1, minBackoff60s, maxBackoff300s, maxDoublings16; maxRetryDuration no devuelto |
| processIqPagoDepositAutomaticTask | RUNNING | 1; 1; 10 | maxAttempts3, maxRetryDuration1800s, minBackoff300s, maxBackoff900s, maxDoublings16 |

Los campos retry/rate explicitados por el candidato 9616055+a18533d concuerdan con los valores remotos. maxBurstSize10 y maxDoublings16 son campos efectivos adicionales, no promesas de nueva configuracion del codigo; preservar mediante revision de plan. stats devolvio effectiveExecutionRate=1 en ambas colas; no devolvio tasksCount, concurrentDispatchesCount ni executedLastMinuteCount. **No interpretar ese rate como un conteo de tareas, ni ausencia de campos como demostracion de cola vacia o cero ejecuciones.** No se ampliaron lecturas a tasks.list, payloads, URLs o Monitoring. La consulta no determina si hay una operacion financiera en vuelo.

| Scheduler | Estado y horario | Deadline / retry observado |
| --- | --- | --- |
| processIqPagoDepositCreateQueue | ENABLED; every 1 minutes; America/Mexico_City | 540s; retryConfig no devuelto; lastAttemptTime22:38:02.767582Z |
| syncTodayIqInvoicesNow | PAUSED; every 24 hours; America/Mexico_City | 540s; retryConfig no devuelto |
| checkPaymentComplementsDaily | PAUSED; 0 19 * * 1-5; America/Mexico_City | 540s; maxRetryDuration0s, minBackoffDuration5s, maxBackoffDuration3600s, maxDoublings5 |

Campos no devueltos no se convierten en una configuracion inventada. El scheduler de deposito sigue habilitado y puede ejecutar su consulta al publicarse; las pausas de los otros dos permanecen verificadas en esta ventana. No hubo creacion, ejecucion, retry, purge, pause/resume ni lectura de documentos IQ. Metadata privada conservada como evidencia local ignorada; solo configuracion y agregados en este documento.

Gate de comparacion de colas **satisfecho para campos declarados**. Pendiente concreto para autorizar deposito3: diff transitivo de flow/adapters/dispatcher/runtime/autoridad por artefacto A/B, suite financiera17 coordinada y build/discovery del SHA final, comparacion de entorno/identidad/plan efectivo sin valores privados y decision central de ventana con Tasks RUNNING/scheduler ENABLED. No reabrir associatedName como requisito nuevo; no afirmar que estas lecturas acreditan drenaje de trabajos. Los tests permanecen fuera de integracion mientras termine su congelamiento.


## Candidato c29260b: deposito3, compatibilidad y gate financiero PASS

Revision exacta `c29260bef02192cdb98def40770bb8cb51378691`, fuente integrada sin cambios durante esta verificacion. Se confirmo igualdad con git show del commit para diez fuentes: callable, flow, adapters, dispatcher, automationRuntime, queue helper, iqHttpClient, externalActionsPolicy, authorizeDeferredIntent y SafetyRuntime. Esas dependencias de deposito no cambiaron entre 9616055 y c29260b; no se reutiliza esa afirmacion para otros dominios modificados entre ambos commits.

Comparacion selectiva por artefacto vigente, sin ejecutar sus fuentes:

| Dependencia | On-demand, grupo A | Automatico/scheduler, grupo B | Interpretacion del candidato |
| --- | --- | --- | --- |
| pagoDepositHttpCreateFlow | Agrega expectedUploadId y callback | Agrega callback | Autoridad actual antes de preparar y justo antes de POST; identidad de comprobante conservada |
| depositHttpCreateFirebaseAdapters | Agrega guard transaccional de generacion/status/omision/terminal | Igual | No debilita locks; lleva on-demand al contrato ya publicado en B |
| pagoImmediateDispatch | Ausente del paquete A | Solo timing adicional y comentario | Mantiene ID determinista y reserva de generacion; no requiere redeploy del trigger solo por import compartido |
| automationRuntime | Separa lectura de elegibilidad de claim de intervalo | Igual | readEnabled no consume intervalo; scheduler conserva claim transaccional |
| iqOnDemandTaskQueue / iqHttpClient | Iguales | Iguales | Sin cambio del transporte de cola ni construccion de solicitud IQ en estos helpers |
| authorizeDeferredIntent | Nuevo | Nuevo | Perfil PAY0 vigente, root y permiso/delegacion antes del efecto; no reemplaza identidad economica IQ persistida |
| externalActionsPolicy | Agrega reserveProtectedRequest/observeProtectedResponse | Igual cambio | Hooks de SafetyRuntime recorren contexto AsyncLocal; sin contexto son no-op y no crean control global nuevo |

No se detecto perdida de capacidad en este delta. La nueva negativa por autoridad revocada es intencional; conserva UNKNOWN y no habilita un POST de recuperacion. Estas conclusiones son selectivas, no una certificacion universal de todo codigo empaquetado o de datos productivos.

**Suite financiera integrada PASS, exit0**, ejecutada sobre c29260b con demo-pay0-financial y Firestore127.0.0.1:18087. Diecisiete escenarios documentados: cinco workers/un POST, respuesta perdida y lease vencido sin replay, nueve respuestas ambiguas con consulta sin coincidencia y bloqueo, control422, fencing SafetyRuntime, REP/cuotas y materializacion de comision. Proveedores falsos y global.fetch bloqueado; sin IQ real. TEMP/TMP aislados en directorio ignorado, DEBUG vacio. Runner cerro Firestore/hub/logging; 18087/14407/14507 libres. Listener9150 transitorio fue inspeccionado sin detener procesos ajenos. Integracion git status limpio al finalizar. No se repitio build ni se modifico codigo/entorno persistente.

**Decision de compatibilidad: deposito3 pasa revision selectiva de fuente y gate financiero; es el siguiente lote candidato concreto.** Funciones exactas: processIqPagoDepositOnDemandTask, processIqPagoDepositAutomaticTask y processIqPagoDepositCreateQueue. Publicarlas como unidad logica revisada; no incluir REP, syncToday, trigger de encolado, solicitud o dispersion/comision incidentalmente. Esto no es autorizacion para desplegar desde este subtask.

Gates pendientes exclusivamente de release: confirmar revision/generaciones siguen iguales si paso otra ventana; acreditar build/discovery/predeploy contra SHA congelado (usar evidencia central existente si corresponde, no reconstruir sin motivo); comparar en memoria env/identidades y plan efectivo del selector tres, especialmente defaults max20/concurrency80 y bindings IQ_CREDENTIALS_KEY2/TELEGRAM_BOT_TOKEN1; preservar Tasks RUNNING y Scheduler/pausas segun decision central, sin afirmar colas drenadas porque stats omitio conteos. Revalidar esas metadata despues de publicar. No falta un gate nuevo de associatedName para este lote.

Recuperacion exacta: on-demand vuelve, solo si es seguro, a revision00034-jot/generacion1790638545672827/ZIP grupo A; automatico00001-gox/generacion1791370236816575 y scheduler00020-naz/generacion1791370286964567 usan grupo B. Los hashes completos y ZIP por endpoint estan en la matriz anterior. Un rollback de codigo anterior puede restaurar clasificacion insegura de respuestas ambiguas: ante incidencia, no liberar retryBlocked ni reenviar; preferir correccion hacia adelante y conservar estados UNKNOWN/auditoria. No se ensaya rollback ni se modifica trafico en esta verificacion.


## Preflight de entorno y ruta de publicacion propuesta (23:08 UTC)

Lectura de los tres endpoints: revisiones/generaciones continuan iguales a la matriz; ACTIVE, misma identidad compute, timeout540/memoria2Gi y bindings IQ_CREDENTIALS_KEY version2 + TELEGRAM_BOT_TOKEN version1. Comparacion de valores exclusivamente en memoria con functions/.env.pay-0-system de integracion: PAY0_FIREBASE_WEB_API_KEY coincide en los tres; sin diferencias de valor compartido. La clave local adicional TELEGRAM_DOWNLOAD_TRANSPORT_MODE no esta en estos endpoints. PAY0_OPERATION_TIMING falta localmente y existe en automaticTask/createQueue; on-demand no la tiene. Clasificacion por semantica de operationTiming: automatico y scheduler ENABLED; on-demand DISABLED/ausente. No se imprimieron valores de entorno.

**No publicar con dotenv comun actual:** eliminaria timing de los dos y agregaria modo Telegram a los tres. La unica lectura de TELEGRAM_DOWNLOAD_TRANSPORT_MODE en codigo es downloadTokenPolicy.downloadIssuance, no alcanzada desde IQ/pagoTelegramNotifications/service; el servicio Telegram usado por IQ no importa actionTokens. No se detecto efecto de esa clave en los handlers IQ, pero sigue siendo una adicion ajena evitable.

Ocultar dotenv por si solo NO resuelve la preservacion. CLI instalado build.resolveBackend llama params.resolveParams: con userEnvs vacio, el defineString PAY0_FIREBASE_WEB_API_KEY default vacio queda outstanding y non-interactive falla antes de aplicar defaults. Si se resuelve interactivamente, writeResolvedParams guarda la clave aunque sea vacia; writeUserEnvs crea .env.pay-0-system porque hay una clave que escribir y hasUserEnvs se evalua despues, anulando la herencia por endpoint. preserveExternalChanges no esta declarado y sus opciones SDK de reset no cambian este merge de env de prepare.js. Import/discovery no usa webApiKey.value hasta la funcion runtime de login, pero eso no elimina la resolucion global de params al preparar despliegue.

**Menor riesgo recomendado: conservar Firebase y dividir el lote logico de tres en invocaciones 2+1**, sin cambiar codigo de producto ni usar gcloud para eludir gates normales. Grupo2: processIqPagoDepositAutomaticTask + processIqPagoDepositCreateQueue; grupo1: processIqPagoDepositOnDemandTask. Antes de cada invocacion, capturar/restaurar mediante journal privado y hash los bytes del dotenv original, preparar mapa exacto de userenv remoto del grupo en memoria (sin campos autogenerados/secretos), excluir TELEGRAM_DOWNLOAD_TRANSPORT_MODE, verificar que ambos mapas del grupo2 sean identicos y conservar timing solo alli. Grupo1 conserva ausencia de timing. No escribir valores inventados ni transferir SECRET env a dotenv. Param API permanece resuelto en ambos mapas.

Procedimiento propuesto, **no ejecutado aqui**: gates de candidato primero; backup/journal local atomico; sustituir exclusivamente dotenv ignorado bajo ownership central; deploy selector del grupo; postflight revision/hash y comparacion en memoria de conjuntos/valores env y nombres/versiones de secretos; restaurar bytes originales en finally aunque falle, comprobar hash y registrar estado remoto realmente alcanzado. Repetir para segundo grupo bajo la misma decision de ventana. Firebase no garantiza atomicidad entre Functions incluso con un solo selector; si falla la segunda invocacion no asumir rollback de la primera ni liberar UNKNOWN. Las dos versiones antiguas ya reconocen estados UNKNOWN persistidos, pero no inferir drenaje ni garantia universal de operaciones concurrentes. Conservar pausas/colas/configuracion y preferir correccion hacia adelante cuando rollback reintroduciria replay ambiguo.

Alternativa gcloud implicaria recrear manualmente el contrato de fuente, bindings, Tasks/Scheduler y gates Firebase; no aporta ventaja suficiente para este cambio y no se recomienda. No se modificaron dotenv, opciones, nube o datos en este preflight.
