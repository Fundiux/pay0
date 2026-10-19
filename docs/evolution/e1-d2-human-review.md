# D2 — revisión humana desde el diagnóstico existente

Estado: **LOCAL_VALIDATED_INTEGRATION_PENDING**. No hay endpoint, ruta, dependencia ni permiso nuevos. No se modificaron los artefactos congelados D1/R2 ni los clones de interfaz publicados. Los builds y pruebas locales pasaron; todavía no existe un paquete exacto autorizado de publicación.

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

Estado de esta interfaz: **LOCAL_UI_VALIDATED_INTEGRATION_PENDING**. No se preparó SSR ni un input de publicación. El build se conserva para retomar la preparación contra la baseline correcta después de publicar el paquete admin/MAT autorizado. Para la revisión humana completa se necesitan además el contrato D2 de diagnostics y la creación/configuración autorizada de `reviewAgent007LearningRule`. Estos destinos son independientes de publicar R2; R2 sólo condiciona la composición de chat D1-after-R2. No se activó ningún gate.

Se necesita una base propia del endpoint `listAgent007LearningDiagnostics`: no usar el ZIP de chat como si fuera su fuente productiva. El trasplante debe limitarse al handler del diagnóstico y a `readReview`, su tipo e imports en el store. No copiar `callables.ts` integrado completo, que contiene cambios ajenos. El resto del dominio D1, los reportes R1.3/R2 y todos los exports deben preservarse y verificarse sobre cada artefacto final.

La base propia se capturó en `.firebase/modular-release/d2-diagnostics-baseline`: revisión `listagent007learningdiagnostics-00002-pin`, ZIP SHA256 `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`, baseline SHA256 `e4cc7f600d8daed48fbf4b333373032815d2e2db6589807266a3e2abc377f2e8`. Carece de RuleStore y los dos helpers de evidencia; no basta reemplazar cuatro entradas como sobre D1. Esa captura no sustituye el cierre de dependencias ni las pruebas del futuro overlay. La creación de `reviewAgent007LearningRule`, el despliegue D1 y sus gates siguen siendo prerrequisitos separados. D2 no los crea ni los habilita.

La interfaz futura debe conservar la base publicada R1.3 y otras correcciones aprobadas. Requiere diagnóstico D2 y revisión D1 realmente disponibles; un botón visible no prueba que estén desplegados. Activar los gates de chat/review requiere configuración y autorización separadas. La reversión de código debe restaurar la fuente propia de cada destino y la interfaz anterior, preservando reglas, experiencias, revisiones y ledger. No hay rollback de datos ni escrituras financieras en este cambio.
