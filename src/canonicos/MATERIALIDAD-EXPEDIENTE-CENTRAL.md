# Materialidad 2.0 — Expediente central de operación

Materialidad no sustituye Solicitudes, Pagos, Wallet, Facturama, IQ ni
documentos. Materialidad es el expediente central que referencia y ordena la
evidencia creada por esos módulos.

## Fuente técnica

- Manifiesto frontend consumible: `src/canonicos/materialidad.ts`.
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
