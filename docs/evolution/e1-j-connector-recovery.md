# J — consumidor QR recuperado en cuarentena

Estado: **INCOMPLETE**; fuente recuperada en cuarentena, sin activar. Búsqueda dirigida de rutas y código, sin restaurar worktrees, instalar paquetes, cargar el módulo ni ejecutar WhatsApp. No se abrieron `.env`, credenciales, sesiones ni logs.

## Revalidación dirigida del 20 de octubre

El bloqueo de autoridad continúa en los recursos concretos revisados. `enqueueWhatsAppConnectorCommand` acredita al solicitante mediante `requireSuperadminUser`, fija su `rootId` y `requestedByUid`, pero dirige ambos comandos a `connectorId: "default"`. Para `SYNC_CHATS` comprueba el estado `CONNECTED`; no acredita que la sesión WhatsApp pertenezca a ese usuario o raíz. El consumidor obtiene `CONNECTOR_ID` y `AUTH_CLIENT_ID` de configuración local y su propio heartbeat escribe esos identificadores en el documento del conector. Ese estado autodeclarado no constituye un registro servidor autorizado de propiedad de sesión.

Se repitió únicamente la caracterización de `syncChatsOnce` extraída por AST, con Firestore fake y WhatsApp stub: **tres fallos reproducidos**, chat nuevo sin raíz, desactivación de un chat sintético de otra raíz y pruning filtrado sólo por conector. Evidencia privada nueva: `.firebase/modular-release/whatsapp-connector-recovery/baseline-contract-probe-recheck-20261020.json`; la evidencia anterior se conserva. `node --check` del consumidor preservado pasa; no se cargó su entrypoint, no se inició el worker ni se abrió una sesión.

No se implementó un parche que tomara el root del payload, del último comando, del primer chat o de un nuevo valor de entorno. La recuperación permanece cerrada mediante cuarentena y ausencia de activación; esto **no** significa que el consumidor histórico esté corregido. Se conservan intactas las capacidades de envío, `SYNC_CHATS`, `NEW_QR`, heartbeat y los bytes recuperados. No se borraron sesiones, locks ni comandos.

La entrega ejecutable sigue pendiente de identificar un vínculo servidor verificable entre sesión, conector, usuario y raíz, con autoridad explícita de registro/revocación, y de acordar el mapeo de chats históricos sin raíz. Después podrá aplicarse el mismo vínculo a sync inicial, timer, comandos, escrituras, colisiones y pruning, con los negativos offline ya especificados. Esta revisión no consultó datos ni metadatos productivos y no acredita la ubicación o versión de un worker activo.

Identidades de esta revalidación: productor fuente SHA256 `842ec708d0fae7f3636337f52bef7e8841a09ed9e4884414ce0c6e75faede53e`; consumidor recuperado `d413df48bc2ff218f655915ac1497a0a36a3029f9ee593f0ec3cfa8ac7f31c8c`; prueba offline `cd025fe6432bac899c5725ade7a91db477b67a53d1b4640c93ca4801a0b11303`. Son identidades locales de código y fixtures, no versiones productivas verificadas.

El productor existente `functions/src/modules/documentDelivery/whatsappQrCallables.ts` usa `enqueueWhatsAppConnectorCommand` para escribir `SYNC_CHATS` y `NEW_QR` en `whatsappQrConnectorCommands`. Se encontró su consumidor en `__untracked_archive/tools/whatsapp-qr-connector/connector.cjs`: `processConnectorCommandsOnce` (línea 918), consulta (925), ramas `SYNC_CHATS` (997) y `NEW_QR` (1039), `startControlPolling` (1157) y heartbeat (841). El `package.json` declara `node connector.cjs`. La ubicación activa `tools/whatsapp-qr-connector` sólo contiene un directorio de sesión, que no se inspeccionó.

## Preservación exacta

Copia privada por allowlist en `.firebase/modular-release/whatsapp-connector-recovery/`. Sólo se copiaron `connector.cjs`, `package.json` y `package-lock.json` cuando existían. Manifest SHA256 `45a09d23bf6d8a7f5a9a2643c37ca94646ab42770827086ed5ea9557276d67a7`. Las tres fuentes pasan `node --check`; esa comprobación sólo analiza sintaxis y no carga el módulo.

| Variante | Identidad SHA256 de `connector.cjs` | Capacidades observadas en código |
| --- | --- | --- |
| `archived` | `d413df48bc2ff218f655915ac1497a0a36a3029f9ee593f0ec3cfa8ac7f31c8c` | Cola de comandos, sync, nuevo QR, heartbeat y envío |
| `backup_h4`, ruta etiquetada `H4-D76-A19B-20260721-084738` | `f402066d5005aa5d9fd499ee9a329bb813d32832c67ac4a77e2bfaa0d391b77b` | Envío; no contiene esos comandos remotos ni heartbeat |
| `backup_remote_control`, ruta etiquetada `WA-REMOTE-CONTROL-A1-20260831-235136` | `156f1a7a275111f4130691e9e8f52a3201d09f3b51ad44a5b79b55a9395928df` | Envío y heartbeat; no contiene el consumidor de comandos posterior |

