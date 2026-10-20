# R1.4: solicitud natural de reporte y aclaración de año

Estado: **DEPLOYED_NOT_VERIFIED**. Publicado con autorización específica únicamente en `sendAgent007Message`, sobre R2; no incorpora D1/D2 ni cambios de interfaz. La identidad y conservación técnica están verificadas; falta el recorrido autenticado del usuario.

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

El usuario autorizó R1.4 y su reversión. No requiere una nueva UI: usa el contrato PDF/XLSX ya publicado.

La reversión restaura el ZIP R2 preservado y sus etiquetas, manteniendo configuración e IAM. No elimina conversaciones, adjuntos persistidos ni auditoría. La validación funcional con datos productivos no forma parte de las pruebas locales y sigue pendiente tras la publicación autorizada.

## Publicación autorizada

El ejecutor finalizó con código 0 y `CONFIGURATION_VERIFIED`. La revisión publicada es `sendagent007message-00021-koz`; la anterior `00020-faf` y su ZIP R2 permanecen preservados. No fue necesaria una reversión.

La verificación independiente del `2026-10-19T22:24:20.044Z` confirmó el ZIP `21922d59…`, la procedencia del input y el rechazo anónimo HTTP 401 / UNAUTHENTICATED. La comparación del ejecutor confirmó configuración e IAM conservados. No se consultaron importes ni se crearon operaciones financieras.

Evidencia privada: `release/deployment.jsonl`, `post-publication-verification.json`, `published-source.zip` y `published-baseline.json`. La baseline tiene SHA256 `3e9d6b42b230c23b0b64d89b1559ccf3ac4895a1bac108744feed077e1795d27` y sirve de punto de partida para una futura integración D1; no autoriza otro despliegue.

Se solicitó al usuario repetir la petición natural, elegir PDF y comprobar el saludo. Hasta recibir esa verificación, no se declara COMPLETED.

## Resultado funcional recibido y siguiente corrección

El usuario confirmó que la segunda secuencia de petición natural → año → PDF muestra la tarjeta y el control de descarga. No confirmó que descargara el archivo ni probó el saludo. Después, al pedir otro cliente con una frase abreviada, recibió nuevamente el reporte anterior; la petición de otro cliente sin nombre salió del flujo de reportes y empezó a solicitar un folio. La capacidad sigue incompleta, sin cierre funcional.

La incidencia se reprodujo contra el ZIP R1.4 exacto en un emulador aislado: tras un reporte sintético del cliente A, la petición abreviada del cliente B devolvió las filas de A. El emulador terminó y se cerró; evidencia privada `tmp/r15-baseline-client-switch.log`. La prueba nueva usa únicamente datos sintéticos y no conserva importes productivos.

R1.5 se prepara para cambiar o aclarar el cliente dentro del contexto de reportes, conservando periodo/formato sin pedir folio. No está autorizado ni publicado. La corrección no usará mayúsculas como criterio para truncar nombres que contengan meses; ante una forma ambigua pedirá aclaración antes de ejecutar.
