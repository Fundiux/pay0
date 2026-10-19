# R2 de reportes sobre R1.3 — candidato local

Estado: **DEPLOYED_NOT_VERIFIED**. El usuario autorizó R2 y su reversión. Se publicó únicamente `sendAgent007Message`, conservando la UI y el resto de Functions. La identidad y el rechazo anónimo se verificaron; la funcionalidad autenticada sigue pendiente. La incidencia de lenguaje natural descrita abajo requiere R1.4 y no se presenta como corregida por R2.

## Alcance y procedencia

Directorio privado: `.firebase/modular-release/r2-after-r13/candidate-final/`.

- Base exacta R1.3: `a33ed9badb033a48a061a38ddb8295fd20f0aa5dedb567b37e423e7c37d68496`.
- ZIP candidato: `sendAgent007Message-r2-after-r13.zip`, SHA256 `83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe`.
- Patch: `qa/patches/r2-after-r13-report.patch`, SHA256 `174fadf544ef8a203b0517a7b1c5e56a029b4c1bfea8f062e67adf9b4bb82575`.
- Receta: `qa/scripts/build-r2-after-r13-overlay.mjs`. Parte de la fuente R1.3 verificada y su ZIP; aplica sólo el patch, comprueba el emit base y reproduce los bytes esperados sin leer las Functions integradas ni instalar dependencias.
- `sourceTree` debe ser `null`: el árbol integrado contiene capacidades ajenas al overlay. `sourceCommit` y `patchCommit`: `9204e901efc3a1c49eb0e2d71e6d6a5f2c93307b`, que contiene este patch exacto; no se atribuye el artefacto al antiguo commit R2.

El delta reutiliza las comparaciones de `0a783d038393113b955029df7c940f54da203d3a` ya integradas y conserva las correcciones R1.3. Cambia cinco fuentes: `contextBuilderV2`, `conversationState`, `reportSemantics`, `toolRouter` y `reportConnector`. Sólo cuatro generan cambios de runtime: ocho entradas JS/maps; las otras 788 entradas del ZIP son idénticas. `toolRouter` cambia tipos. No modifica dependencias, exports, configuración, reglas, fórmulas financieras ni el handler canónico de reportes.

La revisión encontró y corrigió dos pérdidas de opciones en R2: una comparación posterior cambiaba PDF a XLSX y una comparación explícita de cuatro fechas omitía el cliente. Ahora conserva cliente y formato, pregunta el formato si falta y conserva ambos periodos durante esa aclaración. Los saludos y una nueva conversación borran el contexto pendiente y el reporte anterior. Los filtros persistidos mantienen validación, root, caducidad y límite de turnos.

## Verificación

- Runtime aislado: 40/40 pruebas de reportes canónicos, autorización, comparación, diálogo R1.3, formato, límites y persistencia de tokenUsage. Incluye cinco regresiones nuevas de conservación de cliente/PDF, aclaración de formato con ambos periodos, filtros inválidos y reinicio de contexto.
- Typecheck completo de la copia aislada: PASS, sin escribir `functions/lib`.
- Startup del ZIP exacto: PASS, 342 exports cargados y `sendAgent007Message` rechazó la llamada anónima. Se usó el mismo probe R1.3 (SHA256 `a1b39759cebf95003623a1c27fc863a5f29fa92ff990f9a2e3296efb91eea6cd`), con red bloqueada e instalación existente cuyo manifest y lock coinciden; no hubo instalación ni llamadas externas.
- Reproduccion exacta del ZIP: PASS; la receta versionable reproduce el SHA256 candidato.
- Firestore Emulator propio R2: 1/1 PASS, sin proveedores; cliente/PDF, ambos periodos, aclaracion, persistencia, reinicio, revocacion y cambio de root. El transcript R1.3 tambien paso 1/1 sobre el candidato. Cada prueba usa su cliente con cierre independiente.
- Build NORMAL de Functions: PASS. La lib integrada, sin hooks ni redireccion de modulos, obtuvo 69/69 regresiones de consultas, reportes, contexto, aprendizaje/gobernanza D, tokenUsage y dialogo R1.3/R2. Este alcance incluye D y se informa separado del ZIP acotado.

