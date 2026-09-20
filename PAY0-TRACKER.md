# PAY0 — Tracker de trabajo y continuidad

Actualizado: 2026-09-20
Propósito: fuente viva de pendientes, bugs, decisiones y cierres verificables.

## Hugo 2.0 / cotización canónica / REP por Pago / ASSETS V1 — 2026-09-20

- Rama de trabajo: `feature/hugo-assets-platform-v1`. Implementación desplegada en producción; la rama todavía no está fusionada ni publicada al remoto.
- Cotización: renderer HTML/CSS A4 alineado al encabezado canónico TROSTRE (logotipo, título, folio/fecha/vigencia y franja institucional); metadatos técnicos ocultos. Vista previa local generada con el renderer productivo y revisada visualmente.
- Hugo: reconciliación genérica previa a lectura. Propuestas pre-emisión pasan a `SUPERSEDED` al existir CFDI y registran `resolvedAt`, `resolvedByEvent`, `supersededBy` y `resolutionReason`. Una OC sin conflicto SAT concreto queda `OBSERVATION_ONLY`, no exige Correcto/Corregir. UI separa decisiones accionables, historial y observaciones.
- Hugo operativo: capacidad controlada `REQUEST_IQ_PAYMENT_COMPLEMENT`, sólo Superadmin y sólo ante comando explícito. Reutiliza la cola idempotente existente, informa `QUEUED/REQUESTED/BLOCKED/UNKNOWN`, no repite POST inciertos y deja auditoría.
- Complementos: XML/PDF descargados se guardan desde ahora bajo `roots/{rootId}/pagos/{pagoId}/docs/...`, con `entityType: pagos`, versión por pago y referencia a Solicitud/aplicación; dejan de incorporarse como documentos originales de Solicitud.
- ASSETS V1: dominio privado por `ownerUid`, posiciones VEHICLE/LOAN, ledger en centavos, orígenes separados de efectos financieros, interés simple/capitalizable/sin interés, pagos manuales/efectivo/transferencia/PAY0, idempotencia de periodos y enlaces, borrador documental con revisión humana y seed U-PRO idempotente.
- Verificación y despliegue: builds Functions/frontend PASS (37 rutas); autorización PASS; smokes de Hugo, complementos y ASSETS PASS en Emulator, incluidos reconciliación `SUPERSEDED`, no duplicación IQ, REP bajo Pago, aislamiento por propietario, interés idempotente y bloqueo de doble enlace PAY0. Se desplegaron dos índices Firestore (`rootId + status` y `ownerUid + positionId`), ambos `READY`; 16 Functions dirigidas terminaron exitosas y cero con error; SSR quedó `ACTIVE`. Hosting fue liberado en `https://pay-0-system.web.app`; `/assets`, `/hugo` y `/facturacion` respondieron HTTP 200. No se emitió CFDI ni se envió una solicitud real a IQ durante las pruebas.

## Cierre de despliegue fiscal y documental acumulado — 2026-09-20

- Publicados en producción los cambios acumulados de lectura/reproceso de OC, datos fiscales y partidas, borradores/emisión Facturama, catálogos SAT por emisora, cotización y constancia canónicas, firma por enlace, verificación pública, Materialidad y datos bancarios de empresas.
- Functions: despliegue dirigido de 39 funciones, con 39 exitosas, cero errores y cero abortos. Se evitó borrar implícitamente la función diagnóstica histórica `debugPagoIqDepositHttpShadow`; su retiro requiere una decisión explícita separada.
- Infraestructura: índices de Firestore publicados; reglas de Storage publicadas con ruleset `37362831-a91f-44a4-a2dc-ac2bfc7aced6`; Hosting/SSR publicado en `https://pay-0-system.web.app` y rutas `/login` y `/verificar/cotizacion/prueba-no-valida` verificadas con HTTP 200.
- Validación: build frontend PASS (36 rutas), build Functions PASS, política de autorización sincronizada y smokes de parser fiscal, reproceso de OC, conversación de Hugo y enlace fiscal Control Center PASS en emuladores. La prueba fiscal utilizó PAC/Storage simulados y no emitió CFDI ni accionó IQ real.
- Limitación consciente: el deploy global fue sustituido por despliegues dirigidos para conservar la función diagnóstica no presente en el código local. Las advertencias del compilador de reglas Storage sobre llamadas a Firestore quedan como deuda de validación específica en emulador, aunque las reglas compilaron y se publicaron correctamente.
- Rama de trabajo: `feature/control-center-interconnection`. Sin merge, rebase, push ni eliminación de ramas durante este cierre.

## Complementos automáticos IQ / Facturama — 2026-09-20

- Ajuste fiscal de transferencia: el comprobante fija forma `03`, conserva fecha real del movimiento y hora detectada; si falta hora usa `12:00:00` visible/editable. Guarda número de operación, banco y cuentas cuando existen, y bloquea el REP si RFC ordenante/receptor o beneficiario/emisor no coinciden. El RFC bancario se mantiene separado y nunca se inventa con el RFC fiscal.
- Publicado en producción: `createPago`, `parsePagoReceiptPdf`, `executeAutomaticPaymentComplement` y Hosting terminaron correctamente. Smoke de emulador y builds backend/frontend PASS; cero solicitudes IQ o timbrados reales durante la validación.
- Implementada cola prospectiva para PPD: IQ sólo tras aplicación confirmada, una solicitud por depósito/perfil; Facturama desde XML original con UUID, parcialidad, saldos y forma/fecha reales del pago. Histórico no se despacha automáticamente.
- Revisión IQ a las 19:00 America/Mexico_City, una por día; alerta única después de diez días y seguimiento continuo sin WhatsApp automático. Los resultados inciertos nunca repiten POST/timbrado a ciegas.
- XML/PDF validados y vinculados conservando otras parcialidades. Facturama inicial admite MXN sin impuestos o IVA 16 % uniforme; retenciones, impuestos mixtos u otras monedas requieren revisión. Forma SAT faltante se confirma por Superadmin en Reportes.
- Compilación frontend/backend, autorización y cuatro suites de emulador PASS; incluye concurrencia, aislamiento, fecha civil sin corrimiento, alerta, no reemisión y coexistencia documental. Cero operaciones externas de prueba. Pendiente aceptación del primer REP real por PAC/ZIP real de IQ.
- Producción: doce funciones ACTIVE y Hosting publicado; IQ/Facturama activados prospectivamente, cero jobs históricos. Scheduler ENABLED a las 19:00 America/Mexico_City; configuración sin sesión devuelve 401. Nuevo pago permite capturar forma SAT real. Contrato: `src/canonicos/COMPLEMENTOS-AUTOMATICOS-2026-09-20.md`.

## IQ / Hugo / complementos — 2026-09-20

