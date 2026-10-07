## P0-R5 ? recuperaci?n autorizada y bloqueo Hosting/SSR (2026-10-07)

**P0 ABIERTO. DEPLOY_READY = NO.** Esta secci?n sustituye el estado del informe parcial
anterior; lo que sigue se conserva como historial. Base de esta continuaci?n: `d630dc541498c360626908a213060c8ae0d936e5`,
descendiente de `a12cb6de14b0e489181dcd9d5df8283f47b6c0df`, rama `fix/iq-latency-reactivity`.
No push, deploy, escritura productiva, cambio de switches ni operaci?n IQ/Facturama real.

La autorizaci?n expresa resolvi? el l?mite de alcance de la proyecci?n documental REP.
Los tres bloques backend quedan recuperados. **Permanece un bloqueo distinto, comprobado
en el artefacto SSR desplegado: la UI local es anterior a protecciones y rutas productivas.**
No se ampli? la modificaci?n a esos flujos ni se sustituy? su baseline por la rama hist?rica.

### Baseline y comparaci?n sem?ntica de las cinco Functions

Lecturas remotas repetidas el 7 de octubre: las cinco revisiones y el release Hosting siguen
iguales al preflight. No se detect? cambio entre ambas lecturas; esto no es un bloqueo contra
un despliegue concurrente futuro. Regi?n `us-central1`, proyecto `pay-0-system`.

| Function | Revisi?n productiva | Diferencia restante en su camino ejecutado |
|---|---|---|
| createSolicitud | createsolicitud-00058-xev | Instrumentaci?n P0 tras persistencia. Proyecci?n documental, identidad/asociado, permisos y auditor?a recuperados. |
| createPago | createpago-00060-qex | Instrumentaci?n P0. Origen IQ, perfil/cliente, identificaci?n del recibo y transacci?n productivos. |
| finalizePagoDocumentUpload | finalizepagodocumentupload-00031-rox | Enqueue inmediato posterior a nueva generaci?n QUEUED y metadata iqApplicable. Conserva hash, replay y canonical upload productivos; wrapper uploadDocs. |
| processIqCreateOnDemandTask | processiqcreateondemandtask-00007-rob | Lectura sin claim para AUTO e instrumentaci?n. Retry/rate limits y perfil/locks productivos. |
| processIqPagoDepositCreateQueue | processiqpagodepositcreatequeue-00019-qay | Recovery con gracia para Task inmediata; fence de generaci?n y error transaccional P0. Scheduler mantiene claim. |

Se recorrieron declaraciones/dependencias de cada archivo fuente propio: 187/160/131/209/435
s?mbolos, respectivamente. Engines, dependencias y paquetes del lockfile Functions coinciden
con los cinco archivos desplegados. Las diferencias ejecutables restantes corresponden al P0 aprobado.
La comparaci?n por declaraci?n reporta tambi?n la clase completa FirestoreHugoDataStore y
contratos de tipos; constructor, observationRef, recommendationRef y messageRef usados por el
observador son id?nticos en los cinco baselines. No se copiaron funciones ajenas de Hugo.
Este an?lisis est?tico y las regresiones locales no sustituyen una certificaci?n productiva.

### Diff sem?ntico de esta continuaci?n

- Materialidad: consultas de solicitud, aplicaciones, uploads y contrato dentro de la misma
  transacci?n; XML/PDF REP conservados por applicationId y parcialidad; versi?n m?s reciente
  por tipo/aplicaci?n; exclusi?n de aplicaciones reversadas, uploads inactivos y fuentes ajenas;
  referencias con folio, parcialidad, pagoId y digest SHA-256 revisi?n 2. Un digest id?ntico evita
  reescribir operaci?n, carpeta y solicitud. Se copiaron las declaraciones productivas necesarias,
  sin a?adir refreshMaterialityProjectionFromSource ni modificar proveedores/automatizaciones REP.
- Autorizaci?n: wrappers init/finalize/deactivate de documentos usan pagos.uploadDocs; guard
  can?nico rechaza disabled/deleted/deletedAt antes del bypass superadmin. Defaults completos
  de producci?n recuperados desde la pol?tica can?nica, generado backend y bloque generado de
  reglas coherentes. Incluyen edit/cancel, corporateResources y los defaults Wallet del operador
  existentes en producci?n, no permisos dise?ados para P0. No se desplegaron reglas.
- Auditor?a: logActivity, logActivityTx y logActivityBatch escriben PAY0/ASSETS/TTT/HUGO en sus
  colecciones respectivas; sourceSystem y activitySchemaVersion=2; CANONICAL sin sistema se
  rechaza. Conservados los observadores existentes.
