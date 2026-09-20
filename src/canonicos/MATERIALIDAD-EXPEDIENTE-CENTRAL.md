# Materialidad 2.0 — Expediente central de operación

Materialidad no sustituye Solicitudes, Pagos, Wallet, Facturama, IQ ni
documentos. Materialidad es el expediente central que referencia y ordena la
evidencia creada por esos módulos.

## Fuente técnica

- Manifiesto frontend consumible: `src/canonicos/materialidad.ts`.
- Catálogos SAT y trazabilidad fiscal: `src/canonicos/SAT-CATALOGOS-TRAZABILIDAD.md`.
- Cotizaciones canónicas por empresa: `src/canonicos/formatos/cotizaciones/manifest.json`.
- Constancias canónicas por empresa: `src/canonicos/formatos/CONSTANCIAS/PAY0_CONSTANCIAS_CANONICAS_REGENERADAS_FINAL`.
- Validación backend estricta: `functions/src/modules/materiality/domain.ts` y
  `functions/src/modules/solicitudDocuments/domain.ts`.
- Documentos físicos: Storage bajo la ruta autorizada de Solicitudes.
- Expediente operativo: Firestore `materialityOperations`.
- Carpeta cliente/empresa: Firestore `materialityClientCompanies`.

## Regla central

Cada operación debe conservar `rootId`, `clienteId`, `companyId`, `solicitudId`,
vínculo a documentos autorizados, estado de materialidad calculado y faltantes
visibles por tipo canónico.

No se duplican archivos. Materialidad guarda referencias, sellos, estado y
clasificación.

## Familias de evidencia

1. Ingreso: Orden de Compra, Cotización, Presupuesto.
2. CFDI emitido: Factura XML/PDF.
3. Cobranza: Comprobante de Pago, Complemento de Pago XML/PDF.
4. Gasto relacionado: CFDI de Gasto XML/PDF, Solicitud de Gasto Relacionada.
5. Banco: Comprobante de Transferencia, Estado de Cuenta.
6. Operación: Contrato, Autorización, Acuse y Evidencia de Entrega.

## Regla para empresas propias

Solo una empresa propia puede emitir CFDI desde PAY0. Hoy Trostre se reconoce por
RFC `TRO230717L64`; las siguientes empresas propias deberán marcarse en catálogo
con bandera explícita de propiedad antes de facturar.

Una OC de empresa propia puede detonar Solicitud, expediente de Materialidad,
borrador CFDI y ciclo financiero ingreso → gasto relacionado pendiente.

La solicitud de gasto automática queda bloqueada hasta tener reglas fiscales,
operativas y de autorización aprobadas.

## Formatos canónicos

Los formatos generados fuera del sistema deben registrarse aquí como versión
canónica antes de ser usados por operación. Si cambia un formato, se crea una
nueva versión; no se muta silenciosamente la anterior.

## Cotizaciones canónicas

Las cotizaciones aprobadas viven como PDFs de referencia en
`src/canonicos/formatos/cotizaciones/`. PAY0 no debe editar esos PDFs para
operación diaria. Para generar una cotización automática debe resolver la
plantilla por empresa desde el manifiesto canónico, usar HTML/CSS versionado y
conservar en el expediente:

- `templateId`;
- `templateVersion`;
- `referencePdfSha256`;
- `templateBundleSha256`;
- `documentSha256` de la instancia generada;
- vínculos a Solicitud, Materialidad, OC y CFDI cuando existan.

La evidencia de Materialidad conserva referencias y hashes; no duplica el PDF
en otra carpeta ni sobrescribe versiones publicadas.

## Firma, descarga y constancia final

Toda cotización generada automáticamente por PAY0 debe guardarse también como
documento de Solicitud tipo `COTIZACION`, para que pueda descargarse, enviarse al
cliente y convertirse en evidencia del expediente de Materialidad.

Si el cliente firma manualmente, el documento resultante se registra como
`COTIZACION_FIRMADA`.

Cuando exista autorización expresa para firma automática, PAY0 deberá conservar
la evidencia de autorización como `FIRMA_AUTORIZADA_CLIENTE` antes de insertar
firma en cotizaciones o constancias. La firma almacenada no debe ser tratada como
permiso universal: debe estar vinculada a cliente, persona autorizada, alcance,
vigencia, revocación y bitácora.

El documento final de cierre operativo será
`CONSTANCIA_RECEPCION_SATISFACCION`. Ese documento debe identificar quién es la
persona autorizada para aprobar recepción/satisfacción, conservar la política de
no reclamos aplicable y quedar vinculado al expediente material, Solicitud,
cotización, OC y CFDI cuando existan.

Las constancias operativas deben resolver plantilla por empresa desde
`PAY0_CONSTANCIAS_CANONICAS_REGENERADAS_FINAL`. Ese paquete es la fuente única:
los ZIP separados de entrega de bienes y servicios son copias parciales para
revisión, no fuentes independientes.

La firma capturada en celular se guarda primero como documento de Solicitud tipo
`FIRMA_AUTORIZADA_CLIENTE`. La constancia final debe referenciar esa evidencia,
el responsable receptor, cargo, fecha/hora, OC, cotización, CFDI/UUID, folio IQ,
hash del expediente y URL de verificación.

Antes de sellar `CONSTANCIA_RECEPCION_SATISFACCION`, PAY0 debe incluir una
declaración expresa de recepción, conformidad y no reclamación posterior, salvo
observaciones asentadas en el propio documento antes de la firma.