- `IQ-BEN-01`: alta en IQ pendiente del contrato/recorrido que proporcionará el usuario. Corregida captura local de nombres con cifras, control de delegación de beneficiarios y concurrencia de cuentas; probado en emulador.
- `IQ-DISP-01`: validación de root, destino activo y pertenencia de cliente/beneficiario/método/tramos antes del envío. No se ejecutó dispersión real ni se activó efectivo.
- `IQ-REP-01`: seguimiento PPD idempotente y tabla en Reportes, sin fingir solicitud o descarga externa. Histórico: 60 aplicaciones revisadas, 16 seguimientos (12 pendientes de proveedor; 4 esperando aplicación IQ). Solicitud/descarga XML/PDF quedan pendientes de mapear IQ.
- `HUGO-CTX-02`: orden cronológico antes de limitar, consulta exacta por folio, avisos de las operaciones anteriores y contexto que distingue funcionalidades conectadas de pendientes. Continúa sólo Superadmin.
- Auditoría productiva de lectura: 411 solicitudes, 154 pagos, 60 aplicaciones, 3 facturas emitidas y 9 expedientes; cero inconsistencias en padres, abonos y UUID comprobados. No equivale a auditoría fiscal ni revisión visual completa.
- Verificación: builds y autorización PASS; smokes de integración, UI y regresión fiscal PASS en emulador. Índices acotados publicados y siete consultas productivas verificadas. Backend publicado: 21/21 funciones ACTIVE; Hosting publicado correctamente, sin desplegar reglas.
- Evidencia y limitaciones: `src/canonicos/IQ-HUGO-SEGUIMIENTO-2026-09-20.md`. Sin timbrados, dispersiones, altas IQ ni solicitudes de complemento reales.

## Entrega desplegada — interconexión Control Center, 2026-09-19

- Rama: `feature/control-center-interconnection`; se preservaron los cambios previos del workspace, sin mezclar ni descartar ramas.
- No se introduce Proyectos. Se conectan 20 fuentes operativas a contribuciones incrementales, eventos y agregados aislados por root.
- Acceso consolidado sólo Superadmin. Histórico reanudable por lotes; fechas del filtro canónico; avisos explícitos de cobertura, límites y fuentes desconocidas.
- Pagos, aplicaciones, comisiones, gastos documentados, Wallet e integraciones se distinguen. No se anuncia utilidad/impuestos sin cobertura contable.
- Recuperación de borrador/materialidad con permisos vigentes; documentos en revisión; resolución de incidencias cuando se corrige la fuente. Sin timbrado, cancelación ni transferencias automáticas.
- Publicación local CFDI/solicitud/expediente atómica; documentos fiscales idempotentes; Total del XML conservado; alcance del emisor verificado antes del PAC.
- Materialidad conserva su fecha original. Hugo recibe eventos de emisión/recuperación; aprobación concurrente no duplica el aprendizaje. Sólo reglas con aprobaciones netas positivas cuentan como confirmadas.
- Evidencia: builds frontend/Functions, verificador de autorización y seis smokes PASS (contrato, eventos, snapshot, conexiones, enlace fiscal y UI Chromium). Pruebas de API/Admin en emulador, no de reglas. PAC y Storage simulados: cero timbrados reales. Prueba de concurrencia de Hugo incluida con `PAY0_QA_HUGO_CONCURRENCY=true`.
- Despliegue completado: 30 Functions de Control Center/recuperación/gastos, 10 de interconexión y Hosting/SSR. Las 30 funciones de Control Center consultadas `ACTIVE`; `/reportes` HTTP 200 y API analítica anónima HTTP 401. No se desplegaron reglas/índices ni se ejecutaron transferencias, cancelaciones o envíos externos.
- Histórico productivo completo: 2,070 contribuciones; snapshot incremental versión 2; 37 métricas cotejadas contra contribuciones sin diferencias. El mantenimiento sólo consolidó datos derivados y encoló errores existentes.
- Límite de validación: no había navegador con sesión autenticada disponible. La UI se probó en Chromium aislado con backend de emulador; no se afirma un recorrido autenticado de producción ni disponibilidad de proveedores externos.
- Alcance entregado: interconexión 3B, no todas las ideas futuras del Control Center 3.0. Una dimensión por periodo (hasta 366 días); utilidad/impuestos requieren cobertura contable. Se mantienen los cambios previos y los archivos fiscales/Hugo superpuestos fuera del commit acotado, sin descartarlos.
- Tracker y estado maestro se actualizan manualmente con evidencia por entrega; no se afirma que exista automatización de su escritura.

Este archivo complementa `AGENTS.md`; no lo reemplaza. `AGENTS.md` conserva reglas
estables de desarrollo y seguridad. Aquí se administra el trabajo que cambia día a día.

