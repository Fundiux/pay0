# BASE8601-04 — Separación de sistemas y Canonical Center

Fecha: 2026-09-27
Estado: arquitectura base y aislamiento forward-only implementados localmente; sin migración y sin deploy.

## Decisión arquitectónica

PAY0, Assets, TTT, Canonical Center y Hugo son contextos independientes. Cada sistema es dueño de sus rutas, datos operativos, bitácora y autorización. Ningún dashboard puede consultar colecciones de otro sistema. Hugo es el único orquestador autorizado para correlacionar sistemas, siempre mediante conectores server-side que conserven `rootId`, permisos, procedencia y evidencia.

La separación no se basa en ocultar filas en la interfaz. Los eventos nuevos se escriben en colecciones físicas distintas:

| Sistema | Bitácora |
| --- | --- |
| PAY0 | `pay0ActivityLog` |
| Assets | `assetsActivityLog` |
| TTT | `tttActivityLog` |
| Hugo | `hugoActivityLog` |
| Canonical Center | `canonicalActivityLog` |

`activityLog` queda como colección legada de sólo lectura durante la transición. No se mueve ni elimina ningún documento en esta fase. La vista PAY0 combina su nueva colección con registros históricos clasificados como PAY0 y descarta explícitamente eventos `ASSET_*`, `TTT_*`, `HUGO_*`, `AGENTE_007_*` y `CANONICAL_*`.

## Cambio funcional acotado

- Los eventos nuevos reciben `sourceSystem` y `activitySchemaVersion: 2`.
- El escritor común enruta por sistema. Los eventos existentes `ASSET_*` quedan clasificados automáticamente como Assets sin modificar cada transacción financiera.
- PAY0 sólo presenta eventos PAY0, incluido el periodo legado.
- Las bitácoras de Assets, TTT, Hugo y Canonical Center no son legibles desde el frontend PAY0. Sus futuras superficies deberán tener autorización propia.
- Hugo conserva observación server-side porque el observador se ejecuta después de construir el evento y no depende de la colección visible del sistema.
- Hugo se retiró de `SIDEBAR_NAV`; `/hugo`, `HugoShell`, el launcher `/systems` y sus permisos permanecen. No se implementó un launcher nuevo.

## Canonical Center: límites de la primera versión

Canonical Center será un sistema hermano, no un módulo PAY0. Su contrato base está en `functions/src/modules/canonicalCenter/contracts.ts`; no crea colecciones ni rutas activas todavía.

### Rutas reservadas

- `/canonical-center`
- `/canonical-center/companies`
- `/canonical-center/documents`
- `/canonical-center/sat-catalogs`
- `/canonical-center/cfdi`
- `/canonical-center/templates`
- `/canonical-center/stationery`
- `/canonical-center/integrations`
- `/canonical-center/parameters`
- `/canonical-center/audit`

Estas rutas son nombres reservados de arquitectura. No deben agregarse a `RouteAccessGuard` ni a la navegación hasta que exista autorización canónica y una pantalla real; las rutas desconocidas continúan fallando cerradas.

### Modelo de almacenamiento propuesto

- `canonicalResources/{resourceId}`: puntero estable y versión activa.
- `canonicalResourceVersions/{resourceId}:{version}`: revisiones inmutables.
- `canonicalAuditLog/{eventId}`: creación, revisión, activación, retiro, comparación y restauración.
- `canonicalActivityLog/{eventId}`: actividad operacional del propio Canonical Center.
- Storage: `canonical-center/{rootId}/{companyId}/{resourceKind}/{resourceId}/{version}/...`.

Una restauración crea una versión nueva con contenido equivalente a la versión seleccionada. Nunca reescribe ni elimina una versión histórica. Los binarios se sellarán con SHA-256 y sus metadatos señalarán el objeto de Storage; Firestore no almacenará archivos ni secretos.

### Modelo de permisos propuesto

| Acción | Superadmin | Administrador canónico futuro | Revisor futuro | Consumidor de sistema |
| --- | --- | --- | --- | --- |
| Ver versión activa autorizada | Sí | Sí | Sí | Sólo mediante resolver server-side |
| Crear borrador | Sí | Sí | No | No |
| Comparar versiones | Sí | Sí | Sí | No |
| Activar/restaurar | Sí | Con aprobación | No | No |
| Ver referencias de integración | Sí | Acotado | No | No |
| Leer secretos/tokens | Nunca desde Firestore/UI | Nunca | Nunca | Nunca |

La política definitiva deberá incorporarse a `config/authorization-policy.json` y generarse con el flujo canónico. Esta fase no cambia roles ni permisos productivos.

## Inventario de fuentes que deberán migrarse

### Empresas y documentos institucionales

- `companies` y configuración de empresas/despachos.
- `entityDocuments`, uploads y flujos init/upload/finalize.
- CSF de clientes/empresas y procesamiento relacionado.
- Actas, poderes, opiniones SAT, estados de cuenta, e.firma, CSD, logos, firmas, sellos y papelería que hoy vivan como documentos o configuración dispersa.
- Datos fiscales usados por Facturama y generadores documentales.

