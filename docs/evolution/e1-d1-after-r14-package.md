# D1 sobre R1.4: composición local preservada

Estado: **LOCAL_CANDIDATE_TESTED_NOT_DEPLOY_READY**. No hay input productivo, publicación ni activación de gates. El paquete conserva R2 y la corrección de lenguaje R1.4; sustituye como futuro candidato al D1 basado directamente en R2.

## Identidad y composición

- Base R1.4 certificada: ZIP `21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9`, fuente/patch versionados en `2b10b0ed9235430c17674144eb4b18e9d2c94ebb`.
- Patch D1 existente: `qa/patches/d1-after-r2-learning.patch`, SHA256 `744e16e5f5166acd3fbeb5a60d674a59245f4287db7cf01d318a17856418e9ae`. Sus once fuentes son idénticas a las del D1-after-R2 previamente revisado; no se reconstruyeron reglas.
- Candidato: `.firebase/modular-release/d1-after-r14-candidate/d1-after-r14.zip`, SHA256 `a6f29085e6674746b610c3578131f42b394aae80d754cc26d914c514397a41a9`.
- Receta: `qa/scripts/build-d1-after-r14-overlay.mjs`, SHA256 `3faa6c8939d6d52e1094debb2603caf555448bd97f13869c9aab3d94a40ef51d`. Reutiliza la receta D1 anterior fijada por hash y sólo cambia las identidades de base/salida. Una reproducción independiente produjo exactamente el mismo ZIP.

La auditoría previa confirmó que R1.4 sólo cambia `reportSemantics.ts` y `contextBuilderV2.ts` frente a R2. No hay solape con el patch D1. La composición cambia 13 entradas, añade seis y conserva 783, sin borrar ninguna. Los 802 archivos extraídos coinciden con el ZIP. Las fuentes y los cuatro JS/mapas R1.4 quedan intactos. Todos los bytes ajenos a D1, incluidos reportes, fórmulas financieras y manifiestos/lockfiles, se preservan.

La procedencia es compuesta: `sourceTree:null`; no representa un checkout completo del árbol integrado. El único export nuevo es `reviewAgent007LearningRule`. Los 342 endpoints anteriores permanecen; el consumidor D1 es `sendAgent007Message`.

## Reproducción y pruebas

La receta acepta cuatro argumentos: directorio de fuente R1.4 verificada, ZIP R1.4 exacto, módulo TypeScript y directorio nuevo de salida. Exige los hashes de base, patch, receta original y resultado; comprueba el emit previo antes de sustituir las once fuentes. No instala dependencias ni consulta producción.

Sobre el candidato exacto:

- Typecheck aislado: PASS, código 0.
- Arranque con red bloqueada y gate OFF: PASS; 343 endpoints, 342 anteriores conservados y dos callables rechazando acceso anónimo.
- Firestore Emulator: 20/20 pruebas D1, aprendizaje, creación/outcome con gate OFF, hardening, reportes R1.3 con gate OFF/ON y reportes R2. Emulador cerrado, código 0.
- Escenario R1.4 con callable/datastore reales y datos sintéticos: PASS, código 0. Petición sin la palabra cliente → mes pendiente → «en pdf» reconocido → año explícito → reporte persistido/listado → Excel del mismo periodo. Verifica root/fechas, saludo y revocación, con cero llamadas a proveedores.
- Regresiones seleccionadas: 61/61 PASS; lenguaje natural sobre el JS del candidato: 13/13 PASS.
- Comparación de bytes antes/después de las pruebas: PASS. La QA R1.4 admite ahora un nombre de archivo alternativo acotado a basename; por defecto conserva `chat-r14.zip`. Las pruebas originales y sus recibos no se alteraron.

Recibo privado: `d1-after-r14-candidate/behavior-verification.json`, SHA256 `2ed2edba619e320cd94ea401a5e28a52f7b1293d2e23abc27d6fb3d4b2e13ce9`; auditoría en `review-structure.json`. Logs locales: `typecheck.log`, `startup.log`, `regressions.log`, `natural-semantics.log`, `tmp/d1-after-r14-emulator.log` y `tmp/d1-after-r14-natural-emulator.log`.

La selección anterior no implica PASS universal: `universalQueryContract` conserva los dos fallos conocidos de R2/R1.4 en pruebas nuevas de inmutabilidad/validación. No tiene consumidores productivos identificados y no forma parte del camino del reporte. Su corrección existente permanece separada; no se amplía D1 con ese módulo.

## Dependencias y reversión

Antes de preparar una publicación hay que confirmar que R1.4 esté publicado y capturar de nuevo su baseline. La actualización de chat, la creación autorizada de review, su configuración/IAM y la interfaz de revisión D2 son superficies distintas. Este candidato no crea recursos ni autoriza esas acciones. No requiere repetir o sustituir el despliegue R2 si R1.4 ya lo conserva.

El gate sigue ausente/OFF. Las pruebas que lo activaron sólo lo hicieron en procesos sintéticos del emulador. El gate de cada Function y la disponibilidad de la interfaz se verifican por separado antes de cualquier activación.

La reversión de código debe preservar la versión R1.4 efectiva y cualquier cambio posterior autorizado, con preflight nuevo; no restaurar a ciegas el ZIP D1-after-R2. No se borran experiencias, reglas, auditoría ni ledger. No hay cambios financieros ni rollback de datos en esta composición.