> **Estado de continuidad:** `PAY0_ESTADO_MAESTRO.md` es la bitácora técnica
> detallada creada el 2026-09-16/17. Este tracker conserva los IDs y cierres;
> antes de cerrar o priorizar un ID, contrastarlo contra el código y el Estado
> Maestro. Los conteos históricos de este archivo no sustituyen evidencia.

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
| 2026-09-10 | WAL-02 | IMPLEMENTADO / VALIDACIÓN | Movimientos, anticipos y dispersiones se consultan por `scope` + cliente; se conserva el historial que sólo trae `clienteId` y se deduplican documentos con ambos campos. Las nuevas altas de anticipo ya guardan también `clientId`. | Functions build correcto; los índices declarados están desplegados y `READY` en producción. Falta probar con datos representativos, incluido un cliente con más de 1,000 registros para decidir/persistir la paginación. |
| 2026-09-10 | PERF-04 | IMPLEMENTADO / VALIDACIÓN | Dispersiones reemplazó dos listeners por cada cliente por una sola lectura callable autorizada, acotada por `rootId`, ordenada y limitada a 500 registros. Las mutaciones existentes disparan su recarga mediante `balanceReloadKey`. | Functions build correcto. El build frontend quedó bloqueado por `.next/trace` en uso; falta smoke y definir cursor para más de 500 registros. |
| 2026-09-10 | SOL-PERF-01 | IMPLEMENTADO / VALIDACIÓN | Solicitudes preconstruye índices de relaciones de sustitución por lista; cada fila reutiliza esos mapas para origen, sustituta y cadena, eliminando búsquedas lineales repetidas durante el render. | Frontend build correcto. Falta smoke visual de cadenas de sustitución y paginación de la tabla. |
| 2026-09-10 | PERF-03 | IMPLEMENTADO / VALIDACIÓN | Clientes y Empresas usan caché compartida con deduplicación de llamadas y TTL de 30 segundos. Las altas, cambios de estado e identidad bancaria de Empresas invalidan el catálogo inmediatamente. | Frontend build correcto. Falta smoke autenticado de altas/ediciones para cerrar. |
| 2026-09-10 | PERF-06 | IMPLEMENTADO / VALIDACIÓN | `listUsers` ahora retorna páginas estables por cursor; Usuarios y Módulos solicitan 100 filas y ofrecen “Cargar más usuarios” cuando existen más resultados. | Functions y frontend build correctos. Falta smoke con más de 100 usuarios y revisión de acceso por admin. |
| 2026-09-10 | PERF-02 | IMPLEMENTADO / VALIDACIÓN | Dispersiones movió `xlsx`, `jspdf` y `jspdf-autotable` a importaciones dinámicas ejecutadas sólo al exportar Excel/PDF. | Frontend build correcto. Falta medir carga local y revisar separación adicional de modales operativos. |
| 2026-09-10 | PERF-D01 | IMPLEMENTADO / VALIDACIÓN | Se creó un generador de fixtures exclusivo para Firestore Emulator: 101 usuarios, 501 dispersiones y 1,001 movimientos por raíz de prueba, con limpieza explícita y bloqueo contra producción. | Levantar Emulator, ejecutar seed y realizar smoke local de cursor/límites. |
| 2026-09-10 | BNK-01 / BNK-02 | DECISIÓN DE ARQUITECTURA | Se usará una interfaz bancaria canónica con simulador local y adaptadores por proveedor. STP es candidato inicial por API de CLABEs por cliente, conciliación y SPEI; BBVA, Afirme y Banorte quedan como adaptadores futuros según las cuentas/contratos reales. | No se conectará ninguna cuenta ni se emitirán pagos sin sandbox, contrato, credenciales seguras y aprobaciones. |
| 2026-09-11 | AUTH-01 | IMPLEMENTADO / VALIDADO | Se corrigió un bypass de delegación: crear Solicitud exige `operateSolicitudes` y crear Pago exige `operatePagos`; una delegación de solo consulta ya no puede registrar operaciones. Se añadió una prueba local repetible de roles y delegaciones. | Functions compiló correctamente. Smoke de emulador aprobado: operador dueño y delegado autorizado continúan; delegado con solo vista queda bloqueado. |
| 2026-09-13 | WA-A5 | IMPLEMENTADO / VALIDACIÓN | La automatización crea un job idempotente al detectar PDF+XML: sin ruta/destino lo mantiene sin liberar y la pantalla dirige a Configurar rutas; con WhatsApp del cliente crea una única entrega y la libera. Se corrigieron los timestamps modulares de resolución y liberación. | Functions build y smoke local de ambos escenarios aprobados. Falta prueba con conector externo para confirmar `SENT` y cierre de `SEC-01`. |
| 2026-09-13 | XLSX-01 | IMPLEMENTADO / VALIDACIÓN | Los lectores de Orden de Compra, totales semánticos, cargas masivas y exportaciones migraron de `xlsx` a ExcelJS. Las rutas financieras aceptan `.xlsx`/CSV y rechazan `.xls` legado; `xlsx` se retiró del manifiesto y lockfile. | TypeScript y Functions build correctos. Falta smoke de archivos reales/corruptos y revisión de `npm audit` en Node 22 antes de cerrar. |
| 2026-09-13 | QA-01 | IMPLEMENTADO / VALIDACIÓN | Se añadió CI para PR y `main`: instalaciones limpias, verificador de políticas, build frontend, lint y build de Functions. Functions ahora incluye ESLint con parser TypeScript y bloquea `debugger`. | Lint y build pasan localmente; falta primera ejecución remota en GitHub antes de cerrar. |
| 2026-09-13 | PERF-01 | IMPLEMENTADO / VALIDACIÓN | `/pagos` ya usa la callable `listPagos`: autentica y autoriza por rol, exige `rootId`, consulta por cursor con páginas de hasta 100 y la interfaz ofrece “Cargar más pagos”. La función Node 22 está activa en `us-central1`; los índices de Pagos están `READY` en Firestore. | TypeScript, build de Functions y verificador de políticas correctos. Hosting publicó `ssrpay0system-00387-yiy` y `/login` respondió HTTP 200 el 2026-09-14. Falta smoke autenticado con más de 100 pagos. |
| 2026-09-13 | PERF-01 / WAL-02 / XLSX-01 | IMPLEMENTADO / VALIDACIÓN | Pagos ahora filtra el rango en Firestore antes de paginar y conserva el cursor con segundos/nanosegundos. Wallet lee todas las páginas de movimientos, anticipos y dispersiones, conservando compatibilidad `clienteId`/`clientId` y deduplicación. El lector CSV de ExcelJS se sustituyó por un parser de navegador con límites, preservando CLABEs y ceros iniciales. | TypeScript frontend, Functions, lint y política de autorización pasan con Node 22. Falta smoke de Emulator con volúmenes representativos y publicación del frontend; la auditoría confirma que `xlsx` ya no está, pero quedan vulnerabilidades transitivas que requieren actualización mayor de Firebase/Next/ExcelJS. |
| 2026-09-14 | PERF-01 / PERF-06 / WAL-02 | CERRADO | Smoke aislado de Emulator verificó paginación de Usuarios y Pagos y estado de cuenta completo. Durante el smoke se detectó y corrigió el uso inválido de `admin.firestore.Timestamp` en `listPagos`; se migró a `Timestamp` modular. | 102 usuarios en dos páginas, 101 pagos en dos páginas sin duplicados y 1,001 movimientos de Wallet completos. Functions build con Node 22 correcto; se despliega la reparación dirigida de `listPagos`. |
| 2026-09-14 | MAT-01 / Materialidad 2.0 | IMPLEMENTADO / VALIDACIÓN | Solicitudes y documentos de Solicitud ya disparan sincronización automática hacia el expediente de Materialidad sin crear una arquitectura paralela. El alta de Solicitud intenta crear/actualizar su expediente y la carga/desactivación de documentos recalcula evidencia; si falla, la operación principal no se rompe y queda marcada con `materialitySyncStatus: ERROR` para reintento/auditoría. | Functions build y verificador de política correctos. Desplegadas `createSolicitud`, `finalizeSolicitudDocumentUpload` y `deactivateSolicitudDocument` en `us-central1`. Falta smoke autenticado con OC real para cerrar. |
| 2026-09-14 | FAC-01 / MAT-01 | IMPLEMENTADO / VALIDACIÓN | Se añadió automatización segura OC/Solicitud → borrador CFDI para empresas propias únicamente. Trostre queda reconocida por RFC `TRO230717L64` y también se soportan banderas futuras de empresa propia. Empresas no propias quedan bloqueadas para preparar CFDI desde PAY0. El borrador automático se liga a Solicitud, cliente, empresa emisora, expediente de Materialidad y ciclo financiero `INCOME_REQUIRES_EXPENSE`, dejando preparada la futura propuesta de gasto sin crear Solicitud de gasto real todavía. | Functions build y política de autorización correctos. Desplegadas `createSolicitud` revision `createsolicitud-00048-luw`, `finalizeSolicitudDocumentUpload` revision `finalizesolicituddocumentupload-00027-nil` y `saveFacturamaDraft` revision `savefacturamadraft-00004-xad`. Falta smoke con OC de Trostre y validación fiscal receptor para cerrar Facturama sandbox. |
| 2026-09-14 | FAC-01 / MAT-01 / ARC-01 | IMPLEMENTADO / VALIDACIÓN | Se amplió el catálogo canónico de evidencia de Materialidad para no reducir el expediente a OC/factura/pago: ahora contempla cotización, contrato, solicitud/autorización interna, CFDI emitido, complemento de pago, CFDI de gasto, solicitud de gasto relacionada, transferencia, estado de cuenta, acuse y evidencia de entrega. Solicitudes acepta esos tipos desde su selector de documentos. Facturación manual se alineó visualmente con Facturama mostrando columnas tituladas y totales estimados por concepto. | Frontend build y Functions build correctos. Hosting publicado en `https://pay-0-system.web.app`, versión `1bbe4cbd244b01f8`. Desplegadas `initSolicitudDocumentUpload` revision `initsolicituddocumentupload-00018-zow` y `finalizeSolicitudDocumentUpload` revision `finalizesolicituddocumentupload-00028-kol`. Falta validar/timbrar en sandbox Facturama antes de permitir producción fiscal, y falta convertir `ARC-01` en carpeta/contratos consumidos por código para formatos canónicos. |
| 2026-09-14 | ARC-01 / MAT-DOC-01 | IMPLEMENTADO / VALIDACIÓN | Se reutilizó la carpeta existente `src/canonicos/` y se agregó el manifiesto `src/canonicos/materialidad.ts` como fuente canónica frontend para documentos de Materialidad/Solicitudes, más el contrato `MATERIALIDAD-EXPEDIENTE-CENTRAL.md`. El selector de documentos de Solicitudes ahora consume el manifiesto en vez de mantener una lista duplicada; también se retiró `.xls` de los formatos aceptados por el selector. | Frontend build correcto. Hosting publicado en `https://pay-0-system.web.app`, versión `5bf435728f99220f`, SSR `ssrpay0system-00398-pig`. Falta crear validador automático de consistencia frontend/backend y registrar versiones de plantillas reales que el usuario genere fuera del sistema. |