- Dependencia de notificaci?n Pago: preview Telegram id?ntico al scheduler productivo (texto
  compacto, sin alterar transporte, dedupe o triggers). Ning?n env?o real.
- No se modificaron en esta continuaci?n los helpers de intervalo ni las protecciones P0
  anteriores; se volvieron a probar sobre las dependencias recuperadas.

### Evidencia

| PRODUCTION_PROTECTION | PRESERVED | P0_COMPATIBLE | TEST | RESULT |
|---|---|---|---|---|
| Asociado Solicitud separado del login, cat?logo ?nico | S? | S? | Asociado ausente/ambiguo, cliente ID/nombre | PASS |
| Origen IQ Pago y asociaci?n perfil/root/cliente | S? | S? | Reasignaci?n, root ajeno, perfil inactivo, legacy no scoped | PASS |
| Identificaci?n y hash real del comprobante | S? | S? | Actor/root/payload/duplicado y bytes distintos | PASS |
| Replay de finalizaci?n y write-once | S? | S? | Sin nueva versi?n/auditor?a; upload duplicado reutiliza can?nico | PASS |
| REP documental XML/PDF por aplicaci?n/parcialidad | S? | S? | Dos aplicaciones de un pago, XML/PDF, versiones y metadata | PASS |
| Digest/proyecci?n transaccional | S? | S? | Cinco replays concurrentes sin modificar updateTime; reversa recalcula; root ajeno rechazado | PASS |
| pagos.uploadDocs | S? | S? | Tres wrappers; revocaci?n uploadDocs bloquea aunque create=true | PASS |
| disabled/deleted/deletedAt | S? | S? | Admin/operador/superadmin rechazados antes del core | PASS |
| Auditor?a separada por sistema | Backend s? | Backend s? | Directo/Tx/batch a cuatro colecciones; CANONICAL sin scope rechazado | PASS |
| Pago lock/idempotencia/respuesta incierta | S? | S? | Cinco workers ? un POST simulado; replay cero adicional; lease vencido no reenv?a | PASS |
| Solicitud lock/idempotencia/respuesta incierta | S? | S? | Cinco workers comparten lease; replay terminal e incertidumbre no reenv?an | PASS |
| Master/automatizaci?n y claim | S? | S? | OFF cero POST; Task inmediata un core; scheduler conserva intervalo | PASS |
| Retry/recovery y fence | S? | S? | Error retryable, gracia, eventos obsoletos y carrera de generaci?n | PASS |
| Reactividad y descubrimiento P0 | S? | S? local | Dos clientes Firestore, burst/reconexi?n, identidad de filas/p?ginas | PASS |
| Hosting: rutas y registro autom?tico del recibo | No todav?a | Pendiente | Comparaci?n artefacto SSR/rama | BLOCKED |
| Hosting: lectura de auditor?a por sistema y permisos documentos | No todav?a | No con UI hist?rica | SSR frente a ActivityLog.tsx y pagos/page.tsx | BLOCKED |

Pruebas ejecutadas:
- `qa/scripts/iq-immediate-discovery.emulator.test.cjs`: **23/23 PASS**, Firestore `127.0.0.1:8088`,
  proyecto demo aislado. Tasks/IQ/Storage externos simulados. La prueba de Solicitudes ejecuta
  worker/profile lease/error handling reales con finalizaci?n de ?xito simulada; no afirma E2E IQ.
- `qa/scripts/operation-reactivity.test.cjs`: **8/8 PASS**. Dos sesiones son consumidores locales,
  no una validaci?n visual certificada de dos pesta?as productivas.
- Functions build y TypeScript frontend: **PASS**.
- Verificador de autorizaci?n: **PASS**. Coherencia can?nica local, no autorizaci?n para publicar reglas.
- Frontend build: **PASS**, 42 p?ginas. Primer intento fall? en WasmHash._updateWithBuffer;
  pas? despu?s de limpiar exclusivamente `.next/cache`, sin cambios de c?digo/dependencias.
- `git diff --check`: **PASS**.
- Primer test nuevo de auditor?a fall? por callback de fixture no async; corregido ?nicamente
  el test y repetida la suite completa. Ninguna correcci?n productiva adicional por ese fallo.

### Archivos de esta continuaci?n

