# Comprobantes DROP→AUTO — paquete UI exacto

Estado: **DEPLOYED_NOT_VERIFIED**. Publicación autorizada y ejecutada por el coordinador: sesión97761 EXIT0, RELEASE_VERIFIED, Hosting `b933a73db87bb193` y SSR `ssrpay0system-00618-rim`. Verificación técnica independiente estricta PASS; comprobación funcional solicitada al usuario y pendiente. Se preservó la capacidad de voz de SSR616. El backend canónico tiene entrega y autorización separadas.

## Publicación y verificación posterior

Se publicó exactamente el input b7a, ZIP a896 y fuente b690 identificados abajo. La rama local de entrega `release/receipt-drop-auto-20261020` apunta a `b69021834f3a90415202cd0c3ba8dd36f93ed11c` y permanece preservada.

El verificador estricto original mantuvo SHA256 `2c479ef6106e62b9efeaae1790af2b2c1ab13b8bb5c538db82b76f0ae560b0bf`, coincidente con el registro previo. Terminó EXIT0/PASS: proof `ce3e0bfa154ffb9d781ad39a23da6d4c752b521b29c11ebb535c1945c83483b7`, baseline `9a3df7018000e16880610041c430ccbbde2e2489490d1dd0ece6e0e48edca72c`, en `independent-post-publication-7e053cc9-3d54-4889-a316-04c80dd0f79c` dentro del paquete. Fuente ZIP a896 exacta, configuración/Run/IAM preservados, cinco rutas HTTP200, cero operaciones activas. Los 170 archivos esperados coinciden por nombre y hash gzip; las únicas dos entradas adicionales son `/__/firebase/init.js` y `/__/firebase/init.json`. Hosting FINALIZED y Function ACTIVE. No se consultaron ni modificaron datos de negocio; la sesión productiva autenticada sigue pendiente de comprobación funcional.

Los intentos previos quedaron honestamente BLOCKED_COUNTERS_PENDING y después BLOCKED_COUNTERS_DIFFERENT. Se preservaron recibo original, GETs y pruebas. Tras verificar independientemente los archivos y la igualdad de todos los demás campos, el coordinador autorizó y aplicó exclusivamente dos contadores al snapshot LOCAL: `snapshot.hosting.releases[0].version.fileCount` = `172` y `snapshot.hosting.releases[0].version.versionBytes` = `4101164`. Recibo original SHA256 `357f5f109ad2802c634b9e761efcd40022230b0104c9d86e960c3962e645eff6`; resultado SHA256 `12f487ae1fa9e8075479ef9a46ba1414e64b0ff5f8bddf05efe015cec2cd485c`. Proof del coordinador `ea941aa8af6438d17c45bb2987971dc67534c1e4bf94846187fcb8a61923dcc3`; comprobación independiente de archivos del coordinador `af1bdc99` y páginas SHA256 `281c900cdfb7ffc216d9106ee350d784eb7c1315f85f7cd92aaa9f105a41ebd2`. No hubo mutación productiva de contadores, cambios de input/ZIP/helpers ni redeploy para reconciliarlos. El rerun estricto final compara ya contadores idénticos, sin excepción ni reconciliación automática.

La entrega registra al soltar un PDF sólo cuando el servidor devuelve READY canónico: sin motivos pendientes, identificación de 64 hex ligada al payload, cliente/empresa/tipo no vacíos y tipo consistente. Incluye la coincidencia única por nombre autorizado que resuelve el nuevo backend. No elige el primer candidato ni deduce identidades o datos financieros en el navegador. Ambigüedad y REQUIRES_REVIEW conservan revisión manual.

## Identidad y base preservada

Directorio privado del paquete: `.firebase/modular-release/hosting-b69021834f3a-a956ec86-6800-402f-a65e-e2b5e84d3b34`.

| Elemento | Identidad exacta |
|---|---|
| Fuente candidata | `b69021834f3a90415202cd0c3ba8dd36f93ed11c` |
| Árbol | `a25c09216d0a5746fe703e9cc81b7733c6627218` |
| Recibo de build SHA256 | `1baebffca74b6581cf5b368dd48e92144bb011cee95c6db2b229393898940a28` |
| `input.json` SHA256 | `b7a8880e0e10d21e47c02dd3d7189f19f7ca0f92ce10f6bb4d6e1ebe1b0b526b` |
| ZIP candidato SHA256 | `a896abb9d175d2c8c711c276d6c6b396d40ba4bd0a5d5830a42b3b66fbb1d767` |
| Proof runtime vinculado SHA256 | `8f1997edfd52638d1f6f2675502f1ce4fc3d4f5247699ac6e13cef6e32a03963` |
| Proof canónico previo a anotaciones SHA256 | `e867d70d366cc27098674f6ac792524a5aad1caa57172457833d37dbaa15f6ab` |
| Fuente productiva padre | `af1a884270d427244b5a78feed123b5e9be89aaf` |
| ZIP productivo padre SHA256 | `9d4321facd660bc9ec0d319883982698aa5ace21a59127508c7411be1ba6549b` |
| Hosting / SSR de base | `89de9f0862d03d49` / `ssrpay0system-00616-ret` |
| Baseline fijada al input SHA256 | `a5a9029c4941d6c703a549a436ce88846882c8838b37bbfed9615b9da1ac509c` |

