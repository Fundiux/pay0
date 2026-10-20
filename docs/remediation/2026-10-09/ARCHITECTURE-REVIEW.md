# Revisión arquitectónica y funcional — 9 de octubre de 2026

## Alcance y evidencia

Se revisaron íntegramente los 28 documentos Markdown de las auditorías `pay0-architecture-2026-10-07` y `pay0-system-integral-2026-10-07`, las 31 filas legacy y las 350 filas del inventario funcional. Los CSV se cargaron completos con `Import-Csv -Encoding UTF8`; se inspeccionaron sus entradas y se consolidaron los campos repetidos de estado, referencias y ramas. Esto no equivale a leer semánticamente la implementación de las 350 entradas. Las auditorías describen `d206a6c812218dd83ebfe0a45dc8e365c62e6a1f`; el contraste actual se realizó contra HEAD `1f694607dcc94b1af557249f7334af7cd22a8afb`, rama `remediation/pay0-integral-20261009`.

Este informe distingue **verificado estáticamente**, **riesgo pendiente de prueba** y **estado productivo desconocido**. No se ejecutaron servicios, pruebas, compilaciones ni consultas remotas durante esta revisión; las comprobaciones fueron lecturas, búsquedas y comparación Git. No se modificó código ni inventarios históricos. No hay fundamento para declarar un incidente financiero, activar una compuerta o eliminar una capacidad solamente por estas auditorías.

Las rutas de fuentes de las tablas siguientes son relativas a `docs/audits/`. A = `pay0-architecture-2026-10-07/`; I = `pay0-system-integral-2026-10-07/`.

## Correcciones verificadas de interpretación

1. **Clasificación de 20 exports resuelta.** Las 20 entradas `FN-queueControlCenter*` con tipo `export` son triggers `onDocumentWritten`: todas invocan `dirtyTrigger` en `functions/src/modules/controlCenter/automation.ts:36`, cuya fábrica llama a ese constructor en la línea 28. La clasificación corregida del inventario histórico es 236 callables, 38 triggers Firestore, 14 schedulers, 4 tasks y 4 HTTP = 296. No es un recuento del inventario remoto ni de exports nuevos posteriores a la auditoría.
2. **Anclas legacy defectuosas.** Las siete filas `DL-FN-*` asignan al archivo de implementación el número de línea del export en `index.ts` (por ejemplo, backfill `:2831`, frente a implementación `:41` en el inventario funcional). Debe citarse el símbolo y resolverse la línea actual antes de editar. Las fuentes históricas se conservan; este informe da trazabilidad corregida por símbolo.
3. **El inventario de experimentos no es exhaustivo.** `runHugoIqRepReadCohort` figura en el inventario funcional y en `index.ts:2841`, pero no en las siete filas legacy; su nombre no pasó el filtro canary/experiment/probe/backfill/seed. Además, las siete filas incluyen `probeIqDispersionModule`, no cinco experimentos REP. No inferir exhaustividad de las 31 señales.
4. **Comentario de desactivación engañoso.** `processIqStatusMonitorQueue` continúa exportado en `index.ts:2945` aunque el comentario `IQ2G_H4_D55A_INDEX_EXPORT_DISABLED` aparece en la línea 2890. No prueba pausa productiva.
5. **Versión de guía desactualizada.** `package.json:74` fija Next `15.5.25`; AGENTS menciona Next 14. Debe actualizarse la documentación operativa con evidencia de manifiesto/lockfile y build. No se propone cambiar la versión del framework como parte de esta corrección documental.
6. **Gate QA aún dependiente de archivo archivado.** `qa/scripts/check-materiality-canon.mjs` lee `pay0-archivo-tecnico/MATERIALIDAD-CANON.md`. Su reparación requiere definir un contrato/fixture rastreado; omitir silenciosamente el check no cumple el gate.
7. **REP cambió después de la auditoría.** Git muestra cambios en `complementAutomation`, `complementDailyLookup`, `complementDocuments`, `complementFollowup`, `complementGates`, `complementInventory` y `complementProviders`. El gate actual exige `iqRequestEnabled === true` para REQUEST y permite origen durable `originIqProfileId`, conservando validación de root, perfil y switches. Los jobs legacy retienen comprobaciones de usuario/acceso vivo; no afirmar que todos los jobs actuales se reautorizan de igual modo. Debe probarse autorización del origen al crearlo, inmutabilidad y tratamiento de permisos revocados.
8. **Comisión tiene filtro de transición visible.** `commissionDistributions/triggers.ts:4` ejecuta solo al entrar en combinación `CONCILIADO` + `POSTED`. La hipótesis de que cualquier actualización recalcula comisión sería incorrecta; replay del mismo evento, corrección posterior y compensación siguen pendientes de prueba del servicio.
9. **Compuertas conservadas.** El HTTP de depósito exige `allowHttpPost === true` (`depositHttpCreateCore.ts:177`), WhatsApp exige `sendEnabled` (`whatsappRuntime.ts:156`) y la UI de comisión separa preparación y ejecución (`CommissionUserAssignments.tsx:55`). Valores productivos y suficiencia de controles backend no fueron consultados.

