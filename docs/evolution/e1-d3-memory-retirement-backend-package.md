# D3: ACK canónico del retiro personal

Estado: **DEPLOYED_NOT_VERIFIED funcionalmente**. El usuario autorizó este backend, su interfaz y reversión exacta. El backend se publicó y pasó la verificación técnica independiente; su único destino es `reviewAgent007MemoryCandidate`. La interfaz se entrega por separado. No interviene en chat, voz, comprobantes, productores, reglas ni permisos.

Una corrección retirada devuelve `retirement:{memoryId,status:"REJECTED",scope:"USER_TOPIC"|"CONVERSATION_ONLY"}`. Si se pierde ese ACK, el reintento autorizado devuelve el mismo estado con `changed:false`, sin otra escritura. `SUPERSEDED` y otros estados conservan `changed:false` sin afirmar retiro. Autorización y referencias se revalidan dentro de la misma transacción antes de devolver el ACK, también en el reintento.

## Artefacto y procedencia

| Identidad | SHA / commit |
| --- | --- |
| Fuente del cambio de método | `65ca03305e6862aa1f420a26bf95c3e1eb16155a` |
| Receta, patch y QA versionados | `66f5cde1acd0f3a9b6feb41a1bf491119580a876` |
| Base publicada, review `00003-jur` | `f0787837136d9a279321810f8195a8c5d31ccc9eea0d99190fea6a41c4a3fcb6` |
| Baseline propia | `8aec52245a0c620ce22bad2e03ff5ead76117202105fbc4d22e401cc99981e53` |
| ZIP nuevo | `1eb8e6e0232b0d74aa904795ce4a7be9f770e3fbacf73a30d4c2f62bfc0d489f` |
| Patch binario de un TS | `ba92fa9478fb49e6a889370814867c716ac7d9a66e0c3dd87eb8df453a87b9e7` |
| Receta | `ad78e783b9e7124751721bdd95b65b24b3651be5a7e4a696bc3251b7129b864a` |
| Input exacto | `afdf8b68870039f17ddb2b189c3b4c6a612b90b966bb4ddbb97c2acec299479f` |

Directorio candidato: `.firebase/modular-release/d3-memory-retirement-candidate-v2/`. Input y copia idéntica del ZIP: `.firebase/modular-release/d3-memory-retirement-release/input.json`. Grupo `conversation-memory-retirement-overlay`, buildMode `NORMAL`, sourceTree `null`; sourceCommit y sourceIdentity.patchCommit identifican el cambio `65ca033`, no un build completo de ese árbol. La receta `qa/scripts/build-memory-retirement-overlay.mjs` reconstruye el compuesto a partir del ZIP publicado y el método exacto de ese commit. El patch versionado es `qa/patches/memory-retirement-overlay.patch`.

La fuente TS adaptada incluida en f078 reproduce exactamente su JS con su propio tsconfig ES2017. Su método anterior coincide por AST con el padre de 65ca033. Sólo se trasplanta `reviewMemoryCandidate`; todos los demás métodos, imports y declaraciones se comparan y conservan. **1085 entradas: 1082 archivos idénticos, tres cambios TS/JS/map, cero altas o bajas.** El entry shim, bundle heredado, listado y demás handlers conservan bytes. No se copia el Store raíz completo ni se arrastran capacidades de otros frentes.

El mapa heredado tenía una ruta relativa de fuente incorrecta, aunque sus mappings coincidían con la transpilación. El mapa nuevo se regenera desde el TS adaptado y apunta a su ruta real `../../../src/modules/agent007/firestoreHugoDataStore.ts`. No se presenta el mapa anterior como reproducido byte a byte. El patch binario se aplicó sobre la fuente base y produjo los bytes esperados; su línea vacía final es parte de la representación Git. La segunda ejecución de la receta reprodujo exactamente el SHA del ZIP. El intento privado v1 falló por directorios agregados por JSZip; quedó preservado y no se utiliza.

## Pruebas y límites

