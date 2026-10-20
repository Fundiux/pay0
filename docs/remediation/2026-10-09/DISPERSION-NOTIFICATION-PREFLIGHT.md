# Preflight candidato de compatibilidad de notificaciones

Script: `scripts/dispersion-notification-preflight.mjs`. Default sin red ni
credenciales. No migración, atestación, envío ni escritura remota. Pruebas
sintéticas: 31/31 PASS (0.31 s), incluido agotamiento del deadline durante la
obtención de credenciales. Las primeras 30 formaron parte de la regresión
conjunta 164/164 PASS (2.46 s).
No se ha consultado producción.

## Contrato y límites

Reutiliza bootstrap privado de inventario documental y `selectBootstrapRoot`,
con `--root-index`; la selección no imprime rootId ni hashes de identificadores.
Autenticación mediante `memoryCredential`: captura OAuth de gcloud en memoria,
sin token en argumentos, archivos, stdout ni stderr. No copia configuración ni
variables privadas. Ejecución futura explícita:

```powershell
node scripts/dispersion-notification-preflight.mjs --execute-read-only --bootstrap .firebase/document-inventory/bootstrap.json --root-index 0 --checkpoint .firebase/document-inventory/dispersion-preflight.json --limit 25
```

La ruta del bootstrap es ilustrativa: debe existir y ser el inventario privado
revisado por coordinación. El checkpoint debe ser otro archivo del mismo
directorio privado. No se ejecutó este comando.

Proyecto fijo `pay-0-system`, base `(default)`, bucket fijo
`pay-0-system.firebasestorage.app`, coherente con `src/lib/firebaseClient.ts:33`.
Únicamente Firestore runQuery de lectura y GET de documentos/metadata GCS; no
endpoints configurables, redirects, media/download ni operaciones de escritura.

Cada invocación consulta un root y máximo 25 uploads; limit+1 detecta continuación.
Filtros exactos: rootId, entityType=clientDispersions, status=READY y active=true.
Proyección enumera identidad, path, tamaño/MIME, generación, finalizador y marcas
de vigencia. Excluye nombres de archivo/originalName, descripciones, importes,
tokens, URLs de descarga, mensajes y destinatarios. El path necesario sólo vive
en memoria para identificar el objeto y nunca se incluye en salida/checkpoint.

Por registro: hasta cuatro GET Firestore (dispersión, cliente, actor, evento) y
un GET GCS, todos proyectados. Máximo 126 HTTP por invocación, respuesta JSON
<=512 KiB, timeout por HTTP <=10 s y presupuesto de transporte de 120 s; la
obtención local de credenciales conserva su propio timeout de 30 s y puede
prolongar la terminación local hasta ese residual. Se comprueba nuevamente el
deadline después de obtenerla: si se agotó, no comienza el HTTP. No retry
automático. GCS solicita únicamente name/bucket/generation/metageneration/size/
contentType y metadata de uploadid/uploadId/dispersionId/documentType. No solicita
firebaseStorageDownloadTokens, downloadURL ni alt=media; si el servidor devuelve
campos GCS ajenos a esa proyección, se rechaza la respuesta sin imprimirla.

Los IDs aceptados están limitados a letras ASCII, dígitos, guion y guion bajo;
referencias fuera de ese contrato se rechazan, no se reinterpretan. Un índice
Firestore faltante, HTTP distinto de éxito/404 o una respuesta fuera de límites
produce error genérico redactado; nunca se degrada a scan sin filtros.

## Clasificación sin certificar autorización

Los resultados son sólo enums y conteos agregados: identidad inválida, upload
no vigente, padre/cliente no disponible, actor ausente/scope discordante,
restricción/lifecycle por revisar, política USER pendiente, colisión de evento,
SENT sin replay, evento incierto sin replay, generación inválida, objeto ausente,
metadata discordante, metadata actual coincidente y metadata fijada coincidente.

`CURRENT_METADATA_MATCH_ONLY` significa exclusivamente que el objeto observado
ahora coincide con los campos preparados y sus IDs de metadata; no establece
historia de reemplazos, contenido correcto, malware, permisos actuales ni
destinatario autorizado. `PINNED_METADATA_MATCH_ONLY` añade coincidencia con la
generación almacenada. No se descargan ni hashean bytes.

Todos los resultados mantienen `authorization=CURRENT_RESOLVER_REVALIDATION_REQUIRED`,
`historicalIntegrity=NOT_ESTABLISHED`, `attestationPerformed=false` y
`deliveryAuthorized=false`. Roles, permisos individuales y ancestros de
delegación no se aprueban heurísticamente. Incluso una restricción presente que
diga EXPIRED exige revisión con el resolver real. La rama USER no determina
destinatarios. Cualquier evento existente distinto de SENT se clasifica como
incierto para este inventario; no aprovecha PRE_SEND_FAILED para autorizar un
replay fuera del protocolo del notifier.

## Checkpoint y alcance de evidencia

Reutiliza contención de ruta privada del inventario de delegaciones. Lock local
exclusivo; escritura temporal con permiso 0600, fsync y rename. En Windows esos
bits no sustituyen las ACL del workspace: el directorio privado debe conservar
su protección local. Guarda sólo schema/proyecto/root/cursor/conteos; nunca
OAuth, metadata GCS, contenido, paths de Storage ni respuestas. Al reanudar valida
scope, cursor, schema y cada enum/contador; no reimprime claves arbitrarias de un
checkpoint manipulado. No se sube ni versiona el checkpoint.

La salida distingue lote y acumulado, y sólo declara agotado el root/filtro
seleccionado en las lecturas realizadas. No es snapshot transaccional, no cubre
otros roots ni registros que cambiaron mientras se recorren páginas. Reanudación
no equivale a una fotografía consistente. Ningún conteo cierra por sí solo el
gate de migración/publicación.

## Ejecucion remota de solo lectura, 2026-10-10 UTC

Herramienta1616c2b ejecutada sobre bootstrap uploads/root index0, limite25.
Tres READY/active/clientDispersions observados y pagina corta completa para ese
filtro/root: uno EVENT_SENT_NO_REPLAY y dos EVENT_UNCERTAIN_NO_REPLAY.
No se alcanzo lectura GCS porque los tres tienen evento de entrega previo;
ninguna generacion quedo atestada. Cero mensajes, descargas o escrituras remotas.
Checkpoint privado `.firebase/document-inventory/dispersion-notification-root0-v1.json`.
No implica snapshot global, cobertura de otros roots ni autoridad actual
certificada. No autoriza repetir ninguno de los tres eventos ni transforma
la incertidumbre de entrega en error recuperable automaticamente.

Una futura atestación requiere revisar todos los vínculos en transacción y
registrar explícitamente observación actual/actor/hora, preservando historia,
versión, finalizedBy y estado de entrega. No se implementa aquí.

