# D2 — revisión humana desde el diagnóstico existente

Estado: **DEPLOYMENT_PENDING**. D2 conserva la ruta y los permisos existentes; sus paquetes exactos de diagnostics y UI están preparados y probados localmente, sin autorización ni publicación. El endpoint de revisión D1 se prepara por separado con gate apagado. No se modificaron los artefactos congelados D1/R2 ni los clones de interfaz publicados.

## Contrato y alcance

`listAgent007LearningDiagnostics({})` conserva el diagnóstico legacy. El modo opcional `SUPERVISED_REVIEW` añade páginas independientes de experiencias y reglas, con límite 1–25, `candidateCursor`, `ruleCursor` y `focusedRuleId` opcionales. Rechaza modos, campos, tipos y límites inválidos. Cada llamada autentica y cada transacción relee superadmin activo y root vigente. Los cursores incluyen versión, tipo, root e ID; además se verifica el documento de inicio dentro de la consulta autorizada. Un cursor o ID del navegador no concede acceso.

Las experiencias se consultan por root, dominio SOLICITUDES y tarea REASON; las reglas por root y esquema `supervised-rule-v1`. Ambas páginas ordenan por ID y leen un registro adicional para indicar si existe otra página. No se promete exhaustividad a partir de una página. El foco permite volver a consultar la regla recién aprobada aunque esté fuera de la página actual; exige el mismo root y esquema.

La respuesta sólo contiene IDs, versiones, estados, características del contrato, código de corrección, tipo/fecha de resultado y referencias de evidencia acotadas. No devuelve montos, notas libres, contenido crudo de memoria ni documentos financieros. Para permitir seleccionar una experiencia se valida primero su estructura y tipos de referencia, luego su elegibilidad actual y la evidencia canónica mediante el verificador del dominio existente. Datos incompletos se marcan `INCOMPLETE_RECORD`; evidencia no verificada impide seleccionar. Los errores reales de Firestore se propagan y no se convierten en una página vacía.

La lectura no usa `resolve`, no invalida reglas, no escribe ledger ni cambia solicitudes. `ACTIVE` significa estado guardado, no aplicabilidad garantizada: la revisión y el uso vuelven a comprobar soporte y permisos. La fecha vencida se informa sin mutar el registro.

El gate pertenece a cada Function. `diagnosticsLocalFlag` sólo refleja la configuración local del diagnóstico; review y chat permanecen `UNKNOWN`. La interfaz presenta disponibilidad de aprobación por confirmar y aplicación en María no verificada. No deduce activación global. La aprobación/revocación usa `reviewAgent007LearningRule`, existente en la fuente local pero todavía ausente en producción según la captura del 2026-10-19 a las 21:13:11 UTC, y deja que el servidor confirme disponibilidad y autorización.

## Interfaz y conservación

`HugoLearningDiagnostics` conserva su vista legacy. Sólo la nueva sección exige perfil superadmin activo. No se reconstruyen paneles ni se piden IDs manuales: se eligen dos a cinco experiencias de la página, se consulta su procedencia y se confirma expresamente la decisión. Aprobar o revocar vuelve a consultar el estado canónico. Una respuesta rechazada no presenta un éxito ni inventa un estado ACTIVE.

Las páginas de experiencias y reglas tienen controles anterior/siguiente. Cambiar de página limpia selección y detalle. La clave de UID/root/rol/actividad reinicia ambas vistas; generaciones de solicitudes independientes evitan que una respuesta antigua, un `finally` o una mutación pendiente afecten otra identidad. Las operaciones legacy de carga y linaje conservan generaciones separadas para evitar un indicador de carga bloqueado.

El wrapper valida modo, arrays y estructura del estado de configuración antes de devolver datos. Si un backend anterior responde con el contrato legacy, la UI muestra indisponibilidad controlada, conserva el diagnóstico anterior, no monta selección y no intenta aprobar. No presenta esa respuesta como una lista vacía ni produce un error de render.

## Verificación

