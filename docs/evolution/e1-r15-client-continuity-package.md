# R1.5: cambiar de cliente dentro de un reporte

Estado: **LOCAL_VALIDATED_INPUT_PENDING**. El destino propuesto es únicamente `sendAgent007Message`; no se publicó ni se cambió gate, UI, IAM o datos productivos. No incorpora D1/D2. Falta fijar el commit de entrega, crear su input y completar preflight antes de solicitar autorización.

## Problema y alcance

Después de completar un reporte, una petición como «ahora dame uno de inservice de septiembre» podía conservar el cliente anterior. La reproducción inicial sobre R1.4 falló exactamente por ID de cliente: devolvió `alfa-directo` en vez de `inservice-demo`, con datos sintéticos. Ese log corresponde a la primera expectativa, anterior a la decisión de pedir aclaración. Después se ejecutó el **mismo QA final** sobre ambas versiones: R1.4 falló porque devolvió un adjunto donde debía aclarar el nombre; R1.5 pasó. Ambos emuladores cerraron. Logs: `tmp/r15-baseline-client-switch.log`, `tmp/r15-baseline-final-client-switch.log` y `tmp/r15-candidate-client-switch.log`.

R1.5 reconoce el cambio elíptico de cliente. «Ahora ocupo de otro cliente» abre una selección de nombre, sin consultar ni repetir el anterior. Si «de septiembre» admite dos lecturas, pide el nombre completo antes de separar cliente y mes; no inventa una coincidencia. La forma inequívoca «del mes de septiembre» permite conservar el periodo indicado. Se mantienen PDF, filtros y año explícito de contexto cuando corresponden; si no hay año fiable, se pregunta. Un cliente cuyo nombre contiene un mes no se recorta de forma automática en la rama ambigua.

El resultado sigue usando el reporte canónico y sus permisos. No pide un folio para identificar un reporte por cliente ni declara que ya entregó un archivo sin un payload real. Esto cubre las secuencias probadas; no certifica toda expresión en lenguaje natural.

## Identidad reproducible

- Base publicada: revisión `sendagent007message-00021-koz`, ZIP R1.4 `21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9`.
- Baseline: `.firebase/modular-release/r14-report-natural/published-baseline.json`, SHA256 `3e9d6b42b230c23b0b64d89b1559ccf3ac4895a1bac108744feed077e1795d27`.
- Candidato: `.firebase/modular-release/r15-client-continuity/candidate/chat-r15.zip`, SHA256 `45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474`.
- Patch completo R1.4 → R1.5: `qa/patches/r15-client-continuity.patch`, SHA256 `61756efd9abdb50abad5f2b52e751cf4e61d16238c51b4dd232ac68ed11eeb33`.
- Receta: `qa/scripts/build-r15-report-overlay.mjs`. Exige base, patch y resultado exactos; una segunda construcción produjo el mismo ZIP.

Sólo cambian `hugoCore/reportSemantics.ts` y `hugoCore/contextBuilderV2.ts`: sus cuatro entradas JS/mapas se sustituyen y las otras **792 entradas** permanecen byte a byte, total 796. Se conservan manifiestos, lockfiles, exports, autorización, fórmulas financieras y exportadores. El patch binario Git mantiene los finales de línea de la fuente y se aplica sin conversión. La identidad futura será `sourceTree:null`, base R1.4 y el commit que versiona este patch; no el árbol integrado entero.

## Verificación

- Auditoría de fuente/bytes y reproducción del ZIP: PASS.
- Typecheck aislado: PASS, código 0. No se copió `lib` integrada.
- Startup aislado con red bloqueada y gate OFF: PASS, 342 exports previos conservados y rechazo anónimo del único callable destino.
- Firestore Emulator sobre el ZIP exacto: PASS, código 0 y emulador cerrado. Usa callable/datastore reales, dos clientes, aclaración ambigua seguida del nombre, forma inequívoca automática, nuevo estado CLIENT sin query, siete reportes PDF persistidos, octubre con año contextual, root, revocación y saludo. Cero llamadas a proveedores; datos sintéticos. Log `tmp/r15-candidate-client-switch.log`; recibo `candidate/client-switch-dialogue-proof.json`. QA SHA256 `b03c67e6f3b5ffe95a86ed91bffbbb673b15371acd27765e991c5e3b7b1627f8`.
- Regresiones del ZIP exacto: **76/78 PASS**, dos fallos conocidos de `universalQueryContract`, cero omisiones. Son los mismos fallos de inmutabilidad/validación ya reproducidos en R2/R1.4; ese módulo conserva SHA256 `f666eee64715c5a650e4316d41a77fcdf621f1d07a3f77417defea9aad1e01b3` y no tiene consumidores productivos identificados. No se declara PASS universal. Log privado `candidate/artifact-regressions.log`, SHA256 `2975b1d18a6e82b98f3b1668cadeec5dcc753e3e94509bfd87f52f2f4067dc68`; el recibo registra hashes de todos los fixtures y ausencia de hooks.
- Integración local separada: build Functions NORMAL PASS y **97/97** pruebas compiladas PASS, cero fallos/omisiones: siete suites (69), QA R1.4 (13) y QA R1.5 (15). Log `tmp/r15-root-regressions-final.log`. Esa lib contiene capacidades ajenas a este ZIP; sus resultados no se atribuyen al artefacto aislado.

La expectativa de `report-continuation` para «octubre» se actualizó de pedir fechas a consultar octubre de 2026 cuando ese año ya era explícito y fiable. El fixture sólo tiene septiembre: se comprueba NOT_FOUND canónico, ausencia de adjunto, periodo persistido y cero uso de modelo. Se registra como cambio del contrato esperado, no como arreglo de una regresión financiera.

## Publicación y reversión

La futura entrega selecciona sólo el grupo `hugo-chat-overlay`. Requiere input con el commit final, proof del ZIP, baseline R1.4 y preflight GET de Function/servicio/IAM antes de autorización/ejecución. La autorización de versiones previas no autoriza este update. No necesita una nueva UI ni otro endpoint.

La reversión preserva el ZIP R1.4 desplegado y su configuración/IAM; no elimina conversaciones ni adjuntos. Si R1.5 se publica antes de D1, la composición D1 debe rehacerse sobre R1.5 para conservar este comportamiento; no ejecutar el input D1 basado en R1.4 como si incluyera la corrección nueva.
