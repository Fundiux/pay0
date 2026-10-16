# Artefacto mínimo para el guard histórico del receipt IQ

Estado: candidato offline para revisión, sin commit ni despliegue. Base Git:
`0b50559530d334120076c2ec371bd2b8030b93ea`. La base organiza el artefacto y las
pruebas; no se afirma que su runtime completo sea igual al publicado.

## Cambio representado

El parche se aplica exclusivamente a la fuente archivada de
`applyPaymentAutomaticallyOnReceipt`: una importación de
`isIqHistoricalImport` y una condición adicional antes de aplicar el pago.
Las otras tres exportaciones y el resto de la función permanecen iguales.
El predicado de 760 bytes procede del commit
`884e4b253210f0f938c2c41540d9d7993ce677a2`.

Los archivos nuevos son dos fixtures, un helper puro de emisión/ZIP, dos
pruebas y este documento. No cambian `functions/src`, exports, configuración,
paquetes, reglas ni productores. No se incorporan ZIP, dotenv, respuestas
remotas, credenciales, artefactos compilados ni rutas absolutas de usuario.

## Entradas y verificaciones

- ZIP original SHA256:
  `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
- TypeScript 5.9.3, archivo compilador SHA256:
  `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`.
- Predicado canónico SHA256:
  `26246a4c8841ea005993ffda182105cc8340e8b7a6637bfad6e671b2a2b188b7`.

Las rutas del archivo histórico y del compilador son entradas explícitas,
nunca defaults a un workspace ajeno. Si faltan o no coinciden los hashes, el
gate falla; no salta pruebas ni sustituye fuentes integradas. El helper carga
el compilador fijado, pero nunca requiere módulos JavaScript del ZIP.

Antes del cambio, `createProgram` sobre un filesystem virtual reproduce
exactamente JS y source map originales. Después, una comprobación AST limita
el cambio a la importación y la condición. El patch unificado debe coincidir
con el generado por esas dos operaciones; los seis resultados tienen hashes
esperados explícitos. El predicado y patch de Git aceptan únicamente la
conversión de checkout CRLF a LF, documentada; el ZIP y sus fuentes nunca se
normalizan. Esa conversión no permite otras alteraciones de whitespace.

La referencia AST portable contiene la condición canónica explícita, en lugar
de ejecutar `git show` contra una rama externa. El hash de la fuente de
referencia de 884e permanece como procedencia histórica; las garantías
ejecutables son AST, patch exacto, predicado fijado y seis hashes emitidos.
Los campos parserExtractionProvenanceSha256 y
reviewedReferenceSourceProvenanceSha256 son procedencia, no verificaciones
contra archivos externos en runtime. Las banderas compiledTestsExecuted y
typecheckCompleted del manifest describen la generación; una prueba posterior
no las convierte retroactivamente en una certificación de ejecución o tipos.

## ZIP y límites

El parser extraído es puro: inspecciona directorio central, rutas, duplicados,
tipos, tamaños, CRC declarado, descriptores y solapamientos. No se importa el
verificador privado completo. El repacker es una función en memoria, sin
escrituras ni ruta de publicación: 1081 entradas originales pasan a 1084,
con tres sustituciones y tres adiciones. Los 1078 registros locales retenidos
se copian literalmente; sus registros centrales sólo cambian el offset.

Máximos: ZIP 16 MiB, entrada del overlay 2 MiB, overlay agregado 8 MiB y
expansión declarada total 32 MiB. La verificación del repack infla sólo seis
entradas; el emisor lee las fuentes TS y metadatos de compilación acotados.
Ninguna operación infla dotenv ni carga `index`. Preservar CRC/datos
comprimidos retenidos no equivale a reverificar todos sus bytes expandidos.

No se ofrece CLI de escritura de ZIP ni helper de release en este candidato.
El artefacto privado ya revisado obtuvo 1084/1078/6 y ZIP SHA256
`1069019437327e8bf38c848721132a91f8721ae48c4ec75e772ad9e0bd32c643`;
ese resultado histórico no sustituye las pruebas del helper portable nuevo.

## Comandos offline

Prueba ZIP independiente de archivos privados o dependencias instaladas:

```powershell
node --test qa/scripts/remediation-iq-receipt-zip-overlay.test.cjs
```

El gate de fuente requiere dos rutas locales explícitas en el entorno del
proceso: `PAY0_IQ_RECEIPT_ARCHIVE` y `PAY0_IQ_RECEIPT_COMPILER`. No son variables
de runtime ni se escriben a dotenv. Con esas entradas fijadas:

```powershell
node --test qa/scripts/remediation-iq-receipt-source-overlay.test.cjs
```

Para emitir sólo el manifest seguro a stdout, sin escribir artefactos:

```powershell
node scripts/lib/iq-receipt-source-overlay.cjs --archive <archivo-local> --compiler <typescript.js-local>
```

La prueba de fuente ejecuta sólo los módulos compilados seleccionados dentro
de un harness con imports cerrados y puertos simulados. Verifica observaciones
ordinarias equivalentes y cero aplicaciones históricas. No demuestra tipos
completos, SDK real, permisos efectivos, concurrencia financiera ni proveedor.

## Release y recuperación pendientes

El release requerirá revisión separada: snapshot fresco Function/Run/IAM/
generación, código de upload verificado y PATCH con máscara explícita de
fuente. `GOOGLE_NODE_RUN_SCRIPTS` debe permanecer vacío; sin ello el build
predeterminado podría reemitir fuentes e invocar un script externo ausente.
El build cloud aún instala dependencias y genera una imagen; igualdad del ZIP
no acredita identidad de imagen ni prueba de ejecución del handler.

La etiqueta `firebase-functions-hash` antigua quedaría obsoleta. La propuesta
es invalidar sólo esa etiqueta mediante máscara `labels`, conservando el
resto del mapa fresco, sin inventar otro hash. No hay garantía CAS documentada
entre lecturas y PATCH. Nada de esto está implementado en este artefacto.

Un fallo incierto requiere reconciliar la operación antes de cualquier nueva
acción. No existe rollback automático al ZIP original: reintroduciría el
defecto. Una reparación posterior debe conservar el guard. Las invocaciones
antiguas ya en vuelo y la coexistencia de otros productores siguen siendo
límites independientes; este parche no declara resuelta esa carrera global.

Referencias oficiales: [buildpacks Node.js](https://docs.cloud.google.com/docs/buildpacks/nodejs),
[PATCH GCF v2](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch),
[generateUploadUrl](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl).

## Evidencia local del candidato

ZIP sintético: 12/12 PASS, sin skips, salida final `74539b`. Gate de fuente
portable: 26/26 PASS, sin skips, salida `609881`. Incluye el ZIP real fijado:
parser, emisión y repacker reproducen en memoria el SHA
`1069019437327e8bf38c848721132a91f8721ae48c4ec75e772ad9e0bd32c643`,
6.054.892 bytes, 1.084 entradas, 1.078 retenidas y seis cambiadas.
No instalación de dependencias, build de Functions,
emulador, red, repack escrito ni mutación productiva en este worktree.