`functions/src/modules/materiality/service.ts`, `functions/src/modules/pagoDocuments/callables.ts`,
`functions/src/modules/users/authorization.ts`, `functions/src/modules/users/authorizationPolicy.generated.ts`,
`config/authorization-policy.json`, `firestore.rules`, `functions/src/utils/logActivity.ts`,
`functions/src/modules/activityLog/systemBoundary.ts`, `functions/src/modules/iq/pagoTelegramNotifications.ts`,
`qa/scripts/iq-immediate-discovery.emulator.test.cjs` y este informe.
Archivos de auditor?a descargados, compilados y logs permanecen ignorados, fuera del commit.

### Hosting/SSR: evidencia del bloqueo restante

Release `projects/pay-0-system/sites/pay-0-system/releases/1790845588313000`, versi?n
`db3b4ed873464908`, fecha 2026-10-01T09:06:28.313Z. SSR `ssrpay0system-00576-hed`,
source generation `1790845363013657`, ZIP SHA-256
`9f8b77de0a56843352ee39caae6ff57b31d9299466202a2222d23a51a0fc6395`,
BUILD_ID `vt2pNREKn1aoVYJj29Ncd`. Se inspeccionaron manifiestos y JavaScript compilado;
no se ejecut? c?digo descargado. Versiones Next/React/Firebase coinciden; eso no acredita paridad funcional.

Diferencias productivas comprobadas, suficientes para bloquear Hosting:
1. Rutas desplegadas ausentes localmente: `/administracion/recursos-corporativos`, `/cuenta`,
   `/hugo/evaluation`, `/manifest.webmanifest`.
2. SSR Pagos incluye `receiptIdentificationId`, validaci?n READY/reasons/id/payload/operationType,
   y presentaci?n de `automaticApplication`; p?gina y contrato local del recibo carecen de esos
   elementos. Desplegar el frontend local degradar?a el registro por identificaci?n productivo.
3. SSR separa permiso documental `pagos.uploadDocs`; p?gina local admite tambi?n create/conciliate.
4. SSR chunk 6311 contiene colecciones `pay0ActivityLog`/`assetsActivityLog`; ActivityLog.tsx local
   consulta `activityLog`. Es incompatible con leer los eventos del escritor productivo recuperado.

La comparaci?n contra el commit local `9c06705` indica diferencias en 97 archivos de src/config/manifest,
pero ese commit NO se declara baseline autoritativo sin demostrar su correspondencia completa con el
artefacto desplegado. No se copi? mec?nicamente esa rama. No se afirma que las cuatro diferencias
anteriores agoten el drift frontend: falta reconciliar y comprobar todos los m?dulos de ese baseline.
El 403 administrativo aceptado previamente no es el blocker; GET de releases con quota project
`pay-0-system` funcion?. No se hizo redeploy ni cambio de Hosting para corregirlo.

### Micro-deploy e IAM

Conjunto backend P0 identificado (NO ejecutar): modificar `createSolicitud`, `createPago`,
`finalizePagoDocumentUpload`, `processIqCreateOnDemandTask`, `processIqPagoDepositCreateQueue`;
crear `dispatchQueuedPagoIqCreation` y `processIqPagoDepositAutomaticTask`.
Los wrappers auxiliares ya productivos no requieren desplegar otros exports por haberlos recuperado
localmente. Compartir fuentes no autoriza desplegar todas las Functions.

Recursos nuevos: Function/servicio Cloud Run de la Task, cola Cloud Tasks
`processIqPagoDepositAutomaticTask`, Function/servicio del trigger y su Eventarc/transporte administrado.
Hosting `pay-0-system` y SSR `ssrpay0system` son necesarios para certificar la UI P0, pero su paquete
**no es desplegable todav?a**. Por ello no se declara un micro-deploy completo definitivo/seguro hasta
reconciliar ese baseline. No se incluyen complementos, sincronizaci?n inversa, reglas ni ?ndices.

IAM revalidado mediante getIamPolicy y lectura de colas:
- Runtime/caller/callee esperado: `751158244178-compute@developer.gserviceaccount.com`.
- Cuenta runtime conserva editor, eventarc.eventReceiver y run.invoker heredado en proyecto;
  editor cubre encolado/lectura de cola y actAs. No se concedieron permisos nuevos.
- Cuenta runtime conserva self iam.serviceAccountTokenCreator. Agente Cloud Tasks
  `service-751158244178@gcp-sa-cloudtasks.iam.gserviceaccount.com` conserva cloudtasks.serviceAgent/OIDC.
- Requisitos de secretos IQ_CREDENTIALS_KEY/TELEGRAM_BOT_TOKEN: secretAccessor runtime conforme
  al preflight aceptado; valores nunca consultados/publicados.
