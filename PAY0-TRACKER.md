# PAY0 — Tracker de trabajo y continuidad

Actualizado: 2026-09-09  
Propósito: fuente viva de pendientes, bugs, decisiones y cierres verificables.

Este archivo complementa `AGENTS.md`; no lo reemplaza. `AGENTS.md` conserva reglas
estables de desarrollo y seguridad. Aquí se administra el trabajo que cambia día a día.

## Cómo usarlo

- Estados válidos: `ABIERTO`, `EN CURSO`, `BLOQUEADO`, `VALIDACIÓN`, `CERRADO`.
- Todo pendiente nuevo recibe un ID, prioridad, evidencia y criterio de cierre.
- No se marca `CERRADO` sin indicar la fecha, el cambio realizado y la verificación.
- Toda implementación debe añadir una entrada en **Resultados y decisiones**: cambio real,
  alternativa elegida si aplica, pruebas, y motivo de cierre o bloqueo.
- No borrar trabajo histórico: mover los cierres a la sección **Cerrados**.
- Un cambio financiero, de permisos, reglas o producción debe respetar `AGENTS.md`.

## Plan de ejecución

El orden no significa mezclar cambios. Cada fase debe ser una rama/commit coherente,
con pruebas focalizadas, revisión de diff y actualización de su resultado aquí.

| Fase | Estado | Objetivo | Acciones concretas | Dependencia / salida |
| --- | --- | --- | --- | --- |
| F0 — Línea base | EN CURSO | Convertir hallazgos en casos verificables. | Terminar inventario de queries/callables; preparar datos de prueba representativos; medir carga, lecturas y tiempo de acción. | Backlog confirmado y métricas iniciales por pantalla. |
| F1 — Integridad y aislamiento | PENDIENTE | Corregir primero cualquier dato incompleto o fuera de scope. | `SEC-01`: limitar dashboard WhatsApp por `rootId`; `WAL-02`: consultar Wallet por cliente; `REP-01`: consultas de reportes deterministas por rango. | Pruebas de aislamiento, estados de cuenta >1,000 registros y reportes de rango. |
| F2 — Velocidad de operación | PENDIENTE | Quitar descargas y renders masivos de las pantallas diarias. | `PERF-04`: eliminar listeners por cliente en Dispersiones; `PERF-01`: paginar Pagos; `SOL-PERF-01`: precomputar sustituciones y paginar Solicitudes; `PERF-05/06`: contadores/listados acotados. | Medición antes/después y misma información funcional visible. |
| F3 — WhatsApp A5 | PENDIENTE | Construir la bandeja de candidatos sin jobs previos, manteniendo envío manual. | Candidatos PDF+XML paginados; identidad de Cliente; job perezoso; estados excluyentes; tarjetas-filtro; ruta DEFAULT en Clientes; smoke completo. | `SEC-01` resuelto; automático permanece apagado. |
| F4 — Integraciones y resiliencia | PENDIENTE | Reducir esperas externas y asegurar evidencia operativa. | `IQ-01`: wrapper HTTP; `IQ-02`: SLA/Cloud Tasks iniciales; `PERF-07`: consultas Telegram; validar Dispersiones IQ y adjuntos Telegram. | Pruebas end-to-end controladas, sin acciones productivas no autorizadas. |
| F5 — Plataforma y calidad | PENDIENTE | Hacer sostenibles los cambios. | `SEC-02`, `OPS-01`, `QA-01`, `DOC-01`, `DOC-02`; CI, Node 22/SSR, dependencias y runbook. | Pipeline reproducible y checkpoint/ZIP canónico. |

### Próximo cambio propuesto

**F1 / SEC-01 — Scope de WhatsApp por `rootId`.** Es pequeño, aislado, no altera
el envío automático y elimina una posible mezcla de datos entre raíces. Antes de
implementarlo se confirmará que los documentos históricos de jobs/rutas/chats
incluyen `rootId`; si no lo incluyen, se aplicará una migración de compatibilidad
con lectura segura, nunca una exclusión silenciosa de historial.

Después: **F1 / WAL-02**, porque puede afectar exactitud de estados de cuenta.

