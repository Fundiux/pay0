# Cotizaciones canónicas PAY0

Esta carpeta contiene las versiones visuales finales aprobadas de cotización por
empresa. Los PDFs son la referencia visual canónica: sirven para verificar
tipografía, layout, colores, estructura y campos esperados.

Para generación automática desde PAY0 no se debe editar el PDF manualmente. PAY0
debe usar una plantilla HTML/CSS versionada y generar una nueva instancia PDF
con datos operativos. El PDF de referencia permanece inmutable.

## Regla de capas

1. `*.pdf`: referencia visual aprobada.
2. `manifest.json`: contrato canónico entre empresa, versión, hash y campos.
3. `templates/base/template.html`: estructura generable.
4. `templates/base/template.css`: layout imprimible controlado.
5. PDF generado por PAY0: instancia operativa con su propio hash.

## Inmutabilidad

Una versión publicada no se sobrescribe. Si cambia logo, color, texto legal,
tipografía, estructura o campos, se crea una nueva versión (`v1.1`, `v2.0`,
etc.). Los documentos históricos deben conservar la versión exacta usada para
generarse.

## Estado actual

- Tipo documental: `COTIZACION`.
- Versión inicial registrada: `1.0`.
- PDFs canónicos registrados: 21.
- Empresa faltante: no se inventa; se agregará cuando exista su archivo final.

## Campos mínimos esperados

- `folio`
- `fecha`
- `vigencia`
- `cliente.nombre`
- `cliente.rfc`
- `cliente.contacto`
- `referenciaOc`
- `items`
- `subtotal`
- `iva`
- `total`
- `qr`
- `quotationId`
- `solicitudId`
- `materialidadId`
- `purchaseOrderId`
- `cfdiUuid`

## Trazabilidad

Cada cotización generada debe conservar:

- `templateId`
- `templateVersion`
- `referencePdfSha256`
- `templateBundleSha256`
- `documentSha256`
- `companyId`
- `companyRfc`
- `quotationId`
- vínculos a Solicitud, Materialidad, OC y CFDI cuando existan.

## Renderer PAY0

El primer renderer controlado vive en
`src/lib/cotizaciones/renderCotizacion.ts`. Su responsabilidad es:

- resolver la plantilla canónica por `companyId`, RFC o nombre;
- generar HTML imprimible con datos operativos;
- devolver el snapshot de plantilla que Materialidad debe conservar;
- dejar pendiente `documentSha256` hasta que el PDF final sea generado.

El renderer no debe sobrescribir PDFs de referencia ni mutar versiones
publicadas.