- Colas actuales de Solicitud/Pago on-demand RUNNING, 1/s y concurrencia 1, maxAttempts=1;
  cola nueva autom?tica Pago ausente. Su configuraci?n local conserva maxAttempts=3,
  backoff 300?900s y maxRetrySeconds=1800.
- **IAM: PASS de configuraci?n previa; invocaci?n del recurso nuevo no certificada.**

P0 no est? certificado: no hay timestamps end-to-end posteriores a despliegue, operaci?n controlada
ni validaci?n visual sin refresh/parpadeo. No se usaron m?tricas hist?ricas como evidencia de cierre.

---

## P0-R5 ? reconciliacion parcial y conflicto de alcance (2026-10-07)

**P0 ABIERTO. DEPLOY_READY = NO.** Base local: `a12cb6de14b0e489181dcd9d5df8283f47b6c0df`.
Sin push/deploy, cambios de switches, escrituras productivas ni llamadas IQ/Facturama.
Fuentes descargadas mediante GET autenticado, por Function y generacion exacta.
Las revisiones siguen siendo las del preflight aceptado; no se asumio un unico paquete productivo.

| Function existente | Revision productiva | Generacion de source ZIP |
|---|---|---|
| `createSolicitud` | `createsolicitud-00058-xev` | `1790583721253880` |
| `createPago` | `createpago-00060-qex` | `1790843385128228` |
| `finalizePagoDocumentUpload` | `finalizepagodocumentupload-00031-rox` | `1790585058949246` |
| `processIqCreateOnDemandTask` | `processiqcreateondemandtask-00007-rob` | `1790638545665964` |
| `processIqPagoDepositCreateQueue` | `processiqpagodepositcreatequeue-00019-qay` | `1790638545690989` |

Las nuevas `dispatchQueuedPagoIqCreation` y `processIqPagoDepositAutomaticTask`
no tienen baseline desplegado. Reutilizan el core Pago reconciliado y las correcciones P0 aceptadas.

### Cambios locales completados

- `createSolicitud`: cuerpo productivo, incluida atribucion de notas; conserva instrumentacion P0.
- `createPago`: cuerpo de su revision propia, captura identidad IQ de origen y vinculo cliente/perfil,
  validacion transaccional de identificacion, deduplicacion, metadata verificada y registro del recibo;
  conserva instrumentacion. No se copiaron los otros exports de index.ts.
- Solicitud Task/core: associatedName independiente del login, asociado obligatorio, catalogo unico,
  cliente por perfil y persistencia de linkage; Task AUTO lee habilitacion sin consumir intervalo.
- Pago core/scheduler: identidad de origen inmutable frente a reasignacion del usuario, perfil/root,
  cliente por perfil y retorno del catalogo resuelto. Conserva los fences de generacion P0,
  lock/write-once/respuesta incierta y la gracia de recovery. Scheduler reclama intervalo.
- Finalizador: hash SHA-256 contra bytes de Storage, identificacion del recibo, validacion transaccional
  de scope, replay sin version/auditoria adicional y reutilizacion del upload canonico. Enqueue P0
  solo tras nueva transicion QUEUED; reinicia su indicador en cada intento de transaccion.
- Transporte: recuperado guard productivo que bloquea IQ fuera de produccion.
- No cambios de implementacion REP, Facturama, switches o schedulers de complementos.

### Conflicto encontrado: no se acredita paridad completa

La inspeccion de dependencias por declaraciones, seguida de lectura semantica, encontro:

1. `createSolicitud -> linkSolicitudToMaterialityOperationCore -> projectMaterialityOperation
   -> getActivePagoUploadsBySolicitud`. Produccion incluye XML/PDF REP por aplicacion/parcialidad,
   transacciones coherentes y digest para evitar reescrituras. Local omite esa evidencia.
   Restaurar ese tramo toca procesamiento de documentos REP, mientras R5 ordena no modificar REP.
   **Se detuvo antes de incorporarlo.** Es un conflicto de alcance de dependencias, no un fallo
   observado en IQ real ni una afirmacion de que la Task sea incompatible con la identidad.
2. El wrapper productivo de `finalizePagoDocumentUpload` exige `pagos.uploadDocs`; local exige
   `pagos.create`. El techo canonico local no contiene uploadDocs para Pagos. Recuperar el contrato
   completo requiere reconciliar politica canonica, generado backend y bloque de reglas, sin
   habilitar permisos ad hoc. No se cambio ese contrato en esta entrega parcial.
