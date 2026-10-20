# D1 sobre R1.5: aprendizaje sin perder el cambio de cliente

Estado: **LOCAL_INPUT_VALIDATED_PREFLIGHT_PENDING**. R1.5 está publicada y el input local D1 pasó validación pura; no se ejecutó este update. El preflight queda pendiente mientras termina la entrega D independiente en curso. La autorización de consulta/revocación D no incluye chat D1 ni activación de aprendizaje.

## Fuente y composición

- Base R1.5: `.firebase/modular-release/r15-client-continuity/candidate/chat-r15.zip`, SHA256 `45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474`; fuente/patch versionados en `397035caa23ddd56fff0dedcf62158b7df129d4a`.
- Candidato D1: `.firebase/modular-release/d1-after-r15-candidate/d1-after-r15.zip`, SHA256 `763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62`.
- Patch completo reutilizado: `qa/patches/d1-after-r14-revoke-off.patch`, SHA256 `ecbcdb61ff78e31f1ff70c0130b36bc32722703faf2f7376d68de9883618dca3`. Aunque su nombre registra el origen R1.4, es el delta íntegro de once fuentes también sobre R1.5: sus once bases son idénticas. Se comprobó aplicación y reproducción, no se asumió compatibilidad por el nombre.
- Receta: `qa/scripts/build-d1-after-r15-overlay.mjs`, SHA256 `c4e8fa6108d0de72148da5a4e6f89b18746ca12a37bc6dee317e5052c4dc391d`. Una construcción independiente produjo exactamente el mismo ZIP.

La auditoría compara las once fuentes D1 con el paquete corregido anterior: son byteidénticas. Se conserva el guard de revocación OFF de `b0545c2`; no se copió RuleStore de D2 y `readReview` permanece ausente. Las dos fuentes R1.5 y sus cuatro JS/mapas se conservan exactamente. Frente a R1.5 hay 783 entradas iguales, 13 cambiadas, seis nuevas y ninguna borrada; todos los bytes ajenos a D1 y las fórmulas financieras permanecen intactos. Frente a D1 sobre R1.4 sólo difieren los cuatro JS/mapas R1.5.

La identidad futura debe usar base R1.5 `45e8233d`, patch completo `ecbcdb61`, `sourceTree:null` y el commit que contiene esta receta. No usar la base R1.4 ni atribuir el delta a un parche incremental de una línea.

## Pruebas del artefacto

- Typecheck aislado PASS, código 0; startup con red bloqueada y gate OFF PASS: 343 exports, 342 anteriores y dos rechazos anónimos.
- Firestore Emulator: 20/20 PASS, con suite de reglas `b0545c2` (7/7), flujos existentes con gate OFF, hardening y reportes R1.3/R2. Revocar sigue disponible bajo autorización con gate OFF; aprobar y aplicar reglas siguen pausados.
- Regresiones seleccionadas: 66/66 PASS. La QA usa la expectativa `report-continuation` de R1.5 desde `397035c` sólo al activar `PAY0_D1_R15_TESTS=true`; la procedencia queda registrada. El flag selecciona fixtures, no configura el producto.
- Lenguaje R1.4/R1.5 sobre el JS del ZIP: 28/28 PASS. No se carga la `lib` integrada.
- Escenario multicliente R1.5 con callable/datastore reales: PASS, código 0, emulador cerrado. Conserva cambio de cliente, aclaración ambigua, nuevo CLIENT sin query, año contextual, octubre, PDF persistido, aislamiento de root/periodo, saludo y revocación; cero proveedores y datos sintéticos.

Recibo privado `d1-after-r15-candidate/behavior-verification.json`, SHA256 `56b91a881ea9969c27026940b54b0bc0c05f372243d75cc5d9da503f8c2228cd`. Los logs del candidato contienen typecheck, startup, regresiones y lenguaje; `tmp/d1-after-r15-emulator.log` y `tmp/d1-after-r15-client-switch-emulator.log` registran las pruebas con Firestore y su cierre. Los bytes del runtime se verificaron contra el ZIP antes/después.

La selección no declara PASS universal: el módulo `universalQueryContract` conserva la limitación de dos tests conocida en R1.4/R1.5, sin consumidores productivos identificados. No se incorpora su fix ajeno a D1.

## Publicación y reversión

R1.5 se verificó publicada como `sendagent007message-00022-nev`, con ZIP base `45e8233d`. Baseline local: `.firebase/modular-release/r15-client-continuity/published-baseline.json`, SHA256 `c2a4b6cddcb70e65d67f98be8e15d89956822ad00d6261a91b19e71c0cbd3fe8`.

Input local nuevo: `.firebase/modular-release/d1-after-r15-chat-release/input.json`, SHA256 `db4867123a6f5a915b437a6e9170bb6c206531da8478e5ad3eafae3ccc4b953e`. Proof: `artifact-verification.json`, SHA256 `694dd1001c6766dab2c59e8f2c3b04b5a1e0dee0604081e4806a3a337844d445`. sourceCommit/patchCommit: `903e0318f5709ebae722147e515986b79d361a93`, con base R1.5, patch completo y sourceTree null. Hashes, rechazo anónimo del target y construcción pura sourceOnlyPatch: PASS; gate de la baseline ausente/OFF.

No se consultó ni modificó producción para preparar ese input. Tras terminar la entrega D en curso se necesita preflight GET de este target, servicio e IAM y autorización separada antes de ejecutar. No se exige que todas las operaciones globales sean cero para consultar metadatos, ni se interpreta otra entrega como permiso para publicar chat.

Un futuro update selecciona sólo `sendAgent007Message`, conserva su gate OFF y toda la configuración/IAM/secretos/tráfico. El export `reviewAgent007LearningRule` en el ZIP no autoriza crear ese recurso; creación de review, diagnostics, UI y sus gates son superficies separadas. La baseline R1.5 se usa sólo para el consumidor de chat y no impone una dependencia artificial a los paquetes independientes de revisión/diagnóstico.

Los inputs D1 basados en R1.4 no representan esta composición y no deben utilizarse después de publicar R1.5. La reversión debe preservar R1.5 y cambios posteriores autorizados; no borrar reglas, experiencias, conversaciones ni ledger. No hubo activaciones ni escrituras financieras.