| 2026-09-14 | AGT-007 / HUGO-OBS-01 | IMPLEMENTADO / VALIDACION | Hugo dejo de depender solo de observaciones manuales: ahora escucha eventos operativos seleccionados desde `activityLog` y crea memoria en `agent007Observations` con `rootId`, evento, modulo, caso, actor, rol, autorizacion e importe/referencia cuando existen. La observacion es no bloqueante: si falla, no rompe Solicitudes, Pagos, documentos ni Facturama. | Functions y frontend build correctos. Desplegadas `createSolicitud`, `createPago`, `finalizeSolicitudDocumentUpload` y `saveFacturamaDraft` en `us-central1`; revisiones nuevas observadas: `createsolicitud-00049`, `createpago-00052`, `finalizesolicituddocumentupload-00029-kuj`, `savefacturamadraft-00005-qex`. Falta extender captura a logs transaccionales/batch o crear trigger central de `activityLog`, y validar con una operacion autenticada real. |

| 2026-09-14 | AGT-007 / HUGO-PAY-OBS-01 | IMPLEMENTADO / VALIDACION | Se amplio la memoria de Hugo para pagos: `logActivityTx` y `logActivityBatch` ahora escriben observaciones en la misma transaccion/batch cuando el evento es relevante. Se agregaron senales de comprobantes de pago, correcciones por rechazo IQ, vinculacion/conciliacion/rechazo/cancelacion IQ y nuevo comprobante. | Functions y frontend build correctos. Desplegadas 8 Functions de pagos/documentos/aplicacion en `us-central1`: `createPago`, `initPagoDocumentUpload`, `finalizePagoDocumentUpload`, `updateRejectedPagoAmountForRetry`, `deactivatePagoDocument`, `applyPagoToSolicitud`, `applyPagoToSolicitudesAtomic` y `reservePagoApplicationBatch`; 0 errores. Los pagos nuevos ya alimentan a Hugo; falta smoke autenticado observando registros reales en `/hugo`. |
| 2026-09-16/17 | MAT-01 / FAC-01 / SAT-01 / SIG-01 | IMPLEMENTADO / VALIDACIÓN | Se desplegó el bloque acotado de Solicitudes, Materialidad, cotización automática, firma presencial/enlace, constancia posterior, borrador Facturama, catálogo emisor y catálogo SAT global. El catálogo SAT usa el paquete canónico `.db.bz2`, hash, vigencia y versión activa. | 17 Functions objetivo verificadas `ACTIVE`; Storage Rules publicadas; Hosting `/facturacion` respondió HTTP 200. No cerrar: falta smoke autenticado OC Trostre → cotización → firma → constancia, carga de catálogos y validación de borrador. Timbrado/XML/PDF/UUID/REP siguen pendientes. |

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
| 2026-09-16/17 | Materialidad / Facturama / Firma / SAT | EN VALIDACIÓN | Release acotado publicado; el proceso documental automático existe en código pero no cuenta como validado hasta el smoke autenticado. | Importar catálogo SAT/Trostre y subir una OC de empresa propia controlada. |

## Corte de despliegue y cierre

Este cuadro distingue lo que ya existe en la rama local de lo que aún impide
considerarlo cerrado. Un despliegue no se realizará hasta contar con aprobación
explícita y una revisión final de cambios, índices y configuración.

| Estado | Cantidad | Qué significa ahora |
| --- | ---: | --- |
| Cerrado y verificado | 8 | `AUTH-01`, `OPS-01`, `PERF-01`, `PERF-03`, `PERF-04`, `PERF-06`, `SOL-PERF-01` y `WAL-02`: cuentan con smoke o verificación productiva completa. |
| Publicado / validacion pendiente | 5 | `XLSX-01`, `QA-01`, `MAT-01`, `FAC-01` y `AGT-007`: codigo publicado o preparado, con checks de compilacion; falta el smoke especifico indicado en cada fila. |
| Implementado / dependencia externa | 5 | `SEC-01`, `WA-A5`, `WA-CONTACTS-01`, `IQ-01` e `IQ-02`: requieren conector WhatsApp o sandbox IQ para cierre verificable. |
| Abierto | 30 | Trabajo funcional, de seguridad, diseno e integraciones todavia pendiente de implementar o diagnosticar. |

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
| Facturama | IMPLEMENTADO / VALIDACIÓN | `FAC-01`: borradores CFDI manuales y automáticos para empresas propias; pendiente validación fiscal sandbox y timbrado controlado. |
| Reportes, actividad y exportaciones | PENDIENTE DE DIAGNÓSTICO | Consultas, exportación y calidad de auditoría. |
| Firestore, Storage, Functions, Hosting SSR y CI | HALLAZGOS INICIALES | `SEC-02`, `OPS-01`, `QA-01`, `PERF-D02`, `PERF-D04`. |

## Prioridad actual

