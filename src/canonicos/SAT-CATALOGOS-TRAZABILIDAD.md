# PAY0 — Catálogos SAT y trazabilidad fiscal

Este documento agrega el requisito de trazabilidad para Materialidad 2.0 /
Facturama sin crear una arquitectura paralela. La regla es que Facturama,
Solicitudes, OC/OS y Materialidad consuman los mismos catálogos y snapshots
fiscales.

## Estado actual auditado

- Materialidad ya existe como expediente central de referencia:
  `materialityOperations`, `materialityClientCompanies`,
  `functions/src/modules/materiality/*`, `src/app/materialidad/*` y
  `src/canonicos/materialidad.ts`.
- Facturación ya existe en modo sandbox/borrador:
  `src/app/facturacion/page.tsx`, `src/services/facturama.ts` y
  `functions/src/modules/facturama/*`.
- El borrador CFDI actual acepta `productCode`, `unitCode`, `unit`,
  `taxObject`, descripción, cantidad y precio, pero todavía no valida esos
  campos contra catálogos SAT globales ni contra un catálogo autorizado por
  empresa.
- No se encontró una capa existente equivalente a:
  1. catálogo global SAT de productos/servicios,
  2. catálogo global SAT de unidades,
  3. catálogo autorizado por empresa para facturación.
- Sí existen catálogos operativos no equivalentes: empresas, despachos, costos
  por despacho, tipos de operación e integraciones IQ. No deben reutilizarse
  como catálogo fiscal SAT.

## Tres capas obligatorias

PAY0 debe separar estrictamente estas capas:

1. Catálogo global SAT de productos/servicios
   - Fuente autorizada para `ClaveProdServ`.
   - Controlado por Superadmin/importación oficial.
   - No editable por operación normal.
   - No reescribe operaciones históricas.

2. Catálogo global SAT de unidades
   - Fuente autorizada para `ClaveUnidad`.
   - Controlado por Superadmin/importación oficial.
   - No editable desde Solicitudes, OC, OS, CFDI ni catálogo de empresa.

3. Catálogo autorizado por empresa
   - Lista de productos/servicios que cada empresa propia puede facturar.
   - Referencia claves existentes en los catálogos globales SAT.
   - Se importa desde Excel canónico por empresa.
   - No se expande automáticamente por cargar una OC/OS.

## Modelo conceptual de colecciones

Propuesta inicial, pendiente de aprobación antes de implementar:

```text
satProductServiceCatalog/{claveProdServ}
satUnitCatalog/{claveUnidad}
companyInvoiceCatalogImports/{importId}
companies/{companyId}/invoiceCatalog/{entryId}
materialityOperations/{operationId}
facturamaInvoices/{invoiceId}
```

Identidad canónica obligatoria:

- `companyId` debe ser la misma identidad usada por Empresas, Solicitudes,
  Materialidad y Facturama.
- RFC, nombre fiscal, `facturamaIssuerId` o alias comerciales no sustituyen a
  `companyId`.
- Las empresas propias deben tener bandera/configuración explícita para emitir
  CFDI. Trostre es la primera empresa propia conocida por RFC `TRO230717L64`,
  pero nuevas empresas propias no deben requerir cambios de código.

Campos mínimos por capa:

### `satProductServiceCatalog/{claveProdServ}`

- `key`
- `officialDescription`
- `status`
- `validFrom`
- `validTo`
- `source`
- `sourceVersionDate`
- `importedAt`
- `importedBy`
- `active`

### `satUnitCatalog/{claveUnidad}`

- `key`
- `officialName`
- `officialDescription`
- `symbol`
- `status`
- `validFrom`
- `validTo`
- `source`
- `sourceVersionDate`
- `importedAt`
- `importedBy`
- `active`

### `companies/{companyId}/invoiceCatalog/{entryId}`

