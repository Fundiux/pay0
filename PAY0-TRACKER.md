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
| F6 — Diseño, canónicos e integraciones financieras | ABIERTO | Unificar la experiencia visual y preparar capacidades financieras externas con controles. | `UX-01`: sistema visual canónico; `ARC-01`: carpeta/contratos canónicos; `AGT-007`: definir y crear Agente 007; `FAC-01`: Facturama; `BNK-01/02`: conciliación bancaria y dispersiones bancarias. | Diseño aprobado, contratos de integración, credenciales no versionadas y pruebas sandbox. |

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
| 2026-09-12 | SEC-01 | IMPLEMENTADO / VALIDACIÓN | Dashboard, rutas, resolución y asignación manual ya exigen el mismo `rootId`; los chats sin alcance quedan ocultos y no se pueden seleccionar. Se añadió índice y contrato canónico para que el conector persista `rootId` al sincronizar. | Functions build e índice JSON correctos. Falta actualizar el conector externo, sincronizar datos históricos por raíz y ejecutar smoke de aislamiento con dos roots antes de cerrar. |
| 2026-09-10 | WAL-02 | IMPLEMENTADO / VALIDACIÓN | Movimientos, anticipos y dispersiones se consultan por `scope` + cliente; se conserva el historial que sólo trae `clienteId` y se deduplican documentos con ambos campos. Las nuevas altas de anticipo ya guardan también `clientId`. | Functions build correcto e índices declarados. Falta desplegar índices y probar con datos representativos, incluido un cliente con más de 1,000 registros para decidir/persistir la paginación. |
| 2026-09-10 | PERF-04 | IMPLEMENTADO / VALIDACIÓN | Dispersiones reemplazó dos listeners por cada cliente por una sola lectura callable autorizada, acotada por `rootId`, ordenada y limitada a 500 registros. Las mutaciones existentes disparan su recarga mediante `balanceReloadKey`. | Functions build correcto. El build frontend quedó bloqueado por `.next/trace` en uso; falta smoke y definir cursor para más de 500 registros. |
| 2026-09-10 | SOL-PERF-01 | IMPLEMENTADO / VALIDACIÓN | Solicitudes preconstruye índices de relaciones de sustitución por lista; cada fila reutiliza esos mapas para origen, sustituta y cadena, eliminando búsquedas lineales repetidas durante el render. | Frontend build correcto. Falta smoke visual de cadenas de sustitución y paginación de la tabla. |
| 2026-09-10 | PERF-03 | IMPLEMENTADO / VALIDACIÓN | Clientes y Empresas usan caché compartida con deduplicación de llamadas y TTL de 30 segundos. Las altas, cambios de estado e identidad bancaria de Empresas invalidan el catálogo inmediatamente. | Frontend build correcto. Falta smoke autenticado de altas/ediciones para cerrar. |
| 2026-09-10 | PERF-06 | IMPLEMENTADO / VALIDACIÓN | `listUsers` ahora retorna páginas estables por cursor; Usuarios y Módulos solicitan 100 filas y ofrecen “Cargar más usuarios” cuando existen más resultados. | Functions y frontend build correctos. Falta smoke con más de 100 usuarios y revisión de acceso por admin. |
| 2026-09-10 | PERF-02 | IMPLEMENTADO / VALIDACIÓN | Dispersiones movió `xlsx`, `jspdf` y `jspdf-autotable` a importaciones dinámicas ejecutadas sólo al exportar Excel/PDF. | Frontend build correcto. Falta medir carga local y revisar separación adicional de modales operativos. |
| 2026-09-10 | PERF-D01 | IMPLEMENTADO / VALIDACIÓN | Se creó un generador de fixtures exclusivo para Firestore Emulator: 101 usuarios, 501 dispersiones y 1,001 movimientos por raíz de prueba, con limpieza explícita y bloqueo contra producción. | Levantar Emulator, ejecutar seed y realizar smoke local de cursor/límites. |
| 2026-09-10 | BNK-01 / BNK-02 | DECISIÓN DE ARQUITECTURA | Se usará una interfaz bancaria canónica con simulador local y adaptadores por proveedor. STP es candidato inicial por API de CLABEs por cliente, conciliación y SPEI; BBVA, Afirme y Banorte quedan como adaptadores futuros según las cuentas/contratos reales. | No se conectará ninguna cuenta ni se emitirán pagos sin sandbox, contrato, credenciales seguras y aprobaciones. |
| 2026-09-11 | AUTH-01 | IMPLEMENTADO / VALIDADO | Se corrigió un bypass de delegación: crear Solicitud exige `operateSolicitudes` y crear Pago exige `operatePagos`; una delegación de solo consulta ya no puede registrar operaciones. Se añadió una prueba local repetible de roles y delegaciones. | Functions compiló correctamente. Smoke de emulador aprobado: operador dueño y delegado autorizado continúan; delegado con solo vista queda bloqueado. |
| 2026-09-13 | WA-A5 | IMPLEMENTADO / VALIDACIÓN | La automatización crea un job idempotente al detectar PDF+XML: sin ruta/destino lo mantiene sin liberar y la pantalla dirige a Configurar rutas; con WhatsApp del cliente crea una única entrega y la libera. Se corrigieron los timestamps modulares de resolución y liberación. | Functions build y smoke local de ambos escenarios aprobados. Falta prueba con conector externo para confirmar `SENT` y cierre de `SEC-01`. |