| ID | Estado | Prioridad | Área | Pendiente | Criterio de cierre |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | IMPLEMENTADO / VALIDACIÓN | P0 | WhatsApp / permisos | Jobs, rutas, resolución y asignación manual exigen `rootId`; chats históricos sin propietario quedan ocultos. El contrato canónico exige que el conector persista `rootId` al procesar `SYNC_CHATS`. | Actualizar conector externo, sincronizar por raíz y ejecutar prueba focalizada con dos roots; no cerrar mientras existan chats sin alcance persistido. |
| SEC-02 | IMPLEMENTADO / VALIDACIÓN | P0 | Dependencias | Se actualizaron versiones menores de Firebase, Functions, Admin y Vision. Auditoría posterior: raíz 29 vulnerabilidades (8 altas, 1 crítica) y Functions 12 (3 altas); builds y política de autorización pasaron. `xlsx` continúa como dependencia directa vulnerable sin parche y procesa archivos cargados por usuarios. | Sustituir o aislar el lector `xlsx` con pruebas de órdenes de compra y cargas masivas; revisar las tres altas restantes de Functions bajo Node 22 y validar en entorno limpio. |
| XLSX-01 | IMPLEMENTADO / VALIDACIÓN | P0 | Archivos / seguridad | ExcelJS sustituye `xlsx` en lectura de OC, totales, cargas masivas y exportaciones. Los flujos financieros admiten `.xlsx`/CSV; `.xls` legado queda rechazado. | Ejecutar smoke con encabezados reales de dispersión, total de OC, archivo corrupto y exportación; revisar auditoría en Node 22 antes de cerrar. |
| AUTH-01 | CERRADO | P0 | Operaciones / delegación | Las altas de Solicitudes y Pagos ya diferencian permisos de consulta de permisos operativos por cliente. Un usuario delegado debe tener el permiso específico para cada flujo. | Smoke de emulador aprobado: operador directo, delegado con solo vista bloqueado y delegado autorizado permitido. El rol independiente `cliente` continúa como alcance nuevo, sin reutilizar indebidamente el rol operador. |
| OPS-MET-01 | IMPLEMENTADO / VALIDACIÓN | P1 | Operación / métricas | Se registran marcadores privados al crear y resolver Solicitudes/Pagos, al crear entregas WhatsApp y al recibir/responder Telegram. Reportes expone primera respuesta, tiempos promedio/mediano, comparativo por tipo y exportación, respetando el alcance del rol. | Completar asignación y entrega final; añadir WhatsApp entrante cuando el conector exponga webhook seguro; ejecutar ciclo local completo para línea base semanal. |
| OPS-01 | CERRADO | P0 | Runtime | El `package.json` raíz fija Node 22; el despliegue SSR fue validado en `nodejs22` con `ssrpay0system` activo y `/login` HTTP 200 (2026-09-12). | Cumplido: runtime SSR y Functions quedan estandarizados en Node 22. |
| WA-A5 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | La automatización crea/reutiliza el job PDF+XML de manera idempotente; sin ruta/destino no libera la entrega y la UI dirige a Configurar rutas; con ruta válida libera una sola entrega. | Smoke local aprobado para destino ausente y WhatsApp de cliente. Falta conector externo para confirmar `SENT`, ruta DEFAULT real y repetición sin duplicado. |
| WA-CONTACTS-01 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | “Actualizar contactos” crea el comando `SYNC_CHATS`, espera su terminación y ahora exige que `lastChatsSyncedAt` avance; si el conector marca `DONE` sin confirmar una actualización nueva, muestra un error. La pantalla y el resultado muestran conteo y fecha de sincronización. | Frontend build correcto. Falta prueba con el conector externo: alta/cambio real debe reflejarse en PAY0; además el conector debe persistir `rootId` según el contrato canónico. |
| WA-UI-01 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | Las tarjetas Pendientes, Errores y Enviadas ahora aplican el filtro, muestran visualmente cuál está activa y al pulsarla de nuevo regresan a todos los estados. Se eliminó la fila duplicada de botones de estado; Pendientes permanece como vista inicial. | Frontend build correcto; ejecutar smoke visual de selección, cambio y limpieza de filtro antes de cerrar. |
| WA-UI-02 | IMPLEMENTADO / VALIDACIÓN | P1 | WhatsApp | La clasificación y los totales por cliente ahora asignan cada job a una sola categoría: Enviado, Error o Pendiente. Los errores dejaron de contabilizarse también como pendientes. | Frontend build correcto; ejecutar smoke visual con jobs de las tres categorías antes de cerrar. |
| WA-PERF-01 | ABIERTO | P1 | WhatsApp | El dashboard carga hasta 300 jobs y puede realizar una lectura de deliveries por job. | Listado paginado con read-model/resúmenes; detalles cargados bajo demanda. |
| PERF-01 | CERRADO | P1 | Frontend / Pagos | `/pagos` reemplazó la suscripción completa de pagos por `listPagos`, una callable autorizada y acotada por `rootId`, rol y cursor; la tabla carga 100 filas por página y permite continuar. `listPagos` está activa en producción y sus índices compuestos están `READY`; Hosting publicó la interfaz SSR `00387-yiy`. | Smoke de Emulator: 101 pagos por rango, 100 + 1 registros, sin duplicados y con cursor exacto. |
| PERF-02 | VALIDACIÓN | P1 | Frontend | Dispersiones ya difiere librerías pesadas de Excel/PDF hasta la exportación. Pagos, Solicitudes y Beneficiarios siguen pendientes de división/medición específica. | Medición local de bundle/carga y separar modales o flujos restantes sin degradar operación. |
| PERF-04 | CERRADO | P1 | Frontend / Dispersiones | La vista usa una sola callable autorizada por `rootId`, en vez de listeners por cliente; pagina en bloques de 100 y permite continuar el historial sin duplicados. | Smoke de Emulator: 501 dispersiones recuperadas en 500 + 1 con cursor exacto; compilación frontend y Functions correctas. |
| PERF-05 | ABIERTO | P2 | Frontend / Dashboard | El dashboard descarga todas las solicitudes del rango elegido para calcular tres contadores en navegador. | Contadores agregados/consultas acotadas y medición de respuesta anual. |
| PERF-06 | CERRADO | P2 | Usuarios | `listUsers` y sus dos pantallas consumidoras usan páginas de 100 filas con cursor y acción “Cargar más”. | Smoke de Emulator: 102 usuarios devueltos en 100 + 2, bajo superadmin de la raíz autorizada. |
| PERF-07 | ABIERTO | P2 | Telegram / documentos | Varias funciones Telegram leen 200–500 uploads del root y algunas resuelven solicitudes una por una. | Query selectiva por tipo/estado/solicitud y lecturas agrupadas o metadatos ya disponibles. |
| SOL-PERF-01 | CERRADO | P1 | Solicitudes | Relaciones de sustitución se indexan una vez por lista y las filas consultan mapas. La tabla usa una callable autorizada y páginas de 100 filas, con continuidad por cursor en lugar de descargar toda la colección. | Smoke de Emulator: 101 solicitudes en 100 + 1, sin duplicados y con cursor exacto; TypeScript frontend y Functions correctos. |
| IQ-01 | IMPLEMENTADO / VALIDACIÓN | P1 | IQ / resiliencia | El wrapper HTTP canónico con timeout acotado protege Solicitudes, Depósitos y el POST de Dispersiones; también lectura, recuperación, conciliación, catálogos, descarga de factura y diagnósticos. Las llamadas restantes ya tenían `AbortController` acotado. No hace reintentos implícitos sobre creaciones potencialmente enviadas. | Definir tiempos por operación y probar timeout controlado contra sandbox/local antes de cerrar. |
| IQ-02 | IMPLEMENTADO / VALIDACIÓN | P1 | IQ / automatización | La creación IQ de Solicitudes encola una Cloud Task inmediata e idempotente usando el mismo job, bloqueo por perfil y lógica de recuperación. Para automatización respeta la configuración activa de la raíz; solicitudes manuales autorizadas pueden iniciar sin esperar cinco minutos. El scheduler permanece como respaldo si Cloud Tasks falla. | Emulator validó descubrimiento, creación de cola y ejecución inocua del handler (14 ms); falta prueba con job real + IQ sandbox para medir cola→inicio y confirmar que tarea/scheduler no duplican POST. |
| WAL-02 | CERRADO | P1 | Wallet / estado de cuenta | La lectura se acota por `scope` y cliente; las consultas internas recorren páginas completas y deduplican `clienteId`/`clientId`, por lo que el saldo no se calcula sobre un prefijo truncado. Sus índices están `READY` en producción. | Smoke de Emulator: estado de cuenta conserva 1,001 movimientos para un cliente sin mezclar otra raíz. |
| MAT-01 | IMPLEMENTADO / VALIDACIÓN | P2 | Materialidad | Materialidad avanza hacia expediente operativo central: Solicitudes y documentos sincronizan evidencia automáticamente sin duplicar arquitectura. El dashboard ya no debe depender de cargas manuales para enterarse de nuevas operaciones, pero queda pendiente validar determinismo a escala. | Smoke con Solicitud + OC real, confirmar operación visible en Materialidad y validar paginación/read-model por carpeta antes de cerrar. |
| REP-01 | IMPLEMENTADO / VALIDACIÓN | P1 | Reportes | Ganancias por cliente y Tiempos operativos consultan por `rootId` + `createdAt`. Pagos nuevos guardan `reportDateAt`; `backfillPagoReportDates` está desplegada y el panel superadmin está compilado. La consulta de incidencias de Pagos ya quedó preparada localmente para filtrar y ordenar por `rootId + reportDateAt`, con su índice. Hosting no pudo publicar el panel: dos subidas consecutivas a Google Storage se reiniciaron (`ECONNRESET`) después de 28.5 MB y 9.5 MB. | Estabilizar la subida a Google Storage, publicar el panel, ejecutar simulación y backfill por root; después desplegar el índice y la consulta de Pagos, y validar rangos antes de cerrar. |
| PERF-03 | CERRADO | P2 | Frontend / catálogos | Clientes y Empresas usan caché compartida con TTL y deduplicación. Todas las mutaciones de Cliente y Empresa invalidan explícitamente sus catálogos para que el siguiente listado refleje el cambio sin esperar 30 segundos. | Smoke autenticado de Emulator: alta, edición y desactivación de Cliente se reflejan en el catálogo canónico; la desactivación elimina el cliente de la lista activa. |
| UX-01 | ABIERTO | P1 | Diseño / frontend | Varias páginas difieren en espaciado, jerarquía, tablas, acciones y estados, lo que puede confundir la operación. | Inventario visual, tokens/componentes canónicos y migración por pantalla con revisión visual. |
| ARC-01 | ABIERTO | P1 | Arquitectura | Falta una ubicación única y versionada para contratos, estados, copys, formatos visuales y decisiones canónicas que el sistema pueda reutilizar. | Carpeta `src/canonicos/` con esquema, ownership y primeros contratos consumidos por código, sin duplicar reglas financieras. |
| AGT-007 | IMPLEMENTADO / VALIDACION | P1 | Hugo Sanchez / Agente 007 | Una sola entidad: para clientes se presenta como Hugo o Hugito; internamente conserva el identificador Agente 007. Ya observa automaticamente eventos operativos seleccionados desde `activityLog`, incluyendo pagos/comprobantes/aplicaciones aunque se registren en transacciones o batches. No responde ni ejecuta acciones en esta etapa. | Functions y frontend build correctos; Functions publicadas para Solicitudes, Pagos, documentos de Pago/Solicitud y Facturama. Falta smoke autenticado y despues crear patrones/recomendaciones revisables. |
| HUGO-REC-01 | ABIERTO | P1 | Hugo Sánchez / comprobantes | La lectura de comprobantes PDF/imagen no detecta pagos de forma confiable y obliga a captura manual. Hugo observará extracción, correcciones y conciliación para mejorar sugerencias antes de aplicar pagos automáticamente. | Medir precisión por banco/formato; extraer importe, fecha, referencia y emisor; propuesta vinculada a pago con confianza y revisión humana; automatización posterior sólo con reglas, límites y auditoría. |
| FAC-01 | IMPLEMENTADO / VALIDACIÓN | P1 | Facturama | PAY0 prepara borradores CFDI automáticos sólo para empresas propias y tiene emisión Multiemisor sandbox/producción con retorno XML/PDF al mismo expediente. La toma del borrador es atómica, el ID externo se conserva para recuperación sin doble emisión y producción requiere confirmación humana explícita. | Credenciales existentes verificadas contra API producción (HTTP 200). Falta emitir el borrador Trostre desde PAY0, verificar UUID/XML/PDF en el expediente y probar consulta/cancelación; no cerrar sin esa evidencia. |
| BNK-01 | ABIERTO | P0 | Banca / conciliación | Conciliar depósitos de cuentas propias exige un proveedor bancario/Open Banking con acceso autorizado y una identidad estable de transacción. | Selección de banco/proveedor y sandbox; ingestión sólo de lectura, reconciliación idempotente y aprobaciones operativas. |
| BNK-02 | ABIERTO | P0 | Banca / dispersiones | Dispersar desde PAY0 requiere API bancaria/SPEI, beneficiarios verificados, límites, doble autorización, idempotencia y reversos/incidencias. | Contrato bancario/sandbox, flujo de aprobación segregado y pruebas de punta a punta; nunca se activa producción sin autorización explícita. |
| QA-01 | IMPLEMENTADO / VALIDACIÓN | P1 | Calidad | CI en GitHub ejecuta instalaciones limpias, política de autorización, build frontend, lint y build de Functions. El lint de Functions ya es funcional y analiza TypeScript. | Confirmar primera ejecución remota; después incorporar reglas/emulador y un smoke estable al gate. |
| DOC-01 | ABIERTO | P2 | Operación | README no contiene runbook de entornos, despliegue, reversión, reconciliación ni incidentes. | Runbook revisado y versionado. |
| DOC-02 | ABIERTO | P2 | Continuidad | Generar ZIP canónico y checkpoint actualizado después del siguiente hito estable. | ZIP excluye secretos/artefactos y el checkpoint refleja el estado validado. |

