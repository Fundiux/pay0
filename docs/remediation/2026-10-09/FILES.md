# S-06 acotado: integridad de documentos de entidad

## Estado y alcance

**Implementado localmente; S-06 permanece parcial.** Esta corrección verifica los bytes y el contrato de una carga de `entityDocuments`. No es antivirus, cuarentena, aislamiento de parsers ni certificación de documentos benignos. No se cambiaron las demás rutas de carga/descarga ni reglas. No se subió archivo real, no se invocó un parser externo y no se desplegó.

Archivos del cambio: `functions/src/utils/verifiedStorageObject.ts`, `functions/src/modules/entityDocuments/service.ts`, extracción aditiva de `resolveClientCsfContinuationAction` en `functions/src/modules/clients/csfService.ts`, y `qa/scripts/remediation-entity-upload.test.cjs`.

## Comparación previa con producción

Consulta autorizada y filtrada: `gcloud functions describe finalizeEntityDocumentUpload --gen2 --region=us-central1 --project=pay-0-system --format="json(name,updateTime,buildConfig.runtime,buildConfig.entryPoint,buildConfig.source.storageSource)"`.

- Runtime: nodejs22; entrada: finalizeEntityDocumentUpload.
- updateTime observado: `2026-09-28T08:46:39.979425930Z`.
- Snapshot: `gs://gcf-v2-sources-751158244178-us-central1/finalizeEntityDocumentUpload/function-source.zip#1790585188745675`.
- Copia local temporal: `%TEMP%/pay0-remediation-20261009-sources/finalizeEntityDocumentUpload.zip`.
- SHA-256 original `src/modules/entityDocuments/service.ts`: `d7e23948a60e2c2f19d1c13ec8346dfc30622edeb20d668a7efda048f5dcea10`.
- SHA-256 original `src/modules/entityDocuments/domain.ts`: `80b99b006a015b9c39285f7a8918e614c1e8ab2d2261168f10b15c82771c97c8`.
- SHA-256 original `src/modules/entityDocuments/callables.ts`: `a8927908433d99c7914c05655856c79a9bb7a290465a6d0acf2f3348c868218a`.

Se leyeron selectivamente solo las tres fuentes anteriores y `src/modules/clients/csfService.ts`. No se leyeron `.env`, credenciales ni archivos de datos del ZIP. La descarga de un artefacto de código no demuestra que todos los exports compartidos se desplegaran desde esa misma revisión.

`domain.ts` y `callables.ts` coinciden semánticamente con el árbol local (diferencias de finales de línea). El servicio desplegado contenía continuidad de carga CSF para admin/operador que HEAD había perdido. Se recuperó ese comportamiento: solo CLIENTE + CONSTANCIA_SITUACION_FISCAL, documento del actor y vínculo intake↔cliente↔root creado por ese actor, con permiso clientes.create/edit según el contexto. El helper canónico recuperado admite lectura transaccional opcional para que una revocación/cambio de vínculo concurrente invalide la finalización. Los métodos administrativos restantes conservan su guardia superadmin.

Se leyó el diff completo de `csfService.ts`: además del helper faltante, producción tenía mejoras de extracción de razón social/nombre de persona física (`coverTaxpayerName`, nombres/apellidos) ausentes en HEAD. **Ese drift de parser no se incorporó en este lote**, por no ser dependencia del finalizador. Debe preservarse antes de una futura publicación de los callables de análisis CSF. No se afirma paridad completa de csfService con producción.

## Contrato de integridad

El helper verifica el path exacto preparado, tamaño entero positivo y límite por tipo documental; exige que metadata de Storage coincida con tamaño/contentType y los identificadores entityDocumentId/entityType/entityId/documentType. Lee la generación GCS exacta mediante stream con validación CRC32C, acumula SHA-256 en servidor y conserva como máximo 512 bytes de prefijo; corta lectura que exceda tamaño/límite y utiliza timeout de 30 segundos. Al terminar relee metadata para detectar cambios de generación o metageneración durante la inspección. Si había hash cliente válido, debe coincidir con el servidor; nunca se acepta como prueba por sí solo.

