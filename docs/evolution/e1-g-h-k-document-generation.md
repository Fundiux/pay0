# G/H/K — identidad de objetos en descargas autorizadas

Base de trabajo: `bf64cde52aa0`, rama `feature/pay0-global-evolution-20261019`.
Estado: compilación Functions NORMAL y nueve pruebas aprobadas; en preparación
de artefacto sobre la fuente productiva. Sin despliegue de este cambio.

## Capacidad recuperada y alcance

La rama documental contiene `bb5efae9bb87` (adaptador de streaming) y su
precursor `b77765a` (firma ligada a generación exacta). El adaptador depende de
un subsistema de capacidades que no existe en esta base. No se importó ese
subsistema ni sus cambios de rutas, permisos o despliegue.

Se adaptó únicamente el contrato de identidad de objeto de `b77765a` al callable
actual `getAuthorizedDocumentDownloadUrl`. Antes se comprobaba la existencia
de una ruta y se firmaba una URL sin fijar su generación. Una sobrescritura de
esa ruta podía cambiar el documento que recibía la URL ya emitida.

Ahora `generationBoundDownload.ts` lee metadata y firma V4 con la generación
exacta como parámetro de consulta autenticado. `storageGeneration` se toma del
upload autorizado en servidor; los datos de generación enviados por el
navegador se ignoran. Los IDs se conservan como strings, incluyendo valores
mayores que 2^53. Nunca se usa la opción numérica de generación de `File`.
Un documento legado sin generación guardada fija la generación observada en
una sola lectura, sin backfill ni escritura. Un objeto declarado inexistente
produce `not-found`, sin buscar otra generación como reemplazo.

Se conservan comprobaciones de autenticación, permisos, root, padre, delegación,
estado y prefijo de ruta existentes. El resultado sigue siendo
`{ok, uploadId, url, expiresInSeconds: 300}`. Sólo cambia el firmador por defecto;
los firmadores inyectados para pruebas siguen siendo compatibles.

Archivos runtime: `documents/authorizedDownload.ts` y nuevo
`documents/generationBoundDownload.ts`. Búsqueda de referencias: el único
consumidor runtime es su reexport en `functions/src/index.ts`; endpoint afectado
directo único: `getAuthorizedDocumentDownloadUrl`. No se modificó el index.

## Evidencia local

`node --test qa/scripts/generation-bound-download.test.cjs`: 9/9 PASS.
Pruebas con el SDK Storage instalado y llave RSA efímera sintética, red
bloqueada: query textual exacta, validación criptográfica V4, alteración de
generación invalida la firma, compatibilidad legacy, metadata inconsistente,
generación malformada, denegación por root/estado/permisos antes de firma,
composición real core + firmador y clasificación 404/sanitización.

`node scripts/verify-authorization-policy.mjs`: PASS.
`node scripts/verify-capability-registration.mjs`: baseline acumulativo y cuatro
registros canónicos PASS. `git diff --check`: PASS para este cambio.

El coordinador confirmó compilación Functions NORMAL y repitió las nueve
pruebas satisfactoriamente. Se consultó la fuente productiva en modo lectura
para construir un parche mínimo; no se cambió producción. Una publicación, si se autoriza después,
requiere reconciliar el callable productivo y preparar su artefacto exacto;
la presencia del contrato en una rama no demuestra que esté publicado.
