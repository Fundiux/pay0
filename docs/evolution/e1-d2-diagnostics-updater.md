# D2: controlador exclusivo para actualizar diagnostics

Estado: **DEPLOYMENT_PENDING**. Controlador revisado y paquete local preparado; no se ejecutó ninguna mutación remota. La captura de metadatos y fuente fue de sólo lectura. El artefacto sigue pendiente de autorización/publicación y no habilita la capacidad D completa.

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

La revisión independiente y la preparación local se completaron. Sigue pendiente la autorización específica de publicación. No se crean `reviewAgent007LearningRule`, reglas, índices, datos supervisados ni gates con este controlador.

## Paquete exacto preparado

Directorio privado: `.firebase/modular-release/d2-diagnostics-update/`. La captura de 2026-10-19 21:54:55 UTC confirmó la misma revisión `listagent007learningdiagnostics-00002-pin`, recurso/servicio/IAM idénticos a la captura original, ZIP c50 y cero operaciones activas.

| Archivo | SHA256 |
| --- | --- |
| `input.json` | `f58c9ef8eb06eca41288bb215e6e126ab52d6f9db0d4414a47b6809f729424af` |
| `diagnostics-plan.json` | `351714d65bd64f16f002726650f26f5157e8dbf8a1ac18e006cba994967423d8` |
| `baseline.json` | `87cde27ac91de4bb2c7fee545a2bd73b8a3b76bcd0d384090dc31c70da1ec923` |
| `startup-verification.json` | `81836947fda3f6bbb1ca8b37394ff58decd13dec1bbde3975bc29e45194c8e64` |
| `behavior-verification.json` | `3d7a3d42cd14b6dfc4a0dc5bd001b7e7ef7d8eddbf8fa6c7cf2df26365c01cd5` |
| `regression-verification.json` | `f563c8cdfafc2711c34cca653a670b361b589016f7f305317f736c80ed337d3b` |

Las envolturas conservan referencia y SHA de cada proof original y del productor versionado. No son ejecuciones nuevas. El productor del proof de emulador sólo lo escribe después de exigir exit 0 y comparar todos los archivos del runtime antes y después; su log confirma siete pruebas, siete PASS y cero fallos. La preparación volvió a comparar las 1090 entradas del runtime actual con el ZIP d148, de forma opaca y sin imprimir configuración. La comparación de regresión mantiene los dos resultados originales 25/26 y sus logs fijados.

`loadLocal` y `prepare` aceptaron todas las identidades y hashes; `local-validation.json` registra preparación local, `testsRerun:false`, originales intactos y cero escrituras productivas. El controlador repetirá una lectura fresca de recurso/servicio/IAM, fuente y operaciones antes de cualquier mutación autorizada. No se ejecutó `--execute`, no se adquirieron locks productivos y no se habilitó un gate.

Con el gate apagado, esta entrega sólo instala el diagnóstico; no constituye revisión operativa ni aprendizaje activo. El método de revisión exige el gate habilitado también para revocar. La futura autorización debe distinguir instalación, activación y operación humana, sin atribuir al paquete capacidades que siguen deshabilitadas.
