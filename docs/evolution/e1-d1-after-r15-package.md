# D1 sobre R1.5: aprendizaje sin perder el cambio de cliente

Estado: **DEPLOYED_NOT_VERIFIED** funcionalmente. El usuario autorizó expresamente D1 y su reversión; se publicó sólo `sendAgent007Message`, revisión `sendagent007message-00023-gaz`. Fuente exacta, configuración, servicio e IAM verificados; rechazo anónimo HTTP401. La aprobación y aplicación de reglas permanecen OFF. Esta publicación no completa el aprendizaje interactivo solicitado.

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

El preflight de sólo lectura pasó el 2026-10-20 a las 05:01:24 UTC: Function, servicio e IAM siguen coincidiendo con la baseline `00022-nev`, sin escrituras. Recibo privado `.firebase/modular-release/d1-after-r15-chat-release/preflight.json`. No se exigió que todas las operaciones globales fueran cero para consultar metadatos. Debe repetirse la comparación al ejecutar y bloquear cualquier drift; esta lectura no constituye autorización ni permanece fresca indefinidamente.

La actualización autorizada seleccionó sólo `sendAgent007Message`, conservó su gate OFF y toda la configuración/IAM/secretos/tráfico. El export `reviewAgent007LearningRule` en el ZIP no autoriza crear ese recurso; creación de review, diagnostics, UI y sus gates son superficies separadas. La baseline R1.5 se usó sólo para el consumidor de chat y no impuso una dependencia artificial a los paquetes independientes de revisión/diagnóstico.

Esta entrega prepara el consumidor de experiencias legítimas y conserva los flujos de registro del dominio probados localmente; no despliega por este scope los otros endpoints de creación de experiencias ni promete registro automático nuevo desde chat. Con gate OFF no se aplican reglas supervisadas. Se preservan cambio de cliente, PDF y saludo de R1.5.

Los inputs D1 basados en R1.4 no representan esta composición y no deben utilizarse después de publicar R1.5. La reversión debe preservar R1.5 y cambios posteriores autorizados; no borrar reglas, experiencias, conversaciones ni ledger. No hubo activaciones ni escrituras financieras.

## Resultado de publicación autorizada

Comprobación independiente el 2026-10-20 a las 05:14:24 UTC (19 de octubre en Ciudad de México): fuente descargada por generación exacta SHA256 `763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62`, revisión `00023-gaz`, Function ACTIVE y acceso anónimo UNAUTHENTICATED. El ejecutor confirmó preservación de configuración; el gate sigue ausente/OFF. Baseline privada `d1-after-r15-chat-release/published-baseline.json`, SHA256 `7aa7eb136c9b7177f1991340624e6eb83815530915d4461293c35ed8d38fe880`; fuente y recibo preservados junto a ella. No se ejercitaron conversaciones autenticadas ni datos financieros.

El usuario confirmó que el panel D carga, pero señaló que sus botones y alcance no permiten el ciclo de aprendizaje esperado. Se conserva esta limitación: faltan corrección interactiva de comprobantes, respuesta por texto y corrección durante voz con confirmación y reutilización acotada. D1 prepara el consumidor; no declara esas capacidades terminadas ni activa reglas.
