# BASE8601-04 — PAY0 Canonical y separación de sistemas

Fecha: 2026-09-27
Estado: fronteras implementadas; arquitectura e inventario corregidos; sin migración de canónicos.

## Decisión

No existe un Canonical Center global. Cada sistema es dueño exclusivo de sus datos canónicos:

- PAY0 → PAY0 Canonical.
- Assets → un futuro Assets Canonical independiente.
- TTT → un futuro TTT Canonical independiente.

Pueden compartir patrones y componentes técnicos, pero no recursos, colecciones, Storage, autorización ni auditoría. `shared architecture != shared canonical data`.

La prioridad inmediata es PAY0. El espacio visible futuro será `Administración → Canónicos`; las rutas reservadas aún no se habilitan. Hugo puede consultar PAY0 Canonical mediante conectores server-side autorizados, pero no es propietario de los datos ni un bypass de permisos.

## Fronteras ya implementadas

| Sistema | Bitácora nueva | Propietario |
| --- | --- | --- |
| PAY0 | `pay0ActivityLog` | PAY0 |
| Assets | `assetsActivityLog` | Assets |
| TTT | `tttActivityLog` | TTT |
| Hugo | `hugoActivityLog` | Hugo |

`activityLog` permanece legado read-only. La vista PAY0 combina `pay0ActivityLog` con eventos históricos clasificados como PAY0 y excluye `ASSET_*`, `TTT_*`, `HUGO_*`, `AGENTE_007_*` y `CANONICAL_*`. Por tanto, `Asset Move Recorded`/`ASSET_*` no pertenece al Dashboard PAY0. Hugo sigue fuera de `SIDEBAR_NAV`; `/hugo` y `/systems` permanecen disponibles.

PAY0 Canonical no necesita una quinta bitácora global: sus acciones pertenecen a PAY0 y se registrarán en `pay0ActivityLog`, con eventos identificables como `PAY0_CANONICAL_*`.

## ¿Dónde están hoy los canónicos PAY0?

No hay todavía una fuente única administrable. Éste es el inventario verificable en el repositorio:

| Recurso | Empresa/scope | Ubicación actual | Consumido por | Fuente/versionado actual | Riesgo | Destino propuesto |
| --- | --- | --- | --- | --- | --- | --- |
| Catálogo Trostre producto/servicio | Trostre | `src/canonicos/formatos/catalogo empresas propias/CATALOGO_PRODUCTOS_SERVICIOS_TROSTRE_v1.2_PRUEBA_PAY0.xlsx` | Preparación/importación de facturación | Excel versionado sólo por nombre/Git | Edición local; no auditable desde PAY0 | `pay0CanonicalResources` + versiones estructuradas por empresa; Excel sólo import/export |
| Catálogo empresas IQ | Varias empresas | `src/canonicos/formatos/catalogo empresas IQ/LISTADO DE PRODUCTOS Y SERV EMPRESAS (2).xlsx` | Referencia operativa | Excel local en Git | Ambigüedad de ownership y vigencia | Separar filas por empresa en PAY0 Canonical después de validación humana |
| Claves SAT globales | PAY0 | `src/canonicos/formatos/catalogos SAT/catalogs.db.bz2`, `functions/src/modules/facturama/satGlobalCatalog.ts` | Facturación/validación SAT | Archivo copiado al build + código | Fuente binaria y lógica separadas | Recurso SAT versionado de PAY0; conservar digest y procedencia |
| Claves autorizadas por empresa | Empresas propias | `functions/src/modules/facturama/companyCatalog.ts`, `canonicalCatalogAttestations.ts` y catálogos Excel | Facturama | Código/atestaciones/Excel | Duplicidad; modificación requiere código | Catálogo estructurado con ClaveProdServ, ClaveUnidad, ObjetoImp, descripción, tipo, estado y aprobación |
| Configuración Facturama/CFDI | Por empresa y ambiente | `functions/src/modules/facturama/`, `src/services/facturama.ts`; configuración operacional en Firestore | Emisión y sandbox | Código + documentos de configuración | Campos dispersos; riesgo de cambiar fuente equivocada | Versión PAY0 Canonical para configuración no secreta; secretos sólo por referencia segura |
| Datos de empresas propias | Empresas/despachos | colecciones Firestore `companies` y configuraciones relacionadas | Solicitudes, facturación, documentos | Estado mutable; sin versión canónica común | Puede confundirse con datos de clientes | Perfil `OWN_COMPANY_PROFILE` independiente de `clients` |
| Documentos corporativos | Empresas propias y clientes mezclados por flujos | `entityDocuments` + Storage mediante init/upload/finalize | Docs, CSF y validación documental | Versionado documental parcial | No existe expediente explícito de empresa propia | `OWN_COMPANY_DOCUMENT` con owner PAY0/empresa y binario en `pay0-canonical/...` |
| CSF y opinión | Principalmente clientes; empresa propia no consolidada | `entityDocuments`, `src/services/clientCsf.ts`, `functions/src/modules/clients/csfService.ts` | Alta/edición de clientes | Flujo de documentos de cliente | No sustituye expediente de operadora | Separar documento de cliente de documento de empresa propia |
| Logos | Trostre y otras empresas | `public/brand/Trostre.png`, `src/canonicos/formatos/LOGOS/`, múltiples `assets/logo.png` dentro de constancias | UI y generadores | Duplicados físicos; algunos manifests con hash | Divergencia entre copias | `BRAND_STATIONERY`, una versión activa por empresa y uso |
| Cotizaciones | Varias empresas | `src/canonicos/formatos/cotizaciones/`, `manifest.json`, `templates/base/`, `src/canonicos/cotizaciones.ts`, `src/lib/cotizaciones/renderCotizacion.ts` | Generador/verificación de cotizaciones | Git + manifests/PDF de referencia | Edición requiere release; artefactos duplicados | `DOCUMENT_TEMPLATE` versionado; binarios y assets sellados |
| Constancias | Varias empresas | `src/canonicos/formatos/CONSTANCIAS/**` con HTML/CSS/DOCX/PDF/manifest/assets | Materialidad y documentos generados | Versiones por carpeta/manifests | Muchas copias de identidad visual | Plantillas PAY0 Canonical por empresa/tipo con versión activa |
| Materialidad | PAY0 | `src/canonicos/materialidad.ts`, `src/canonicos/MATERIALIDAD-EXPEDIENTE-CENTRAL.md`, rutas `src/app/materialidad/` | Módulo Materialidad | Código + documentación + Firestore/Storage operativo | Contrato y recursos visuales dispersos | Parámetros y plantillas en PAY0 Canonical; expedientes operativos siguen en Materialidad |
| Firmas y verificaciones | PAY0/usuarios/empresas | `src/app/firma/[token]/`, `src/app/verificar/*`; firmas visibles dentro de plantillas | Firma, cotización y constancia | Flujo operativo + placeholders/archivos | Firma autorizada corporativa no consolidada | Referencia a firma autorizada versionada; tokens siguen siendo efímeros y no canónicos |
| Parámetros y recursos oficiales | PAY0 | `src/canonicos/`, `config/`, variables de entorno y módulos de Functions | Múltiples módulos | Git/configuración/Firestore | No hay inventario de autoridad por campo | `SYSTEM_PARAMETER` o `INTEGRATION_REFERENCE` sólo cuando exista ownership aprobado |