El proof vinculado está en `runtime-627d495b-f775-43b4-b0e2-df7431262e2c/proof-with-qa-override.json`, dentro del directorio del paquete. El input contiene 170 archivos Hosting con hashes fijados. Fuente privada: `receipt-auto-on-voice-ui-source`, rama `fix/receipt-auto-preserve-voice-20261020`, limpia antes del build.

Exactamente cinco archivos cambian sobre el padre: `src/app/pagos/page.tsx`, `src/services/pagoReceipt.ts`, `src/lib/receiptAutomaticRegistration.ts`, `src/lib/receiptOperationPreference.ts` y `src/lib/uploadPagoDoc.ts`. Patch SHA256 `13c6bd57b8cb5cdf237b52c60b9faf63b82760c9fe0030537aba6cd40006b6f7`. Functions, dependencias y el resto de la fuente permanecen intactos, incluidos los dos archivos productivos de arranque de voz.

## Comportamiento y límites

El tipo `resolvedOperationTypeKey` del servidor rellena una entrada vacía, con fallback al tipo del createPayload. Una contradicción entre campos o frente a una elección explícita impide crear. La resolución canónica no depende de que el catálogo del navegador ya haya terminado de cargar.

En `/pagos`, el control **«Tipo predeterminado para comprobantes (recordar en este navegador)»** permite elegir una vez cuando existen varios tipos. Guarda sólo una clave, con namespace root/uid, valida catálogo activo OPERACION del ámbito y nunca hereda silenciosamente el último tipo del formulario. Una preferencia persistida se conserva mientras carga el catálogo y se elimina si resulta inválida después de cargar. Configurarla no crea pagos.

Cambiar cliente/empresa sólo vuelve a analizar; no crea por seleccionar. El botón explícito revalida los IDs elegidos o sugeridos visibles. Se conserva el par de IDs en correcciones y reintentos; la creación usa exclusivamente el payload del servidor. REGISTERED sólo adjunta con receiptPending exactamente true y pagoId servidor válido; nunca crea otro pago. Un duplicado completo produce cero uploads y cero creaciones. El copy de señales insuficientes es neutral: el texto antiguo sobre RFC/cuenta provenía del mapping UI y no demostraba una versión backend antigua.

La cola captura root/uid/epoch y comprueba también Firebase auth.currentUser.uid antes de llamadas y después de awaits. Un cambio de sesión invalida el lote y sus actualizaciones UI. Los callbacks assertContext son internos y no se serializan. Parse protege la lectura del archivo; upload protege SHA, init, Storage, progreso/cancelación y finalize. Una creación ya enviada puede completar bajo la autorización original; el cambio posterior impide uploads y publicación de resultados en otra sesión. La recuperación canónica del pago pendiente se conserva. Otros callers sin callback mantienen su comportamiento. Las autorizaciones, transacciones e idempotencia siguen siendo responsabilidad del servidor.

## Verificación exacta

- Build canónico literal del compuesto: **PASS, 47 rutas**, sesión49435. Log `output/receipt-drop-auto-ui/canonical-build-on-voice.log`; no se omitió npm ci ni se cambiaron helpers/pins.
- QA contra el compuesto: **20/20 PASS**, cero skip/fail: 10 identidad/Chromium, 4 operación/preferencia y 6 actor. Log `output/receipt-drop-auto-ui/preserve-voice-candidate20.log`. Cubre nombre READY automático, payload incompleto rechazado, selección parse-only, recuperación sin create, tipo canónico antes de catálogo, mismatch, reload de preferencias y carreras durante lectura/init/Storage/create.
- TSC del compuesto: **PASS**, sesión77956; junction temporal de QA retirada. El TSC raíz detectó una variable fuera de alcance exclusiva de su render acumulativo: se corrigió una línea en `c841dc2` y pasó TSC50849. El candidato privado ya era correcto.
- Runtime del ZIP exacto: **PASS**, sesión69084, 486 archivos verificados, realpaths y closure, cinco rutas HTTP 200, login a 390/1440 píxeles, redirección anónima de pagos a login y cinco componentes. Emulador y servidor finalizados. `assertRuntimeProof` PASS contra el input exacto.
- Revisión independiente del coordinador: `check(input)` y `assertRuntimeProof` con proof8f19 **PASS**, sin cambios en artefactos o pins.
- Verificador de política de autorización: **PASS**, frontend/Functions/Firestore sincronizados. No se cambiaron roles, rutas o reglas.

