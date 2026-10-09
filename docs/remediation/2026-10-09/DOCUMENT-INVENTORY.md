# Inventario documental historico previo al puente

Estado: herramienta preparada y probada con fixtures; CERO lecturas productivas, CERO escrituras cloud, ningun cambio de bridge/rules/UI. No demuestra compatibilidad historica real ni autoriza retirar Storage/getDownloadURL. Fuente revisada: DOCUMENT-ROLLOUT-COVERAGE.md y downloadAccess.ts de .worktrees/private-document-bridge-20261009, mas escritores y verifiedStorageObject del checkout principal.

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