## Pendientes funcionales vigentes

### Actualizacion operativa — 2026-09-18

- **OC / Facturacion / documentos:** la reprocesada de OC activa vuelve a extraer partidas, clave SAT, unidad, receptor y lugar de entrega. Alimenta el borrador Facturama y reemplaza la cotizacion activa. Pendiente: smoke autenticado de una OC corregida hasta que el borrador deje de mostrar bloqueo fiscal.
- **Correccion fiscal S1C35U1E28 (2026-09-18):** se confirmó que la OC activa v2 contiene clave SAT `72101510` y unidad `E48`, ambas autorizadas en el catálogo activo de Trostre. La causa raíz fue el lector XML: trataba celdas combinadas vacías (`<c .../>`) como abiertas y desplazaba la siguiente celda; por ello leía índices de `sharedStrings` o una fecha serial en vez de régimen, CP y uso CFDI. La prueba local contra la OC original confirmó extracción de `601`, `06700`, `G03`, `72101510` y `E48`. `reprocessActiveSolicitudOc` y `finalizeSolicitudDocumentUpload` quedaron `ACTIVE` en producción a las 03:56, con 1 GiB. Falta un reproceso real posterior a esa hora para actualizar el borrador existente y verificar su estado final.
- **Cotizacion:** el motor productivo deja de escribir encima de PDFs de referencia. La fuente canónica pasa a ser el paquete versionado HTML/CSS (`templates/base`) y cada salida incorpora identidad del emisor, tabla dinámica, QR y campos de OC. Los PDFs históricos permanecen como evidencia, no como plantilla ejecutable. Las tres rutas de generación/reproceso están desplegadas y activas con 1 GiB; falta regenerar una cotización real para la aprobación visual final.
- **Constancia:** incorpora partidas de OC, CFDI/UUID disponible, firma sellada y QR de verificacion publica; pendiente smoke visual de la nueva version generada en produccion.
- **Hugo / AGT-007:** las observaciones y recomendaciones quedan aisladas por `rootId`. Una OC subida genera ahora una propuesta revisable de clasificacion fiscal, no solo memoria observada.
- **DocsModal:** sin cambios por decision operativa; esta en evaluacion de rediseño.