## Backlog de corrección y certificación

P0 = condición para certificar efectos financieros o release; P1 = completar contratos/pruebas y corregir deuda verificable; P2 = mejora condicionada a evidencia. Un riesgo P0 no es automáticamente un defecto implementado. Ningún ítem se declara cerrado por compilar.

| ID / prioridad | Trabajo y alcance | Estado comprobado | Prueba / aceptación | Fuentes |
|---|---|---|---|---|
| AR-01 / P0 | Fijar candidato y mapear SHA a Hosting, Functions, reglas, Scheduler y Tasks; separar presencia de nombre de igualdad de implementación | Incógnita remota; conteos de ramas/worktrees son históricos | Matriz por artefacto con revisión/fecha/SHA, diferencias explícitas, rollback; inventario remoto solo de lectura | A00,A01,A09,A10; I00,I01,I12,I14 |
| AR-02 / P0 | Formalizar dueño de solicitud/folio/pago/posting y transiciones, sin mover APIs todavía | Varios escritores observados; fallo concreto no demostrado | Replay misma intención, folio único, terminal no reabierto, corrección/reverso auditado y montos coherentes | A02–A05,A08–A09; I04–I05,I10,I12 |
| AR-03 / P0 | Caracterizar claim y recuperación de depósito IQ entre trigger/task/scheduler y ruta manual | Múltiples entradas confirmadas; carrera no probada | Dos trabajadores simultáneos, lease vencido, timeout tras éxito externo y reentrega: un depósito, un vínculo, sin segundo POST ante resultado incierto; IQ falso | A00,A03–A07; I04–I05,I08–I09,I14 |
| AR-04 / P0 | Aplicación parcial/total y REP: reserva, suma, origen IQ durable, hard gate, cuota, estado incierto y adjuntos | IDs deterministas/claims visibles; implementación REP cambió | Carreras con reserva repetida; dos claims última cuota; switch apagado, root/perfil ajeno, job legacy/durable; respuesta perdida; lookup sin REQUEST indebido; terminales; único efecto y auditoría | A03–A07; I03–I06,I08–I09; DL-REP-REQUEST |
| AR-05 / P0 | Comisión, wallet, adelanto y dispersión: dueño del saldo y compensación | Filtro de transición comisión confirmado; suficiencia del servicio pendiente | Reentrega evento; corrección tras POSTED; una comisión/reserva; cancelación y saldo/ledger conciliados; límite financiero y root ajeno | A02,A04–A07; I05,I09,I14; DL-COMMISSION |
| AR-06 / P0 | Matriz de autorización backend/Firestore/Storage y URL directa; revisar escrituras administrativas de accesos | Política repartida confirmada; no hay vulnerabilidad universal demostrada | Verificador canónico; emuladores por rol/root/cliente/empresa/delegación; llamada directa denegada sin escrituras; documento init/upload/finalize; rechazo de metadato/ruta/tamaño ajeno | A04,A06–A07; I02,I06,I09,I13 |
| AR-07 / P1 | Control Center, reportes, materialidad y Hugo: derivaciones y recuperación, separar autoridad financiera | Se cierran 20 tipos de trigger; fan-out y dirty marker visibles | Replay/no-op; eventos fuera de orden; actualización durante reconstrucción preserva dirty marker; proyección reconciliada; fallo de proyección no duplica finanzas | A02–A04,A06–A07; I04,I08–I10 |
| AR-08 / P1 | Reparar QA materialidad y publicar matriz real de pruebas aisladas | Fuente archivada confirmada | Fixture/contrato rastreado; gate falla ante violación real; todos los casos financieros y permisos identifican SHA/comando/resultado y no usan cuentas reales | A07; I09,I13 |
| AR-09 / P1 | Completar inventario de consumidores, roles y datos dinámicos, corregir anclas y clasificación | 350 IDs; 296 roles NO DERIVADO; 20 tipos ahora resueltos; referencias de pruebas son heurísticas | Para cada entrada crítica: dueño, permiso efectivo, llamada, colecciones/subcolecciones dinámicas, prueba concreta; resolver 17 callables sin referencia en src antes de cualquier retiro | A02,A10; I02–I04,I07,I13; ambos CSV |
| AR-10 / P1 | Revisar 31 señales de UI/legacy individualmente y cohorte REP omitida | Ninguna prueba apagado/obsolescencia productiva | Tabla inferior; navegación contextual y perfil sintético; expediente de uso/retención/reemplazo/rollback para retiro o reactivación | I03,I07,I11–I14; CSV legacy |
| AR-11 / P1 | Suites independientes CFDI/documentos, activos, entidades y mensajería | Cadena financiera principal no cubre estas capacidades | Doble emisión/cancelación incierta; upload inválido; activo/préstamo/pago idempotente; alta/delegación negativa; Telegram/WhatsApp falsos y envío exactamente una vez según contrato | A02,A06–A07; I02,I05,I08–I09 |
| AR-12 / P1 | Reconciliar guía y estado maestro con manifiesto y evidencia nueva | Next 15.5.25 confirmado; informes históricos no son ejecución actual | Guía coherente con lockfile, pruebas y runtime; separar implementado/probado/desplegado/verificado; Sofía documentada solo al localizar capacidad concreta | A01,A07,A10,README; I00,I13,I14,README |
| AR-13 / P2 | Extraer contratos B→C con adaptadores y exports estables; evaluar D solo por métricas | Recomendación compartida, no autorización para refactor global | Equivalencia antes/después, un dueño por efecto, rollback, latencia/claims/duplicados/cola incierta medidos; no doble productor en migración | A08–A09; I10–I12 |

