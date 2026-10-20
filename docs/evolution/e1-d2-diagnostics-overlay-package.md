# D2: candidato aislado de diagnóstico sobre su base productiva

Estado: **LOCAL_CANDIDATE_TESTED_NOT_DEPLOY_READY**. No está publicado ni hay un input ejecutable. Falta un controlador autorizado para este destino, la preparación del input y su revisión de vigencia. No se modificaron los controladores de despliegue ni se usó el grupo de chat para eludir su alcance.

## Identidad y alcance

- Destino exclusivo: `listAgent007LearningDiagnostics`; revisión base capturada `diagnostics00002-pin`.
- ZIP base: `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`, 1081 entradas.
- Candidato privado: `.firebase/modular-release/d2-diagnostics-candidate-v1/diagnostics-d2.zip`, SHA256 `d148d084149f6be8e76ce297d4639c22583ead14e5eee64f6386b3969d353ce8`.
- Implementación reutilizada: commit D2 `f0fc69fbe761cdf1dded4b67a0550e2d237074af`. Este commit identifica las fuentes de origen; el patch adaptado a la base productiva tiene procedencia independiente.
- Patch exacto: `qa/patches/d2-diagnostics-source.patch`, SHA256 `24fe46b530742411fe1d4709a8620173dce60d9b72749a0e7df864445e706f4b`. El futuro `sourceCommit`/`patchCommit` debe identificar el commit que contiene este patch; `sourceTree` será `null`.
- Receta: `qa/scripts/build-d2-diagnostics-overlay.mjs`. Acepta ZIP base, módulo TypeScript y un directorio privado nuevo. Comprueba la base, trasplanta sólo el handler por AST, exige equivalencia del emit previo y reproduce el hash candidato. No instala dependencias ni llama a producción.

La base no contiene RuleStore, observationEvidence ni evidenceIdentity, ni exporta `reviewAgent007LearningRule`. Por ello este cierre no es el delta de cuatro entradas calculado sobre D1+R2: requiere ocho fuentes y conserva el inventario real de **341 exports**, sin añadir review ni cambiar `index`.

## Cambios intencionales y preservación

Las ocho fuentes son `callables.ts` (sólo nuevo import y handler de diagnostics), `firestoreHugoLearningRuleStore.ts`, `observationEvidence.ts`, `hugoCore/evidenceIdentity.ts`, `hugoCore/experienceBuilder.ts`, `firestoreHugoLearningStore.ts`, `hugoCore/learningContract.ts` y `hugoCore/learningStore.ts`, todas dentro del módulo agent007.

Se reutilizan los controles D1 de identidad y procedencia. El constructor de experiencias y sus callers existentes se actualizan conjuntamente: no se introduce un helper nuevo dejando sus llamadas legacy incompatibles. Las ampliaciones de contrato y store son de tipos. La comparación confirmó que el helper de actividad de paymentApplications, authGuard y learningEvaluation coinciden con la base D1; no se sustituyen.

El ZIP cambia 12 entradas existentes: cinco fuentes TypeScript y siete archivos de runtime/mapas. Añade nueve: tres fuentes y seis archivos JS/mapas. Conserva **1069 entradas idénticas**, para un total de 1090. `manifest.json` privado enumera cada entrada. El AST de las demás declaraciones de callables permanece idéntico; no se copió ese archivo integrado completo. Core, reportes, configuración, dependencias, index y módulos financieros conservan sus bytes originales. La configuración incluida en el ZIP base se preservó opaca, sin abrirla, publicarla en Git ni imprimirla en logs.

## Pruebas sobre el artefacto exacto

- Reproducción: PASS; una segunda ejecución de la receta obtuvo el mismo SHA256 `d148d084...`. El patch aplica a la fuente capturada y produce exactamente las ocho fuentes del candidato.
- Typecheck completo de la copia aislada: PASS, exit 0. No se escribió la lib integrada.
- Startup con red bloqueada: PASS; 341 exports del candidato coinciden con los 341 de la base. Review sigue ausente. Las dos llamadas anónimas a diagnostics (`{}` y `{mode: "SUPERVISED_REVIEW"}`) fueron rechazadas. Cero intentos de red.
- Firestore Emulator aislado: **7/7 PASS**, exit 0. Se compararon los archivos del runtime con el ZIP antes y después. Cubre diagnostics legacy y nuevo, creación/corrección real de experiencias, paginación, autorización/root, datos malformados, ausencia de campos libres y errores Firestore propagados. Aprobación/revocación se ejercitan mediante el **método interno del RuleStore**, porque este artefacto no exporta el callable review; no es una prueba de ese endpoint publicado.
- Regresión focalizada de contexto, Phase 5 y Phase 6: **base 25/26; candidato 25/26**, con el mismo único fallo de autorización de entrenamiento almacenada tras revocación. No hubo nuevas regresiones. No se declara PASS universal. Una primera ejecución omitió un fixture local del exportador; se conservó el log y se repitió con el fixture original sin modificar.

`learningGovernance` se conserva byte por byte, incluida esa limitación previa de cached grants. El nuevo `readReview` recalcula `trainingEligibility` y verifica evidencia; no llama a `internalTrainingAuthorization`. La corrección de gobernanza de D1 es una entrega independiente y no se atribuye a este paquete.

La instalación reutilizada conserva el lockfile exacto y las mismas dependencias, devDependencies y engines; su package.json difiere sólo en scripts. `--preserve-symlinks` se utilizó exclusivamente en el harness local para evitar EPERM de realpath sobre junctions de Windows. No cambió el ZIP ni define un contrato de despliegue o de SSR.

El patch usa ocho bloques binarios Git para conservar exactamente los finales de línea de la fuente capturada y de las fuentes reutilizadas. Se verificó con `git -c core.autocrlf=false apply` sobre una copia nueva; su resultado coincide byte por byte con las ocho fuentes del candidato. Un primer patch textual sólo conservaba equivalencia normalizando CRLF y fue sustituido antes del commit. La receta mantiene el trasplante AST legible y verifica el emit base: los bloques binarios no amplían el alcance del cambio.

Evidencia privada: `manifest.json`, `verification.json`, `startup-proof.json`, `typecheck.log`, `regression-comparison.json`, ambos logs de regresión y `qa-internal-review/proof.json` dentro del directorio candidato. El helper reproducible del emulador es `qa/scripts/e1-operations-d2-artifact.cjs`.

## Dependencias antes de publicación

El controlador actual de Functions no incluye diagnostics en su whitelist. Hace falta una actualización de alcance segura en una versión independiente del controlador o un controlador específico autorizado; no se cambiarán los hashes de herramientas de otros paquetes pendientes. Después se requiere input sobre la base propia vigente, pruebas de artefacto y autorización de estos bytes. La reversión restauraría la fuente propia anterior de diagnostics, sin borrar experiencias ni ledger.

La UI D2 requiere su paquete aislado y conserva la vista legacy. El guard del wrapper rechaza una respuesta de backend antiguo que ignore `mode`, sin convertirla en candidatos ni bloquear la vista previa. El endpoint review todavía no existe en producción: el candidato de diagnostics sólo habilita lectura, no aprobación/revocación completa. Los gates son por Function; diagnostics no puede certificar la activación de chat/review. Su publicación y configuración siguen pendientes de la entrega D1 y autorización separada. No se generaron datos supervisados ni se activó ninguna regla.
