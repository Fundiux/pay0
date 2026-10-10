# Descarga autorizada: generación fija, lote 1

Candidato aislado sobre integración `a276e03`. Sólo cambia el callable
`getAuthorizedDocumentDownloadUrl`; no cambia frontend, resolver, opciones de
despliegue, IAM ni transporte POST/blob. No se ha desplegado.

## Contrato y límites

Se conserva entrada `{uploadId}` y salida `{ok:true,uploadId,url,
expiresInSeconds:300}`. La URL HTTPS sigue admitiendo los consumidores históricos
`window.open`, enlaces y `fetch` sin cabeceras de sesión. Ahora se firma con V4:
la generación está dentro del mensaje firmado y no puede cambiarse o retirarse
conservando una firma válida. No es un proxy ni revocación por cada GET.

El resolver autoriza antes del acceso a Storage. Si Firestore declara generación,
el GET de metadatos la selecciona explícitamente; un 404 no cae a la versión
actual. Si la generación anterior sigue conservada, puede firmarse con autoridad
actual aunque exista una posterior. Para históricos sin generación, una lectura
de metadatos obtiene la actual y la fija únicamente para esta URL. No escribe
Firestore, no rellena históricos y no afirma integridad histórica.

Se comprueban bucket, nombre y generación exactos. Las generaciones se manejan
como cadenas decimales positivas de hasta 20 dígitos; metadatos numéricos,
malformados o inconsistentes fallan cerrados. Se revalida después de metadatos la
autoridad actual y la revisión/ruta/generación declarada. Un reemplazo posterior
no cambia qué bytes identifica la URL; borrar la generación puede hacerla fallar.
Permanece la ventana entre la última revalidación y la firma, y una URL emitida
sigue siendo bearer hasta vencer. El stream autenticado tiene su política actual
de comparar con la generación más reciente; este lote no la cambia.

## Detalles del SDK que deben conservarse

`@google-cloud/storage` 7.22.0 convierte `File({generation:string})` a `Number`; por eso
se crea File sin generación y se pasa la cadena a las opciones de metadatos y a
`queryParams.generation` del signer. El SDK reenvía opciones de metadatos a la
query HTTP; el test intercepta el transporte después de esa construcción.
No se usa una instancia File con generación que pueda sobrescribir esa query.
En el SDK instalado el signer V2 añade queryParams después de construir su
mensaje firmado; V4 incorpora la query canónica en la firma. Referencias:
[solicitudes canónicas V4](https://docs.cloud.google.com/storage/docs/authentication/canonical-requests),
[firma V4](https://docs.cloud.google.com/storage/docs/access-control/signing-urls-manually),
[URLs firmadas](https://docs.cloud.google.com/storage/docs/access-control/signed-urls).

## Evidencia local preparada

`remediation-document-generation-pin.test.cjs` usa el signer real del SDK con una
clave RSA efímera y cuenta/proyecto ficticios, todo en memoria. Ninguna clave,
URL o identificador real se imprime o guarda. HTTP/HTTPS/fetch están bloqueados;
el transporte de metadatos es sintético. La firma se verifica por separado con
la clave pública, y se rechaza tras cambiar/quitar generación. Incluye valor
`9007199254740993` (mayor que 2^53), selección histórica explícita, ausencia de
backfill, 404 sin fallback, incoherencias, errores sanitizados y carreras antes
de firma. Las 13 regresiones previas de autoridad/wrappers se adaptaron de
`exists` a metadatos, manteniendo sus aserciones.

Tras liberarse la ventana de CPU: **22/22** pruebas nuevas y **13/13** regresiones
PASS, cero acciones externas. Build Functions **PASS** (exit 0). No hay evidencia
nueva de producción ni prueba de IAM/signBlob real.
La firma usa los permisos ya necesarios para el signer existente; no se propone
ningún permiso nuevo. Antes de publicación: pruebas enfocadas, build Functions,
revisión de runtime/env/source desplegados y lote selectivo de este único export.
Los cambios de formato de URL deben tratarse como opacos; ningún caller revisado
interpreta GoogleAccessId/Signature ni depende de V2.

Comandos en el worktree aislado (la variable sólo selecciona dependencias locales):

```powershell
$env:PAY0_FUNCTIONS_DEPS_ROOT='C:/Users/ebarr/Desktop/pay0-system'
node qa/scripts/remediation-document-generation-pin.test.cjs
node qa/scripts/remediation-legacy-download-authority.test.cjs
Push-Location functions; npm run build; Pop-Location
```