- Interfaz real y wrapper Firebase real, con transporte y perfiles sintéticos: PASS de límites 2–5, detalle de evidencia, confirmación previa, recarga canónica, paginación de experiencias y reglas, rechazo de aprobación, cambio de identidad y conservación legacy. No equivale a Firebase Auth productivo.
- Build Functions NORMAL: PASS, código 0, tras corregir únicamente el estrechamiento TypeScript de campos opcionales. El primer intento fallido se conserva en `tmp/d2-functions-build.log`; el resultado final está en `tmp/d2-functions-build-final.log`.
- Build frontend final: PASS, código 0 (`tmp/d2-frontend-build-final.log`), después del guard de compatibilidad. Su caso de UI explícito también pasó.
- Firestore Emulator sobre la `lib` del build NORMAL final: **7/7 PASS**, cero fallos y salida 0; emulador cerrado. Cubre contrato legacy, más de 25 registros, páginas y foco, auth/root revocados, entradas inválidas, referencias null/vacías/numéricas, no filtración, propagación de errores y lecturas sin escrituras. Log: `tmp/d2-review-emulator-final.log`. El primer intento falló sólo por un resolver relativo del test; se corrigió a la ruta absoluta de Functions y no se cuenta como PASS.
- Regresiones de contexto, aprendizaje, hardening, reportes, query, tokenUsage y diálogo: **69/69 PASS**, cero fallos u omisiones, sobre la `lib` final sin hooks. Log `output/d-publication-plan/d2-compiled-regressions.log`, SHA256 `1a9408e07bcd759d10c9be60023747ab097daf1580c9e98bf3896195f4b05c40`.
- Verificador de autorización: PASS `PAY0-USERS-PERMISSIONS@1`, frontend/Functions/Firestore sincronizados. No se cambiaron roles ni reglas.
- Plan de consultas D2 exacto: PASS de sólo lectura el 2026-10-19 a las 21:01:22 UTC, con orden `__name__` y límite 26. Request SHA256 `4c4821b9ff636ffdc1e076fe8df379ef242a4836aaae3c04561580debe0a0b6a`; evidencia privada `output/d-publication-plan/d2-query-plan-only-proof.json`. Cero documentos, ejecuciones y escrituras. No se reutiliza el plan D1 sin orden; tampoco se afirma autorización o suficiencia de datos productivos.

## Publicación futura y reversión

### Candidato de interfaz aislado

La rama local `release/d2-human-review`, commit `a2cf5d1f3402079b37b2b7e006fb6c91501ff505`, parte de admin/MAT `a335e195e8e70f889be1e60aa0df850e4d278585`. Sólo cambia `src/components/HugoLearningDiagnostics.tsx` y `src/services/agent007.ts`; conserva R1.3 PDF/XLSX, E y admin/MAT. El servicio incorpora el contrato D2 y el wrapper de revisión D1 que necesita el panel, sin afirmar que ese endpoint ya exista en producción.

El build aislado terminó con código 0 y estado PASS. Recibo: `.firebase/modular-release/hosting-a2cf5d1f3402-57d82bde-0458-4275-ae18-6211f023e2eb/build.json`, SHA256 `2efdeac5bce512783a2cb377c3499ac03c415ab0b8848118f9fe77778c0ceaa6`. El helper instaló el lockfile del clon, validó las siete variables públicas requeridas y completó compilación, tipos y generación de las 47 páginas. La instalación manual anterior no se usa como prueba del runtime.

La QA ejecutó el componente y el servicio reales de ese clon mediante `PAY0_D2_UI_ROOT` y `PAY0_D2_UI_OUTPUT`, con transporte Firebase y perfiles sintéticos. Pasaron selección, confirmaciones, estados canónicos, paginación de ambas listas, aprobación denegada, respuestas obsoletas y conservación legacy. Recibo local: `.firebase/modular-release/d2-ui-qa/proof.json`, SHA256 `e5f9ceb7d5a7b44289cc7c5aa58c84e7db39217d3eb5c95d3a43b45567c43d1d`. No certifica una sesión autenticada ni acciones productivas.

Estado de esta interfaz: **DEPLOYMENT_PENDING**. Después de publicar admin/MAT se preparó el SSR exacto sobre su baseline estable, preservando esa fuente. Para la revisión humana completa se necesitan además el contrato D2 de diagnostics, la creación/configuración autorizada de `reviewAgent007LearningRule`, el consumidor D1 en chat y una activación separada. El gate apagado permite instalar el código, pero no aprobar ni revocar reglas. No se activó ningún gate.

