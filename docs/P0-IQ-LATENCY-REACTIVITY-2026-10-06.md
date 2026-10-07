# P0: despacho inmediato de Pagos y descubrimiento reactivo

## Continuacion 2026-10-07: Task automatica de Solicitudes (base `118b40f`)

Se aplica al bloqueo aceptado del ultimo preflight el mismo helper de lectura.
Diff de produccion: dos lineas en `solicitudCreateQueueCallables.ts`: importa
`readEnabledIqAutomationRoots` y lo usa en `processIqCreateOnDemandTask` para
fuentes automaticas. `processIqCreateQueue` conserva el helper con claim.
No se cambian perfiles, locks, jobs, transporte, reintentos, fuentes manuales,
sincronizacion inversa ni complementos. Pagos conserva la correccion anterior.

La suite ejecuta el manejador actual de Solicitudes contra la configuracion
real en Firestore emulado. Un claim previo impide otro claim pero no impide
la Task: `processProfileJobs=1` (antes 0), sin escrituras a la configuracion.
Master OFF y flujo OFF bloquean; el error de procesamiento se propaga; el job
terminal no se procesa de nuevo. `processProfileJobs` se sustituye por un
contador con fallo controlado: esta prueba no certifica el POST de Solicitudes.
La regresion de Pagos mantiene finalize real -> Task -> core HTTP real con
transporte simulado: tasks=1, core=1, POST=1, configWrites=0.

Comprobaciones: emulador 13/13, reactividad 8/8, TypeScript, build Functions y
verificador de autorizacion PASS. Build frontend: PASS (cache limpia, 42 paginas).
P0 abierto. Sin push, deploy ni operaciones reales. SHA en la entrega.

## Correccion minima del claim de intervalo (base `5c345bf`)

P0 abierto. Sin deploy, operaciones reales ni cambios de arquitectura.

El preflight encontro que enqueue y worker de Pagos consumian el intervalo
usando `loadEnabledIqAutomationRoots`. La Task podia terminar normalmente sin
entrar al core IQ. Las pruebas anteriores ocultaban ese efecto mediante un mock
siempre habilitado; sus resultados no certificaban la integracion de este gate.

Diff de produccion limitado a tres archivos:

- `automationRuntime.ts`: extrae la seleccion existente a
  `readEnabledIqAutomationRoots` (solo lectura). Conserva Master Switch,
  habilitacion del flujo, normalizacion y evaluacion opcional de horario.
  `loadEnabledIqAutomationRoots` llama a esa lectura y al mismo
  `claimIqAutomationProcessIfDue` transaccional. No cambia el cuerpo del claim.
- `pagoImmediateDispatch.ts`: enqueue usa la lectura sin claim.
- `pagoDepositCallables.ts`: el worker automatico de Pagos usa la lectura sin
  claim. Sus schedulers siguen usando `loadEnabledIqAutomationRoots`.

No cambia la deduplicacion de Task, generacion, lease, fingerprint, write-once,
proteccion de resultado incierto, backoff ni protecciones terminales.

La suite usa ahora `automationRuntime.ts` y `operatingCalendar.ts` reales contra
Firestore emulado, sin sustituir la habilitacion por una respuesta constante.
Ejecuta el finalize real de documentos con Storage/usuario/auditoria simulados,
helper de enqueue, entrega de Task simulada, worker real extraido de su modulo,
core HTTP y adapters reales; transporte IQ simulado. La construccion del contexto
IQ se sustituye por la llamada al core HTTP, como en la suite anterior.

Evidencia obtenida:

- Finalize -> enqueue -> Task -> worker -> core: **tasks=1, core=1, POST=1**.
- Un claim previo del scheduler no bloquea el recorrido inmediato.
- `updateTime` del documento de configuracion permanece identico tras finalize,
  enqueue y worker: cero escrituras, incluido `lastClaimedAt`.
- Scheduler: primer claim admitido, segundo dentro del intervalo rechazado,
  siguiente al vencer 60 segundos admitido; timestamp actualizado correctamente.
