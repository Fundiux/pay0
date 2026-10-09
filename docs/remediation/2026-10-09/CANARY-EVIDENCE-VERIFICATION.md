# Comprobación de persistencia sintética Sentinel

Estado: herramienta de solo lectura y pruebas locales completas. **No ejecutada contra servicios remotos**. No modifica IAM ni recursos; no hace mint de SA, queries, listados, transacciones ni escrituras.

`services/pay0-sentinel-observation/scripts/verify-canary-observation.ps1` reutiliza `verify-canary-runtime.ps1 -LibraryOnly` sin modificarlo. Sin `-Execute` no hace red. La ejecución central debe suministrar `-ExpectedRevision` con el nombre corto exacto de la revisión CANARY que emitió el evento; no usar la revisión DRY_RUN para afirmar persistencia. `-MaxAttempts` admite 1–6, default 3.

## Claves exactas

Reproduce las funciones puras del productor y del núcleo, sin tomar identificadores de logs:

1. eventId = `canary_` + SHA256 UTF-8 de `PAY0-CANARY@1:` concatenado con revisión.
2. eventDigest = SHA256 de JSON compacto `[publisherId, actorUid, eventId]`.
3. rootDigest = SHA256 de JSON de rootId.
4. receiptKey = SHA256 de JSON `[policyVersion, origin, eventDigest]`.
5. incidentKey = SHA256 de JSON `[policyVersion, origin, actorUid, eventType, eventDigest]` (el canario no tiene intentionId).

Constantes: root `canary-observation-root`, actor `canary-observation-actor`, publisher `pay0-observation-canary-v1`, policy `PAY0-SENTINEL-SHADOW@1`, origin SERVER_AUTH_DECISION y tipo AUTHORIZATION_DENIED. Fuentes: `services/pay0-security-observation-publisher/src/main.mjs`, `functions/src/modules/sentinel/{schema,detector,transactionalStore,policy}.ts`.

Lee exclusivamente las rutas derivadas `sentinelObservationRoots/{rootDigest}/receipts/{receiptKey}` e `incidents/{incidentKey}`, en `projects/pay0-sentinel-observe/databases/sentinel-observation`. El operador no puede suministrar ruta, root, actor, publisher, base de datos ni proyecto alternativo. No se imprimen claves, eventId, tokens o documentos.

## Lecturas y validación

Usa el access token del usuario activo en memoria, rechaza impersonación/overrides de credenciales y no amplía permisos si devuelve 403. Cada intento consiste en **dos GET exactos** con el helper HTTP acotado existente. Solo espera diez segundos y repite cuando hay 404; máximo doce GET y cinco esperas. Un error de acceso, transporte o documento inválido termina sin reintento. Límite de respuesta compartido: 256 KiB por documento; nunca consulta documentos financieros.

Valida tipos Firestore REST y conjunto exacto de campos para evitar certificar registros con acciones adicionales o schema desconocido. Comprueba:

- `name` exacto en ambos documentos, root/actor/origen/tipo fijos, digests de evento y publisher, enlace receipt→incident y ausencia de intention/attempt/effect digest.
- Incidente con OBSERVE_ONLY, authority NONE, OPEN_OBSERVATION, HUMAN_REVIEW_ONLY, SERVER_AUTHORIZATION_SIGNAL y **eventCount=1**.
- Primer/último occurredAt iguales al evento del recibo; observedAt del recibo igual a lastObservedAt del incidente. Exige un evento reciente (menos de 24 h) y tiempos coherentes.
- Retención exacta de 48 h para recibo y 7 días para incidente desde observedAt; expiresAtMs igual al timestamp Firestore expiresAt y todavía vigente.

Salida únicamente enums/status. Exit 0 significa `OBSERVE_ONLY_SINGLE_EVENT_VERIFIED`; ausencia tras agotar el margen produce NOT_YET_PRESENT y exit 1. Otros fallos producen NOT_VERIFIED y exit 1. No guarda payloads ni tokens.

## Lectura antes y después de replay

Root puede ejecutar la herramienta tras la primera emisión y volver a ejecutarla tras el segundo POST de la misma revisión. Ambas deben validar el mismo recibo y un incidente con eventCount=1. El recibo conserva el evento de la primera ingestión; el replay puede llevar un occurredAt diferente, pero el núcleo retorna DUPLICATE sin modificarlo.

Esta comprobación **no acredita por sí sola que el replay llegó al detector**. Un estado idéntico también es compatible con entrega pendiente o deduplicación anterior en el transporte. La ejecución central debe correlacionar evidencia operativa de entrega/procesamiento antes de afirmar deduplicación E2E. Tampoco prueba ausencia global de efectos financieros: valida únicamente los dos documentos sintéticos bajo el contrato actual. Los GET individuales son consistentes por documento, no una lectura transaccional conjunta.

## Pruebas

`powershell -NoProfile -File qa/scripts/remediation-canary-evidence.test.ps1`: **21 casos PASS**, sin red. Las fixtures se generan ejecutando el TypeScript real del detector sobre un store en memoria: primera ingestión RECORDED y segunda DUPLICATE. La derivación PowerShell se compara con las claves efectivamente usadas por ese núcleo, evitando fixtures que solo repitan la implementación del verificador.

La suite cubre persistencia tras replay, propagación acotada, 404 agotado, 403 sin retry, ruta/enlace/digests/scope alterados, count=2, autoridad/decisión indebida, TTL/tipos/tiempos incorrectos, campos adicionales, parámetros inválidos e importación LibraryOnly. Dry-run local PASS. Sin ejecución remota y sin commit hasta revisión central.