## Registro de avance automático

Cada bloque terminado debe actualizar esta sección con hora, ID, resultado y siguiente
acción. La actualización programada de Codex depende de una automatización persistente
configurada en la aplicación; mientras no exista, este agente actualiza el registro al
cerrar cada bloque de trabajo verificable.

| Hora local | Bloque activo | Estado | Último resultado | Siguiente acción |
| --- | --- | --- | --- | --- |
| 2026-09-10 | PERF-01 + PERF-D01 | EN VALIDACIÓN | Consultas de Pagos por periodo e índices declarados; fixtures creados en Emulator. | Ejecutar smoke local de filtros/rango y registrar resultado. |
| 2026-09-10 | BNK-01 / BNK-02 | DISEÑO INICIAL | Se eligió arquitectura de adaptadores; STP es candidato sandbox inicial. | Crear contratos canónicos y simulador, sin credenciales externas. |
| 2026-09-10 | REP-01 | PENDIENTE DE IMPLEMENTACIÓN | Mover rango/orden al query o introducir agregados, sin truncar reportes. | Tercera tarea de F1. |

## Corte de despliegue y cierre

Este cuadro distingue lo que ya existe en la rama local de lo que aún impide
considerarlo cerrado. Un despliegue no se realizará hasta contar con aprobación
explícita y una revisión final de cambios, índices y configuración.

| Estado | Cantidad | Qué significa ahora |
| --- | ---: | --- |
| Cerrado | 2 | `AUTH-01` tiene smoke de Emulator aprobado y `OPS-01` ya está desplegado con Node 22. |
| Implementado / validación | 3 | `OPS-MET-01`, `IQ-01`, `IQ-02`: código construido; faltan pruebas de ciclo/sandbox indicadas en cada fila. |
| Validación pendiente | 6 | `PERF-02`, `PERF-03`, `PERF-04`, `PERF-06`, `SOL-PERF-01`, `WAL-02`: requieren smoke local y, en Wallet, despliegue de índices. |
| En curso | 2 | `SEC-01` y el diagnóstico global de rendimiento. |
| Abierto | 31 | Trabajo funcional, de seguridad, diseño e integraciones que todavía no debe presentarse como terminado. |

### Lote local listo para revisión previa a despliegue

1. Seguridad de delegaciones de Pagos/Solicitudes.
2. Rendimiento: paginación de usuarios, caché de clientes, carga diferida de exportaciones, lectura de Wallet y optimizaciones de Solicitudes/Dispersiones.
3. UX: login adaptable, copys/UIDs visibles corregidos y reporte de tiempos operativos.
4. Automatización: métricas internas, Telegram, WhatsApp documental y creación IQ inmediata mediante Cloud Tasks.
5. Resiliencia IQ: timeouts acotados en sus flujos principales.

Antes de desplegar este lote: ejecutar smoke local de las pantallas afectadas,
revisar el diff completo, desplegar Functions y frontend, y desplegar índices
solamente con la aprobación correspondiente. La validación con IQ requiere
cuenta sandbox; no se prueba contra IQ productivo.