## Resultados y decisiones

Registrar una fila al iniciar, al cambiar el enfoque y al cerrar un ID. El resultado
puede ser `IMPLEMENTADO`, `NO REPRODUCIDO`, `ALTERNATIVA`, `BLOQUEADO` o `CERRADO`.

| Fecha | ID | Resultado | Decisión / cambio realizado | Evidencia y siguiente estado |
| --- | --- | --- | --- | --- |
| 2026-09-09 | PERF-D01 | EN CURSO | Se inició diagnóstico estático global; no se aplicaron cambios funcionales. | Hallazgos registrados de listeners, queries, reportes e integraciones. |
| 2026-09-10 | SEC-01 | EN CURSO / PARCIAL | Dashboard y actualización de rutas ahora consultan jobs/rutas por `rootId`; se añadieron sus índices. Los chats del conector siguen globales porque su sincronización no guarda `rootId`. | Functions build correcto. Definir propiedad de chats y migración/sincronización antes de cerrar el aislamiento completo. |
| 2026-09-10 | WAL-02 | IMPLEMENTADO / VALIDACIÓN | Movimientos, anticipos y dispersiones se consultan por `scope` + cliente; se conserva el historial que sólo trae `clienteId` y se deduplican documentos con ambos campos. Las nuevas altas de anticipo ya guardan también `clientId`. | Functions build correcto e índices declarados. Falta desplegar índices y probar con datos representativos, incluido un cliente con más de 1,000 registros para decidir/persistir la paginación. |
| 2026-09-10 | REP-01 | PENDIENTE DE IMPLEMENTACIÓN | Mover rango/orden al query o introducir agregados, sin truncar reportes. | Tercera tarea de F1. |

## Cobertura total del sistema

El tracker cubre todos los dominios conocidos de PAY0. Una fila `PENDIENTE DE
DIAGNÓSTICO` no significa que el módulo esté fallando: significa que todavía no ha
sido revisado de forma sistemática para bugs, rendimiento y pruebas.

| Dominio | Estado de diagnóstico | Seguimiento principal |
| --- | --- | --- |
| Autenticación, usuarios, roles y delegación | PENDIENTE DE DIAGNÓSTICO | Seguridad, permisos, `rootId`, rutas y auditoría. |
| Clientes, empresas y despachos | PENDIENTE DE DIAGNÓSTICO | Rendimiento de catálogos, acceso y configuración de rutas. |
| Solicitudes, documentos, OC y facturas | PENDIENTE DE DIAGNÓSTICO | `SOL-01`, `SOL-02`, validación de importes y rendimiento de tabla. |
| Pagos, conciliación y aplicaciones | PENDIENTE DE DIAGNÓSTICO | `PAG-01`, `PERF-01`. |
| Wallet, adelantos, beneficiarios y estados de cuenta | PENDIENTE DE DIAGNÓSTICO | `WAL-01`, `PERF-02`. |
| Dispersiones y comprobantes | PENDIENTE DE DIAGNÓSTICO | `DISP-01`, `DISP-02`, `DISP-03`, `PERF-02`. |
| IQ: creación, depósitos, sincronización y automatización | PENDIENTE DE DIAGNÓSTICO | Latencia, idempotencia, colas y estados terminales. |
| WhatsApp y entrega documental | HALLAZGOS INICIALES | `SEC-01`, `WA-A5`, `WA-UI-01`, `WA-UI-02`, `WA-PERF-01`. |
| Telegram / MAT | PENDIENTE DE DIAGNÓSTICO | `TEL-01`. |
| Facturama | PENDIENTE DE IMPLEMENTACIÓN | `FAC-01`. |
| Reportes, actividad y exportaciones | PENDIENTE DE DIAGNÓSTICO | Consultas, exportación y calidad de auditoría. |
| Firestore, Storage, Functions, Hosting SSR y CI | HALLAZGOS INICIALES | `SEC-02`, `OPS-01`, `QA-01`, `PERF-D02`, `PERF-D04`. |

## Prioridad actual