Orden recomendado: AR-01/09 para baseline; AR-02/06 y pruebas AR-03/04/05; AR-07/08/11; resolver AR-10/12; después AR-13. Los ítems independientes pueden investigarse en paralelo, pero migraciones de productores financieros deben ser secuenciales.

## Matriz de lectura y trazabilidad por archivo

La tabla cubre cada fuente, incluidos índices, recomendaciones y CSV. Los prefijos A e I se expanden a las carpetas indicadas arriba.

| Fuente leída | Aporte al backlog |
|---|---|
| A/README.md | Definiciones de evidencia y límites; AR-12 |
| A/00-EXECUTIVE-SUMMARY.md | Cinco prioridades financieras/release/pruebas; AR-01–08 |
| A/01-CURRENT-SYSTEM-STATE.md | Checkout, divergencia y 42 worktrees históricos; AR-01 |
| A/02-MODULE-INVENTORY.md | Propiedad de dominios y rutas; AR-02,05,09,11 |
| A/03-DEPENDENCY-MAP.md | Efectos por Firestore y límites de inferencia de ciclos; AR-03,04,07 |
| A/04-COUPLING-AND-REGRESSION-RISKS.md | Transiciones, eventos, política y UI/backend; AR-02–07 |
| A/05-FINANCIAL-INTEGRITY.md | Dueños y fallos entre proveedor/Firestore; AR-02–05 |
| A/06-FIREBASE-AND-AUTOMATIONS.md | Triggers, tareas, schedulers y canarios; AR-01,03–07,11 |
| A/07-TEST-COVERAGE.md | Pruebas existentes no ejecutadas; AR-03–08,11 |
| A/08-ARCHITECTURE-OPTIONS.md | A–E y preferencia B/C; AR-13 |
| A/09-RECOMMENDED-ROADMAP.md | Baseline→invariantes→pruebas→contratos→migración; AR-01,02,13 |
| A/10-EVIDENCE-INDEX.md | Niveles A/B/C/H; incógnitas remotas/dinámicas; AR-01,09,12 |
| I/README.md | 350 entradas técnicas no equivalen a capacidades certificadas; AR-09,12 |
| I/00-EXECUTIVE-DIAGNOSIS.md | Alcance y riesgos sin incidentes probados; AR-01–10 |
| I/01-PRODUCTION-VS-REPOSITORY.md | Presencia entre refs no equivale a contenido/publicación; AR-01 |
| I/02-COMPLETE-FUNCTIONAL-INVENTORY.md | Servicios, páginas, autoridad y ciclos separados; AR-06,09,11 |
| I/03-DISABLED-HIDDEN-LEGACY-FEATURES.md | 31 señales, 17 callables sin match, comentario engañoso; AR-09,10 |
| I/04-MODULE-DEPENDENCY-MAP.md | Matriz completa 51 dominios, imports y colecciones literales; AR-02–07,09 |
| I/05-FINANCIAL-AND-OPERATIONAL-INTEGRITY.md | Cadena financiera y suites independientes; AR-02–05,11 |
| I/06-SECURITY-AND-ACCESS.md | Scoping y contratos reglas/backend/Storage; AR-06 |
| I/07-UI-AND-MISSING-FUNCTIONALITY.md | 54 páginas y límite del muestreo JSX; AR-09,10 |
| I/08-AUTOMATIONS-TRIGGERS-AND-SCHEDULERS.md | 20 tipos sin resolver y correspondencia remota; AR-01,07,09 |
| I/09-TESTS-AND-REGRESSION-GAPS.md | Matriz positiva/negativa aislada y 23 archivos por sufijo; AR-03–08,11 |
| I/10-ARCHITECTURE-RECOMMENDATION.md | Fronteras lógicas prioritarias; AR-13 |
| I/11-CLEANUP-CANDIDATES.md | Cero expedientes suficientes de eliminación; AR-10 |
| I/12-INCREMENTAL-ROADMAP.md | Baseline, inventario, autoridad, pruebas, extracción, legacy; AR-01–13 |
| I/13-EVIDENCE-INDEX.md | 233 scripts enumerados, límites de método y versión Next; AR-08,09,12 |
| I/14-UNRESOLVED-QUESTIONS.md | Diez incógnitas: producción, worktrees, flags, carreras, saldos, UI, Sofía, scripts, suite, vigencia; AR-01–12 |
| I/FUNCTIONALITY-INVENTORY.csv | Las 350 filas/27 campos preservan ID y referencia; AR-01,09,11 |
| I/DISABLED-AND-LEGACY-INVENTORY.csv | Las 31 filas/10 campos se resuelven individualmente abajo; AR-10 |