La detección mínima reconoce cabeceras PDF, PNG, JPEG, WEBP, GIF, ZIP/Office, OLE, PEM/DER y XML; texto plano debe presentar prefijo sin controles binarios y no empezar como HTML. Un contenedor ZIP no se descomprime ni se trata como garantía de un documento Office válido. Formatos desconocidos o MIME que contradiga la firma se rechazan. `application/octet-stream` permite un tipo reconocido y queda registrado junto con `detectedContentType`. Archivos arbitrarios que antes podían cargarse sin inspección pueden requerir conversión o soporte explícito de tipo.

Persistencia nueva: `sha256`, `storageGeneration`, `storageMetageneration`, `sizeBytes`, `contentType`, `detectedContentType`, `integrityVerificationVersion:1`, `integrityHashAlgorithm:SHA-256`, `integritySealStatus:HASH_SERVER_VERIFIED`, `contentValidationStatus:BASIC_SIGNATURE_VERIFIED` o `UNRECOGNIZED_TYPE`, `malwareScanStatus:NOT_SCANNED`. No se crea estado PENDING ni una promesa de scanner inexistente. El hash reportado por cliente se distingue como `clientReportedSha256`.

## Integridad de estados y concurrencia

Antes y dentro de la transacción se rechazan registros eliminados, desactivados, reemplazados o ya desplazados por otra versión. La transacción relee documento, perfil/rol/root, entidad, vínculo CSF si aplica, predecesor y documentos vigentes del mismo tipo/periodo. Una mutación del contrato de carga durante la lectura impide finalizar.

Dos finalizaciones simultáneas del mismo archivo son idempotentes si la generación/hash coinciden y sigue vigente. Dos cargas que compiten por reemplazar el mismo documento no pueden convertir ambas en versión actual: la consulta y el predecesor pertenecen al conjunto de lecturas transaccionales. Reemplazar marca la versión anterior inactiva y REPLACED; no se reactiva un registro pasado. La activación conserva el contrato active/FINALIZED requerido por la continuación CSF productiva.

## Verificación

`node --test qa/scripts/remediation-entity-upload.test.cjs`: **8/8 PASS**, con datos sintéticos y Firestore/Storage simulados:

- Hash exacto calculado, generación fija, metadatos de integridad y retry idempotente.
- Hash cliente falso, path/tamaño/MIME/metadata falsos, reemplazo de generación/metageneración y stream sobredimensionado rechazados.
- Borrado/desactivación/reemplazo y cambios concurrentes de perfil/entidad/contrato rechazados.
- Finalización concurrente del mismo documento sin duplicar vigencia.
- Predecesor cambiado o versión más nueva impiden finalización atrasada.
- Continuidad CSF admin/operador conservada; otros roots/clientes/creadores o permiso revocado deniegan, incluido cambio del intake durante la lectura.
- Dos reemplazos concurrentes del mismo predecesor producen exactamente una versión vigente.

Los tests usan guardias canónicas reales transpiladas y modelo transaccional optimista sintético. No sustituyen una prueba de reglas/emulador o GCS real. Build global reservado al responsable integrador; este subtrabajo avisó de fuente congelada después de las pruebas.

## Límites pendientes

- NOT_SCANNED significa que el documento puede seguir siendo malicioso. La firma y SHA verifican identidad/integridad, no seguridad.
- Firestore y GCS no comparten transacción. Se fija y registra generación exacta y se detectan cambios durante lectura, pero un actor con privilegio servidor puede sustituir/borrar el objeto después. Los consumidores futuros deben leer la generación registrada. Los consumidores actuales que solo usan path no quedan certificados.
- URLs de descarga existentes, parsers y `reactivateEntityDocumentCore` necesitan revisión específica; esta corrección solo impide que **finalize** resucite estados terminales. No pretende cerrar rutas alternativas.
- Aislamiento, límites de expansión/páginas/píxeles, aprobación de scanner y controles globales previos a consumo/descarga requieren otro lote.
- La compatibilidad de producción de exports no incluidos y el drift del parser CSF siguen pendientes; no desplegar módulos compartidos indiscriminadamente.

## Índices de la consulta vigente

Revisión del 9 de octubre: no hay índice compuesto `entityDocuments` en `firestore.indexes.json`; `gcloud firestore indexes composite list` filtrado por colección devolvió `[]`. `gcloud firestore indexes fields list --collection-group=entityDocuments` devolvió `[]` (sin exenciones de campo específicas). `gcloud firestore databases describe` filtrado confirmó STANDARD y FIRESTORE_NATIVE. No se ejecutó consulta contra documentos productivos.