| ID | Estado | Prioridad | Área | Pendiente | Criterio de cierre |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | EN CURSO | P0 | WhatsApp / permisos | Jobs y rutas ya se consultan por `rootId`; los chats del conector aún no contienen un propietario de raíz. | Definir y persistir propiedad de chats; cada lectura queda limitada al `rootId` autorizado y existe prueba focalizada de aislamiento. |
| SEC-02 | ABIERTO | P0 | Dependencias | Auditoría de producción: 31 vulnerabilidades en raíz (10 altas) y 16 en Functions (5 altas). `xlsx` tiene vulnerabilidades altas sin corrección disponible. | Plan de actualización probado; dependencia `xlsx` reemplazada, aislada o mitigada explícitamente. |
| OPS-01 | ABIERTO | P0 | Runtime | Functions exige Node 22, pero el entorno local observado ejecuta Node 20. El SSR de Hosting también requiere revisión separada. | Node 22 queda estandarizado y el runtime SSR se valida en una tarea dedicada. |
| WA-A5 | ABIERTO | P1 | WhatsApp | Construir candidatos desde PDF+XML activos de solicitudes, sin requerir un job previo; crear/reutilizar job sólo al enviar manualmente. | Smoke manual: candidato sin job, ruta DEFAULT, envío, `SENT` y repetición sin duplicado. |
| WA-UI-01 | ABIERTO | P1 | WhatsApp | Las tarjetas de estado no son filtros; aún existe una fila duplicada de filtros. | Tarjetas clicables y filtro único, con estado predeterminado Pendientes. |
| WA-UI-02 | ABIERTO | P1 | WhatsApp | Errores también se contabilizan como pendientes. | Categorías Pendiente/Error/Enviado mutuamente excluyentes y conteos consistentes. |
| WA-PERF-01 | ABIERTO | P1 | WhatsApp | El dashboard carga hasta 300 jobs y puede realizar una lectura de deliveries por job. | Listado paginado con read-model/resúmenes; detalles cargados bajo demanda. |
| PERF-01 | ABIERTO | P1 | Frontend / Pagos | `/pagos` mantiene suscripciones completas de pagos, solicitudes y aplicaciones, y filtra en navegador. | Consultas por periodo con `limit`/cursor; tabla no carga el historial completo. |
| PERF-02 | ABIERTO | P1 | Frontend | Pantallas grandes: Pagos, Dispersiones, Solicitudes y Beneficiarios concentran mucha lógica y renders. | Perfil de rendimiento por pantalla y plan aplicado: componentes de filas estables, carga diferida y/o virtualización donde corresponda. |
| PERF-04 | ABIERTO | P1 | Frontend / Dispersiones | La vista abre dos listeners de `clientDispersions` por cada cliente accesible y descarga historiales completos antes de filtrar. | Una consulta paginada y acotada por `rootId`/periodo; compatibilidad histórica resuelta sin listeners por cliente. |
| PERF-05 | ABIERTO | P2 | Frontend / Dashboard | El dashboard descarga todas las solicitudes del rango elegido para calcular tres contadores en navegador. | Contadores agregados/consultas acotadas y medición de respuesta anual. |
| PERF-06 | ABIERTO | P2 | Usuarios | `listUsers` obtiene todos los usuarios del `rootId` sin límite, cursor ni paginación. | Listado paginado y búsqueda servidor/lado cliente sólo sobre una página acotada. |
| PERF-07 | ABIERTO | P2 | Telegram / documentos | Varias funciones Telegram leen 200–500 uploads del root y algunas resuelven solicitudes una por una. | Query selectiva por tipo/estado/solicitud y lecturas agrupadas o metadatos ya disponibles. |
| SOL-PERF-01 | ABIERTO | P1 | Solicitudes | La tabla calcula relaciones/cadenas de sustitución buscando en toda la lista por cada fila y vuelve a buscar sustitutas durante el render. | Índices de sustitución calculados una vez por lista; filas reciben datos precomputados y la tabla se pagina. |
| IQ-01 | ABIERTO | P1 | IQ / resiliencia | Varios clientes HTTP directos de IQ usan `fetch` sin `AbortController`/timeout local; una dependencia lenta puede consumir la ventana completa del callable. | Wrapper HTTP canónico con timeout, clasificación de error y reintento seguro donde corresponda. |
| IQ-02 | ABIERTO | P1 | IQ / automatización | Varias colas IQ se procesan por scheduler cada cinco minutos y con concurrencia 1; por diseño no garantizan inicio inmediato después de una solicitud. | SLA definido; acción inicial encolada por Cloud Task/evento o UI informa la ventana real sin crear una arquitectura paralela. |
| WAL-02 | VALIDACIÓN | P1 | Wallet / estado de cuenta | La lectura ya se acota por `scope` y cliente, evitando que los primeros 1,000 documentos de todo el scope oculten historial del cliente. Cada colección aún conserva un límite de 1,000 por cliente. | Desplegar índices y validar saldo/historial. Si un cliente puede superar 1,000 registros, añadir cursor/rango y prueba focalizada antes de cerrar. |
| MAT-01 | ABIERTO | P2 | Materialidad | El dashboard limita folders, operaciones y contratos por root antes de agrupar/filtrar localmente; puede omitir operaciones al superar los topes. | Paginación o read-model por carpeta con resultados deterministas. |
| REP-01 | ABIERTO | P1 | Reportes | Reportes aplican `limit` por `rootId` sin `orderBy` ni rango de fechas en Firestore, y filtran fechas después. Puede omitir registros del periodo y producir resultados no deterministas al crecer el historial. | Consultas deterministas por fecha/índices o agregados; resultado completo para el rango solicitado. |
| PERF-03 | ABIERTO | P2 | Frontend / catálogos | Clientes y empresas hacen polling por callable cada 30 segundos desde diversas vistas. | Caché compartida e invalidación tras mutaciones; polling sólo donde tenga justificación operativa. |
| QA-01 | ABIERTO | P1 | Calidad | No hay CI, `npm test` estándar ni lint funcional de Functions. La QA histórica está fragmentada y `qa:pay0` no es un gate confiable. | Pipeline reproducible: policy verifier, builds, lint funcional, pruebas de reglas y smoke estable. |
| DOC-01 | ABIERTO | P2 | Operación | README no contiene runbook de entornos, despliegue, reversión, reconciliación ni incidentes. | Runbook revisado y versionado. |
| DOC-02 | ABIERTO | P2 | Continuidad | Generar ZIP canónico y checkpoint actualizado después del siguiente hito estable. | ZIP excluye secretos/artefactos y el checkpoint refleja el estado validado. |