Las dos fallas de `phase6-hardening` también se reprodujeron en el ZIP R1.3 base: una expectativa sobre autorización de entrenamiento revocada y una lectura estática de `learningContract.ts`, fuente ausente de ese runtime. No se ocultan ni se presentan como regresiones causadas por R2. El overlay preserva esos módulos byte por byte; no publica el mecanismo D ni reduce sus controles en la fuente integrada. La certificación D 7/7 previa corresponde a la integración local, no a este ZIP.

## Límites y reversión

Sólo se prepara `sendAgent007Message`. No se incluye `delegateHugoVoiceTurn`, el gateway ni su imagen; este paquete por sí solo no habilita R2 en voz. La comparación usa dos lecturas canónicas independientes y lo declara; no ofrece una instantánea transaccional entre periodos. La descarga PDF/XLSX conserva el reporte del periodo principal; la comparación se presenta en el texto, no como una tabla comparativa dentro del archivo.

La base publicada es `sendagent007message-00019-qon`, fuente R1.3 `0b17cfc6423ab4005c6d30087e50aa90ddd5e748` y ZIP `a33ed9badb033a48a061a38ddb8295fd20f0aa5dedb567b37e423e7c37d68496`. La reversión debe restaurar ese ZIP y conservar su configuración; no borra conversaciones ni auditoría. El executor preserva la fuente anterior antes de modificarla. Cualquier cambio concurrente invalida el preflight. No se realizaron llamadas a modelos, proveedores, acciones financieras ni escrituras productivas.

La preparación privada `r2-after-r13/readiness/` conserva el template histórico no ejecutable. Tras confirmación expresa de R1.3, `prepare-input-after-r13.mjs` verificó baseline, ZIP actual, patch versionado y prueba de artefacto antes de crear `r2-after-r13/release-after-r13/input.json`. La autorización de R1.3 no autoriza R2.

Evidencia privada: `candidate-final/manifest.json`, `regressions.log`, `typecheck.log`, `emulator-final.log` y los resultados separados de `phase6` en el directorio padre.

## Input exacto y preflight

- Input SHA256: `42f359f360b5fd6b800c535195d494c067fb530da8d6fab225d65d7b6eaaf326`.
- Baseline: `r13-chat-report/published-baseline.json`, SHA256 `f114b8732d6eb8cd6197b976ff51af7b31a5f06cf50b4765fdaf96c1c29b6e76`; `published-source.zip` coincide con la base R1.3.
- Identidad: `PRODUCTION_OVERLAY_V1`, `sourceTree:null`, `sourceCommit` y `patchCommit` `9204e901efc3a1c49eb0e2d71e6d6a5f2c93307b`, grupo `hugo-chat-overlay`, modo `NORMAL`, destino exclusivo `sendAgent007Message`.
- `assertArtifactProof`, alcance y `sourceOnlyPatch`: PASS. No incluye D, voz, nuevas Functions ni cambios de configuración.
- Preflight `2026-10-19T20:51:54.062Z`: PASS; Function, servicio e IAM coincidieron con la captura. Evidencia privada `release-after-r13/preflight.json`. Solo GET autenticados de metadatos; cero escrituras productivas.
- Esta comprobación puntual debe repetirse al ejecutar; no sustituye autorización ni valida una conversación financiera real.

## Publicación autorizada y resultado

El ejecutor terminó con código 0. Verificación independiente del 2026-10-19 a las 21:41:50 UTC: revisión `sendagent007message-00020-faf`, ZIP productivo `83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe`, rechazo HTTP 401 `UNAUTHENTICATED` sin sesión. No se ejecutó ninguna operación financiera ni fue necesaria reversión.

La captura privada `r2-after-r13/published-baseline.json`, SHA256 `48bd4d5bf8a9ad42bec5ad7d27f0a5116272b7bff28cd76bafc694422559a1ab`, y `published-source.zip` fijan la base para la siguiente entrega. `post-publication-verification.json` conserva el recibo técnico; no equivale a una prueba funcional de usuario.

El usuario comprobó R1.3 con «Dame un reporte de utilidades de pc directo del mes de septiembre» y después «en pdf». El reconocedor requiere la palabra «cliente», por lo que ese caso cae en conversación general y no activa el reporte. La misma limitación existe en R2. R1.4 se prepara como parche separado sobre esta base, sin alterar los bytes ya autorizados ni declarar cerrada la incidencia.