## Integridad y límites del CSV funcional

Las 350 filas conservan `despliegue=NO VERIFICADO`, `uso=NO VERIFICADO`, `estado=IMPLEMENTADA NO VERIFICADA` y recomendación de investigar. Hay 296 exports y 54 páginas; 296 roles `NO DERIVADO` y 54 referencias genéricas a roles.ts. 221 filas tienen UI `si`, 129 `no identificada`; ninguna cifra prueba accesibilidad ni autorización. 89 riesgos están marcados altos y 261 por evaluar. La matriz histórica tiene 348 entradas presentes en main/origin-main y dos no detectadas (`dispatchQueuedPagoIqCreation`, `processIqPagoDepositAutomaticTask`); 161/162 filas remiten a archivos distintos de esas refs. No se usa esta matriz para afirmar divergencia actual.

Las listas de ramas se compararon como metadato repetido: no demuestran actividad, limpieza o propiedad actual del worktree. Los propósitos son inferidos del nombre. `datos_literales` y `dependencias_directas` son del archivo, por lo que varias funciones comparten detecciones que no prueban uso individual. Por ejemplo, la prueba de descubrimiento IQ aparece asignada a múltiples callables IQ por heurística; no certifica cobertura específica de cada callable. Las columnas vacías no demuestran ausencia. AR-09 aplica a las 350 filas, usando su ID sin renumerarlas ni mezclar página con callable.

## Decisión por las 31 señales legacy

Cada ID siguiente corresponde exactamente a una fila del CSV legacy. El estado productivo, fecha de desactivación, motivo y reemplazo siguen **NO VERIFICADOS** en las 31 filas. Conservar durante investigación no significa certificar seguridad o uso. Para páginas se conserva navegación/autorización existente; no se añade un menú indiscriminado.