## Pendientes funcionales vigentes

| ID | Estado | Prioridad | Área | Pendiente | Criterio de cierre |
| --- | --- | --- | --- | --- | --- |
| SOL-01 | ABIERTO | P2 | Solicitudes | Simplificar `DocsModal`: área compacta IQ/WhatsApp y tabla de documentos HTML válida. | Revisión visual y smoke de documentos, IQ y envío manual. |
| SOL-02 | ABIERTO | P2 | Solicitudes / IQ | Reducir notas automáticas duplicadas y validar latencia/SLA de creación IQ automática. | Bitácora útil sin duplicación; medición de ejecución y SLA acordado. |
| DISP-01 | ABIERTO | P1 | Dispersiones | Aceptar CLABE o tarjeta válida; prioridad CLABE sobre tarjeta. | Casos de CLABE, tarjeta y ambos validados contra IQ. |
| DISP-02 | ABIERTO | P1 | Dispersiones | IQ por defecto cuando aplica; saldos visibles al elegir cliente; filtros temporales canónicos; exportación y comprobante IQ. | Smoke de dispersión individual y masiva con comprobante persistido. |
| DISP-03 | ABIERTO | P1 | Dispersiones | Validar que lotes masivos lleguen realmente a IQ y no queden sólo en `CREADA`. | Trazabilidad de lote desde PAY0 hasta IQ y estado final. |
| PAG-01 | ABIERTO | P1 | Pagos | Verificar depósitos IQ, conciliación, aplicación, estados terminales e idempotencia de postings. | Suite focalizada con casos de rechazo, reintento y aplicación parcial/total. |
| WAL-01 | ABIERTO | P2 | Wallet | Validar postings y estados de cuenta por usuario/cliente sin mezclar semántica PPD. | Conciliación de eventos y saldos con casos de adelanto, dispersión y devolución. |
| FAC-01 | ABIERTO | P2 | Facturama | Integración sólo para compañías propias: credenciales, CFDI, documentos, cancelación, auditoría y sincronización. | Primera compañía propia opera end-to-end sin acceso a compañías de despachos. |
| TEL-01 | ABIERTO | P2 | Telegram | Revalidar entrega de PDF/XML cuando la factura queda lista. | Prueba end-to-end confirma notificación con ambos adjuntos. |