La consulta usa únicamente igualdades de rootId, entityType, entityId, documentType, active e isCurrent, sin orderBy ni desigualdades. Firestore Standard permite combinar índices simples para múltiples igualdades; con índices automáticos sin exenciones observadas no requiere desplegar un compuesto nuevo. Es inferencia de metadatos y semántica documentada, no medición productiva de latencia. Fuente: [Index types in Cloud Firestore — index merging](https://firebase.google.com/docs/firestore/query-data/index-overview#index_merging).

## Siguiente lote ejecutable: parsers y análisis de seguridad de archivos

No activar bloqueos sobre archivos existentes para simular una cobertura que no existe. Ejecutar en este orden:

1. Inventariar consumidores por colección y path, incluyendo descargas URL, lectura CSF, documentos de solicitud/pago/dispersiones y reactivación. Por consumidor registrar generation requerida, tipo permitido, límite de bytes y privilegios del proceso. Criterio: cada lectura tiene un responsable y una prueba que rechace sustituir generation.
2. Implementar contrato de artefacto nuevo (`storageGeneration`, SHA servidor, estado de validación) y lector común de generación fijada. Integrar primero entityDocuments/CSF con pruebas aisladas; mantener artefactos legacy señalados explícitamente y sin promoción automática. Criterio: finalizar dos veces, borrar, reemplazar o reactivar no abre un objeto distinto.
3. Aislar parsers de PDF, imágenes, XML y archivos comprimidos en ejecutor de privilegio mínimo: sin credenciales IQ/Facturama/Telegram, límites de CPU/tiempo/memoria, páginas/píxeles/expansión, red de salida acotada y cancelación. Criterio: fixtures benignos malformados consumen presupuesto acotado y nunca continúan a una mutación financiera.
4. Elegir e integrar un scanner real con versión de motor/firmas registrada; solo entonces crear cola e introducir estados PENDING_SCAN/SCANNING/CLEAN/REJECTED/ERROR sobre nuevas generaciones. Veredicto vinculado a hash+generation+motor, consumo idempotente, timeout y reintento con presupuesto. Criterio: rechazo/error/no disponibilidad nunca produce CLEAN; replay y resultados de otra generación no promueven archivo.
5. Modo observación inicial: comparar firmas/veredictos y medir falsos positivos con datos autorizados minimizados. Los archivos existentes permanecen bajo su política vigente; no rellenar CLEAN ni bloquearlos por defecto. Criterio: informe de cobertura, tasas de error y capacidad de recuperación antes de aprobar enforcement.
6. Activar control de consumo para cargas nuevas de un único flujo con aprobación explícita y rollback probado. El guard de descarga/parser debe exigir autorización vigente y veredicto de la generación exacta; el scanner no decide permisos financieros. Criterio: tests de bypass en ruta directa, callable, legacy URL y trabajo diferido. Tratar URLs de Storage existentes como frontera separada.
7. Solo con evidencia suficiente planificar tratamiento de legacy: inventario, prioridad por exposición, lectura minimizada, ventana de análisis, manejo de errores y comunicación. No borrar ni cambiar estados productivos de manera masiva.

Pruebas transversales del siguiente lote: archivo diferente al preparado; metadata/hashes cliente falsos; decompression bomb controlada de tamaño pequeño; XML con entidades externas deshabilitadas; PDF con demasiadas páginas; imagen con dimensiones imposibles; caída del scanner; duplicación de tarea; resultado atrasado de generación anterior; usuario/root delegado revocado durante espera; rollback sin dar por seguro un archivo no analizado. Todas se ejecutan primero con fixtures locales y proveedores simulados, diferenciando simulación de un escaneo real.


Compatibilidad MIME verificada con una octava prueba: XML con/sin declaraci?n, JSON y ZIP vac?o conservan carga; binarios opacos quedan UNRECOGNIZED_TYPE, sin aparentar escaneo. Adaptaci?n S06 en worktree de integraci?n conserva ?ntegramente coverTaxpayerName/personFirstNames de main; el diff csfService respecto main agrega ?nicamente lector transaccional opcional al helper existente.