> Despliegue — 2026-09-12: se habilitó `compute.googleapis.com` en
> `pay-0-system`. Las Functions nuevas `getOperationalMetricsReport` y
> `processIqCreateOnDemandTask`, junto con las Functions modificadas del lote,
> están activas en producción. Hosting publicó la versión SSR y
> `https://pay-0-system.web.app/login` respondió HTTP 200. No se ejecutaron
> operaciones IQ, bancarias ni envíos reales durante la validación.
>
> Plataforma — 2026-09-12: el runtime SSR fue migrado y validado en `nodejs22`;
> la Function `ssrpay0system` está `ACTIVE` y `/login` respondió HTTP 200.
> `OPS-01` queda cerrado. La Function histórica
> `debugPagoIqDepositHttpShadow` se conservó: impide un despliegue global no
> interactivo, pero no bloqueó el despliegue dirigido del lote actual.

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
| SEC-01 | IMPLEMENTADO / VALIDACIÓN | P0 | WhatsApp / permisos | Jobs, rutas, resolución y asignación manual exigen `rootId`; chats históricos sin propietario quedan ocultos. El contrato canónico exige que el conector persista `rootId` al procesar `SYNC_CHATS`. | Actualizar conector externo, sincronizar por raíz y ejecutar prueba focalizada con dos roots; no cerrar mientras existan chats sin alcance persistido. |
| SEC-02 | IMPLEMENTADO / VALIDACIÓN | P0 | Dependencias | Se actualizaron versiones menores de Firebase, Functions, Admin y Vision. Auditoría posterior: raíz 29 vulnerabilidades (8 altas, 1 crítica) y Functions 12 (3 altas); builds y política de autorización pasaron. `xlsx` continúa como dependencia directa vulnerable sin parche y procesa archivos cargados por usuarios. | Sustituir o aislar el lector `xlsx` con pruebas de órdenes de compra y cargas masivas; revisar las tres altas restantes de Functions bajo Node 22 y validar en entorno limpio. |
| XLSX-01 | ABIERTO | P0 | Archivos / seguridad | `xlsx` lee órdenes de compra y cargas masivas de archivos proporcionados por usuarios, además de generar exportaciones. No dispone de parche para sus vulnerabilidades altas. | Reemplazarlo por lector/exportador `.xlsx`/CSV mantenido; retirar `.xls` legado; pruebas con encabezados de dispersión, totales de OC, archivos inválidos y exportaciones. |
| AUTH-01 | CERRADO | P0 | Operaciones / delegación | Las altas de Solicitudes y Pagos ya diferencian permisos de consulta de permisos operativos por cliente. Un usuario delegado debe tener el permiso específico para cada flujo. | Smoke de emulador aprobado: operador directo, delegado con solo vista bloqueado y delegado autorizado permitido. El rol independiente `cliente` continúa como alcance nuevo, sin reutilizar indebidamente el rol operador. |
| OPS-MET-01 | IMPLEMENTADO / VALIDACIÓN | P1 | Operación / métricas | Se registran marcadores privados al crear y resolver Solicitudes/Pagos, al crear entregas WhatsApp y al recibir/responder Telegram. Reportes expone primera respuesta, tiempos promedio/mediano, comparativo por tipo y exportación, respetando el alcance del rol. | Completar asignación y entrega final; añadir WhatsApp entrante cuando el conector exponga webhook seguro; ejecutar ciclo local completo para línea base semanal. |
| OPS-01 | CERRADO | P0 | Runtime | El `package.json` raíz fija Node 22; el despliegue SSR fue validado en `nodejs22` con `ssrpay0system` activo y `/login` HTTP 200 (2026-09-12). | Cumplido: runtime SSR y Functions quedan estandarizados en Node 22. |
| WA-A5 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | La automatización crea/reutiliza el job PDF+XML de manera idempotente; sin ruta/destino no libera la entrega y la UI dirige a Configurar rutas; con ruta válida libera una sola entrega. | Smoke local aprobado para destino ausente y WhatsApp de cliente. Falta conector externo para confirmar `SENT`, ruta DEFAULT real y repetición sin duplicado. |
| WA-CONTACTS-01 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | “Actualizar contactos” crea el comando `SYNC_CHATS`, espera su terminación y ahora exige que `lastChatsSyncedAt` avance; si el conector marca `DONE` sin confirmar una actualización nueva, muestra un error. La pantalla y el resultado muestran conteo y fecha de sincronización. | Frontend build correcto. Falta prueba con el conector externo: alta/cambio real debe reflejarse en PAY0; además el conector debe persistir `rootId` según el contrato canónico. |
| WA-UI-01 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | Las tarjetas Pendientes, Errores y Enviadas ahora aplican el filtro, muestran visualmente cuál está activa y al pulsarla de nuevo regresan a todos los estados. Se eliminó la fila duplicada de botones de estado; Pendientes permanece como vista inicial. | Frontend build correcto; ejecutar smoke visual de selección, cambio y limpieza de filtro antes de cerrar. |
| WA-UI-02 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | La clasificación y los totales por cliente ahora asignan cada job a una sola categoría: Enviado, Error o Pendiente. Los errores dejaron de contabilizarse también como pendientes. | Frontend build correcto; ejecutar smoke visual con jobs de las tres categorías antes de cerrar. |
| WA-PERF-01 | ABIERTO | P1 | WhatsApp | El dashboard carga hasta 300 jobs y puede realizar una lectura de deliveries por job. | Listado paginado con read-model/resúmenes; detalles cargados bajo demanda. |
| PERF-01 | ABIERTO | P1 | Frontend / Pagos | `/pagos` mantiene suscripciones completas de pagos, solicitudes y aplicaciones, y filtra en navegador. | Consultas por periodo con `limit`/cursor; tabla no carga el historial completo. |
| PERF-02 | VALIDACIÓN | P1 | Frontend | Dispersiones ya difiere librerías pesadas de Excel/PDF hasta la exportación. Pagos, Solicitudes y Beneficiarios siguen pendientes de división/medición específica. | Medición local de bundle/carga y separar modales o flujos restantes sin degradar operación. |
| PERF-04 | VALIDACIÓN | P1 | Frontend / Dispersiones | La vista ahora usa una sola carga autorizada por `rootId`, en vez de dos listeners por cliente; se limita a 500 filas y se recarga tras mutaciones. | Smoke de filtros/operaciones y cursor por periodo para historiales superiores a 500. |
| PERF-05 | ABIERTO | P2 | Frontend / Dashboard | El dashboard descarga todas las solicitudes del rango elegido para calcular tres contadores en navegador. | Contadores agregados/consultas acotadas y medición de respuesta anual. |
| PERF-06 | VALIDACIÓN | P2 | Usuarios | `listUsers` y sus dos pantallas consumidoras ya usan páginas de 100 filas con cursor y acción “Cargar más”. | Smoke con más de 100 usuarios y rol admin; la búsqueda seguirá sobre lo ya cargado hasta definir búsqueda de servidor. |
| PERF-07 | ABIERTO | P2 | Telegram / documentos | Varias funciones Telegram leen 200–500 uploads del root y algunas resuelven solicitudes una por una. | Query selectiva por tipo/estado/solicitud y lecturas agrupadas o metadatos ya disponibles. |
| SOL-PERF-01 | VALIDACIÓN | P1 | Solicitudes | Relaciones de sustitución se indexan una vez por lista y las filas consultan mapas, en lugar de recorrer todas las solicitudes durante cada render. | Smoke visual de origen/cadena/vigente; completar paginación de tabla. |
| IQ-01 | IMPLEMENTADO / VALIDACIÓN | P1 | IQ / resiliencia | El wrapper HTTP canónico con timeout acotado protege Solicitudes, Depósitos y el POST de Dispersiones; también lectura, recuperación, conciliación, catálogos, descarga de factura y diagnósticos. Las llamadas restantes ya tenían `AbortController` acotado. No hace reintentos implícitos sobre creaciones potencialmente enviadas. | Definir tiempos por operación y probar timeout controlado contra sandbox/local antes de cerrar. |
| IQ-02 | IMPLEMENTADO / VALIDACIÓN | P1 | IQ / automatización | La creación IQ de Solicitudes encola una Cloud Task inmediata e idempotente usando el mismo job, bloqueo por perfil y lógica de recuperación. Para automatización respeta la configuración activa de la raíz; solicitudes manuales autorizadas pueden iniciar sin esperar cinco minutos. El scheduler permanece como respaldo si Cloud Tasks falla. | Emulator validó descubrimiento, creación de cola y ejecución inocua del handler (14 ms); falta prueba con job real + IQ sandbox para medir cola→inicio y confirmar que tarea/scheduler no duplican POST. |
| WAL-02 | VALIDACIÓN | P1 | Wallet / estado de cuenta | La lectura ya se acota por `scope` y cliente, evitando que los primeros 1,000 documentos de todo el scope oculten historial del cliente. Cada colección aún conserva un límite de 1,000 por cliente. | Desplegar índices y validar saldo/historial. Si un cliente puede superar 1,000 registros, añadir cursor/rango y prueba focalizada antes de cerrar. |
| MAT-01 | ABIERTO | P2 | Materialidad | El dashboard limita folders, operaciones y contratos por root antes de agrupar/filtrar localmente; puede omitir operaciones al superar los topes. | Paginación o read-model por carpeta con resultados deterministas. |
| REP-01 | IMPLEMENTADO / VALIDACIÓN | P1 | Reportes | Ganancias por cliente y Tiempos operativos consultan por `rootId` + `createdAt`. Pagos nuevos guardan `reportDateAt`; `backfillPagoReportDates` está desplegada y el panel superadmin está compilado. La consulta de incidencias de Pagos ya quedó preparada localmente para filtrar y ordenar por `rootId + reportDateAt`, con su índice. Hosting no pudo publicar el panel: dos subidas consecutivas a Google Storage se reiniciaron (`ECONNRESET`) después de 28.5 MB y 9.5 MB. | Estabilizar la subida a Google Storage, publicar el panel, ejecutar simulación y backfill por root; después desplegar el índice y la consulta de Pagos, y validar rangos antes de cerrar. |
| PERF-03 | IMPLEMENTADO / VALIDACIÓN | P2 | Frontend / catálogos | Clientes y Empresas usan caché compartida con TTL y deduplicación. Las mutaciones de Empresa invalidan explícitamente la caché para que el siguiente listado refleje el cambio sin esperar 30 segundos. | Ejecutar smoke autenticado de alta, edición bancaria y activación/desactivación antes de cerrar. |
| UX-01 | ABIERTO | P1 | Diseño / frontend | Varias páginas difieren en espaciado, jerarquía, tablas, acciones y estados, lo que puede confundir la operación. | Inventario visual, tokens/componentes canónicos y migración por pantalla con revisión visual. |
| ARC-01 | ABIERTO | P1 | Arquitectura | Falta una ubicación única y versionada para contratos, estados, copys, formatos visuales y decisiones canónicas que el sistema pueda reutilizar. | Carpeta `src/canonicos/` con esquema, ownership y primeros contratos consumidos por código, sin duplicar reglas financieras. |
| AGT-007 | ABIERTO | P1 | Hugo Sánchez / Agente 007 | Una sola entidad: para clientes se presenta como Hugo o Hugito; internamente conserva el identificador Agente 007. Aprenderá de todos los módulos y de las decisiones humanas, incluyendo el rol, permiso y alcance que las autorizó. No responderá ni ejecutará acciones en esta etapa. | Especificación canónica, bitácora de observación con intención, decisión humana, resultado y contexto de autorización; métricas únicas por agente y pruebas locales sin acciones financieras ni mensajes autónomos. |
| HUGO-REC-01 | ABIERTO | P1 | Hugo Sánchez / comprobantes | La lectura de comprobantes PDF/imagen no detecta pagos de forma confiable y obliga a captura manual. Hugo observará extracción, correcciones y conciliación para mejorar sugerencias antes de aplicar pagos automáticamente. | Medir precisión por banco/formato; extraer importe, fecha, referencia y emisor; propuesta vinculada a pago con confianza y revisión humana; automatización posterior sólo con reglas, límites y auditoría. |
| FAC-01 | ABIERTO | P1 | Facturama | Emitir CFDI desde PAY0 requiere contrato API, credenciales sandbox/producción, manejo de certificados, idempotencia, cancelación y evidencia fiscal. | Cliente backend exclusivo, secretos fuera de Git, flujo sandbox de emitir/consultar/cancelar y bitácora auditable antes de producción. |
| BNK-01 | ABIERTO | P0 | Banca / conciliación | Conciliar depósitos de cuentas propias exige un proveedor bancario/Open Banking con acceso autorizado y una identidad estable de transacción. | Selección de banco/proveedor y sandbox; ingestión sólo de lectura, reconciliación idempotente y aprobaciones operativas. |
| BNK-02 | ABIERTO | P0 | Banca / dispersiones | Dispersar desde PAY0 requiere API bancaria/SPEI, beneficiarios verificados, límites, doble autorización, idempotencia y reversos/incidencias. | Contrato bancario/sandbox, flujo de aprobación segregado y pruebas de punta a punta; nunca se activa producción sin autorización explícita. |
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
| AUTH-01 | 2026-09-11 | Delegación operativa cerrada: Solicitudes y Pagos exigen permisos operativos específicos. | Smoke de Emulator: dueño y delegado autorizado permitidos; delegado de solo vista bloqueado. |
| OPS-01 | 2026-09-12 | Runtime SSR y Functions estandarizados en Node 22. | `ssrpay0system` activo y `/login` respondió HTTP 200. |

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