Las fechas son etiquetas de directorio, no evidencia de ejecución o despliegue. La variante principal tiene package SHA256 `e0a099f9decf344a330b41718951794c1673e02e01f0f75714af02b72da3a4dc` y lock SHA256 `96245b6a9ea1b3b0acd9d2df526abf95312b85e56a107ffa8a3a328cb20cca63`. No se eligió una versión para activar sólo por su fecha.

## Compatibilidad y bloqueo concreto

El consumidor sí existe; la ausencia era del árbol versionado, no global. La variante con comandos es la base de recuperación más completa observada, pero no es un candidato seguro de arranque sin revisión:

- `SYNC_CHATS` llama `syncChatsOnce()` sin pasar el root del comando. El registro escrito en `whatsappQrChats` contiene connectorId/chatId/safeDocId, pero no `rootId`; el barrido de chats obsoletos filtra sólo connectorId. Esto no satisface `src/canonicos/WHATSAPP-CONECTOR-CONTRATO.md`, que exige root del comando y rechazo de colisiones entre raíces. No abrir la UI para mostrar esos chats sin ámbito.
- Cargar el entrypoint tiene efectos: dotenv, inicialización Admin/cliente, procesamiento de marcador de reinicio de autenticación, limpieza de locks de navegador, polling y `client.initialize()`. La rama `NEW_QR` prepara un reinicio de autenticación. No usar `require()` como prueba de importación inocua.
- El guard de envío y el heartbeat existen en código; no se probó su comportamiento, identidad runtime, estado de sesión ni conectividad. El lock se preserva, pero no se instaló ni auditó aquí.

## Siguiente paquete, todavía sin activación

Reutilizar esta fuente en un candidato independiente y revisar únicamente el contrato de comandos/root, colisiones, reclamación/reintentos y efectos de arranque mediante fixtures sin red ni sesiones reales. Conservar los envíos, destinos y límites existentes; no reconstruir un conector alternativo. Identificar después el supervisor/proceso autorizado y su identidad mediante un diagnóstico separado de sólo lectura; esta búsqueda no acredita qué fuente está corriendo en otro equipo.

La activación exige autorización explícita y pruebas sobre el candidato exacto. El plan de reversión debe detener únicamente el proceso candidato y restaurar la versión previa verificada, conservando sesiones y comandos; nunca borrar autenticación o regenerar QR como paso automático. Cualquier comando que ya pasó a PROCESSING requiere reconciliación antes de reintentar, no restablecerlo ciegamente a PENDING. No se ofrece aún un comando de arranque ni se restauró ningún archivo en `tools/`.

## Prerrequisito de identidad y contrato antes de implementar

No se encontró un vínculo de autoridad servidor entre la sesión WhatsApp y un root operativo. `CONNECTOR_ID` y `AUTH_CLIENT_ID` vienen de configuración local con default; el documento del conector recibe escrituras del propio worker. El `rootId` del comando lo fija el productor autenticado, pero no define a quién pertenecen todos los chats de esa sesión. El timer, el evento ready y el barrido no tienen un comando del que obtener contexto. Inferir el root del último comando, del primer chat o de una variable añadida abriría una frontera de confianza nueva y no está autorizado.

Antes del patch, se necesita un registro administrado por servidor que acredite qué sesión/conector puede operar para cada raíz, quién puede cambiar ese vínculo y cómo se revoca. La forma de ese registro y el mapeo de chats históricos requieren revisión; no se inventó ni creó una colección, rol, identidad o dato productivo para resolverlo.

El contrato mínimo ya respaldado por `WHATSAPP-CONECTOR-CONTRATO.md` debe aplicarse en todos los caminos:

- La sincronización disparada por comando exige root del comando y vínculo de sesión autorizado vigente. La periódica y la inicial necesitan ese mismo contexto servidor; si falta, no escriben chats ni desactivan históricos.
- Cada chat escrito conserva root explícito. Un documento histórico sin root queda pendiente de mapeo, nunca se adjudica por coincidencia de ID ni por el operador que llega primero.
- Colisión con chat de otra raíz no sobrescribe, no reactiva ni desactiva ese documento; genera una condición revisable en el ámbito permitido. El barrido de obsoletos sólo toca la raíz y sesión autorizadas.
- `NEW_QR` conserva su capacidad pero exige el vínculo autorizado de sesión antes de preparar reinicio; no debe permitir que una raíz reinicie la sesión compartida de otra. No se borra autenticación al probar este contrato.
- Reclamación de comando, finalización y reintento conservan identidad y ownership; una pérdida de respuesta no autoriza reprocesar efectos externos.

Casos offline requeridos para un futuro patch: sincronización y pruning válidos en root A, root B intacto, rechazo de vínculo ausente/revocado, chat histórico sin root, colisión de IDs, comando adulterado y timer sin contexto, más conservación de SYNC_CHATS/NEW_QR con stubs sin efectos de sesión.

Se ejecutó una prueba de caracterización sobre la función `syncChatsOnce` extraída por AST, sin `require` del entrypoint: Firestore fake y WhatsApp stub, cero red. Reproduce tres incumplimientos actuales: chat nuevo sin root, escritura de desactivación sobre un documento sintético de root B y filtro de pruning sólo por connectorId. Evidencia privada `baseline-contract-probe.json`, estado `BASELINE_GAPS_REPRODUCED`, **no corregido**. Los datos y escrituras fueron sólo objetos en memoria. No se implementó un worker parcheado porque falta el vínculo autorizado descrito arriba.