- `rootId`
- `companyId`
- `internalCode`
- `name`
- `description`
- `aliases`
- `satProductServiceKey`
- `satProductServiceSnapshot`
- `satUnitKey`
- `satUnitSnapshot`
- `taxObject`
- `taxConfiguration`
- `active`
- `catalogVersion`
- `sourceImportId`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`

## Flujo de importación obligatorio

Ninguna importación de Excel debe escribir producción en el upload inicial.

```text
UPLOAD
→ PARSE
→ VALIDATE
→ VALIDATION REPORT
→ PRIVILEGED CONFIRMATION
→ COMMIT
```

El reporte debe incluir:

- total de filas,
- válidas,
- warnings,
- errores,
- nuevas entradas,
- descripciones actualizadas,
- desactivaciones,
- cambios de clasificación fiscal,
- claves SAT desconocidas,
- unidades desconocidas,
- duplicados.

Si existen errores en campos fiscales protegidos, no se hace commit.

## Regla de snapshot histórico

Cada operación fiscal debe conservar su propio snapshot inmutable:

- clasificación fiscal usada,
- clave SAT usada,
- unidad SAT usada,
- objeto de impuesto,
- configuración fiscal,
- versión del catálogo de empresa,
- versión/fuente del catálogo SAT global,
- usuario/proceso que resolvió la clasificación,
- confianza de clasificación cuando aplique.

Actualizar un catálogo SAT o un catálogo de empresa nunca debe modificar CFDIs,
operaciones de Materialidad ni Solicitudes históricas.

El snapshot fiscal no es duplicación documental. Materialidad no copia PDF, XML,
OC, comprobantes ni evidencias; guarda referencias a documentos. En cambio, sí
congela los datos fiscales necesarios para explicar la decisión histórica.

### Estructura mínima del snapshot fiscal

```ts
fiscalSnapshot: {
  schemaVersion: 1,
  capturedAt: Timestamp,
  capturedBy: string,
  source: "OC" | "OS" | "MANUAL" | "SOLICITUD",

  issuer: {
    companyId: string,
    rfc: string,
    legalName: string,
    fiscalRegime: string,
    postalCode: string,
  },

  receiver: {
    rfc: string,
    legalName: string,
    fiscalRegime: string,
    fiscalPostalCode: string,
    cfdiUse: string,
  },

  document: {
    currency: string,
    exchangeRate?: number,
    paymentMethod: "PUE" | "PPD",
    paymentForm: string,
    exportCode?: string,
    series?: string,
    folio?: string,
  },

  concepts: [
    {
      sourceLineId?: string,
      claveProdServ: string,
      claveProdServDescription: string,
      claveUnidad: string,
      claveUnidadDescription: string,
      objetoImp: string,
      description: string,
      quantity: number,
      unitPrice: number,
      discount: number,
      subtotal: number,
      taxes: {
        transfers: unknown[],
        withholdings: unknown[],
      },
      total: number,
      companyCatalogEntryId: string,
      companyCatalogVersion: string,
      classification: {
        method: "EXPLICIT" | "COMPANY_CATALOG" | "AUTO_SUGGESTED" | "MANUAL_REVIEW",
        confidence: number | null,
        reviewedBy: string | null,
        reviewedAt: Timestamp | null,
      },
    }
  ],

  totals: {
    subtotal: number,
    discount: number,
    transferredTaxes: number,
    withheldTaxes: number,
    total: number,
  },

  catalogEvidence: {
    satProductCatalogVersion: string,
    satUnitCatalogVersion: string,
    companyCatalogImportId: string,
    companyCatalogEntryIds: string[],
  },
}
```

Una vez que el borrador entra a un estado fiscal cerrado, el snapshot no se
sobrescribe. Cualquier corrección fiscal crea una nueva revisión/version.

## Relación Materialidad ↔ documentos fiscales

No debe imponerse relación 1:1 entre operación material y factura. Una operación
puede tener anticipo, PPD, complemento de pago, sustitución, cancelación o más de
un CFDI.

Materialidad debe modelar documentos fiscales relacionados como arreglo:

```ts
fiscalDocuments: [
  {
    type: "CFDI_INGRESO" | "CFDI_EGRESO" | "COMPLEMENTO_PAGO" | "CFDI_RELACIONADO",
    invoiceId: string,
    uuid?: string,
    relationType?: string,
    status: string,
  }
]
```

La fuente técnica/fiscal completa vive en `facturamaInvoices/{invoiceId}`; el
expediente transversal vive en `materialityOperations/{operationId}`.

## Referencias documentales en Materialidad

`materialityOperations` guarda referencias y sellos, no archivos duplicados:

```ts
references: {
  solicitudId?: string,
  paymentIds?: string[],
  walletEventIds?: string[],
  iqIds?: string[],
  facturamaInvoiceIds?: string[],
  documentRefs?: [
    {
      documentId: string,
      storagePath: string,
      sourceModule: string,
      sourceEntityId: string,
      hash?: string,
      canonicalType: string,
    }
  ],
}
```

## Regla para OC/OS y Facturama

Cuando una OC/OS trae clave SAT:

1. Validar que exista en catálogo global SAT.
2. Validar que esté autorizada para la empresa emisora.
3. Validar unidad.
4. Validar compatibilidad con el producto/servicio autorizado.

Si la clave existe globalmente pero no está autorizada para esa empresa, el
sistema debe bloquear con:

```text
COMPANY_SAT_KEY_NOT_AUTHORIZED
```

Si la OC/OS no trae clave SAT, PAY0 puede proponer clasificación únicamente
desde el catálogo autorizado de la empresa. Si hay ambigüedad:

```text
SAT_CLASSIFICATION_REVIEW_REQUIRED
```

PAY0 nunca debe ampliar automáticamente el catálogo autorizado de una empresa.

## Motor fiscal backend único

Las reglas fiscales deben vivir en un servicio backend único consumido por:

- Facturama,
- importación de OC/OS,
- Solicitudes,
- Materialidad,
- futuras automatizaciones de empresas propias.

Ese motor debe responder estados explícitos:

```text
VALID
SAT_KEY_INVALID
SAT_UNIT_INVALID
COMPANY_SAT_KEY_NOT_AUTHORIZED
SAT_CLASSIFICATION_REVIEW_REQUIRED
```

No deben existir tres implementaciones separadas de la misma validación fiscal.

## Idempotencia y máquina de estados

Una misma OC/OS o documento fuente no debe crear múltiples operaciones,
expedientes o borradores por doble clic, reintento de Cloud Function o trigger
duplicado.

La clave idempotente debe derivarse de datos canónicos, por ejemplo:

```text
companyId + sourceDocumentId + sourceDocumentVersion + operationType
```

No se debe automatizar todo como una cadena implícita de triggers. PAY0 debe
usar estados explícitos y recuperables:

```text
UPLOADED
PARSED
FISCAL_VALIDATION_PENDING
FISCAL_VALIDATED
MATERIALITY_DOSSIER_READY
FACTURAMA_DRAFT_READY
READY_TO_STAMP
STAMPED
REVIEW_REQUIRED
FAILED
```

Timbrado real queda bloqueado hasta que la operación llegue a un estado
explícito aprobado.

## Trazabilidad administrativa

Debe quedar auditado:

- importación/actualización SAT global,
- importación de catálogo por empresa,
- usuario que validó,
- usuario que confirmó,
- versión anterior,
- versión nueva,
- entradas agregadas,
- entradas desactivadas,
- cambios fiscales protegidos,
- hash del archivo fuente,
- ruta Storage del Excel fuente,
- timestamp.

El Excel fuente de cada import confirmado debe preservarse como evidencia
administrativa de configuración.

## Checklist maestro pendiente

- BE. Importar catálogo global SAT Producto/Servicio.
- BF. Importar catálogo global SAT Unidad.
- BG. Rechazar archivo SAT inválido.
- BH. Subir Excel canónico de empresa.
- BI. Mostrar preview de validación de Excel de empresa.
- BJ. Rechazar clave SAT desconocida.
- BK. Rechazar unidad desconocida.
- BL. Aceptar clave SAT autorizada.
- BM. Rechazar clave globalmente válida pero no autorizada para empresa.
- BN. Preservar históricos al actualizar catálogo SAT.
- BO. Preservar snapshots históricos al actualizar catálogo de empresa.
- BP. Buscar catálogo SAT grande sin cargarlo completo al navegador.
- BQ. Auditar importaciones.
- BR. Preservar hash y versión del Excel fuente.
- BS. Bloquear empresa `READY_TO_INVOICE` con catálogo incompleto.
- BT. Validar identidad canónica de empresa emisora.
- BU. Preservar snapshot fiscal completo por CFDI y concepto.
- BV. Soportar relación Materialidad ↔ CFDI 1:N.
- BW. Evitar creación duplicada por doble clic/reintento/trigger.
- BX. Bloquear mutación de snapshot fiscal cerrado.
- BY. Resolver clasificación solo con motor fiscal backend único.
- BZ. Exigir revisión humana cuando la clasificación sea ambigua.

## Índices previsibles, no crear sin consulta real

No crear índices "por si acaso". Confirmar contra consultas reales antes de
deploy. Posibles índices por validar:

### `materialityOperations`

- `companyId ASC, createdAt DESC`
- `companyId ASC, status ASC, createdAt DESC`
- `clientId ASC, createdAt DESC`
- `clientId ASC, status ASC, createdAt DESC`
- `source.solicitudId ASC, createdAt DESC`
- `issuerRfc ASC, createdAt DESC`
- `receiverRfc ASC, createdAt DESC`

### `facturamaInvoices`

- `companyId ASC, createdAt DESC`
- `companyId ASC, status ASC, createdAt DESC`
- `materialityOperationId ASC, createdAt DESC`
- `solicitudId ASC, createdAt DESC`
- `companyId ASC, facturamaStatus ASC, updatedAt DESC`
- `companyId ASC, cfdiStatus ASC, updatedAt DESC`

### `companyInvoiceCatalogImports`

- `companyId ASC, createdAt DESC`
- `companyId ASC, status ASC, createdAt DESC`

### SAT global

`ClaveProdServ` y `ClaveUnidad` deben ser IDs documentales para validación
directa:

```text
satProductServiceCatalog/80101500
satUnitCatalog/E48
```

Búsqueda textual grande no debe cargar el catálogo completo al navegador. Si
Firestore no alcanza para búsqueda semántica, se diseñará índice especializado
posterior.

## Orden de implementación aprobado como ruta propuesta

1. Cerrar modelo canónico de empresas propias: identidad, RFC, régimen, CP,
   configuración Facturama, CSD, permisos `canIssueCfdi`.
2. Crear catálogos SAT globales con importación/versionado y lookup backend.
3. Crear catálogo autorizado de Trostre con Excel canónico y flujo
   upload/parse/validate/report/confirm/commit.
4. Implementar motor fiscal backend único.
5. Incorporar snapshots fiscales y referencias 1:N en Materialidad.
6. Integrar el borrador Facturama existente al motor fiscal.
7. Implementar OC/OS → clasificación → Materialidad → borrador Facturama.
8. Ejecutar pruebas end-to-end en sandbox.
9. Habilitar timbrado real solo después de validar snapshots e idempotencia.
10. Conectar Solicitud de gasto relacionada después de estabilizar facturación.

## Decisión pendiente antes de implementar

Antes de Fase 2 se debe aprobar:

1. nombres finales de colecciones,
2. estructura de índices,
3. permisos por rol,
4. formato exacto del Excel canónico de empresa,
5. estrategia para cargar los catálogos oficiales SAT iniciales,
6. contrato de snapshot fiscal entre Solicitudes, Materialidad y Facturama.
