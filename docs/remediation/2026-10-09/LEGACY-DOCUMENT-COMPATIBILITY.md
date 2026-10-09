# Compatibilidad legacy documental: evidencia antes del puente

Fecha2026-10-09. Analisis de codigo local y fixtures; este agente no consulto documentos productivos, URLs, tokens ni contenido. No se edito el puente ni se amplio autoridad.

## Hallazgo

El registro de muestra con entityId pero sin campo canonico ya era rechazado por getAuthorizedDocumentDownloadUrl anterior. El resolver identifica familia por entityType o por solicitudId/pagoId/dispersionId, pero obtiene el padre EXCLUSIVAMENTE desde el campo canonico de esa familia. Si falta, lanza failed-precondition (Documento sin recurso padre) antes de consultar padre, Storage o firmar. No hay fallback a entityId. El puente conserva esa exigencia; no se demostro una regresion nueva para ese patron.

## Fuente productiva preservada y trazabilidad

- Integracion preservo getAuthorizedDocumentDownloadUrl revision00003-xuj, generation1790583836497870, en TEMP/pay0-remediation-20261009-sources/getAuthorizedDocumentDownloadUrl-pre-bridge.zip.
- SHA256 del ZIP exacto, verificado localmente: C50F0D7A95BB24CAF156022AE1145503D34F2110F9C39DF71921EE52A190DB1F. Es identico al archivo de fuentes previo resolveClientDispersionIncident-pre-next-lot.zip, usado inicialmente para extraer SOLO src/modules/documents/authorizedDownload.ts. No se extrajeron .env, claves u otros archivos.
- Archivo TypeScript5989bytes; SHA256 A97DAA4C0D5B93E015E1C10F7CFFC5746B6AAE68DAEFC7C26B5F43D62F1BF397. Cero menciones entityId.
- Tras normalizar CRLF, coincide byte por byte con el archivo en commit1e25f1a72dd86ddb067d3529b301335a18122ffe (padre de integracion fb0d0d5). SHA256 normalizado:3b12a1b6ce559a2d31724b07addb2f0ba3651915b56ea05fb6310a8e2e770a1a.
- Wrapper src/services/authorizedDocuments.ts y DocsModal prepuente invocaban ese callable por uploadId sin fallback a una URL persistida. Esta inspeccion no acredita cada bundle historico ni toda URL bearer distribuida.

## Comprobacion ejecutable local

Se transpilaron ambos cuerpos TypeScript en VM con SDK/Firestore/guardas y signer inyectados, sin red. Filas sinteticas para solicitudes, pagos y clientDispersions, cada una con dos variantes: entityId-only sin padre canonico y campo canonico valido. Se ejecutaron ambos resolvers:12 decisiones.

| Variante | Legacy | Puente |
|---|---|---|
| Falta campo canonico,3familias |3failed-precondition|3failed-precondition|
| Campo canonico y padre valido,3familias |3aceptadas|3aceptadas|

Signer invocado0veces en casos sin padre. Las guardas de rol/delegacion se sustituyeron por fakes para aislar la seleccion de padre; NO se presenta este ensayo como prueba completa de autorizacion. Los fixtures no contienen datos reales y no se persistio muestra productiva en el repositorio.

## Muestra reportada por integracion

Primera pagina100uploads:94estatus elegibles,6inactivos;93rutas docs,93tamanos declarados <=32MiB y93padres concordantes. Un registro combina MISSING_CANONICAL_PARENT_FIELD,ENTITY_ID_ONLY_LEGACY,CANONICAL_PARENT_UNRESOLVED,INVALID_OR_UNVERIFIABLE_PREFIX,RECORDED_SIZE_UNKNOWN. Estas banderas no prueban path malicioso: sin padre canonico no puede verificarse prefijo, y se mantiene el rechazo ya existente.

La muestra posterior con Storage, ejecutada por integracion contra bucketcanonico, reporto93OBJECT_WITHIN_32_MIB,0objetos ausentes y el mismo registro de metadata legacy no resoluble. No se descargaron archivos. Una muestra100 no cierra compatibilidad de todo el historico, otros roots ni entidades/assets.

## Recomendacion sin ampliar permisos

No introducir fallback entityId como supuesta restauracion: el callable probado no lo tenia. Mantener el caso como defecto preexistente de metadata; no ocultarlo ni concluir que el archivo desaparecio. Si se decide repararlo, primero comprobar procedencia de la fila y correspondencia con entidad padre canonica, root/lifecycle y objeto esperado. Cualquier cambio de campo exige plan revisado, CAS contra version/estado leidos y auditoria atomica; aun con metadatos reparados, el resolver debe revalidar permisos/delegacion/restriccion actuales.

Un fallback futuro entityType+entityId seria compatibilidad nueva, que requiere diseno y pruebas especificas: familia whitelist exacta, ID valido, ninguna contradiccion con campos canonicos, padre existente/root/lifecycle, autoridad vigente en transaccion y prefijo Storage solo como comprobacion de consistencia. URL/path nunca aportan permiso. No se propuso ni ejecuto esa ampliacion para este rollout.