| ID | Estado | Prioridad | Área | Pendiente | Criterio de cierre |
| --- | --- | --- | --- | --- | --- |
| SOL-01 | ABIERTO | P2 | Solicitudes | Simplificar `DocsModal`: área compacta IQ/WhatsApp y tabla de documentos HTML válida. | Revisión visual y smoke de documentos, IQ y envío manual. |
| SOL-02 | ABIERTO | P2 | Solicitudes / IQ | Reducir notas automáticas duplicadas y validar latencia/SLA de creación IQ automática. | Bitácora útil sin duplicación; medición de ejecución y SLA acordado. |
| DISP-01 | ABIERTO | P1 | Dispersiones | Aceptar CLABE o tarjeta válida; prioridad CLABE sobre tarjeta. | Casos de CLABE, tarjeta y ambos validados contra IQ. |
| DISP-02 | ABIERTO | P1 | Dispersiones | IQ por defecto cuando aplica; saldos visibles al elegir cliente; filtros temporales canónicos; exportación y comprobante IQ. | Smoke de dispersión individual y masiva con comprobante persistido. |
| DISP-03 | ABIERTO | P1 | Dispersiones | Validar que lotes masivos lleguen realmente a IQ y no queden sólo en `CREADA`. | Trazabilidad de lote desde PAY0 hasta IQ y estado final. |
| PAG-01 | ABIERTO | P1 | Pagos | Verificar depósitos IQ, conciliación, aplicación, estados terminales e idempotencia de postings. | Suite focalizada con casos de rechazo, reintento y aplicación parcial/total. |
| WAL-01 | ABIERTO | P2 | Wallet | Validar postings y estados de cuenta por usuario/cliente sin mezclar semántica PPD. | Conciliación de eventos y saldos con casos de adelanto, dispersión y devolución. |
| FAC-01 | IMPLEMENTADO / VALIDACIÓN | P2 | Facturama | Integración sólo para compañías propias: borrador fiscal validado, emisión sandbox/producción, XML/PDF versionados y liga con Solicitud/OC/Materialidad sin expediente paralelo. | Primera compañía propia debe operar end-to-end: emitir, consultar/cancelar, comprobar UUID y confirmar bloqueo para compañías no propias. |
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
| PERF-01 | 2026-09-14 | Pagos paginado por rango y cursor exacto. | Emulator: 101 pagos en 100 + 1, sin duplicados. |
| PERF-06 | 2026-09-14 | Usuarios paginados por cursor. | Emulator: 102 usuarios en 100 + 2. |
| WAL-02 | 2026-09-14 | Estado de cuenta sin límite silencioso de 1,000 registros. | Emulator: 1,001 movimientos completos para el cliente de prueba. |
| PERF-04 | 2026-09-14 | Historial de dispersiones paginado sin límite de 500 registros. | Emulator: 501 dispersiones en 500 + 1, sin duplicados y con cursor exacto. |
| PERF-03 | 2026-09-14 | Catálogo de clientes se invalida después de sus mutaciones. | Emulator: alta, edición y desactivación se reflejan inmediatamente en el listado canónico. |
| SOL-PERF-01 | 2026-09-14 | Solicitudes paginadas y relaciones de sustitución indexadas. | Emulator: 101 solicitudes en 100 + 1, sin duplicados y con cursor exacto. |

## Evidencia de validación reciente

