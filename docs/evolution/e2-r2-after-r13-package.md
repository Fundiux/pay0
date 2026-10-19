# R2 de reportes sobre R1.3 — candidato local

Estado: **LOCAL_CANDIDATE_TESTED_NOT_DEPLOY_READY**. Este paquete no se ha publicado y no contiene un input de ejecución. Requiere que R1.3 se publique y se capture después una base vigente de `sendAgent007Message`, además de autorización independiente para estos bytes.

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

El siguiente paso es capturar la Function, revisión, fuente, configuración e IAM realmente vigentes después de R1.3 y preparar un input source-only contra esa identidad. La reversión debe restaurar ese ZIP R1.3 y conservar su configuración; no borra conversaciones ni auditoría. Cualquier cambio concurrente invalida el preflight. No se realizaron llamadas a modelos, proveedores, acciones financieras ni escrituras productivas.

La preparación privada `r2-after-r13/readiness/` contiene un template con `readyForExecution:false` y baseline nula; no es un input ejecutable. La receta `prepare-input-after-r13.mjs` exige confirmación explícita del backend R1.3, baseline/hash y ZIP actual capturados, y comprueba sus identidades antes de generar un input nuevo. No se adelantó la captura productiva ni se autorizó R2 mediante la autorización de R1.3.

Evidencia privada: `candidate-final/manifest.json`, `regressions.log`, `typecheck.log`, `emulator-final.log` y los resultados separados de `phase6` en el directorio padre.
