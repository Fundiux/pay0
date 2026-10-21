# MAT — revalidación de sesión al volver al panel

Estado: **DEPLOYMENT_PENDING**, paquete local exacto y runtime verificados; sin autorización de publicación ni activación. No modifica comprobantes ni la entrega AUTO pausada. La composición aislada parte de la UI productiva b690/SSR618 y la conserva íntegra salvo este hook.

## Paquete exacto y reversión

Directorio `.firebase/modular-release/hosting-63c70651bf1c-abb14735-66fa-4bdc-b8fd-c95831eef03b`:

| Archivo | SHA256 |
|---|---|
| `input.json` | `c6e1a862e075d1ccffaad30f67c8e3ed5565d4c7091651b374fe9c91985e373b` |
| `ssr.zip` | `f71e37d5128611c68e260de448c02952b095f79859a2ea710da64a576295c539` |
| `runtime-9902c86b-238b-4112-a49f-b46dc09a667f/proof-with-qa-override.json` | `dd1e23a2250de076bbd9396b46f2a90ea61b199c499dbdc6d7dfbcd5908d7009` |
| Baseline fijada al input | `04eb71f3cb7f51670ea3b2fbb2bbb94104d602fcc873f506fc181f373e305d8c` |
| Preflight final sólo lectura | `cd42f1547b37a6895ca3bfe00a6ee77204e142574e9797ae995a100c7bf2e45f` |

Build47 y runtime exacto EXIT0/PASS, sesiones29582 y69119; `assertRuntimeProof` PASS. Runtime nuevo extraído de este ZIP, 486 archivos verificados, dependencias copiadas físicamente sólo después de package/lock idénticos, realpaths y closure PASS. Cinco rutas estándar HTTP200, login 390/1440 y redirección anónima pagos→login, cinco componentes estándar PASS. Servidor y emulador cerrados. Las dos adaptaciones QA heredadas de b690 están explícitas: ingeniería `593b8fd70a744c0cc126cd3645b1ce57046f75fb99fa06358721fead5826faa7` y evidencia `2fcc15877b7314ad801ec07737d1327789b81629527c91518eb2c865d28b874e`; sólo binding al candidato nuevo, preload `93e85472a54448b7a596b893b81300c6391b6221a4814aa49d3224eb547e5a94`. No se presentan como ejecución literal de los tests originales ni como pruebas del caso real de comprobantes pausado. Emulador allow-all: no certifica reglas ni autorización productiva.

El coordinador reprodujo independientemente `check(input)` y `assertRuntimeProof` contra c6e/f71/dd1: **PASS**, sin alterar pins, helpers ni artefactos.

También se abrieron `/mat/usuarios` y `/mat/clientes` en Chromium contra este runtime SSR exacto: HTTP200, render sin errores y sin initData Telegram ni cuenta Firebase. Se bloquearon redes externas; no se leyó información financiera. Proof `output/mat-session-refresh/mat-routes-proof.json`, SHA256 `1869693e5a3631d43f0a7ec4ffcf36cded478e74c18ba45a6ca3cbbbca3894c9`. Esa comprobación de arranque no sustituye una sesión Telegram firmada real, todavía pendiente.

Preflight final `ui-mat-session-refresh-final-preflight.json`: SSR618/Hostingb933/configuración/Run/IAM preservados, cero operaciones activas. No hubo escrituras productivas ni invocación de acciones financieras. La publicación requiere aprobación específica del input/ZIP/proof; no se ha ejecutado. Reversión exacta sólo contra el estado propio del ejecutor: Hosting `b933a73db87bb193` y fuente b690/ZIP `a896abb9d175d2c8c711c276d6c6b396d40ba4bd0a5d5830a42b3b66fbb1d767`, configuración/IAM preservados. Nunca retirar ni modificar AUTO para revertir MAT. Incertidumbre exige reconciliar operación/journal, sin replay ni borrar locks.

El hook existente consulta el home una sola vez al montar. Un panel abierto conserva la vista anterior al volver de segundo plano, incluso si el vínculo se revocó después. El control negativo con ese hook reprodujo la conservación de `old-home` tras ocultar la página; no se interpretó como un fallo de autorización del backend, que valida cada solicitud firmada.

El candidato cambia exclusivamente `src/components/mat/useMatHome.ts`, en copia privada `output/mat-session-refresh/source`. Limpia la vista al ocultar y antes de revalidar, y vuelve a invocar el wrapper existente al recibir focus/pageshow/visibilitychange visible. Agrupa eventos durante 100 ms y mantiene una única solicitud vigente por contexto; eventos durante una solicitud en vuelo dejan una sola revalidación pendiente. Las respuestas de una generación anterior o de un componente desmontado no actualizan la vista. No registra errores raw, transcripciones ni initData.

El UID Firebase real es sólo una frontera auxiliar para descartar una vista pendiente cuando cambia la sesión web; no se usa para fabricar identidad Telegram. USERS/CLIENTS siguen fijados por el wrapper correspondiente. No existe selección local de root en este hook: la raíz y el vínculo se resuelven y autorizan nuevamente en el servidor. No se añaden lecturas directas Firestore, roles, endpoints, políticas, puente custom-token, temporizadores de polling ni datos financieros. Una pestaña que permanece visible y quieta no recibe revocaciones por push: se revalida al volver; no se promete revocación instantánea local.