- Master OFF y flujo Pagos OFF: cero enqueue/core/POST y sin claim.
- Cinco workers concurrentes: un POST. Replay: ningun POST adicional.
- Fallo de contexto del worker: promesa rechazada (retryable), pago QUEUED,
  sin POST ni claim; siguiente intento ejecuta un POST. Conserva tres intentos.
- Respuesta IQ incierta: retryBlocked persiste incluso al vencer el lease.
- Permanecen las pruebas de generacion obsoleta, ID write-once, dos sesiones,
  reconexion con 150 altas por listado, scopes/reglas y cleanup.

Verificacion: suite Firestore emulada **12/12**, suite reactividad **8/8**,
TypeScript frontend, build Functions y politica de autorizacion PASS.
Build frontend: PASS, cache limpia, 42 paginas generadas.
SHA en la entrega; el diff exacto es `git show <SHA> --` sobre estos tres modulos,
la suite `qa/scripts/iq-immediate-discovery.emulator.test.cjs` y este informe.
Los resultados son locales; la certificacion real continua pendiente.

## Continuacion sobre `43496c5970b83334a20563200a79f8cbe52e8b1f`

Rama: `fix/iq-latency-reactivity`. **P0 permanece abierto. Sin push ni deploy.**
Esta seccion describe el cambio actual y sustituye los dos pendientes tecnicos
anotados en el diagnostico anterior, conservado abajo como antecedente.
Las metricas historicas no son evidencia de cierre.

### Causa y nuevo camino de Pagos

Antes, `finalizePagoDocumentUploadCore` persistia el comprobante y el estado
`QUEUED`, sin encolar una Task automatica. El consumidor normal era
`processIqPagoDepositCreateQueue`: cada minuto, hasta diez candidatos en serie.
La Task existente `processIqPagoDepositOnDemandTask` acepta solamente `MANUAL`;
no era un camino automatico utilizable por la finalizacion del comprobante.

Ahora el camino normal es:

`createPago -> PAY0 persistido -> respuesta/UI liberada -> upload/finalize del
comprobante -> commit QUEUED -> enqueue inmediato (delay 0) ->
processIqPagoDepositAutomaticTask -> contexto autorizado/gates -> core HTTP
compartido -> lock/fingerprint/journal -> POST /deposits -> recuperacion y
vinculacion del ID -> Firestore -> listeners de la pantalla`.

El comprobante sigue siendo requisito del POST. La pagina no espera IQ para
liberarse. Finalize espera el enqueue, nunca el POST IQ. La transicion `QUEUED`
es durable: `dispatchQueuedPagoIqCreation` reintenta el enqueue si el proceso
muere o falla. Ambos caminos usan SHA-256 del par pago/upload como ID de Task;
la normalizacion de Cloud Tasks no colapsa IDs que difieren por mayusculas.

La Task relee el pago y la generacion, comprueba configuracion maestra y usa
el mismo contexto/autorizacion del scheduler. El core y el lock transaccional
vuelven a comprobar la generacion antes del POST. Se conservan leases,
fingerprint, bloqueo de resultado incierto, vinculacion de ID write-once,
protecciones terminales y reintentos manuales existentes. Las entregas tardias
no despachan un comprobante reemplazado. El catch del scheduler ya no puede
rebajar un estado que otro worker cambio a PROCESSING/CREATED.

La nueva Task reintenta errores anteriores al despacho: hasta tres intentos,
backoff 300-900 s, ventana de 1800 s. Un resultado incierto no se vuelve a
postear automaticamente. El scheduler es respaldo: pagos QUEUED sin reserva
de despacho (o con fallo explicito de enqueue) tras 60 s, o con reserva de la
misma generacion de mas de 45 minutos
(ventana de retries y ultima ejecucion). Conserva el mismo lock al competir.
No se cambio la sincronizacion inversa IQ->PAY0 ni complementos automaticos.

### Descubrimiento de filas nuevas

