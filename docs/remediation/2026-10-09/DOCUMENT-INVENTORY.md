# Inventario documental historico previo al puente

Estado: herramienta preparada y probada con fixtures; este agente no ejecuto lecturas productivas ni escrituras cloud. Integracion reporto un bootstrap de100 documentos, documentado abajo; no es cierre historico. Ningun cambio de bridge/rules/UI. No demuestra compatibilidad historica real ni autoriza retirar Storage/getDownloadURL. Fuente revisada: DOCUMENT-ROLLOUT-COVERAGE.md y downloadAccess.ts de .worktrees/private-document-bridge-20261009, mas escritores y verifiedStorageObject del checkout principal.

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

## Herramienta y modo seguro predeterminado

- qa/scripts/remediation-document-inventory.mjs: sin flags de ejecucion devuelve solo plan DRY_RUN y no carga firebase-admin ni abre red.
- qa/scripts/remediation-document-inventory.test.mjs: ocho casos sinteticos, todos PASS. Incluyen umbral exacto32MiB, oversized, flatlegacy, entityId-only, entidades/assets, prefijos peligrosos, padre ausente, objeto404, limites, cache, paginacion, reanudacion y redaccion de errores.
- Entrada cloud futura requiere --execute-read-only, --project, --root y --checkpoint explicitos. No se ejecuto. No existe flag de escritura cloud ni uso de setters/download/readStream/signedURL.

Comprobaciones locales reproducibles:

```powershell
node qa/scripts/remediation-document-inventory.mjs
node --test qa/scripts/remediation-document-inventory.test.mjs
```

La ejecucion lee un solo root por invocacion. Familias permitidas: uploads,entityDocuments,assetDocuments; seleccionar una sola al iniciar la revision. Limites predeterminados: page-size50, max-records200 global entre familias, max-metadata50. Limites duros: pagina100, registros1000, metadata1000; no concurrencia paralela. La metadata Storage esta DESACTIVADA por defecto y requiere --with-storage-metadata y --bucket concretos. max-metadata debe igualar al menos max-records si se desea cubrir todos los objetos elegibles de ese lote.

## Lecturas y salida

Firestore consulta rootId==root, ordena por documentId, pagina con startAfter y aplica proyeccion explicita de campos: raiz/estado/lifecycle, referencias canonicas, storagePath y sizeBytes/fileSize. La ruta se usa solamente en memoria para comprobar prefijo y consultar metadata; no se imprime. No solicita campos URL/token/nombres de archivo/contenido ni documentos de usuarios. Lee metadatos minimos del padre por ID: raiz/estado/lifecycle, con cache limitada al lote.

Storage hace getMetadata({fields:'size'}) solo para rutas bajo prefijo canonico valido. El SDK local propaga fields como query a GCS; no solicita custom metadata, download tokens, contenido, ACL, generation ni URL. No lista el bucket. Un404 cuenta objeto ausente; otros errores abortan con codigo generico, sin mensaje original del proveedor. DEBUG se vacia al habilitar ejecucion para evitar trazas heredadas.

stdout contiene exclusivamente conteos por familia, banderas fijas, numero de consultas y hash del alcance; no IDs/root/bucket/rutas/nombres/tokens/URLs. El checkpoint local guarda hash de alcance, cursor documentId por familia y conteos acumulados; debe guardarse en una carpeta local ignorada como .firebase/document-inventory/, nunca Git. No contiene rutas Storage, URLs o tokens. Crear esa carpeta previamente y usar un archivo distinto por alcance. El checkpoint se reemplaza mediante archivo .pending local tras completar cada pagina. No ejecutar dos procesos sobre el mismo checkpoint. Si falla una pagina, se repite desde el ultimo checkpoint guardado sin duplicar los conteos persistidos.

## Que se cuenta