## Identidad y reproducción

- Fuente base SHA256 `d4c61d696b859efeedb1a8038715f12879a18fe522f3922c41efa831de2bc8dd`.
- Candidato SHA256 `5196c2a42a80b04b4a386f2a15b03ae6cbe663892bb6886f48ba1ed7ffc4be2a`.
- Patch `qa/patches/e1-mat-session-refresh.patch`, SHA256 `cfbdbc24ade20c93051ca35f003e5bbca390c30124ffd7356d0307f5baf62e32`; `git apply --check` PASS sobre raíz, sin aplicarlo allí.
- QA `qa/scripts/mat-session-refresh.test.cjs`: **seis escenarios PASS** con hooks React y eventos Chromium reales. Ambos scopes cubren ocultación, vínculo revocado al volver, agrupación de tres eventos, cambio de actor con respuesta antigua tardía, initData ausente, error seguro y desmontaje. Wrappers y respuestas son sintéticos; no se ejecutan operaciones de negocio ni validaciones HMAC reales en esta prueba.

Comando del candidato: `node qa/scripts/mat-session-refresh.test.cjs`. Puede fijarse otra copia mediante `PAY0_MAT_REFRESH_SOURCE`. La prueba exige esa fuente candidata; no representa que el hook raíz ya esté integrado. Evidencia privada `output/mat-session-refresh/verification.json`; control negativo preservado en `baseline-negative.log`. No hubo consultas de negocio productivas ni instalaciones raíz. El TSC de la composición está **PASS**, reutilizando temporalmente dependencias privadas tras comprobar igualdad exacta de manifest/lock; la junction se retiró antes del build. Build canónico **PASS, 47 rutas**, sesión29582; runtime exacto **PASS**, sesión69119. Verificador de política de autorización PASS; no se modificaron roles o reglas.

## Composición y procedencia del build

Fuente privada `.firebase/modular-release/mat-session-refresh-delivery-source`, rama `fix/mat-session-refresh-20261020`, commit `63c70651bf1c2fbdeb0ce891599d7be1013cc70e`, árbol `e7e971dbf5ce9370c5fc69286e06e71a0c15e3ee`, hijo directo de b690. Diff de un solo archivo y árbol tracked limpio: todos los demás blobs permanecen intactos, incluidos los cinco de comprobantes pausados y los dos de voz. QA seis escenarios PASS también contra esta composición; no se ejecutaron pruebas de comprobantes.

El primer intento de build abortó antes de instalar dependencias o iniciar Next: `MAIN_NOT_INCLUDED=5`. El clon había heredado origin/main `86157b6`, posterior a la línea productiva; no se ocultó el fallo ni se arrastraron sus cambios. Con autorización del coordinador, se fijó únicamente la ref main del clon al snapshot `f1df4a2835e37db725897bd97a26475437d88637` que usó el build productivo b690. Se conservaron origin/main, HEAD, árbol y main raíz, sin merge/rebase ni cambios al guard. Esto acredita la misma línea de entrega productiva, **no integración con main861**.

Los cinco commits permanecen en origin/main para reconciliación separada: `86157b6` (Fix authenticated reports QA stubs), `5943d81` (Instrument authenticated emulator QA scenarios), `b178011` (Remove client number repair control), `853115c` (Add authenticated emulator UI QA harness) y `8952ba4` (Integrate interface regularization batch one into main). Evidencia before/after `output/mat-session-refresh/main-snapshot-reconciliation.json`. El build canónico literal posterior terminó EXIT0, sesión29582; log `canonical-build-reconciled.log`. Recibo `.firebase/modular-release/hosting-63c70651bf1c-abb14735-66fa-4bdc-b8fd-c95831eef03b/build.json`, SHA256 `1b4301debcceda2dc3cafb2a2337f55eb336d9083ded5a04a9aec5b2279e4b33`. No se omitió npm ci ni se modificaron helpers.

Baseline fresca sólo de metadatos: `.firebase/modular-release/ui-mat-session-refresh-baseline.json`, SHA256 `04eb71f3cb7f51670ea3b2fbb2bbb94104d602fcc873f506fc181f373e305d8c`, PASS contra la publicación b690: SSR618/Hostingb933/configuración/Run/IAM idénticos y cero operaciones activas. La preparación local requirió lectura elevada de la configuración del CLI; el primer intento sandbox denegado por EPERM se conserva como limitación de ejecución, no como fallo del producto ni mutación.

Antes de publicación: autorización separada del input/ZIP/proof y rollback indicados, y preflight fresco del ejecutor. La composición, TSC/build/runtime e input ya están preparados; no se ha tocado la UI productiva ni se ha activado ningún servicio.

## J: bloqueo conservado

El consumidor QR continúa en cuarentena: falta el vínculo servidor autorizado sesión→conector→usuario/raíz y el mapeo de chats históricos. Los tres fallos de aislamiento y las capacidades recuperadas siguen documentados en `e1-j-connector-recovery.md`. Este candidato MAT no inventa esa autoridad ni inicia worker, QR, envíos o limpieza de sesiones.
