# GHK1 — paquete mínimo de descarga por generación

Estado: **DEPLOYED_NOT_VERIFIED**. Autorización explícita recibida; publicado
el 2026-10-19 en `getauthorizeddocumentdownloadurl-00007-yah`. Fuente, hash,
runtime e IAM verificados, sin reversión. La petición sin autenticar devuelve
HTTP 401. El usuario confirmó que las descargas de solicitudes y pagos funcionan.
Verificación funcional limitada a esos flujos; otros módulos y sustitución de objetos
no se comprobaron en producción. El paquete afecta exclusivamente
`getAuthorizedDocumentDownloadUrl`; no incluye gateway, interfaz, reglas ni
otros endpoints.

## Identidad y contenido

Fuente actual verificada: `getauthorizeddocumentdownloadurl-00006-koz`.
Runtime/configuración existente: Node 22, 30 segundos, 256 MiB. El archivo
productivo sólo contiene JavaScript; el AST del módulo completo coincide con
la compilación del código previo al cambio.

| Evidencia | SHA-256 |
| --- | --- |
| Fuente productiva recuperable | `6615bb840530acf6dc31f2f86e988210f5505d2d17a0b4c05850c0c0eb2eb713` |
| Artefacto GHK1 | `ddf1f8b0f206e5c4e58bcb58468f7f5716b94ff06100d5950e47dfea06ba5707` |
| Patch de los dos módulos | `96ee023641a61592ac2826cb2ad07efd6d2442e6a82fec6cdea1862a412b7f17` |
| Input de publicación | `42728973bfdff90627ee664ac04d9d33040ef8e7639360c0d18425540c6ce8f4` |

Commit del cambio: `eae9d017a66eafe2fd9c0b172b0aa8831666bf87`.
`sourceIdentity.mode` es `PRODUCTION_OVERLAY_V1` y `sourceTree` es null.
No se presenta el archivo como una compilación completa de ese commit: se
transpilaron sólo los dos módulos revisados y se conservaron las 952 entradas
restantes, incluyendo los manifests y locks productivos.

Artefactos privados:
`.firebase/modular-release/document-generation-2026-10-19T18-01-15-098Z/overlay/release/`.
El input es `input.json`; el archivo es `functions.zip`; la fuente de rollback
original está en el directorio superior de captura como
`getAuthorizedDocumentDownloadUrl-previous.zip`. No se incluyen credenciales en
esta documentación.

## Verificación

La compilación Functions compartida pasó. Nueve pruebas del SDK/firma/core
pasaron tanto sobre fuentes como sobre los JavaScript exactos del artefacto:
generación textual mayor que 2^53, firma V4 comprobada criptográficamente,
alteración de firma rechazada, legacy fijado una vez, metadata inconsistente,
entrada inválida, generación del servidor y denegaciones antes de firmar,
404 sin fallback y sanitización de errores. No hubo red en esas pruebas.

La prueba canónica de startup del archivo, con dependencias exactas, pasó:
354 endpoints cargados y denegación sin autenticación del endpoint objetivo.
Su identidad está registrada en `artifact-verification.json`. Se verificaron
también byte a byte las 952 entradas que no cambian. La autorización de
publicación no se deduce de que esas pruebas pasen.

## Operación y reversión

Se conserva el contrato de respuesta y vencimiento de 300 segundos. Se firma
una generación específica, evitando que una sobrescritura de la ruta cambie
el documento de una URL ya entregada. No se cambian políticas de acceso,
metadata documental, estados financieros, environment, secretos ni IAM.

No se ejecutó una descarga autenticada productiva. Para cualquier nueva
publicación, el ejecutor debe volver a verificar
que la revisión/fuente actual coincidan con el baseline y preservar el archivo
original para rollback. Un fallo de esa comparación impide reutilizar este
paquete sin reconciliar la nueva fuente.

Riesgo operativo: si la generación autorizada ya no existe, la descarga falla
en vez de entregar silenciosamente el objeto nuevo de la misma ruta. Se
conserva la clasificación `not-found`; no se cambia la política de retención
de Storage. La firma usa las credenciales y permisos actuales.

Publicación: ejecutar exclusivamente el input indicado, con su SHA256, mediante
`scripts/deploy-scoped-functions.mjs --execute`. Reversión autorizable para este
paquete: usar `--rollback` con el mismo input/hash y
`getAuthorizedDocumentDownloadUrl`; restaura la fuente y etiquetas anteriores,
sin borrar objetos ni auditoría. Verificar después estado ACTIVE, hash,
runtime/IAM y una descarga autorizada real. Hasta esa comprobación funcional,
el estado posterior será `DEPLOYED_NOT_VERIFIED`, no `COMPLETED`.