Las filas de esta sección se completan mediante lectura del CSV y comprobación local de archivo/símbolo. Pruebas comunes: **E** = consumidor estático/dinámico, autorización, ventana de uso, retención y rollback; **U** = enlace contextual, URL directa, render por rol/root con datos sintéticos y llamada efectiva; **G** = gate apagado/ausente/tipo inválido, gate habilitado, cuota/scope, replay y ausencia de efecto externo cuando deniega. No se ejecutaron estas pruebas en esta revisión.

| ID | Capacidad | Evidencia local actual | Decisión / prioridad / aceptación |
|---|---|---|---|
| DL-FN-backfillPagoReportDates | backfillPagoReportDates | `functions/src/modules/reports/pagoReportDateBackfillCallables.ts:41`; símbolo presente en index | Conservar; investigar E; P1. Probar reentrega/ejecución repetida según tipo; no ejecutar mantenimiento real. |
| DL-FN-runHugoIqRepReadCanary | runHugoIqRepReadCanary | `functions/src/modules/paymentApplications/complementCanary.ts:149`; símbolo presente en index | Conservar; investigar E; P1. Probar reentrega/ejecución repetida según tipo; no ejecutar mantenimiento real. |
| DL-FN-runHugoIqRepAttachmentExperiment | runHugoIqRepAttachmentExperiment | `functions/src/modules/paymentApplications/repAttachmentExperiment.ts:111`; símbolo presente en index | Conservar; investigar E; P1. Probar reentrega/ejecución repetida según tipo; no ejecutar mantenimiento real. |
| DL-FN-runHugoIqRepDepositFieldProbe | runHugoIqRepDepositFieldProbe | `functions/src/modules/paymentApplications/repDepositFieldProbe.ts:74`; símbolo presente en index | Conservar; investigar E; P1. Probar reentrega/ejecución repetida según tipo; no ejecutar mantenimiento real. |
| DL-FN-runHugoIqRepRequestCanary | runHugoIqRepRequestCanary | `functions/src/modules/paymentApplications/repRequestCanary.ts:146`; símbolo presente en index | Conservar; investigar E; P1. Probar reentrega/ejecución repetida según tipo; no ejecutar mantenimiento real. |
| DL-FN-probeIqDispersionModule | probeIqDispersionModule | `functions/src/modules/iq/dispersionModuleProbeCallables.ts:767`; símbolo presente en index | Conservar; investigar E; P1. Probar reentrega/ejecución repetida según tipo; no ejecutar mantenimiento real. |
| DL-FN-seedUproAssetPortfolio | seedUproAssetPortfolio | `functions/src/modules/assets/callables.ts:1046`; símbolo presente en index | Conservar; investigar E; P1. Probar reentrega/ejecución repetida según tipo; no ejecutar mantenimiento real. |
| DL-UI-42099b4af0 | `/` | `src/app/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-88e60e85e1 | `/cuenta` | `src/app/cuenta/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-bd98cdefb8 | `/mensajes` | `src/app/mensajes/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-4c94e3bc7f | `/systems` | `src/app/systems/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-25d020c883 | `/wallet/adelantos` | `src/app/wallet/adelantos/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-43819dc890 | `/wallet/clientes` | `src/app/wallet/clientes/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-0d4625fa32 | `/wallet/estado-cuenta-cliente` | `src/app/wallet/estado-cuenta-cliente/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-00bb28340e | `/wallet/estado-cuenta-usuario` | `src/app/wallet/estado-cuenta-usuario/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-e89b8aa328 | `/pagos/reproceso` | `src/app/pagos/reproceso/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-462c419553 | `/mat/clientes` | `src/app/mat/clientes/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-00b2a5e029 | `/mat/usuarios` | `src/app/mat/usuarios/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-d2aff0ef08 | `/integraciones/iq` | `src/app/integraciones/iq/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-4f07ac256c | `/integraciones/iq/automatizacion` | `src/app/integraciones/iq/automatizacion/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-623a7932e7 | `/integraciones/iq/diagnostico` | `src/app/integraciones/iq/diagnostico/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-c48d1ce9d3 | `/integraciones/iq/diagnostico/pagos` | `src/app/integraciones/iq/diagnostico/pagos/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-e91b31e517 | `/hugo/evaluation` | `src/app/hugo/evaluation/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-c1a74c7b39 | `/assets/documents` | `src/app/assets/documents/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-3dd9289b45 | `/assets/movements` | `src/app/assets/movements/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-85bdece098 | `/assets/positions` | `src/app/assets/positions/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-UI-cf047cbc75 | `/assets/positions/new` | `src/app/assets/positions/new/page.tsx`; archivo presente | Conservar; investigar U; P1. Ausencia de menú histórica no demuestra abandono ni ruta inaccesible. |
| DL-REP-REQUEST | Solicitud automática REP IQ | `functions/src/modules/paymentApplications/complementGates.ts:24` | Conservar gate; P0 para certificación, prueba G. REQUEST requiere iqRequestEnabled booleano true, master, perfil, cuota; distinguir origen durable/legacy. |
| DL-IQ-HTTP | Creación HTTP depósito IQ | `functions/src/modules/iq/depositHttpCreateCore.ts:177` | Conservar gate; P0 para certificación, prueba G. POST requiere allowHttpPost booleano true; comparar productor manual y automático. |
| DL-WHATSAPP | Envío WhatsApp | `functions/src/modules/documentDelivery/whatsappRuntime.ts:156` | Conservar gate; P0 para certificación, prueba G. sendEnabled deriva del conector; impedir envío si está apagado y conservar job recuperable. |
| DL-COMMISSION | Envío automático de comisiones | `src/components/CommissionUserAssignments.tsx:55` | Conservar gate; P0 para certificación, prueba G. UI separa enabled/executionEnabled; verificar enforcement backend y reserva/costos. |

Además de estas 31 filas, AR-10 conserva `FN-runHugoIqRepReadCohort` como omisión del filtro original; no se inventa un ID legacy histórico para él. AR-09 conserva los 17 callables sin referencia textual enumerados en I/03 y exige localizar consumidores fuera de src antes de cualquier decisión. Ninguna fila tiene expediente suficiente para eliminación ni reactivación productiva.

## Resultado de esta revisión

Se completó la trazabilidad de las 30 fuentes (28 Markdown y dos CSV), se reclasificaron estáticamente las 20 funciones Control Center y se documentaron las 31 señales. Permanecen abiertos los riesgos de concurrencia, autorización semántica y comportamiento externo hasta pruebas aisladas concretas. La correspondencia productiva sigue desconocida. Las modificaciones y checks de la remediación principal se reportan por separado: este archivo no los certifica por inferencia.

## Adenda de implementación S-10: delegaciones vigentes

Tras la revisión anterior se autorizó implementar S-10. Esta adenda describe cambios reales; las afirmaciones de solo lectura anteriores corresponden a la primera fase.

Se centralizó la vigencia en `functions/src/modules/clientDelegations/policy.ts`: `active === true`, `revokedAt` ausente/nulo, inicio no futuro y expiración estrictamente posterior a ahora. Se conservan delegaciones permanentes sin fecha y timestamps nativos o milisegundos numéricos finitos positivos heredados. Strings, booleanos, objetos arbitrarios persistidos, cero, negativos, NaN e infinito no habilitan acceso. Las entradas callable con Timestamp serializado (`seconds`/`nanoseconds` o `_seconds`/`_nanoseconds`) se convierten a Timestamp nativo antes de persistir. Una delegación TEMPORARY sin vencimiento no es válida. No se migraron datos existentes.

El resolver revalida usuario actual, rol, root, estado activo/borrado, cliente y alcance del documento delegado. Permisos específicos booleanos prevalecen sobre fallback legado; `viewBasic=false` tampoco puede eludirse mediante el alias genérico `view=true`. Los helpers locales de `index.ts`, beneficiarios, financiamiento, documentos de dispersión y materialidad usan el adaptador canónico. La enumeración de clientes ya aplicaba el resolver y no requirió edición.

La concesión rechaza fechas/formatos inválidos, usuario/cliente no disponible, permisos no booleanos y ampliación de permisos o plazo de un otorgante que opera mediante delegación. Se conserva la capacidad de redelegar un subconjunto con vigencia no mayor. El panel frontend conserva `mode`, `startsAt`, `expiresAt` y `grantReason` cuando cambia permisos: antes enviaba siempre PERMANENT y expiración nula. No se añadió una interfaz nueva.

Firestore aplica el mismo contrato a acceso básico, solicitudes y pagos; Storage lo aplica a documentos de solicitudes, pagos y dispersiones. Las referencias root/targetUid/clientId ausentes conservan compatibilidad con documentos legacy; si están presentes deben coincidir exactamente. El contrato de permisos ausentes conserva fallback histórico, pero un valor presente malformado no habilita permisos.

### Preservación de reglas publicadas

La investigación de baseline del equipo proporcionó snapshots de reglas productivas en el directorio temporal `pay0-remediation-20261009-rules`. Se integraron sus diferencias respecto de HEAD antes de colocar S-10 encima. SHA-256 de snapshots: Firestore `E46B418E151684F983703A86B1FF6DD1C096FAF113929086F5F45397681E125D`; Storage `EA944E2B3597E48FAAEF50A3231E3C9F63D16D2DE05F3C464AADC7C7953B9B10`.

Se preservaron flags de usuario deleted/disabled/deletedAt, alcance de wallet, privacidad de dispersiones financiadas por USER, bitácoras PAY0 y restricciones de otras bitácoras, colecciones server-only de identidad/canónicos/comisiones, staging corporativo preparado y denegación del almacenamiento canónico. La prueba incluye aceptación por propietario y rechazo a otro delegado de una dispersión USER, rechazo al propietario inactivo, carga corporativa autorizada, rechazo de lectura staging/escritura canónica, colecciones privadas y root ajeno en bitácora.

### Validación y límites

Runner reproducible: `powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-delegations-run.ps1`. Usa exclusivamente proyecto `demo-pay0-delegations`, Firestore `127.0.0.1:18086`, Storage `127.0.0.1:19196`, configuración CLI temporal sin cuenta real y fuentes TypeScript actuales (no `functions/lib` previo). Las fixtures son sintéticas; no se ejecutan Functions desplegadas, IQ, WhatsApp o Telegram.

La matriz cubre concesiones válidas/legacy, expiración y límites exactos del reloj backend, revocación con valores falsy no nulos, fecha/permisos malformados, root/usuario/cliente incorrectos, reducción de permisos efectiva en la siguiente lectura, usuarios inactivos/borrados, acceso anónimo, límites de redelegación y compatibilidad de reglas publicadas. El roundtrip adicional ejecuta el builder puro real del panel y guarda el resultado con el servicio real en emulador.

- Emuladores: **243 aserciones aprobadas**, incluyendo roundtrip frontend → servicio → Timestamp persistido; código de salida 0.
- `node scripts/verify-authorization-policy.mjs`: PASS; bloque generado y política canónica sin cambios.
- `git diff --check` sobre los archivos del lote: PASS.
- Se detectó y corrigió durante pruebas el límite Firestore de 1000 expresiones: reutilizar usuario/rol/root en variables locales evita evaluaciones repetidas sin quitar controles. Los primeros intentos fallidos no se cuentan como aprobación.
- Builds frontend/Functions: a cargo del proceso principal después de consolidar el lote, no declarados aprobados por esta adenda.

**Pendiente S10-DERIVED:** revocar/reducir una delegación padre después de haber materializado un hijo no revoca automáticamente ese hijo. Este lote impide nuevas concesiones desde padre revocado y evita ampliar permisos/plazo al conceder; no certifica revocación transitiva. Resolver exige autoridad documental server-side o actualización transaccional de concesiones derivadas con linaje explícito; un trigger asíncrono no proporciona revocación inmediata.

**Pendiente S-01:** las lecturas Storage delegadas ya consumen dos documentos Firestore (operación + delegación). No se agregó una tercera lectura de usuario, que rompería accesos válidos. La desactivación global del usuario en esos paths requiere diseño de autoridad de descargas; backend y Firestore sí revalidan usuario actual. Las guardas productivas existentes de USER-funded/corporativo que ya consultan usuario se conservaron y probaron. Por estos pendientes, no se declara cerrada toda la seguridad documental o toda la delegación transitiva.

No hubo commit ni despliegue por este agente. Los cambios deben integrar el candidato y su revisión final antes de cualquier publicación.
