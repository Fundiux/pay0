# Descarga autorizada: preflight de runtime y recuperación

Lectura de metadatos el 2026-10-10 a las 18:07:43 UTC, sin documentos/clientes,
bytes de archivos de usuario ni invocaciones de negocio. No despliegue, permisos
nuevos, integración ni modificación de entorno. Candidato funcional `b77765a`
sobre `a276e03`, en worktree aislado `document-generation-pin-20261010`.

## Runtime observado

Único export `getAuthorizedDocumentDownloadUrl`, proyecto `pay-0-system`, región
`us-central1`, ACTIVE. Revisión `getauthorizeddocumentdownloadurl-00004-vat`,
actualizada 2026-10-09T23:03:00.551536764Z; generación fuente
`1791586901568255`. Node22, timeout30s, memory256Mi, CPU1, maxInstances20,
concurrency80. MinInstanceCount ausente/null; ingress ALLOW_ALL; VPC y egress
ausentes/null. Cuenta `751158244178-compute@developer.gserviceaccount.com`.
Sin secretEnvironmentVariables ni secretVolumes.

Entorno de usuario tiene **dos** nombres: `PAY0_FIREBASE_WEB_API_KEY` y
`TELEGRAM_DOWNLOAD_TRANSPORT_MODE`. Ambos valores son idénticos en memoria a la
dotenv de integración restaurada, hash general
`572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856`.
No se imprimieron/guardaron valores. No hay claves diferentes, remotas exclusivas
ni locales exclusivas. No reutilizar ciegamente el scope public-key-only del
helper Hugo/document-core: esta función conserva ambas claves.

Primera comparación con la función estricta de Hugo rechazó el nombre adicional
con `REMOTE_ENV_KEY_UNREVIEWED`; después se compararon únicamente nombres y
igualdad en memoria. No ocurrió ninguna mutación.

## Artefactos exactos preservados

Fuente `gs://gcf-v2-sources-751158244178-us-central1/getAuthorizedDocumentDownloadUrl/function-source.zip#1791586901568255`
preservada en `.firebase/authorized-download-preflight/getAuthorizedDocumentDownloadUrl-1791586901568255.zip`.
SHA256 `be851c99522e3f2b9399bbc3c3d9e18425a5264b6b1de0b7b2a0942e14343606`.
La descarga inicial por wrapper PowerShell abortó por stderr/progreso; la
recuperación verificó ausencia de archivo antes de descargar con captura nativa,
sin sobrescritura de backups. ZIP válido, salida sólo estado/hash.

Se conserva además el backup anterior `TEMP/pay0-remediation-20261009-sources/getAuthorizedDocumentDownloadUrl-pre-bridge.zip`,
SHA256 `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
El antiguo backup precede las guardas actuales; no es rollback equivalente.

Sólo se abrieron tres entradas TypeScript del ZIP, nunca `.env`, credenciales ni
configuración privada. Los ZIP completos permanecen ignorados y privados.

| Entrada | SHA256 bytes desplegados | Comparación con candidato |
| --- | --- | --- |
| src/modules/documents/authorizedDownload.ts | af59008ffd8fb189024207f68a375bb2c06ac939971fcc93aae6e6d526e8da7b | Sólo lote generation/V4 antes del ajuste de opciones |
| src/modules/documents/downloadAccess.ts | 218a0abc8566cd08111f40db2e4e66d7b929687d2015d3d0b7f9fe26bb36eede | Idéntico normalizando CRLF/LF |
| src/modules/documents/documentDownloadHttp.ts | eff57242036292c72d45f1f91b723f7c8c81eaf91083c34718c9a5fa66b6c9ce | Idéntico normalizando CRLF/LF |

## Opciones y gates

El callable omitía preservación/max/concurrencia. El ajuste separado conserva
timeout30 y memory256, añade `preserveExternalChanges:true`, `maxInstances:20`,
`concurrency:80`, igual a lo observado. No se fijan min/ingress/VPC/SA con valores
inventados. La nueva prueba AST + SDK/CLI real confirmó máscaras sin resets
de campos omitidos, y control negativo sin preservación: **24 aserciones PASS**
(SDK7.3.2/CLI15.3.1, red bloqueada). Se ejecutó tras liberar la pausa CPU de IQ.
Nuevo build Functions con estas opciones **PASS**, exit0; no se reutilizó como
evidencia el build anterior de `b77765a`.

Pendiente publicación selectiva futura, no autorizada por este documento:
revalidar pins/runtime/env/secret bindings inmediatamente antes; preservar ambas
claves mediante backup/CAS/journal; revisar field masks; SDK/CLI test y build;
postflight de configuración/revisión/generación. No invocar descargas reales.
El lote generation no elimina el bearer300s ni permite revocación por cada GET.