- Typecheck aislado del Store adaptado y sus imports: PASS, cero diagnósticos; sin emitir ni compilar la raíz.
- Arranque de `package.main`: 341 endpoints; 340 descriptores ajenos a los dos overrides heredados iguales al bundle original, identidad de ambos handlers parcheados y una denegación anónima del reviewer. Red bloqueada, cero llamadas externas. El listado sigue siendo el override anterior sin cambio de código.
- Firestore demo aislado contra el ZIP exacto: **16 comprobaciones y una denegación anónima adicionales, exit 0**. Reviewer real desde `package.main`; productor del módulo archivado usado explícitamente para preparar fixtures, pues el ZIP de lectores no reemplaza el export productor. Cubre ambos alcances, actor distinto del mismo root, root ajeno, retiro, ACK perdido/reintento sin segunda escritura, actualización de fuente, revocación y ausencia de ACK en `SUPERSEDED`. Bytes del runtime cotejados antes y después; cero pagos, solicitudes, aplicaciones financieras o proveedores. `request.auth` es sintético: no acredita JWT/HTTP ni una sesión real del usuario.
- Verificador canónico `verify-scoped-functions-artifact.cjs`: un único `npm ci --omit=dev --prefer-offline --no-audit --no-fund` privado, PASS 341 endpoints y una denegación anónima. El emulador anterior reutilizó dependencias de la base previamente certificada, con package/lock exactos y realpath documentados; no se atribuye esa ejecución a la instalación fresca posterior.
- Preflight de sólo GET del `2026-10-21T07:06:16.450Z`: reviewer `00003-jur`, fuente f078 exacta y Function/Run/IAM sin deriva. No se consultaron recuerdos ni otros datos de negocio. Debe repetirse la comprobación de frescura antes de cualquier ejecución autorizada.

Recibo consolidado `behavior-verification.json`: SHA256 `fb32b20022f41f5a5b30b9fcc703266d1989e26bc5b131ae6ceea0666b02113d`; manifiesto final `f436c30972a1ba45acc2c82016ac89ff48103d766e9d832d1d134cedbecfed85`.

Recibos independientes: emulador `ed9ef16cf4c1231d7f86276de325851e01865ef7ac6998478a8bff333c3c68bf`; arranque `11bfd03374ba15dd28095aee8768eb340f4e557b407aab32686c67499685bc22`; typecheck `3e5743a3eecb324eba8ba7cca5e0b5098b2d81d8f98babd2afa8b33bd63d3f39`; canónico `91d6c81ee9ec524752d2c2dc185c47bed304a68f59c7fb00dbd36f11b108803b`; preflight `3035fd9682490bd9c698fdc07e612fd2d0cd17915d43d8906f9a7ed0cfe50042`. Las rutas están vinculadas en el recibo consolidado. El helper acotado observado tenía SHA256 `5afb90ed4193e1e2826f62a9936c3df896cf494650960543ddb06297b170a2bf`; no se modificó durante estas comprobaciones.

## Orden y reversión

Se publicó únicamente el reviewer compatible antes de la UI D3, con autorización del paquete exacto. No se instalaron ni activaron otros endpoints o gates. La reversión propia restaura f078 y su configuración/IAM: conserva las guardas de privacidad, el listado y la capacidad de retirar, pero pierde el ACK aditivo; la UI anterior debe acompañar esa reversión para evitar errores de confirmación. No volver a lectores c50 sin guardas, no borrar recuerdos ni deshacer retiros ya confirmados. El artefacto no cambia productor ni crea una nueva clase de datos.

## Publicación y comprobación independiente

El ejecutor de raíz terminó con código 0 y `CONFIGURATION_VERIFIED`: revisión `reviewagent007memorycandidate-00004-sef`, anterior `00003-jur`. La verificación independiente posterior también terminó con código 0 y `PASS_TECHNICAL_PUBLICATION`: fuente descargada exactamente igual al ZIP `1eb8e6e0…`, etiquetas de procedencia `65ca033`, configuración Function/Run e IAM conservados, revisión lista y generación observada. La petición anónima vacía devolvió HTTP 401 / `UNAUTHENTICATED`.

Snapshot y fuente de reversión futura: `.firebase/modular-release/d3-memory-retirement-release/post-publication-2026-10-21T07-38-22-608Z/`; baseline SHA256 `4ba4a159ec6d4f772a2ec84cffdf7ff81e4fcd021695a138c05fc064e54f4f1a`, generación de fuente `1792568157460612`. Recibo `proof.json` SHA256 `ab414868b6687c5e44a8c889f5ccac9f5c9dd09ed2dfa6734ae68306418240be`. No se retiraron recuerdos reales, no se consultaron datos de negocio y no se hicieron escrituras productivas durante esta comprobación. No se ejecutó reversión.

La verificación funcional autenticada de retirar y reintentar desde la UI queda pendiente. Este documento acredita la publicación técnica backend y sus límites; no declara aprendizaje supervisado activo ni cierre funcional del usuario.
