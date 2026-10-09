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

## Resultado completo del root examinado (reporte de integracion)

El recorrido uploads de root index0 termino en checkpoint privado .firebase/document-inventory/sample-uploads-size-root0.json. Este agente no abrio ese archivo; los siguientes conteos fueron comunicados por integracion. Sustituyen la muestra inicial100 como evidencia de cobertura de ESE root:

| Coleccion / categoria | Conteo |
|---|---:|
| uploads escaneados |1446|
| uploads con estado elegible |1361|
| uploads con padre canonico concordante y objeto actual <=32MiB |1357|
| uploads inactivos/no elegibles |85|
| uploads entityId-only sin padre canonico |4|
| uploads con tamano declarado desconocido |7|
| entityDocuments escaneados |23|
| entityDocuments activos, padre valido y objeto <=32MiB |13|
| entityDocuments inactivos |10|
| assetDocuments en root index0 |0|

Consistencia de categorias:1361+85=1446 y1357+4=1361. Los7tamanos declarados desconocidos son una dimension distinta; no sumarlos como7documentos extra ni inferir intersecciones no reportadas. La verificacion Storage permite confirmar el tamano actual de1357uploads y13entityDocuments, aunque algun tamano declarado falte. No se inspeccionaron bytes, MIME, tokens custom ni URL.

Estas lecturas fueron paginadas y secuenciales, no un snapshot transaccional global. Altas con ID previo al cursor o cambios durante el recorrido pueden escapar de la vista combinada. El resultado no acredita otros roots, documentos sin rootId, objetos sin registro, permisos de un actor concreto, lineage, generaciones historicas ni revocacion de URLs bearer. Los4registros legacy siguen bloqueados por metadatos incompletos; no cuentan como descargas compatibles. No declarar cierre total ni cambiar el resolver para hacerlos pasar.

## Muestra inicial reportada por integracion (historica)

Primera pagina100uploads:94estatus elegibles,6inactivos;93rutas docs,93tamanos declarados <=32MiB y93padres concordantes. Un registro combina MISSING_CANONICAL_PARENT_FIELD,ENTITY_ID_ONLY_LEGACY,CANONICAL_PARENT_UNRESOLVED,INVALID_OR_UNVERIFIABLE_PREFIX,RECORDED_SIZE_UNKNOWN. Estas banderas no prueban path malicioso: sin padre canonico no puede verificarse prefijo, y se mantiene el rechazo ya existente.

La muestra posterior con Storage, ejecutada por integracion contra bucketcanonico, reporto93OBJECT_WITHIN_32_MIB,0objetos ausentes y el mismo registro de metadata legacy no resoluble. No se descargaron archivos. Una muestra100 no cierra compatibilidad de todo el historico, otros roots ni entidades/assets.

## Recomendacion sin ampliar permisos

No introducir fallback entityId como supuesta restauracion: el callable probado no lo tenia. Mantener los4casos como defectos preexistentes de metadata segun el mismo patron probado; no ocultarlo ni concluir que el archivo desaparecio. Si se decide repararlo, primero comprobar procedencia de la fila y correspondencia con entidad padre canonica, root/lifecycle y objeto esperado. Cualquier cambio de campo exige plan revisado, CAS contra version/estado leidos y auditoria atomica; aun con metadatos reparados, el resolver debe revalidar permisos/delegacion/restriccion actuales.

Un fallback futuro entityType+entityId seria compatibilidad nueva, que requiere diseno y pruebas especificas: familia whitelist exacta, ID valido, ninguna contradiccion con campos canonicos, padre existente/root/lifecycle, autoridad vigente en transaccion y prefijo Storage solo como comprobacion de consistencia. URL/path nunca aportan permiso. No se propuso ni ejecuto esa ampliacion para este rollout.

## Plan previo del diagnostico sin ampliar autoridad

El plan detallado esta en DOCUMENT-INVENTORY.md: el checkpoint agregado no conserva IDs de anomalos, por lo que se propone reescaneo de metadata bajo el mismo root con nuevo checkpoint privado,100porlote/tope1500, maximo4candidatos y8lecturas adicionales padre/revalidacion. El plan no se habia ejecutado al redactar esta seccion; el resultado posterior consta abajo. La salida publica se limita a conteos/enums, sin IDs ni datos. EntityId se usaria para consultar un candidato padre, nunca como permiso ni sustitucion automatica del campo canonico. Conservar rechazo legacy hasta que una reparacion especifica tenga evidencia y revision propias.

## Resultado del diagnostico legacy ejecutado por integracion

Integracion reporto COMPLETE:1446registros reescaneados, sourceCountMatched:true,4candidatos y8lecturas adicionales. Los4resultados comparten familia SOLICITUD, parent:MISSING, prefix:MATCH, result:AMBIGUOUS_OR_UNAVAILABLE y provenance:UNVERIFIED. No hubo cambios productivos. Este agente incorpora el reporte sin reabrir checkpoints privados ni realizar lecturas remotas.

El prefijo coincide con la referencia entityId guardada, pero los documentos padre consultados no existen. Esa coincidencia NO demuestra ownership, permiso, procedencia ni recuperabilidad. No procede completar solicitudId automaticamente: agregaria una referencia a un padre ausente y no resolveria la autorizacion. Tampoco procede crear solicitudes ficticias, reasignar documentos a otra solicitud, aceptar una URL como prueba ni relajar el resolver. Conservar los registros y su historial; el rechazo de descarga permanece coherente con el callable legacy probado.

La coincidencia de conteos entre inventarios secuenciales no prueba un snapshot comun ni identidad completa de la poblacion original; el diagnostico revalido updateTime de cada candidato durante sus lecturas. Los padres ausentes estan acreditados en ese momento de lectura, no como afirmacion permanente ante futuras restauraciones.

### Backlog de investigacion y recuperacion revisada

1. Investigar, con alcance y presupuesto separados, si hubo borrado legitimo/accidental del padre, migracion historica o referencias creadas sin padre. Revisar solo evidencia necesaria en auditoria/eventos/respaldos; no iniciar barrido general ni emitir IDs/datos en reportes.
2. Buscar una cadena de procedencia demostrable entre el registro upload, su entityId, el padre historico y el objeto. Un path coincidente no sustituye esa cadena. Registrar si la evidencia es inexistente, contradictoria o verificable sin inventarla.
3. Si existe respaldo autentico y recuperacion autorizada, disenar restauracion de la entidad original con sus invariantes financieras, root/cliente/lifecycle y auditoria. Evaluar efectos colaterales y permisos actuales antes de cualquier restauracion; no crear un padre sintetico para hacer funcionar la descarga.
4. Si se demuestra otra referencia canonica, proponer una reparacion puntual con evidencia, revision humana, CAS de version y audit atomico. Nunca reparentar por semejanza de nombre/ruta, ni activar una reparacion masiva con estos cuatro casos.
5. Si no hay evidencia suficiente, conservar historial y marcar el impedimento para soporte. Cualquier acceso excepcional de recuperacion exige un flujo autorizado independiente y no altera las reglas ni la autoridad normal del puente.

Estado: diagnostico read-only cerrado para estos4candidatos; reparacion NO autorizada ni ejecutada. El backlog anterior sigue pendiente y no convierte en compatibles las cuatro descargas bloqueadas.