No se encontró una colección productiva `pay0CanonicalResources` ni una pantalla de administración activa. Por ello, hoy la respuesta a “¿puedo cambiar una clave, CSF, logo o plantilla desde un lugar controlado?” todavía es **no**.

## Arquitectura objetivo acotada

Nombres reservados, aún sin datos ni rutas activas:

- `pay0CanonicalResources/{resourceId}`: puntero y versión activa.
- `pay0CanonicalResourceVersions/{resourceId}:{version}`: revisiones inmutables.
- `pay0CanonicalAuditLog/{eventId}`: cambios y aprobaciones.
- `pay0ActivityLog/{eventId}`: actividad PAY0, incluidos eventos canónicos.
- Storage: `pay0-canonical/{rootId}/{ownCompanyId}/{resourceKind}/{resourceId}/{version}/...`.
- UI futura: `/administracion/canonicos/...`.

El scope exige `system: PAY0`, `rootId` y, cuando corresponda, `ownCompanyId`. Assets y TTT no podrán leer estas colecciones. Sus futuros centros usarán nombres, reglas y almacenamiento propios.

La activación/restauración es forward-only: restaurar crea una versión nueva. Firestore almacena metadatos y referencias, no binarios ni secretos. CSD, e.firma, tokens, cookies, contraseñas y credenciales permanecen en Secret Manager/Firebase Secrets o proveedor equivalente; PAY0 Canonical sólo conserva referencias opacas y estado sanitizado.

## Mapa de consolidación (sin migración en este corte)

1. Aprobar empresa piloto y ownership de cada campo.
2. Implementar `Administración → Canónicos` y autorización server-side fail-closed.
3. Importar un único dominio de bajo riesgo (logo/papelería) con hashes y versiones.
4. Ejecutar shadow reads contra la fuente actual.
5. Migrar plantillas/documentos corporativos.
6. Migrar catálogo Trostre a registros estructurados, conservando Excel como intercambio.
7. Migrar configuración CFDI no secreta al final, con aprobación y rollback por capacidad.
8. Congelar cada fuente anterior sólo tras validación humana; no eliminarla automáticamente.

## Fuera de alcance

- No se implementa Assets Canonical ni TTT Canonical.
- No se migran documentos ni datos reales.
- No se habilita una pantalla o ruta canónica todavía.
- No se cambia el launcher de Hugo.
- No se centralizan secretos.

## Decisiones humanas pendientes

- Nombre visible definitivo (`Administración → Canónicos` recomendado).
- Empresa piloto (Trostre es candidata, no aprobación implícita).
- Roles de edición/aprobación y posible doble aprobación para CFDI.
- Fuente autorizada cuando código, Excel y Firestore discrepen.
- Retención de versiones y periodo de shadow reads.
