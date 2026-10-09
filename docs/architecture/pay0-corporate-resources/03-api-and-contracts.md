# API & Contracts

| Metadato | Valor |
| --- | --- |
| Título | Recursos Corporativos PAY0 — API & Contracts |
| Versión | 0.1.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Catálogo inicial de contratos, sin implementación ni esquema físico definitivo. |

## 1. Convenciones públicas

- Primera fase: Firebase callable autenticado; no REST público.
- Todos los comandos mutables requieren `requestId` idempotente.
- Los DTO no aceptan `rootId`, rol ni permisos como autoridad del cliente.
- IDs son opacos. Las respuestas no exponen rutas Storage ni nombres internos de servicios.
- Errores públicos: `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_ARGUMENT`, `NOT_FOUND`, `CONFLICT`, `FAILED_PRECONDITION`, `RATE_LIMITED`, `INTERNAL`.
- `NOT_FOUND` y `FORBIDDEN` se normalizan cuando revelar existencia sea sensible.

## 2. Callables propuestos

| Callable | Tipo | Responsabilidad | Capacidad mínima |
| --- | --- | --- | --- |
| `listCorporateResources` | Query | Lista recursos visibles por filtros seguros. | VIEW_METADATA |
| `getCorporateResource` | Query | Devuelve detalle y resumen de versiones/dependencias. | VIEW_METADATA |
| `createCorporateResource` | Command | Crea identidad lógica sin contenido activo. | CREATE_RESOURCE |
| `updateCorporateResourceMetadata` | Command | Cambia sólo metadatos permitidos de la identidad. | CREATE_RESOURCE o capacidad dedicada |
| `createCorporateResourceVersion` | Command | Crea draft nuevo o restaura como copia forward-only. | CREATE_VERSION |
| `initCorporateResourceUpload` | Command | Autoriza staging y devuelve sesión limitada. | UPLOAD_ARTIFACT |
| `finalizeCorporateResourceUpload` | Command | Verifica y asocia artefacto inmutable. | UPLOAD_ARTIFACT |
| `submitCorporateResourceVersion` | Command | Sella y envía a revisión. | SUBMIT_REVIEW |
| `reviewCorporateResourceVersion` | Command | Solicita cambios o rechaza. | REVIEW_VERSION |
| `approveCorporateResourceVersion` | Command | Registra aprobación separada de activación. | APPROVE_VERSION |
| `activateCorporateResourceVersion` | Command | Activa ahora de forma transaccional. | ACTIVATE_VERSION |
| `scheduleCorporateResourceActivation` | Command | Programa activación o retiro. | ACTIVATE_VERSION |
| `retireCorporateResourceVersion` | Command | Retira sin borrar. | RETIRE_VERSION |
| `getCorporateResourceDownloadUrl` | Query | Emite URL firmada corta para un artefacto autorizado. | DOWNLOAD_ARTIFACT |
| `listCorporateResourceDependencies` | Query | Expone grafo e impacto sanitizado. | VIEW_METADATA |
| `upsertCorporateResourceDependency` | Command | Declara/corrige una dependencia confirmada. | MANAGE_DEPENDENCIES |
| `listCorporateResourceAudit` | Query | Consulta historial sanitizado y paginado. | VIEW_AUDIT |
| `runCorporateResourceValidation` | Command futuro | Solicita validación registrada. | Capacidad futura |

## 3. Contrato interno de resolución

`CorporateResourceResolver.resolve(context, selector)` será la única interfaz de consumo interno.

Entrada conceptual:

- identidad autenticada y contexto de autorización;
- consumidor registrado;
- selector por clave estable y ownership;
- estrategia `ACTIVE` o `PINNED_VERSION`;
- ambiente y propósito de uso.

Salida conceptual:

- referencia de recurso y versión resuelta;
- payload estructurado autorizado;
- handles internos de artefactos, nunca rutas públicas;
- compatibilidad/esquema;
- vigencia;
- `usageId` para correlación.

## 4. DTOs conceptuales

| DTO | Grupos de información; campos exactos pendientes |
| --- | --- |
| ResourceSelector | Clave estable, clase, ownership global/empresa, ambiente. |
| ResourceSummary | Identidad, clasificación, owner, estado, vigencia y versión activa. |
| ResourceDetail | Summary, versiones resumidas, dependencias, validación y permisos efectivos. |
| VersionDraftInput | Base opcional, comentario, payload estructurado, vigencia propuesta. |
| ArtifactManifestInput | Nombre sanitizado, MIME declarado, tamaño esperado, digest esperado y propósito. |
| ReviewInput | Decisión, comentario y evidencias no sensibles. |
| ActivationInput | Versión, fecha opcional, motivo, evaluación de impacto aceptada. |
| DependencyInput | Consumidor/destino, tipo, criticidad, modo de resolución y compatibilidad. |
| ImpactReport | Consumidores, outputs, dependencias encadenadas, validaciones y bloqueos. |
| AuditQuery | Recurso, rango temporal, tipo de evento y cursor. |

## 5. Modelos públicos e internos

Públicos para frontend: resúmenes sanitizados, estado de workflow, capacidades efectivas, impacto y auditoría legible.

Internos server-side: scope autorizado, puntero activo, referencias Storage, digests, outbox, leases, resultados detallados y procedencia de migración. Los modelos internos nunca cruzan directamente al navegador.

## 6. Eventos de dominio

| Evento | Cuándo se emite |
| --- | --- |
| `PAY0_CORPORATE_RESOURCE_CREATED` | Se crea la identidad. |
| `PAY0_CORPORATE_VERSION_CREATED` | Se crea un draft. |
| `PAY0_CORPORATE_ARTIFACT_FINALIZED` | Artefacto verificado y promovido. |
| `PAY0_CORPORATE_VERSION_SUBMITTED` | Versión sellada para revisión. |
| `PAY0_CORPORATE_VERSION_APPROVED` | Aprobación registrada. |
| `PAY0_CORPORATE_VERSION_REJECTED` | Rechazo registrado. |
| `PAY0_CORPORATE_ACTIVATION_SCHEDULED` | Activación futura persistida. |
| `PAY0_CORPORATE_VERSION_ACTIVATED` | Cambio del puntero activo completado. |
| `PAY0_CORPORATE_VERSION_RETIRED` | Versión retirada. |
| `PAY0_CORPORATE_DEPENDENCY_CHANGED` | Arista confirmada modificada. |
| `PAY0_CORPORATE_VALIDATION_COMPLETED` | Resultado de validación persistido. |
| `PAY0_CORPORATE_RESOURCE_RESOLVED` | Uso autorizado registrado cuando la política lo requiera. |
| `PAY0_CORPORATE_AUTHORIZATION_BLOCKED` | Operación bloqueada, sin datos protegidos. |

Eventos internos usan outbox/idempotencia. Activity recibe sólo una proyección sanitizada.

## 7. Contrato para Hugo

Hugo no usa los callables administrativos ni Firestore/Storage. Una tool server-side futura invocará el Resolver con identidad delegada, propósito explícito y capacidad `CONSUME_RESOURCE`. La salida se limita a contenido autorizado para la tarea. Descargar, resumir, validar, adjuntar o enviar son capacidades separadas; ninguna se deriva de otra.

## 8. Jobs previstos

- `executeScheduledCorporateResourceTransitions`
- `expireCorporateResourceUploadSessions`
- `runScheduledCorporateResourceValidations`
- `reconcileCorporateResourceDependencyObservations`

Todos requieren lease, idempotency key, límite de lote, reintento seguro y estado terminal. No se implementan en esta fase.
