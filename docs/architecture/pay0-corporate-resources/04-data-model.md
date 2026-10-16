# Data Model

| Metadato | Valor |
| --- | --- |
| Título | Recursos Corporativos PAY0 — Data Model |
| Versión | 0.1.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Modelo lógico de colecciones; campos físicos e índices definitivos quedan sujetos a aprobación y pruebas de consulta. |

## Principios

- Colecciones exclusivas de PAY0; no compartidas con Assets, TTT o Hugo.
- Scope obligatorio derivado server-side.
- Documentos pequeños; binarios nunca en Firestore.
- Versiones, decisiones, validaciones, usos y auditoría append-only.
- Punteros y contadores derivados pueden actualizarse transaccionalmente.
- No se crean colecciones durante esta fase.

## Colecciones propuestas

| Colección lógica | Propósito | Ownership | Relaciones | Ciclo de vida | Índices previstos | Volumen y crecimiento |
| --- | --- | --- | --- | --- | --- | --- |
| `pay0CorporateResources` | Identidad, clasificación, scope y puntero activo. | PAY0; contexto global o empresa propia. | 1:N versiones y dependencias. | Larga duración; cierre lógico, no borrado rutinario. | root+owner+class+status; stableKey única por scope mediante guard transaccional. | Bajo/medio; cientos o miles. |
| `pay0CorporateResourceVersions` | Snapshots inmutables y estado de workflow. | Heredado del recurso. | N:1 recurso; 1:N artefactos/validaciones/decisiones. | Append-only; transición de estado controlada. | resource+version; resource+state; validity; scheduledAt. | Medio/alto; crece con cambios. |
| `pay0CorporateArtifacts` | Manifest y referencia interna de cada binario. | Heredado de versión. | N:1 versión. | Staged/verified/promoted/quarantined; contenido promovido inmutable. | version; digest; uploadSession; state. | Alto; metadatos pequeños, binarios en Storage. |
| `pay0CorporateConsumers` | Registro de módulos, procesos, automatizaciones y tools. | PAY0 por equipo/dominio responsable. | 1:N dependencias/usos. | Registered/active/deprecated/disabled. | type+status; ownerModule. | Bajo. |
| `pay0CorporateDependencies` | Grafo de consumo e impacto. | PAY0; mantenido por responsables del consumidor/recurso. | Origen recurso/versión → destino. | Proposed/confirmed/deprecated/removed. | source; target; criticality; status; provenance. | Medio; potencialmente varias aristas por recurso. |
| `pay0CorporateResourceUsages` | Evidencia append-only de resolución/uso. | PAY0; scope del usuario/consumidor. | N:1 versión y consumidor. | Retención según política. | version+time; consumer+time; resource+time; correlation. | Alto; partición/TTL o agregación futura. |
| `pay0CorporateValidationProfiles` | Contratos de validación por clase/esquema. | PAY0 Architecture/Security. | 1:N runs. | Draft/active/retired; versionado. | resourceClass+status. | Bajo. |
| `pay0CorporateValidationRuns` | Resultados inmutables de validación. | PAY0; scope de la versión. | N:1 versión/perfil. | Append-only; resultado terminal. | version+createdAt; status; validator. | Medio/alto. |
| `pay0CorporateReviewDecisions` | Evidencia de revisión/aprobación/rechazo. | PAY0; actor autorizado. | N:1 versión. | Append-only; decisiones pueden quedar superseded. | version+time; actor; decision. | Medio. |
| `pay0CorporateActivationSchedules` | Activaciones/retiros futuros idempotentes. | PAY0. | N:1 versión. | Scheduled/executed/cancelled/failed. | state+executeAt; resource. | Bajo/medio. |
| `pay0CorporateAuditLog` | Historial detallado del agregado. | PAY0. | N:1 recurso/versión/operación. | Append-only, retención aprobada. | resource+time; operationId; eventType+time. | Alto y continuo. |
| `pay0CorporateOutbox` | Entrega confiable de eventos internos. | PAY0 backend. | Referencia a agregado/evento. | Pending/leased/delivered/dead-letter. | state+availableAt; leaseUntil. | Transitorio con retención corta. |
| `pay0CorporateUploadSessions` | Sesión limitada de staging. | PAY0 backend/actor autorizado. | N:1 draft. | Initialized/uploaded/finalized/expired/rejected. | state+expiresAt; actor; version. | Transitorio; TTL. |
| `pay0CorporateMigrationLinks` | Procedencia y correspondencia con fuentes heredadas. | PAY0 migration tooling. | Fuente externa → recurso/versión. | Se conserva para trazabilidad. | sourceSystem+sourceKey; resource. | Bajo/medio. |

## Jerarquía y partición

Se propone colección plana con scope explícito para consultas administrativas y transacciones consistentes. Las subcolecciones se evitan inicialmente porque complican búsquedas globales, migración y auditoría. Si los usos o auditoría alcanzan gran volumen, podrán particionarse por periodo conservando una interfaz de repositorio estable.

## Invariantes de datos

1. Stable key única dentro de `root + ownershipScope + company + class + environment`.
2. Una sola versión `ACTIVE` por recurso/ambiente.
3. Una versión sellada no cambia payload ni manifest.
4. Un artefacto promovido no cambia bytes ni ruta.
5. ReviewDecision y AuditEvent son append-only.
6. Un consumidor deshabilitado no puede resolver nuevos usos.
7. Una dependencia no concede autorización.
8. Un recurso `OWN_COMPANY` exige empresa válida; `PAY0_GLOBAL` no acepta empresa arbitraria.
9. Referencias secretas son opacas; valores secretos están prohibidos.

## Índices y crecimiento

Los índices anteriores son previsiones, no una autorización para modificar `firestore.indexes.json`. Antes de definirlos se validarán consultas reales, cardinalidad y costo. Usages y audit deberán soportar paginación por cursor, agregación y política de retención. Los binarios tendrán lifecycle diferenciado para staging, quarantine y versiones promovidas; una política legal aprobada prevalecerá sobre limpieza automática.
