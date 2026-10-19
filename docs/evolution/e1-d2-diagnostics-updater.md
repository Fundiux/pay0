# D2: controlador exclusivo para actualizar diagnostics

Estado: **LOCAL_CONTROLLER_TESTED_REVIEW_PENDING**. Existe código y pruebas offline; no se preparó input autorizable ni se ejecutó ninguna operación remota. El artefacto sigue pendiente de publicación y no habilita la capacidad D completa.

`scripts/update-learning-diagnostics.mjs` acepta únicamente `listAgent007LearningDiagnostics`. No amplía ni utiliza un grupo alternativo de los controladores fijados por R2/admin-MAT. Reutiliza sus comprobaciones puras de fuente y operación, fijando también el hash de ese módulo en el futuro plan.

Identidad permitida:

| Elemento | SHA256 / commit |
| --- | --- |
| ZIP productivo anterior | `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f` |
| ZIP candidato | `d148d084149f6be8e76ce297d4639c22583ead14e5eee64f6386b3969d353ce8` |
| Patch versionado | `24fe46b530742411fe1d4709a8620173dce60d9b72749a0e7df864445e706f4b` |
| `sourceCommit` / `patchCommit` | `b5ba93a4b002a0c4dde8711b524840737e7fcd40` |

El modo es `PRODUCTION_OVERLAY_V1`, con `sourceTree:null`. El commit de implementación original `f0fc69f…` no identifica un árbol completo del ZIP. La CLI exige hashes de input/plan y autorización explícita para actualización o rollback. Lee y comprueba localmente ZIPs, baseline, patch y tres proofs antes de obtener un token. Los proofs de startup, comportamiento y comparación requieren identidad y SHA propios; deben conservar el vínculo con la evidencia original, sin presentar envolturas como ejecuciones nuevas.

## Contrato de conservación

La única mutación de Function admitida usa `updateMask=buildConfig.source,labels`. Antes de subir o aplicar se comprueban recurso, servicio e IAM completos contra el snapshot y ausencia de operaciones activas. El upload exige generación como string y descarga/hash coincidente antes del PATCH, también al reanudar. Runtime, entorno, gates, IAM y otros endpoints no forman parte de la mutación.

El postflight coteja la respuesta de operación con GET, configuración completa de Function/Cloud Run salvo campos generados expresamente enumerados, labels esperadas, IAM idéntico y bytes de fuente. No equivale a verificación funcional productiva. El rollback necesita el estado propio exacto, vuelve a comprobarlo contra la baseline original y sube sólo el ZIP anterior c50; restaura sus labels, sin escribir datos o IAM.

Se usan los locks compartidos `active-executor.lock` y `deployment.lock`. El journal se persiste antes del PATCH; `DISPATCHING` sin respuesta identificable bloquea repetición. Una operación conocida puede seguir consultándose. Un journal ilegible, ausente o ajeno nunca libera un lock preexistente. La escritura interrumpida puede requerir reconciliación manual; no se intenta adivinar el resultado ni recuperar automáticamente el lock.

## Pruebas y límites

`node --test qa/scripts/learning-diagnostics-update.test.mjs`: **14/14 PASS**, con ciclo update/rollback mediante IO sintético, destino ajeno, deriva de configuración/IAM/fuente, operación activa, fuente persistida adulterada, operación de otro proyecto, resultado incierto sin replay, rollback con deriva o journal inventado y journals malformados/ausentes/ajenos conservando el lock. No se instaló nada ni se accedió a producción.

Las suites independientes de los creadores E y D1 pasan **52/52**; no se suman a las pruebas funcionales del artefacto diagnostics. Su evidencia de regresión continúa siendo **base 25/26 y candidato 25/26**, con el mismo fallo previo de cached training grants tras revocación; el controlador exige `BASELINE_COMPARISON`, no PASS universal. Startup y siete casos del emulador se describen en [el paquete del artefacto](e1-d2-diagnostics-overlay-package.md).

Siguiente paso: revisión independiente del controlador, vincular proofs originales por SHA e identidad, refrescar baseline propia de diagnostics y preparar un plan exacto. Después se necesita autorización específica de publicación. No se crean `reviewAgent007LearningRule`, reglas, índices, datos supervisados ni gates con este controlador.
