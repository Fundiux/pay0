# MAT — paquete de aislamiento y sesión firmada

Estado: **DEPLOYED_NOT_VERIFIED**. Los tres artefactos se publicaron el 2026-10-19 con autorización específica, sin reversión. Revisiones activas: `getmatuserhome-00016-bel`, `getmatclienthome-00016-cew` y `verifytelegramminiappsession-00017-fur`. Fuente, runtime, configuración e IAM verificados; los tres rechazan solicitudes sin scope con HTTP 400 / INVALID_ARGUMENT antes de acceder al token. Falta comprobar el flujo autenticado real de Telegram. Los cambios backend proceden exclusivamente de `functions/src/modules/telegramMiniApp/service.ts` en `5b0db917bd70e76c160339e506f7c7d4467376b7`. No incluyen los controles UI del mismo commit ni el módulo de recovery.

Los endpoints se autentican mediante `initData` firmado de Telegram, no mediante Firebase Auth. El probe de publicación usa el contrato `SIGNED_SESSION`: `data: {}` debe fallar con `invalid-argument` por falta de `botScope`, antes de acceder al token. No se presenta ese resultado como rechazo de Firebase Auth.

## Artefactos exactos

Carpeta privada: `.firebase/modular-release/i-mat-readiness`. Cada `release-<función>/` contiene `input.json`, `functions.zip`, pruebas y receta de patch. Los ZIP productivos originales permanecen en el directorio superior; ningún `*-previous.zip` ocupa el destino que el ejecutor reserva para su rollback.

| Función / revisión base | SHA256 ZIP final | SHA256 input |
|---|---|---|
| `getMatUserHome` / `getmatuserhome-00015-zok` | `421d5a2eca25bcebeac04d6688d3356a7484d3c3797b281e600a2994a2494045` | `469b91040b1e7fb141375f106bf40d989c9bd33c3909e36d6193967405710b4f` |
| `getMatClientHome` / `getmatclienthome-00015-qol` | `120d122f0abe57acfd355546e88554c6e1f3ad5312d22d74e3478cd3826677ed` | `21e0276ea66c8ac195aad95f11a323e8d01bd36a0a489cbdf1b0f9e7e5bab346` |
| `verifyTelegramMiniAppSession` / `verifytelegramminiappsession-00016-cel` | `d11e6f5e8d172c42db9f9ce58a40ada28ccc17e40c1c83688248cd6b6fe02097` | `f28fb32c3bfbe1a23a89ca7bd879fd9b352136b515fcb34d61bb037bb19d9a7b` |

Grupos: `mat-user-home-overlay`, `mat-client-home-overlay`, `mat-session-overlay`. Cada input declara una sola función, `sourceTree: null` y `PRODUCTION_OVERLAY_V1`. SHA256 común del patch: `df18115853cd9a33b515a6070d641f5b190d3cf4d8873a67c20a12562affcf81`.

Bases de rollback: user home `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`; client home y session `cd43ae1f323e495d8a2907fe25fa3abe68ae823b9057311b65dd21f3814ff07e`. El ejecutor debe revalidar revisión, configuración y artifact antes de cada modificación; la captura no sustituye ese control de concurrencia.

## Preservación

Cada TS productivo coincide canónicamente con el padre del patch. Su transpilación reproduce el AST completo del JS original. El overlay modifica doce funciones del servicio previstas por el patch: lectura de saldos/movimientos, filtros de clientes/solicitudes/dispersiones, resolución de vínculos y construcción de homes. Mantiene callables, autenticación HMAC, proveedores, imports y dependencias originales. Sólo cambian `service.ts`, `service.js` y `service.js.map`; 1077 archivos restantes conservan bytes exactos. ZIP final: 1080 archivos.

Se excluye un archivo `.env` por paquete sin divulgar valores. Todas sus claves y valores ya están cubiertos por la configuración del servicio; ningún JS/TS contiene cargador dotenv/readFile.env/loadEnv. Los probes funcionan sin ese archivo. Se preservan las opciones de las funciones y sus secretos configurados.

Los tres manifiestos/locks son idénticos byte a byte al runtime E de configuración ya instalado: se reutilizan sus 446 dependencias mediante junction local, sin alterar el ZIP. Los proofs declaran `reusedInstall`, hash del lock y 784 archivos runtime comparados por paquete. Este lock heredado mantiene los 17 hallazgos documentados en el [paquete E](e1-complement-config-publication-package.md); estos overlays no certifican dependencias libres de vulnerabilidades.

## Evidencia y límites

`qa/scripts/e1-mat-signed-session.test.cjs`: **8/8 PASS por artefacto**, con los `auth.js`, `callables.js` y `service.js` exactos del ZIP. Usa HMAC real con clave sintética; el almacenamiento, saldo y acceso al secreto son fixtures. Verifica firma alterada, expiración, scope vacío/incorrecto, revocación explícita sin fallback, UID canónico frente a campos falsificados, aislamiento de cliente extranjero y rechazo de saldos con root diferente.

La comprobación de datos financieros entre roots se ejecuta sobre los homes del mismo módulo para cada ZIP; `verifyTelegramMiniAppSession` sólo devuelve estado del vínculo. No se afirma que ese endpoint devuelva o filtre un home financiero. Los proofs explican esta cobertura compartida.

Startup de cada artefacto: **341 endpoints cargados**, una sesión inválida rechazada según contrato, sin red ni lectura de token productivo. `artifact-verification.json` incluye `behavior-verification.json`, hashes de módulos/probe y no incluye `unauthenticatedDenied` de Firebase.

No se han usado tokens Telegram reales ni realizado envíos o movimientos financieros. La comprobación productiva sólo invocó solicitudes vacías que debían rechazarse. Evidencia privada: `live-invalid-session-verification.json`, 2026-10-19T19:05:01Z. El paquete no acredita por sí solo acciones UI, reglas globales, movimientos financieros ni integración de formularios MAT; esos alcances permanecen separados.