uploads incluye READY, ACTIVE, FINALIZED y legacy con status vacio+active true, excluyendo lifecycle borrado/inactivo. Se cuentan por separado registros escaneados no elegibles. entityDocuments/assetDocuments incluyen ACTIVE; entityDocuments marca uploadStatus distinto FINALIZED.

- RECORDED_OVER_32_MIB y OBJECT_OVER_32_MIB distinguen tamano declarado frente a tamano actual verificado. El valor exacto32MiB no es oversized. Tamano desconocido se informa, nunca se infiere compatibilidad.
- FLAT_LEGACY reconoce archivo directo bajo roots/root/familia/padre/file; DOCS_LAYOUT y OTHER_PREFIX_LAYOUT son categorias distintas. Un flat con referencias/padre validos es candidato compatible con el resolver; flat por si solo no acredita autorizacion.
- CANONICAL_PARENT_UNRESOLVED, MISSING_CANONICAL_PARENT_FIELD, UNKNOWN_UPLOAD_FAMILY y ENTITY_ID_ONLY_LEGACY identifican metadatos no resolubles sin inferir ownership desde rutas/URLs.
- PARENT_DOCUMENT_MISSING, PARENT_UNAVAILABLE y PARENT_ROOT_MISMATCH detectan faltantes o inconsistencias. Para entidad se conserva la excepcion legacy de root ausente en el padre, tal como el resolver actual; no se convierte en autoridad nueva.
- INVALID_ENTITY_REFERENCE, ENTITY_UPLOAD_NOT_FINALIZED, INVALID_ASSET_REFERENCE, MISSING_STORAGE_PATH e INVALID_OR_UNVERIFIABLE_PREFIX separan impedimentos estructurales.
- OBJECT_SIZE_NOT_CHECKED_BUDGET hace visible la falta de cobertura de metadata por presupuesto. complete=true solo significa terminar el recorrido Firestore, nunca compatibilidad total ni cierre de seguridad.

## Alcance, coste y reanudacion propuestos

Primera ejecucion futura: un root aprobado, uploads solamente, pagina25, max-records100, metadata desactivada; revisar conteos. Segundo lote aprobado puede habilitar metadata con max-metadata100 y bucket canonico. Para cubrir todas las filas anteriores con metadata, empezar checkpoint nuevo: los registros omitidos por presupuesto no se revisitan automaticamente al reanudar. No usar los conteos parciales para retirar rutas.

Un lote escanea como maximo B documentos seleccionados y consulta como maximo B padres distintos; los queries vacios pueden tener cargo minimo adicional (hasta las familias concluidas). Como orden conservador: hasta2B+F lecturas documentales, mas costes de entradas de indice si aplican, y hastaM operaciones metadata GCS; proyeccion reduce bytes, no garantiza menor numero de lecturas facturadas. No se cotiza dinero ni se supone indice existente. Si Firestore pide indice, abortar y revisar; el script no crea indices.

El alcance del checkpoint fija proyecto/root/bucket/familias/metadata. Un cambio de alcance falla cerrado; permite cambiar tamanos de lote sin perder cursor. Cada invocacion esta acotada, pero ejecutar repetidamente consume mas lecturas: llevar presupuesto acumulado fuera del script. No hay snapshot global: altas con ID anterior al cursor y cambios concurrentes pueden omitirse; repetir inventario completo en ventana acordada antes del retiro y comparar resultados. Mantener credencial con permisos de lectura minimos en Firestore y, si se habilita, storage.objects.get; nunca provisionar IAM desde este script. Admin SDK omite reglas de cliente, por lo que su inventario NO prueba autorizacion del puente.

## Fronteras no cubiertas y gates pendientes