## Backlog de diagnóstico global de rendimiento

Estos puntos deben medirse antes de optimizar; no asumir que toda espera es de React.

| ID | Estado | Prioridad | Alcance | Entregable |
| --- | --- | --- | --- | --- |
| PERF-D01 | EN CURSO | P1 | Pagos, Solicitudes, Dispersiones, Beneficiarios, Clientes, WhatsApp, Dashboard | Medir tiempo de primera carga, datos descargados, número de lecturas y duración de acciones críticas por rol. | Línea base con datos de prueba representativos. |
| PERF-D02 | ABIERTO | P1 | Firestore | Revisar consultas sin límite, filtros locales, índices y suscripciones en tiempo real. | Inventario de queries y decisión por pantalla: listener, carga puntual o paginación. |
| PERF-D03 | ABIERTO | P1 | React | Usar React Profiler en tablas y modales pesados para localizar renders evitables. | Lista de componentes con costo y correcciones verificadas. |
| PERF-D04 | ABIERTO | P2 | Red / Functions | Medir callables de IQ, WhatsApp, carga de archivos y reportes; separar espera remota de respuesta visual. | Presupuesto de latencia y estrategia de progreso/actualización optimista. |

## Cerrados

| ID | Fecha | Resultado | Verificación |
| --- | --- | --- | --- |
| — | — | Aún no se han registrado cierres en este tracker. | — |

## Registro de hallazgos

- 2026-09-08: build de frontend y Functions correcto; verificador de política de autorización correcto.
- 2026-09-08: reglas de Storage revisadas como restrictivas por defecto; mutaciones frontend directas a Firestore no detectadas en el escaneo estático.
- 2026-09-09: se detectó solapamiento de conteos Pendiente/Error en WhatsApp, falta de `rootId` en el dashboard WhatsApp y patrón N+1 de deliveries.
- 2026-09-09: se detectaron suscripciones sin paginación para datos operativos voluminosos y polling de catálogos cada 30 segundos.
- 2026-09-09: se detectó que Dispersiones instala dos listeners por cliente accesible para compatibilidad histórica y fusiona todo el historial localmente; se registró como `PERF-04`.
- 2026-09-09: se inició el diagnóstico global `PERF-D01`; el mapa confirma que Pagos, Solicitudes, Dispersiones y pantallas de costos concentran la mayor cantidad de listeners del frontend.
- 2026-09-10: `listUsers` consulta todos los usuarios de un root sin paginación; registrado como `PERF-06`.
- 2026-09-10: se registró `REP-01`: límites previos al filtro de fechas en Reportes comprometen exactitud y consistencia de resultados.
- 2026-09-10: se registró `PERF-07`: flujos Telegram exploran lotes amplios de uploads y pueden realizar lecturas por solicitud.
- 2026-09-10: se registró `SOL-PERF-01`: cálculo repetido de sustituciones en render de la tabla de Solicitudes.
- 2026-09-10: se registró `IQ-01`: múltiples fetch HTTP de IQ no aplican timeout/cancelación local de forma uniforme.
- 2026-09-10: se registró `IQ-02`: la cadencia de cinco minutos de colas IQ explica parte de la latencia percibida de automatización.
- 2026-09-10: se registró `WAL-02`: consultas globales del scope antes de filtrar por cliente pueden truncar un estado de cuenta.
- 2026-09-10: se registró `MAT-01`: límites previos a la agregación pueden incompletar el dashboard de Materialidad a escala.