El diagnóstico usa su base propia, no el ZIP de chat. Su overlay comprobado incorpora ocho fuentes y conserva el resto de los módulos y exports. El alcance y las pruebas sobre ese artefacto se detallan en [el paquete de diagnostics](e1-d2-diagnostics-overlay-package.md); no se copió `callables.ts` integrado completo.

La base propia se capturó en `.firebase/modular-release/d2-diagnostics-baseline`: revisión `listagent007learningdiagnostics-00002-pin`, ZIP SHA256 `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`. El refresco de sólo lectura y el input/plan exactos figuran en [el controlador dedicado](e1-d2-diagnostics-updater.md). El resultado comparativo es base 25/26 y candidato 25/26, con un fallo previo idéntico; no se declara PASS universal. La creación de `reviewAgent007LearningRule`, el consumidor D1 y sus gates siguen siendo prerrequisitos separados. El actualizador D2 no los crea ni los habilita.

La interfaz futura debe conservar la base publicada R1.3 y otras correcciones aprobadas. Requiere diagnóstico D2 y revisión D1 realmente disponibles; un botón visible no prueba que estén desplegados. Activar los gates de chat/review requiere configuración y autorización separadas. La reversión de código debe restaurar la fuente propia de cada destino y la interfaz anterior, preservando reglas, experiencias, revisiones y ledger. No hay rollback de datos ni escrituras financieras en este cambio.

## SSR exacto preparado sobre admin/MAT publicado

Directorio: `.firebase/modular-release/hosting-a2cf5d1f3402-57d82bde-0458-4275-ae18-6211f023e2eb/`.

| Elemento | SHA256 |
| --- | --- |
| `input.json` | `78203f56922c8cc603260ad4dae1847b45afb06d01fb2558cc2585593f6b08f0` |
| `ssr.zip` | `58a69d097f032d27ba653371bd1fd7a447ef5eb3a4e3ab5781bea488bda77d38` |
| Baseline admin/MAT estable | `d2d7725cf59c10739dcd12714ce121110ea7d71da9a9938fa31f9420eaa783e8` |
| `runtime-2e2e7464-0722-4bb6-b986-2caeca13795d/proof-with-qa-override.json` | `c0dbca5687ab3c6306afb7185408c76864ec8b24d4ca79e95c2781bd1815b47c` |
| Proof canónico original | `f58ddef94a1d3fc5eb7b29ce6a0f3f6d17183068e0303112f294cdd55f025cce` |

La base publicada es Hosting `a340678f44840641`, SSR `ssrpay0system-00604-hov`, fuente `a335e195e8e70f889be1e60aa0df850e4d278585`, ZIP `f0e47ff8aae70da0b50836f23367a5c49ab641baf12c89af3a90edbb569ebf0f`. El input preserva esa identidad, configuración e IAM.

Se extrajo un runtime nuevo desde el ZIP D2. Se copiaron únicamente dependencias de una instalación verificada después de comprobar igualdad exacta de `package.json` y lockfile; no se reutilizó como fuente el runtime de otro ZIP. El verificador canónico comprobó 484 archivos contra este archivo, realpaths y cierre de dependencias. Pasaron cinco rutas HTTP, login a 390/1440 px, redirección anónima de `/pagos`, ausencia de errores JS y cinco componentes. El proceso terminó exit 0 y el emulador se cerró.

El proof declara un override de QA: el test antiguo de Ingeniería no suministraba el contexto de perfil ni el módulo real `RecoveryReview`. El preload sólo sustituye ese path y hash; conserva las aserciones originales y añade negativos sin sesión, rol incorrecto e inactividad. Original `35f5d7a…`, adaptación `593b8fd7…`, preload D2 `7f716750e8444d92b799bc07c590ee74f9ff2e41bc50b3cbe75a9575f8454cab`. El componente y el ZIP no se modificaron. No se presenta como ejecución sin cambios del test original.

`assertRuntimeProof` acepta el proof anotado. Estas verificaciones usan fixtures y Firestore Emulator, no sesiones productivas ni reglas Firestore. El paquete integrado y sus etapas pendientes están en [la instalación D](e1-d-installation-package.md).