1. El filtro rootId excluye documentos sin root o con root incorrecto. Su censo exige fase global separada, acotada y aprobada; no afirmar que faltan cero.
2. No lista objetos huerfanos sin documento ni consulta URLs historicas. MISSING_STORAGE_PATH no significa necesariamente URL-only: esos campos deliberadamente no se leen. documentDeliveryJobs/corporateResources/Telegram/firma/IQ requieren inventarios propios y preservar contratos.
3. No consulta ni cuenta tokens Firebase existentes: fields:size excluye custom metadata. Un futuro inventario de presencia de tokens requiere diseno separado que no los emita; este lote no revoca ni rota tokens. Tampoco prueba generaciones fijadas, contenido/MIME, lineage/delegacion o sesion de un usuario concreto.
4. Compatibilidad historica requiere resolver oversized>32MiB y referencias ausentes con migracion validada o ruta soportada antes de cambiar las seis ramas Storage. Ningun boton debe ocultar ese faltante.
5. Mantener24 casos Storage delegados pendientes hasta despliegue compatible de backend/UI, inventario historico, prueba de acceso legitimo y revision final de reglas. Este script no activa restriccion, writer ni despliegue.

No se ejecutaron builds ni emuladores: el lote solo agrega script read-only y pruebas puras. No se usaron credenciales, proveedores ni respuestas productivas en las pruebas.

## Bootstrap y adapter REST sin ADC persistente

Archivos nuevos: remediation-document-inventory-bootstrap.mjs/.test.mjs y remediation-document-inventory-rest.mjs/.test.mjs. Suite conjunta19/19 PASS (8core,5bootstrap,6REST). Ambos comandos son DRY_RUN por defecto: no piden token, no leen checkpoint privado ni usan red. Firebase Admin Firestore instalado rechaza credencial custom getAccessToken (firestore-internal.js acepta certificado/ADC); por eso estos helpers usan Firestore REST con el mismo permiso OAuth, no un supuesto soporte de Admin. El ejecutable original de inventario con Admin sigue siendo secundario; la ruta operativa preferida sin ADC es el adapter REST.

memoryCredential captura gcloud auth print-access-token --project pay-0-system --quiet en stdout PIPE; no imprime stdout/stderr del proceso. Token vive en cierre de memoria con cache30s, nunca variable persistente, archivo ADC, URL o checkpoint. shell de Windows solo recibe comando/argumentos constantes, sin entradas de usuario. Errores se sustituyen por codigos genericos; DEBUG se vacia antes de autenticar.