Una consulta `onSnapshot` por pantalla usa el alcance exacto del callable
(rol/usuario/root) y el rango temporal seleccionado. Arranca al recibir la
primera pagina y fija el limite inferior en su ultimo `createdAt`; si esta
vacia, usa el inicio del rango. No tiene limite movil: recupera todas las altas
posteriores, incluso una rafaga durante desconexion. Los indices necesarios
ya estan en `firestore.indexes.json`; no se modificaron reglas ni indices.

El snapshot inicial/reconexion combina sus documentos por ID; despues procesa
cambios incrementales en una sola actualizacion de estado por lote. Mantiene
referencias de filas iguales, orden temporal con nanosegundos y desempate por ID.
No activa loading, reload, navegacion ni una key que remonte la tabla.
Los listeners de documentos conservan reactividad/borrado de las paginas mas
antiguas, aunque queden fuera de la consulta de descubrimiento. Cambiar alcance
o salir libera las suscripciones; las respuestas tardias se descartan.
`iqApplicable` se persiste al finalizar el comprobante para las altas nuevas.
El enriquecimiento ya recibido del listado conserva precedencia; cambios de
configuracion del despacho se recalculan al volver a cargar el listado.

### Validacion local de esta continuacion

- `node --test qa/scripts/operation-reactivity.test.cjs`: 8/8.
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 node --test --test-timeout=90000 qa/scripts/iq-immediate-discovery.emulator.test.cjs`: 9/9.
- `npx tsc --noEmit --incremental false`: PASS.
- `npm --prefix functions run build`: PASS.
- `node scripts/verify-authorization-policy.mjs`: PASS.
- `npm run build`: PASS (version final, cache limpia, 42 paginas generadas).

La suite nueva usa Firestore emulado con las reglas actuales y un proyecto
`demo-pay0-latency-*` unico por corrida. Rechaza cualquier host distinto del
localhost indicado. Cloud Tasks y el transporte IQ estan simulados; se ejecutan
el helper de enqueue, handlers extraidos del codigo actual, core HTTP y adapters
reales de lock/journal. El orquestador de contexto IQ se sustituye por ese core:
no prueba credenciales, catalogos, IAM ni entrega real de Cloud Tasks.

Cobertura: helper de finalize/evento duplicados generan una Task inmediata; worker sin
scheduler; fallo de enqueue y reintento; error previo al contexto y reintento;
cinco creaciones concurrentes producen exactamente un POST; ID write-once;
replay no genera otro POST; respuesta perdida conserva retryBlocked aun con
lease vencido; generacion obsoleta/terminal no hace POST. Dos clientes Firebase
por cada listado reciben altas/cambios/borrados; recuperan 150 altas tras
reconexion sin duplicados; conservan filas de paginas anteriores y referencias
no modificadas; cleanup de una sesion no interrumpe la otra. Consultas por rol
aceptadas por reglas actuales y consulta ampliada de operador rechazada.

El arnes inicial fallo por promesas de otro contexto VM y fue corregido para
usar el contexto Node nativo. El emulador 1.22 devolvio 500 al vaciar un proyecto
con streams cerrados: cada corrida usa ahora un proyecto demo nuevo. Estos
fallos locales no se ocultan ni se atribuyen al comportamiento productivo.
El frontend compilo inicialmente; tras el ajuste final de enriquecimiento,
el build con cache reprodujo el error previo WasmHash de Webpack. Se repitio
con cache local limpia, sin cambiar dependencias ni configuracion.

Para repetir, iniciar el jar local del emulador en `127.0.0.1:8088` y ejecutar
la suite con la variable indicada; requiere primero el build de Functions.

### Archivos de esta continuacion

- `functions/src/index.ts`: exporta trigger y Task automaticos.
- `functions/src/modules/pagoDocuments/service.ts`: enqueue tras commit y enriquecimiento IQ.
- `functions/src/modules/iq/pagoImmediateDispatch.ts`: reserva, deduplicacion y criterio de recovery.
- `functions/src/modules/iq/pagoDepositCallables.ts`: trigger, worker, generacion y scheduler de respaldo.
- `functions/src/modules/iq/pagoDepositHttpCreateFlow.ts`: propaga generacion al lock.
- `functions/src/modules/iq/depositHttpCreateFirebaseAdapters.ts`: valida generacion/elegibilidad en transaccion.
- `src/lib/operationDiscovery.ts`: consulta acotada de altas nuevas.
- `src/lib/liveOperationRows.ts`: scope, merge incremental, orden y frontera inicial.
- `src/lib/useLiveOperationRows.ts`: integra descubrimiento y listeners existentes.
- `src/app/pagos/page.tsx`, `src/app/solicitudes/page.tsx`: seed y alcance de suscripciones.
- `qa/scripts/operation-reactivity.test.cjs`: dependencia del hook actualizada.
- `qa/scripts/iq-immediate-discovery.emulator.test.cjs`: cobertura local nueva.
- Este informe.

### Pendiente exclusivamente de validacion real para estos dos cambios

Tras autorizar y desplegar esta version en el entorno acordado, comprobar
provisionamiento/IAM de las dos Functions nuevas, enqueue/entrega/retries reales,
configuracion IQ y uso de los indices existentes. Ejecutar una operacion
controlada y correlacionar por ID:

`click -> PAY0 persisted -> UI released -> IQ dispatch -> IQ response ->
Firestore update -> UI reactive update`.

Medir latencia total y cada tramo posterior a este cambio; contar POST y folios
IQ efectivos; observar ambas pantallas en dos pestanas/sesiones, alta externa,
folio/estado/aplicaciones, navegacion y reconexion. Comprobar visualmente que
no hay refresh, parpadeo, perdida de scroll/seleccion ni remonte de la tabla.
Las trazas del listener no sustituyen la comprobacion de pintura/commit React
ni corrigen por si solas el desfase entre relojes. Las pruebas locales no
certifican un SLO productivo ni autorizan cerrar P0.

La consulta conserva todas las altas dentro del rango durante la sesion: sus
lecturas/memoria crecen con las altas y paginas cargadas. El upload sigue
dependiendo de la pestana y los post-create de Solicitudes siguen como estaban;
esta continuacion no altera esos flujos. La prueba real determinara si algun
tramo necesita otra correccion. No se uso ninguna operacion productiva.

---

## Diagnostico anterior (historico, previo a esta continuacion)

Fecha: 2026-10-06. Base inspeccionada: `fe2b98b`, rama inicialmente abierta
`feature/commission-distribution-cycle`. Trabajo aislado en
`fix/iq-latency-reactivity`. **P0 abierto; no autorizar deploy con este informe.**

El checkout abierto no es `main`: este último apunta a `094472f` y presenta
382 archivos diferentes. Los resultados de este informe pertenecen al checkout
inspeccionado, no certifican el código desplegado ni los otros worktrees.
El manifiesto actual usa Next.js 15.5.25; el entorno ejecutado usa Node 22.23.2.

## 1. ROOT CAUSE P0-A

- `createSolicitud` devuelve `HttpsCallableResult`, pero `NuevaSolicitudModal`
  lee `solicitudId` y `folio` en el nivel superior. Se reprodujo ejecutando el
  servicio real transpilado con una respuesta Firebase simulada válida: el
  guard del modal falla y no llega al upload. El backend puede haber persistido
  ya; repetir la captura puede crear otra solicitud. Corregido el contrato en
  el servicio compartido. El importador masivo acepta también el nuevo contrato.
- El callable `createSolicitud` espera `Promise.all(postCreateTasks)` después
  de su transacción: auditoría, nota, Materialidad y borrador Facturama. Después
  espera además `recordOperationalMetric`. El tiempo consumido por cada una
  de estas dependencias todavía requiere medición individual. Cloud Logging
  confirma que el bloque conjunto `post_create` consume p50 849 ms / p95 1714 ms.
- `createPago` espera sus validaciones, transacción financiera/auditoría y
  `recordOperationalMetric`; el alta normal ya sube su comprobante en segundo
  plano. No se encontró un POST IQ dentro de este callable de alta.
- En `applySelectedFolios`, el overlay global envolvía tanto
  `applyPagoToSolicitudesAtomic` como `preparePagoApplicationIqPlan`. La prueba
  ejecuta el manejador anterior y el actual con una promesa IQ retenida: antes
  permanece bloqueado; después se libera tras PAY0. Se mantiene el bloqueo del
  flujo IQ, su confirmación humana y la clave de idempotencia para reintento.
  El modal se cierra al confirmar PAY0 y el progreso queda en un aviso dentro
  de la página, con botón para revisar el plan cuando termine la preparación.

## 2. ROOT CAUSE P0-B

- Pagos automático: finalizar el comprobante escribe `QUEUED`, pero no
  despacha una Task de creación. `processIqPagoDepositCreateQueue` corre cada
  minuto y toma hasta diez candidatos, procesándolos secuencialmente. Hay una
  dependencia directa del scheduler en el camino normal. El intervalo
  configurado no es una medición de latencia: no garantiza un límite de 60 s.
- Pagos manual: `requestPagoIqSync` sí encola Tasks. La primera creación usa
  demora cero; reintentos de creación usan 5 y 15 minutos. Esas esperas y las
  protecciones de resultado ambiguo no se han eliminado.
- Solicitudes: `enqueueIqCreationForSolicitud` ya encola una Task inmediata
  con el mismo job y lock por perfil; scheduler cada minuto como respaldo.
  La Task limita concurrencia y despacho a uno. Un error de enqueue queda
  registrado en `onDemandTaskEnqueueError`. Falta observar esos valores reales.
- `solicitudHttpCreateA53` recupera el ID por HTTP con esperas configuradas
  `[0, 1200, 3500, 8000]` ms si hace falta; no son tiempos medidos de IQ.
- No se puede atribuir cuantitativamente la latencia a cold start, locks,
  autenticación HTTP, catálogo o IQ sin una corrida correlacionada.

## 3. ROOT CAUSE P0-C

`listSolicitudes` y `listPagos` obtienen páginas mediante callables de una sola
lectura. Los listeners que existen en las páginas corresponden a otros datos:
no mantienen actualizadas las filas principales. El evento local de Solicitudes
hace un solo `getDoc`. Varios modales guardan además el objeto seleccionado.

Se añadió una suscripción por documento cargado, compartiendo implementación:
reemplaza sólo la fila afectada, conserva las referencias de las demás filas y
el enriquecimiento `iqApplicable`, elimina campos retirados por el servidor y
actualiza los objetos abiertos en modales. La paginación añade suscripciones;
cambiar de ámbito o salir las libera. Errores se muestran, y `permission-denied`
retira la fila. No se introdujo polling, navegación, reload ni desmontaje de
tabla por actualizaciones de documentos.

**Límite pendiente:** el listener sigue documentos ya cargados. Los nuevos pagos
creados en esta pestaña se insertan leyendo su documento; solicitudes mantienen
su evento local. Una creación desde otra pestaña no se descubre automáticamente
si su ID todavía no estaba cargado. La actualización de filas existentes en dos
consumidores sí tiene prueba unitaria, pero falta la validación en dos pestañas
reales y la suscripción acotada de descubrimiento de nuevas filas.

## 4–7. Arquitectura actual y transportes

Solicitud normal:

`modal → createSolicitud callable → validaciones/transacción/folio PAY0 → tareas
post-create esperadas → respuesta → upload init/Storage/finalize en navegador →
enqueueIqCreationForSolicitud → Cloud Task (scheduler de respaldo) → lock por
perfil → descarga OC → login/catálogos/POST /invoices HTTP → recuperación HTTP
del folio → transacción Firestore → listeners de filas cargadas`.

Pago normal:

`página → createPago callable → validaciones/transacción/folio/auditoría → métrica
esperada → respuesta → upload init/Storage/finalize en navegador → estado QUEUED →
scheduler → contexto autorizado → runPagoDepositHttpCreateFlow → login/catálogos,
descarga comprobante, fingerprint/lock/journal/recuperación → POST /deposits HTTP →
vinculación ID/Firestore → seguimiento de conciliación → listeners`.

El botón manual de sincronización de Pagos usa Task. La aplicación a solicitudes
es un flujo diferente: transacción PAY0, preparación de plan IQ y confirmación
humana antes de ejecutar IQ. No se ha automatizado esa confirmación.

Los dos transportes de creación examinados son HTTP directo. Las referencias
históricas a browser en comentarios no prueban ejecución de Chromium. No se
migró ningún transporte ni se auditó exhaustivamente toda la integración IQ.

## 8 y 10. Latencias ANTES / DESPUÉS

No hay muestras end-to-end reales antes ni después. No se dispone todavía de
un entorno PAY0/IQ y operación controlada identificados por el usuario.

Sí se consultaron **100 métricas históricas de Cloud Logging**, sólo lectura,
seleccionando `PAY0_PERF_CREATE_SOLICITUD` / `PAY0_PERF_CREATE_PAGO`, últimos
30 días con límite de 100 entradas. La muestra efectiva abarca 2026-09-21 a
2026-10-06. Se extrajeron únicamente tiempos y etapas, sin folios, identidades,
credenciales ni payloads financieros. Percentiles por rango más cercano:

| Tiempo interno del callable desplegado | n | mínimo | p50 | p95 | máximo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Crear Solicitud | 63 | 694 ms | 1357 ms | 2513 ms | 3017 ms |
| Crear Pago | 37 | 378 ms | 649 ms | 1380 ms | 1571 ms |

Para Solicitudes, `post_create`: p50 849 ms / p95 1714 ms. `auth_user_root`:
p50 69 ms / p95 723 ms. Para Pagos, `auth_user_root`: p50 64 ms / p95 617 ms.
Las tres solicitudes más recientes del 2026-10-06 registran total/post-create:
1089/782 ms, 1390/925 ms y 2997/1124 ms.

Estas métricas pertenecen a versiones desplegadas, **no prueban que el deploy
coincida con este checkout**. Excluyen el trayecto del navegador, parte del
arranque de plataforma, upload y creación IQ. No se presentan como UI_LATENCY,
IQ_LATENCY ni mediciones DESPUÉS de esta corrección, que no está desplegada.

| Prueba controlada local | Antes | Después |
| --- | --- | --- |
| Respuesta Firebase válida de Solicitud | Guard falla; upload no alcanzado | ID y folio disponibles |
| IQ pendiente después de aplicación PAY0 | Overlay global sigue activo | Overlay global liberado |
| Documento cargado cambia | Lectura única; sin suscripción principal | Suscripción reemplaza una fila |

Estos resultados funcionales no equivalen a mediciones de 2 s o 1–3 s.

## 9. Instrumentación y cambios

Backend: `PAY0_OPERATION_TIMING=1` activa logs con ID, etapa, tiempo Unix y
duración opcional. Marcas: `pay0_persisted_at`, `iq_dispatch_at`,
`iq_response_at`, `firestore_iq_update_at`. No se registran tokens ni payloads.
Se conservan además las métricas `_perf` existentes de los callables.

Frontend: activar por pestaña con
`sessionStorage.setItem("PAY0_OPERATION_TIMING", "1")`; retirar con `removeItem`.
El alta registra `ui_click_at`, `ui_released_at` y `UI_LATENCY`. Los listeners
registran `ui_reactive_update_at` y `REACTIVE_LATENCY_ESTIMATE` a partir del último
timestamp disponible. Este último mide entrega al listener, no pintura de React;
puede incluir una carga inicial y está sujeto al desfase entre relojes. No debe
usarse solo para certificar ausencia de parpadeo ni el objetivo reactivo.

Para una corrida válida, correlacionar por ID:

- `UI_LATENCY = ui_released_at - ui_click_at` (también monotónico en navegador).
- `IQ_LATENCY = firestore_iq_update_at - ui_click_at`, comprobando además folio
  y resultado exitoso; una respuesta HTTP sola no demuestra creación confirmada.
- `IQ_HTTP_LATENCY = iq_response_at - iq_dispatch_at`.
- `REACTIVE_LATENCY = ui_reactive_update_at - timestamp de commit`, con relojes
  alineados; falta verificar commit/render en navegador y marcar todos los saltos
  de cola, upload, autenticación y recuperación.

No se adelantó el despacho automático de Pagos todavía. La propuesta es un
despacho durable inmediato al finalizar el comprobante usando el mismo core,
autorización, gates y locks del scheduler. No usar fire-and-forget en Functions.
Separar Materialidad/Facturama requiere antes medir y asegurar idempotencia con
el finalize del documento; moverlas simplemente a un trigger podría duplicar
borradores porque el código existente puede seleccionar un documento nuevo.

## 11. Pruebas y validación pendiente

`node --test qa/scripts/operation-reactivity.test.cjs`: ocho pruebas locales
con dependencias simuladas: contrato Firebase, cambios de fila/campos eliminados,
enriquecimiento de Pagos, paginación/cleanup, dos consumidores, bloqueo anterior
versus actual, protección de doble envío, error IQ/reintento y fallo PAY0;
hook real con snapshots simulados, revocación de acceso y callbacks tardíos.

Pasaron `npx tsc --noEmit --incremental false`, `npm --prefix functions run build`
y `node scripts/verify-authorization-policy.mjs`. También pasó el build frontend
final `npm run build`, con 42 páginas generadas; se verificó que el bundle final
incluye «Revisar aplicación IQ». Durante los intentos hubo un error de tipos
corregido, errores transitorios de red y fallos `WasmHash` al reutilizar la caché
Webpack. El build final usó caché limpia, sin cambios de dependencias/configuración.

No ejecutado: solicitud ni pago real; conteo de POST IQ; errores/retries reales;
refresh/navegación/dos pestañas reales; perfilado de memoria; inspección visual
de parpadeo; reglas contra emulador. No se ejecutaron operaciones vivas en
Firebase/IQ/Telegram/WhatsApp. La única consulta remota fue la lectura de métricas
existentes en Cloud Logging; no se guardaron las respuestas brutas en el repo.

## 12. Archivos modificados

- `src/services/solicitudes.ts`: contrato de respuesta.
- `src/lib/liveOperationRows.ts`, `src/lib/useLiveOperationRows.ts`: suscripciones.
- `src/app/solicitudes/page.tsx`, `src/app/pagos/page.tsx`: integración, modales,
  respuesta obsoleta de Pagos, publicación de fila nueva y alcance del overlay.
- `src/lib/operationTiming.ts`, `src/components/NuevaSolicitudModal.tsx`: trazas UI.
- `functions/src/utils/operationTiming.ts`, `functions/src/index.ts`: trazas de persistencia.
- `functions/src/modules/iq/{solicitudHttpCreateA53,depositHttpCreateCore,
  solicitudCreateQueueCallables,pagoDepositCallables}.ts`: trazas HTTP/commit.
- `qa/scripts/operation-reactivity.test.cjs` y este informe.

## 13. Riesgos y trabajo restante

Cada documento cargado añade una suscripción/lecturas Firestore; el número crece
con las páginas que abre el usuario. El cierre de modales si desaparece su fila
es intencional. El enriquecimiento de despacho `iqApplicable` proviene del
callable y no se recalcula ante cambios de configuración del despacho; una fila
recién publicada por `getDoc` todavía no tiene ese enriquecimiento. Los uploads
siguen dependiendo de la pestaña, como antes. No se agregó idempotencia al alta
de Solicitudes ni se certificó la ausencia de duplicados de creación de extremo
a extremo. La prueba de idempotencia cubre el manejador de aplicación de Pagos.

## 14–15. Commit y deploy

El SHA se informa después del commit para no incorporar una autorreferencia.
Sin merge, push ni deploy. Sin modificación de reglas, estados financieros,
sincronización inversa ni complementos automáticos. El P0 permanece abierto
hasta medir y completar los pendientes descritos con operaciones controladas.