### CFDI y fiscal

- Configuración por compañía en `functions/src/modules/facturama/`.
- Borradores y emisión de Facturama, incluidas series, folios, moneda, IVA, retenciones, `ObjetoImp`, uso CFDI, método/forma de pago y exportación.
- Configuración de complementos en `functions/src/modules/paymentApplications/`.
- Parámetros fiscales derivados hoy de solicitudes, OC o documentos.

### Catálogos SAT

- `functions/src/modules/facturama/satGlobalCatalog.ts`.
- `functions/src/modules/facturama/companyCatalog.ts`.
- `functions/src/modules/facturama/canonicalCatalogAttestations.ts`.
- Archivos y atestaciones SAT actualmente locales o embebidos.
- Catálogos de productos, servicios, unidades y claves por empresa.

### Plantillas y papelería

- `src/canonicos/formatos/` y sus manifiestos, HTML, CSS, PDF de referencia y assets.
- `src/canonicos/materialidad.ts`.
- Generadores en `cotizaciones`, `constancias`, `documents`, `pagoDocuments`, `solicitudDocuments` y complementos.
- Logos, firmas, encabezados, pies, colores, tipografías, marcas de agua y QR actualmente resueltos desde código o archivos.

### Integraciones y operación

- IQ: perfiles, calendario, colas, master switches y schedulers.
- Facturama: referencias de credenciales, ambientes y estado.
- WhatsApp y Telegram: rutas, preferencias, webhooks y estado de conexión.
- SAT y APIs futuras.
- Secret Manager/Firebase secrets: sólo se migrarán referencias opacas y metadatos sanitizados; el valor secreto nunca entrará a Firestore, logs, navegador o historial de versiones.

## Estrategia de migración propuesta

### Fase 0 — Contratos y aislamiento

Incluida en esta rama: fronteras de sistemas, bitácoras forward-only, retiro de Hugo del menú PAY0, contratos y este inventario. No se modifican datos reales.

### Fase 1 — Lectura paralela

Crear resolutores server-side del Canonical Center. Importar una copia versionada de una sola empresa piloto sin cambiar consumidores. Comparar digest, campos y documentos con las fuentes actuales.

### Fase 2 — Shadow reads

Cada consumidor continúa usando la fuente existente, consulta también Canonical Center sin afectar la salida y registra diferencias sanitizadas. Criterio: coincidencia determinista durante un periodo acordado.

### Fase 3 — Activación por capacidad

Cambiar un consumidor a la vez mediante feature flag server-side: primero papelería no financiera, después plantillas, catálogos SAT y finalmente configuración CFDI. Mantener fallback explícito y auditable a la fuente anterior.

### Fase 4 — Escritura única

Después de validación humana y técnica, Canonical Center se vuelve el único lugar de edición. Las fuentes anteriores quedan congeladas como respaldo de rollback, no se eliminan.

### Fase 5 — Retiro controlado

Sólo con aprobación expresa: bloquear lecturas antiguas, conservar exportación y evidencia, y retirar duplicados después del periodo de retención. Ningún secreto o documento se elimina automáticamente.

## Compuertas obligatorias antes de mover datos

1. Aprobar nombres, modelo de permisos y empresa piloto.
2. Definir ownership de cada campo y resolver duplicados/conflictos.
3. Diseñar validación de hashes, malware, MIME, tamaño y retención documental.
4. Probar aislamiento de dos roots y de los cinco sistemas en emulador.
5. Probar creación concurrente, activación única, restauración forward-only y auditoría inmutable.
6. Verificar que cotizaciones, constancias, facturas y Materialidad produzcan el mismo resultado en shadow mode.
7. Preparar rollback por capacidad y no por despliegue monolítico.
8. Obtener autorización explícita antes de cualquier deploy, migración o modificación de datos reales.

## Riesgos abiertos

- Los eventos históricos sin `sourceSystem` requieren clasificación por nombre; eventos legados con nombres no canónicos deberán inventariarse antes de migrar.
- Crear nuevas colecciones exige desplegar Rules e índices junto con Functions/frontend; un despliegue parcial dejaría la vista nueva sin lectura o mantendría escritores en la colección legada.
- Los archivos locales contienen evidencia y plantillas con estructuras heterogéneas; no deben convertirse en datos activos por copia masiva.
- Series y folios requieren transacciones y una autoridad única; versionar configuración no debe permitir reutilizar numeración.
- Centralizar referencias de integración no autoriza centralizar valores secretos.
- Hugo puede correlacionar sistemas, pero cada herramienta debe declarar sistema fuente, root, permiso, completitud y evidencia; Hugo no puede convertirse en bypass de autorización.

## Decisiones pendientes de aprobación

- Nombre visible definitivo: `Canonical Center` o `Administración → Canónicos`.
- Si el sistema tendrá administradores canónicos distintos del `superadmin`.
- Primera empresa piloto y orden de migración de capacidades.
- Periodo de shadow reads y retención de fuentes anteriores.
- Política de aprobación doble para CFDI, integraciones y restauraciones.
