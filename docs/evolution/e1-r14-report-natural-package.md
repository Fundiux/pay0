# R1.4: solicitud natural de reporte y aclaración de año

Estado: **CANDIDATO PROBADO; PENDIENTE DE AUTORIZACIÓN**. No se ha publicado. El destino es únicamente `sendAgent007Message`, sobre el R2 publicado; no incorpora D1/D2 ni cambios de interfaz.

## Problema y resultado

La frase «Dame un reporte de utilidades de pc directo del mes de septiembre» no contenía la palabra `cliente`, requerida por el reconocedor anterior. R1.3 y R2 derivaban esa frase y «en pdf» al modelo, sin conservar una solicitud pendiente. La reproducción sintética confirmó dos llamadas al modelo, ningún reporte y ningún contexto pendiente en ambos runtimes.

R1.4 reconoce la solicitud sin esa palabra y conserva cliente, mes y formato. Si falta el año, pregunta cuál es; «en pdf» responde «De acuerdo, en PDF» y mantiene la pregunta, sin afirmar que exista un archivo. Sólo un año explícito o fechas explícitas completan el periodo. El intervalo resultante sigue usando el handler canónico de reportes, con autorización y filtros existentes. No se infiere el año actual.

La captura tolera puntuación y comillas de cierre sin quitar puntuación interna del nombre. `Banco de Septiembre` no se interpreta como periodo. Una solicitud nueva no hereda la comparación anterior; las continuaciones y repeticiones explícitas conservan sus filtros. Los saludos borran el contexto pendiente como en R1.3.

## Fuente y artefacto

- Base publicada: `sendagent007message-00020-faf`, ZIP R2 `83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe`.
- Baseline: `.firebase/modular-release/r2-after-r13/published-baseline.json`, SHA256 `48bd4d5bf8a9ad42bec5ad7d27f0a5116272b7bff28cd76bafc694422559a1ab`.
- Candidato: `.firebase/modular-release/r14-report-natural/candidate-certified/chat-r14.zip`, SHA256 `21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9`.
- Patch: `qa/patches/r14-report-natural.patch`, SHA256 `6784975e087cb788f835ac637b97a60f48df5d0cda0197fad746a645d957ee20`.
- Receta: `qa/scripts/build-r14-report-overlay.mjs`; exige la base y el patch exactos y reproduce el SHA candidato. Los bloques binarios Git conservan los finales de línea; el código sigue revisable en las dos fuentes.

Sólo cambian `hugoCore/reportSemantics.ts` y `hugoCore/contextBuilderV2.ts`. El ZIP modifica sus cuatro entradas JS/mapas y conserva las otras **792 entradas**, inventario total 796. No cambia callables, index, dependencias, configuración, permisos, fórmulas ni exportadores. La procedencia usa `sourceTree:null` y `sourceCommit`/`patchCommit` `2b10b0ed9235430c17674144eb4b18e9d2c94ebb`, que contiene este patch exacto; no usa el árbol integrado completo.

## Verificación

- QA de lenguaje natural: **13/13 PASS**, incluido periodo sin año, formato abreviado, puntuación, nombre que contiene un mes, reinicio y ausencia de comparación heredada.
- Escenario Firestore Emulator sobre el ZIP exacto: PASS, exit 0. Usa el callable y datastore reales: solicitud → PDF pendiente → año explícito → adjunto persistido y listado → Excel sobre el mismo periodo; comprueba root/periodo, saludo y revocación. Cero llamadas a proveedores. Los importes de la prueba son sintéticos.
- Startup del ZIP exacto: PASS, 342 exports y rechazo anónimo de `sendAgent007Message`, con red bloqueada y el mismo probe de R1.3/R2.
- Typecheck aislado: PASS. Reproducción del ZIP y equivalencia del emit base: PASS.
- Regresiones del artefacto: **61/63 PASS**. Los dos fallos pertenecen a `universalQueryContract` y se reproducen idénticos en R2; ese módulo conserva sus bytes, no tiene consumidores de runtime en esta ruta y no es invocado por el reporte. La consulta de utilidades pasa por `getEarningsByClientReport` y su handler canónico. No se presenta un PASS universal ni se amplía este parche con un módulo sin uso.
- Integración local, separada del artefacto: build Functions NORMAL PASS y **82/82** regresiones PASS. Esa lib contiene capacidades D1/D2 ajenas al ZIP; sus resultados no se atribuyen al artefacto R1.4.

Evidencia privada del candidato: `natural-dialogue-proof.json`, `startup.log`, `typecheck.log`, `artifact-regressions.json`, `root-regressions.json`, `r2-baseline-query.json` y logs asociados. La reproducción anterior al fix está en `.firebase/modular-release/r14-investigation/baseline-reproduction.json`. Las versiones provisionales de copy y patch se conservaron privadas; el ZIP y patch anteriores son los definitivos.

## Publicación y reversión

El input `hugo-chat-overlay` está preparado en `.firebase/modular-release/r14-report-natural/release/input.json`, SHA256 `fc0f3ffd668e16a7391736a5cd8d6e71a7246e261359e18d2a74640e507b6d15`, contra la baseline R2 indicada. `assertArtifactProof` y `sourceOnlyPatch` aprobaron el alcance y la identidad. El preflight de sólo lectura del `2026-10-19T21:53:05.494Z` confirmó Function, servicio e IAM sin cambios frente a `sendagent007message-00020-faf`; evidencia en `release/preflight.json`. No ejecutó escrituras productivas. Esta comprobación puntual debe repetirse al ejecutar.

La autorización específica de R1.4 está solicitada y pendiente; la autorización de R2 no la sustituye. No requiere una nueva UI: usa el contrato PDF/XLSX ya publicado.

La reversión restaura el ZIP R2 preservado y sus etiquetas, manteniendo configuración e IAM. No elimina conversaciones, adjuntos persistidos ni auditoría. La validación funcional con datos productivos no forma parte de estas pruebas y queda pendiente de la publicación autorizada.