Bootstrap fija proyecto pay-0-system, coleccion uploads, proyeccion exclusiva rootId y limit100 en una sola runQuery. Guarda cursor y roots reales exclusivamente en .firebase/document-inventory/*.json ignorado; stdout contiene indices/hash/conteos, no IDs. Integracion reporto su ejecucion de una pagina:100 documentos, missingRoot0,invalidRoot0,un root index0,exhausted=false. Este agente no leyo el checkpoint ni las respuestas. Es muestra, no inventario completo ni validacion de padre/tamano.

Adapter REST selecciona root por index desde ese checkpoint; nunca requiere escribir UID en comando/stdout. Primera ejecucion revisable por integracion:

```powershell
node qa/scripts/remediation-document-inventory-rest.mjs --execute-read-only --bootstrap .firebase/document-inventory/bootstrap-uploads.json --root-index 0 --checkpoint .firebase/document-inventory/sample-uploads-root0.json --max-records 100 --page-size 25
```

Este agente NO ejecuto el comando remoto. El adapter usa uploads por defecto, acepta familias whitelist y mantiene maximo100 registros globales por invocacion; usa FIELDS, filtro rootId exacto y cursor exclusivo por __name__. Padres se consultan por ID canonico, limit1 y solo6 campos root/estado/lifecycle. Las respuestas estan acotadas a512KiB, timeout30s y redirect:error; el endpoint de proyecto es constante. No imprime mensaje original de proveedor, rutas o datos leidos. Checkpoints bajo carpeta ignorada y bootstrap/inventario deben ser archivos distintos.

Storage sigue DESACTIVADO en la primera muestra. El flag opcional --with-storage-metadata solo solicita fields=size al endpoint fijo pay-0-system.firebasestorage.app, coincidente con getStorage(app,"gs://pay-0-system.firebasestorage.app") en src/lib/firebaseClient.ts. La referencia anterior appspot procedia de scripts historicos y fue corregida antes de cualquier lectura Storage; no debe usarse para inferir objetos ausentes. No consulta custom metadata/tokens ni contenido. Su presupuesto queda igual a max-records. La muestra puede detectar problemas de metadata declarada; sin Storage no confirma tamano actual, generacion ni existencia del objeto.

Una pagina bootstrap100 mas muestra100 y hasta100 padres implica lecturas adicionales acotadas; consultar siguiente pagina/root, otras colecciones o metadata Storage requiere revisar resultados y presupuesto, no continuar automaticamente. No retirar rutas ni publicar la UI suponiendo compatibilidad global a partir de una sola muestra.

## Familias seleccionables y conteos agregados

REST CLI acepta --families uploads,entityDocuments,assetDocuments (whitelist estricta, sin duplicados); default sigue uploads. max-records100 es GLOBAL por lote, no100porcoleccion. El checkpoint fija lista/orden de familias en scopeHash: un cambio de familias requiere archivo nuevo y falla antes de leer si se intenta reutilizar el anterior.

qa/scripts/remediation-document-inventory-counts.mjs hace como maximo6consultas seriales: COUNT acotado total y COUNT acotado root seleccionado para cada una de las3colecciones. DRY_RUN predeterminado no abre checkpoint/gcloud/red. Para ejecucion revisada de integracion: --execute-counts-read-only --bootstrap .firebase/document-inventory/bootstrap-uploads.json --root-index 0. No ejecutado por este agente. Endpoint fijo pay-0-system, solo aggregation count con alias documentCount; sin lectura de documentos, URLs o custommetadata. stdout solo numeros porfamilia, rootIndex/hash y estado. Timeout30s/512KiB/redirect:error porpeticion, sin reintentoautomatico.

Cada una de las seis consultas usa count:{upTo:"10001"}, sin opcion ilimitada. stdout devuelve count y cappedPossible por familia/alcance; count>=10001 indica posible truncamiento, NO total exacto. La cota agregada es60006 documentos contados por invocacion, no una afirmacion sobre importe exacto de facturacion o cada entrada interna de indice. DRY_RUN declara countLimit10001 e indexScanUnbounded:false. Consultas separadas no comparten snapshot global; diferencias concurrentes de conteos no identifican por si solas documentos rootless. No ampliar automaticamente si se alcanza la cota.

Documentacion primaria: [runAggregationQuery](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runAggregationQuery) define el endpoint POST, structuredAggregationQuery, resultados agregados y scopes datastore/cloud-platform. Su seccion Count define upTo como restriccion opcional del maximo de documentos a contar y describe su uso para limitar escaneo, latencia y coste. El helper lo envia como string int64 "10001". No solicita Explain ni datos documentales.

Suite conjunta25/25PASS:8core+5bootstrap+6REST+6conteos/familias, incluyendo cota exacta y respuesta sobre-cota rechazada. Incluye redaccion, cota6, whitelist, cambio de scope, filtro root y errores de conteo. No hubo nuevas lecturas productivas por este agente. La compatibilidad legacy y hashes del codigo preservado se documentan en LEGACY-DOCUMENT-COMPATIBILITY.md.

## Correccion del contrato de respuesta y muestra entity/assets

La primera consulta count ejecutada por integracion recibio HTTP200 pero el parser fallo: se habia usado aggregationFields en codigo y fakes. El campo oficial es result.aggregateFields; parser y fixtures corregidos, con prueba que rechaza explicitamente la grafia anterior. El intento fallido no constituye un resultado de conteo ni se contabiliza como gatePASS. El agente no repitio consultas productivas. Referencia primaria: [proto oficial AggregationResult](https://github.com/googleapis/googleapis/blob/master/google/firestore/v1/aggregation_result.proto), campo aggregate_fields; los tipos instalados de @google-cloud/firestore exponen aggregateFields y la prueba verifica ese contrato.

Integracion reporto inventario entityDocuments/assetDocuments completado SOLO para rootindex0:23entityDocuments escaneados,13activos y10inactivos;13padres concordantes y13objetos dentro de32MiB. assetDocuments0 en ese root. No extrapolar a otros roots ni declarar cierre global. Suite local actual26/26PASS (conteos7+REST6+bootstrap5+core8).

## Diseno previo del diagnostico de los cuatro legacy (ejecucion posterior reportada abajo)

El checkpoint agregado actual guarda conteos y ultimo cursor, NO la lista de los4documentos anomalos. Por eso no puede obtenerse una lista de4IDs a partir de ese archivo ni reanudar desde su cursor final para encontrarlos. Usarlo solo como evidencia de alcance/conteos y conservarlo intacto. El root se obtiene por index0 desde bootstrap privado; nunca por un UID pegado en comandos o stdout.

Propuesta para revision antes de implementar/ejecutar:

1. Validar proyecto pay-0-system, root index0, familias uploads y hash de alcance del checkpoint terminado. Guardar un checkpoint diagnostico NUEVO, ignorado, con hash del origen y cursor desde el principio; no sobrescribir inventario ni bootstrap.
2. Repetir solo proyeccion minima de metadata requerida para detectar estado elegible y falta del campo padre canonico: rootId,estado/lifecycle,entityType,entityId y solicitudId/pagoId/dispersionId. No leer URLs, nombres, tokens ni bytes. Paginas de hasta100, presupuesto100por invocacion y tope total1500documentos para este censo conocido1446. Detener y pedir nueva revision de alcance si cambia la poblacion o aparecen mas de4candidatos; no ampliar automaticamente.
3. Guardar IDs, updateTime y metadatos de referencia de esos candidatos exclusivamente en un manifest local ignorado, maximo4. stdout solo progreso/conteos y enums. Si el nuevo censo encuentra menos o mas de4 o datos cambiados, marcar SOURCE_CHANGED y no equiparar automaticamente los hallazgos al censo anterior.
4. Para cada candidato, usar entityType exacto en whitelist para elegir coleccion; entityId solo identifica que padre inspeccionar, NO concede permiso. Consultar maximo1padre por candidato con root/estado/lifecycle, y revalidar version del upload. Proyectar storagePath solo si hace falta clasificar consistencia del prefijo contra ese padre, mantenerlo exclusivamente en memoria; no consultar Storage ni emitir rutas. Presupuesto adicional maximo4lecturas de padres y4relecturas de upload, sin escrituras.
5. Emitir por indice opaco categorias cerradas: familia SOLICITUD/PAGO/DISPERSION/UNKNOWN; referencia VALID/MISSING/INVALID/CONFLICTING; padre SAME_ROOT_ACTIVE/MISSING/OTHER_ROOT/INACTIVE/UNRESOLVED; prefijo MATCH/MISMATCH/UNVERIFIABLE; procedencia UNVERIFIED salvo evidencia independiente futura. Ningun dato original, IDs, cliente, root, path o nombre aparece en stdout.
6. Entregar conteos y posible plan de reparacion para revision. Un padre coincidente no prueba procedencia ni autoriza mutacion. Cualquier reparacion requerira autorizacion separada, precondicion CAS y audit atomico; este diagnostico no escribe cloud ni agrega fallback al puente.

Coste propuesto: como maximo1500documentos de reescaneo, hasta8lecturas de diagnostico y queries vacios minimos. Ese plan no se ejecuto durante su redaccion; su ejecucion posterior por integracion se registra en el apartado final. Alternativa de reutilizar IDs requeriria un manifest privado previo que hoy no existe en el checkpoint agregado; no inventar que se guardaron.

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