- 2026-09-19: Hugo Fase 2 conversacional publicado exclusivamente para `superadmin`. La burbuja conserva historial persistente separado de `agent007Observations`, responde saludos por nombre, consulta contexto de Solicitudes/Pagos, muestra dudas dentro del chat, maneja no leídos y genera avisos proactivos para eventos relevantes. Smoke PASS en Firestore Emulator: saludo personalizado, consulta de `S1C35U1E28`, cuatro mensajes ordenados y marcado de lectura. Vertex AI habilitado por autorización expresa del superadministrador y validado en producción con `source=VERTEX_AI`; revisión activa `sendagent007message-00003-bak`. El contexto excluye secretos, CSD y tokens, y Hugo no puede ejecutar acciones financieras.
- 2026-09-19: Fase 1 de `PAY0 Control Center` publicada. Se agregó una proyección persistente por `rootId` (`controlCenterSnapshots`), callables separados para lectura y recálculo, resumen ejecutivo, salud por módulo, alertas navegables y pipeline operativo. La vista nueva es la entrada principal de `/reportes`; los reportes detallados y exportaciones permanecen disponibles. Builds frontend/Functions PASS, smoke de Firestore Emulator PASS con aislamiento por `rootId`, Functions activas y Hosting publicado. Fotografía productiva inicial generada: 411 solicitudes, 154 pagos y 6 registros fiscales inspeccionados; monto registrado `$30,281,736.09`. Pendiente conexión incremental por eventos y reconciliación programada.
- 2026-09-19: Fase 2 de `PAY0 Control Center` publicada. Los cambios en Solicitudes, Pagos, Facturama, Materialidad, Dispersiones y propuestas de Hugo marcan automáticamente la raíz afectada en `controlCenterDirtyRoots`; una tarea cada 15 minutos reconstruye únicamente raíces pendientes y conserva eventos concurrentes. Functions build PASS y smoke de Firestore Emulator PASS para encolado, aislamiento por `rootId`, reconciliación y limpieza segura. Siete Functions desplegadas sin errores; el botón de actualización inmediata se conserva como respaldo del superadmin.
- 2026-09-19: `PAY0 Control Center 3.0` Fase 3A cerrada localmente. Se formalizaron 16 tipos de evento, dinero en centavos enteros, periodos canónicos en `America/Mexico_City`, persistencia idempotente, 10 KPIs versionados y 5 widgets declarativos. Se separaron explícitamente facturación emitida, cobranza recibida, ingresos aplicados, gastos y utilidad operativa. Functions build PASS, prueba de contrato PASS y Firestore Emulator PASS para creación única, reintento sin duplicado y bloqueo de colisión entre raíces. No requiere deploy todavía: ningún flujo productivo consume el event store hasta la Fase 3B.

- 2026-09-19: reproceso OC/facturación corregido y validado en Emulator y producción con la OC real de Transunisa. El parser obtiene clave `72101510`, unidad `E48`, descripción `SERVICIO DE REPARACION DE SISTEMAS DE PLOMERIA`, régimen `601`, CP `06700`, uso `G03` y domicilio; conserva el borrador enlazado `9YYutut1OJUS20LTzclY` en `AUTO_DRAFT_FISCAL_VALIDATED` aunque exista un borrador obsoleto duplicado. Cotización productiva v6, una página, verificada con domicilio, BBVA, cuenta `0121570099` y CLABE terminación `0991`. Functions activas: `reprocessActiveSolicitudOc` `00010-qaz`, `finalizeSolicitudDocumentUpload` `00055-doh`, `generateSolicitudQuotation` `00010-jop` y `listFacturamaInvoices` `00006-bel`.

- 2026-09-17: conector Facturama sandbox desplegado. `getFacturamaSandboxStatus`, `saveFacturamaIssuerConfig` e `issueFacturamaSandboxInvoice` están `ACTIVE`; emisión usa toma transaccional e ID externo persistido para impedir doble CFDI. Hosting publicó la interfaz de estado/configuración/prueba. El smoke externo no cierra porque los secretos actuales fueron rechazados con HTTP 401 por Facturama.
- 2026-09-17: smoke aislado PASS en Firebase Emulator para Trostre: una OC creó automáticamente cotización, exactamente un borrador Facturama `AUTO_DRAFT_FISCAL_VALIDATED` y el mismo expediente de Materialidad; la firma creó evidencia y constancia dentro de esa trazabilidad. Pendiente únicamente la validación autenticada en producción; no cubre timbrado, XML/PDF/UUID, PPD/REP ni ingreso→gasto.
- 2026-09-17: catálogo canónico de Trostre quedó atestado por hash contra la fuente SAT revisada. El flujo diario valida contra el catálogo autorizado de Trostre; ya no exige importar el paquete SAT global para esa versión exacta. Functions acotadas activas: `finalizeSolicitudDocumentUpload` `00032-kip`, `saveFacturamaDraft` `00006-nex`, `importCompanyInvoiceCatalog` `00002-nah`.
- 2026-09-17: Facturama API Multiemisor producción autenticó con las credenciales existentes (HTTP 200, sin exponer secretos). Se publicaron `getFacturamaProductionStatus` `00001-mop`, `issueFacturamaProductionInvoice` `00001-qub` y Hosting SSR `00418-xor`. El primer CFDI real, XML/PDF/UUID y consulta/cancelación siguen como validación obligatoria; no se timbró durante el deploy.

- 2026-09-14: se cargaron en Firestore Emulator 101 usuarios, 501 dispersiones y 1,001 movimientos bajo una raíz aislada. El smoke de delegaciones pasó: operador dueño y delegado autorizado permitidos; delegado sólo lectura bloqueado.
- 2026-09-14: el smoke automático de WA-A5 no generó el job esperado en el emulador. `WA-A5` y `SEC-01` permanecen en validación hasta corregir esa ejecución y probar el conector externo con dos raíces.
- 2026-09-14: Materialidad quedó conectada al ciclo normal de Solicitudes: `createSolicitud`, `finalizeSolicitudDocumentUpload` y `deactivateSolicitudDocument` sincronizan o recalculan el expediente sin bloquear la operación principal.
- 2026-09-14: Facturación automática segura queda conectada a Solicitudes/OC sólo para empresas propias. Producción fiscal sigue bloqueada; el sistema crea borradores sandbox y marca el ciclo financiero como ingreso que requiere gasto relacionado.
- 2026-09-14: se amplió el expediente de Materialidad para incluir documentos fiscales, operativos, bancarios y de gasto relacionado; la pantalla de Facturación ya muestra columnas y totales estimados. Hosting quedó publicado en `https://pay-0-system.web.app` versión `1bbe4cbd244b01f8`; documentos quedó activo con `initsolicituddocumentupload-00018-zow` y `finalizesolicituddocumentupload-00028-kol`.
- 2026-09-14: `src/canonicos/` quedó como raíz canónica reutilizada, no duplicada. `src/canonicos/materialidad.ts` alimenta el selector de documentos de Solicitudes; Hosting publicó la versión `5bf435728f99220f` y SSR quedó en `ssrpay0system-00398-pig`.

- 2026-09-14: Hugo / Agente 007 ya observa automaticamente eventos operativos seleccionados desde `activityLog` y guarda memoria por `rootId` en `agent007Observations`. Despliegue Functions completo: `createSolicitud`, `createPago`, `finalizeSolicitudDocumentUpload` y `saveFacturamaDraft`; no se ejecutaron acciones autonomas, financieras ni envios.

- 2026-09-14: Hugo amplio aprendizaje de pagos: `logActivityTx` y `logActivityBatch` ya crean memoria transaccional/batch en `agent007Observations`, incluyendo pago creado, comprobante subido/desactivado, aplicacion a Solicitud, posteo financiero e IQ de pagos. Despliegue Functions de pagos completo con 8 actualizaciones y 0 errores.

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