El runtime usa dos adaptaciones QA declaradas, no una ejecución literal de los tests originales: fixture autenticado sintético de ingeniería con RecoveryReview real y negativos de sesión/rol/estado; test de evidencia documental que abre detalles intencionalmente colapsados y comprueba edición, clasificación, historial y estado. Ambos targets están acotados por path y hashes originales/adaptados. El producto no se modificó para estas pruebas. El emulador permite todas las reglas: esta ejecución no certifica reglas Firestore ni una sesión productiva autenticada. Cero escrituras productivas y cero acciones financieras reales durante la preparación.

El primer intento de runtime abortó antes del emulador por un path de preload heredado. Sólo se corrigió el binding al nuevo checkout, manteniendo las mismas dos adaptaciones semánticas. Preload SHA256 anterior `26f1b0583f369cedaf3780022beb347869acd33a6ba8a407a3e78c1fc81261eb`; nuevo `6b589f3f440c3eae92f9be4c7462166ac874cb5de6d1eba9c2fc59b79f4244d5`. Audit SHA256 `31bb9b22759daaa1620bd5c837251e7a8a7d88025f11073db2d9c7925f1c074c`, vinculado al proof final. Se conservaron el fallo y los bytes anteriores; se reutilizaron las dependencias verificadas sin reinstalar ni reconstruir el ZIP.

## Preflight y reversión

La captura final anterior al despliegue backend del coordinador pasó con cero operaciones y SSR616/Hosting89de/configuración/Run/IAM idénticos: `.firebase/modular-release/ui-receipt-auto-on-voice-final-preflight.json`, SHA256 `b0499fd93933af329af68e4d40f48f979750b78530417ff01f551aa3fd7f8c53`. Se conserva como captura previa, sin presentarla como posterior.

Tras finalizar el backend se obtuvo un nuevo preflight sólo lectura: `.firebase/modular-release/ui-receipt-auto-on-voice-post-backend-preflight.json`, SHA256 `e68b5afe4b30d27bde5340e32c8c461ca91f9e346f6b8f8f0dfd3dd2b4a98039`; proof `output/receipt-drop-auto-ui/post-backend-preflight-on-voice.json`. validateBaseline y assertFreshBaseline PASS: SSR616/Hosting89de, resource/Run/IAM sin deriva, cero operaciones y cero escrituras. Estado entonces DEPLOYMENT_PENDING; luego se autorizó y publicó exactamente el mismo input, ZIP y proof.

La autorización UI recibida cubrió exclusivamente este input/ZIP/proof y su rollback exacto. El rollback vuelve al código `af1a884`/ZIP9d4 y al Hosting89de de la baseline SSR616, preservando configuración e IAM; las nuevas revisiones las asigna cloud. Sólo procede contra el estado propio exacto. Resultado incierto exige reconciliar el journal/operación, sin replay ni borrar locks. No borra datos, sesiones o pagos, ni modifica reglas o activa gateway/OCI. La reversión backend se controla separadamente.

## Procedencia histórica preservada

`c3ece52` pasó build47 sobre SSR614 pero quedó **BASE_LOCAL_SUPERSEDED** antes de preparar un input al detectarse la nueva SSR616. La fuente real `af1a884`, árbol `08d669577516114b05076f2e3dd845fe0900f9c7`, se encontró mediante el path de build embebido y se leyó sin editar ni ejecutar el repositorio externo. Sus 482 archivos .next/public coincidieron con el ZIP9d4: proof SHA256 `c50310038e21c8ec2243761c68cee0817b6a570f1fdf2d6b9f27ea7497bd880e`.

Su delta frente a f1df eran sólo HugoRealtimeVoice y hugoVoiceStartup, con arranque acotado/cancelable. AUTO se aplicó como cinco hunks disjuntos con contexto comprobado, sin merge/rebase. Los blobs Git y los bytes de checkout de ambos archivos de voz se preservaron: proof SHA256 `7cd32ad2572d2f4947700661f143f635a2c5596c85ce08ade088ac50b52feaf9`. La comparación inicial errónea entre blob LF y checkout CRLF no era una pérdida de capacidad y no requirió cambiar esos archivos. Los recibos y logs anteriores se mantienen; el dossier de selección publicado f1df/31 no se altera.