3. `isCanonicalUserActive` productivo excluye tambien deleted/disabled/deletedAt; pendiente.
4. Auditoria productiva usa colecciones por sistema (PAY0/ASSETS/TTT/HUGO); local usa activityLog.
   Esa dependencia compartida tampoco esta reconciliada. La diferencia de la clase Hugo detectada
   por el recorrido requiere revision por metodo; no se copio el modulo completo.

Por estos pendientes, los PASS locales NO prueban `PRODUCTION CURRENT BEHAVIOR + P0 FIXES` completo.
El commit conserva solo el avance local verificable; no es un candidato autorizado para deploy.
No se declara un diff semantico final completo ni paridad de Hosting/SSR.

### Matriz de evidencia local

| PRODUCTION_PROTECTION | LOCAL_BEFORE | RECONCILED | TEST | RESULT |
|---|---|---|---|---|
| Asociado separado del login; catalogo unico | Usaba username; resolucion antigua | Recuperado | Asociado ausente/ambiguo y cliente por ID/nombre | PASS |
| Identidad IQ de origen Pago | Dependia del acceso actual del actor | Recuperada | Reasignacion, root ajeno, perfil inactivo, sustitucion | PASS |
| Cliente por perfil | Link global | Recuperado | Perfil correcto, legacy ajeno/sin scope | PASS |
| Identificacion recibo | No validada en createPago | Recuperada | Actor/root/payload/duplicado | PASS |
| Hash y replay finalizador | Sin hash de identificacion; reversionado | Recuperado en core | Bytes distintos rechazados; replay y upload duplicado sin writes | PASS |
| Idempotencia, lock y write-once | P0 aceptado | Conservados | Cinco workers y replay; automatic/manual/recovery | PASS |
| Resultado incierto | P0 aceptado | Conservado | No segundo POST incluso tras lease | PASS |
| Master OFF / intervalo | P0 aceptado | Conservado | OFF cero POST; inmediata un core; scheduler claim | PASS |
| Reactividad y descubrimiento | P0 aceptado | Sin cambios | Dos sesiones, paginacion, burst y reconexion | PASS |
| Transporte aislado | Guard productivo ausente | Recuperado | staging/test/sandbox bloqueados | PASS |
| Proyeccion REP/Materialidad | Historica | No incorporada por limite de alcance | Diff de dependencias | BLOCKED |
| uploadDocs / usuario inactivo | Historico | Pendiente | Comparacion wrapper/politica/guard | BLOCKED |
| Auditoria por sistema | Historica | Pendiente | Comparacion dependencia logActivity | BLOCKED |

La suite emulator usa Firestore real local y transporte IQ/Cloud Tasks simulados. El worker se
extrae del fuente; su adaptador de core conecta al HTTP core con lock/journal reales, no a una
sesion IQ. Las pruebas de identidad invocan los helpers recuperados contra perfiles sinteticos.
No hay prueba end-to-end productiva ni prueba visual sin parpadeo.

### Verificacion ejecutada

- Suite P0 emulator ampliada: 19/19 PASS (13 previas + 6 recuperacion R5).
- Reactividad: 8/8 PASS.
- Functions build, TypeScript frontend y verificador de autorizacion: PASS.
- Frontend build: PASS tras limpiar exclusivamente .next/cache; primer intento fallo en WasmHash.
- git diff --check: PASS.
- El PASS de autorizacion comprueba coherencia de la politica local actual, no paridad con produccion.

### Recursos eventuales (no autorizados)

Candidatos existentes: createSolicitud, createPago, finalizePagoDocumentUpload,
processIqCreateOnDemandTask, processIqPagoDepositCreateQueue.
Nuevos: dispatchQueuedPagoIqCreation, processIqPagoDepositAutomaticTask, cola homonima
us-central1 y trigger Eventarc administrado para pagos. Hosting pay-0-system y ssrpay0system
serian necesarios para servir los cambios UI, pero su baseline completo no esta certificado.
No desplegar Functions ajenas, complementos, reglas ni sincronizacion inversa con esta lista.

IAM esperado: runtime/caller `751158244178-compute@developer.gserviceaccount.com`, tasks.create,
queues.get, serviceAccounts.actAs, run.invoker; Cloud Tasks service agent con OIDC y runtime con
acceso a IQ_CREDENTIALS_KEY/TELEGRAM_BOT_TOKEN. Preflight previo verifico permisos existentes;
la nueva Function/cola no existe y su verificacion efectiva sigue pendiente.

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
