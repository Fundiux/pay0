# Baseline de remediación PAY0 — 2026-10-09

## Alcance y preservación

Inspección de solo lectura de Git y metadatos remotos. No se ejecutaron despliegues, mutaciones de datos, tareas, llamadas financieras, mensajes ni cambios de switches. No se leyeron documentos Firestore, objetos de negocio ni valores secretos. Este archivo conserva metadatos técnicos y conclusiones; no respuestas productivas de negocio.

## Base de implementación

- Checkout inicial: `fix/iq-latency-reactivity`, HEAD `1f694607dcc94b1af557249f7334af7cd22a8afb`, 2026-10-08 10:28:14 -06.
- `main`: `094472f6689e1da340f24aa7c750a4ccccb92eab`; `origin/main` local: `7dfcd8aa039aafbe7345a17155d3db2c2fc3fd8a`. No se hizo fetch; esta referencia no demuestra estado del remoto.
- Ancestro común: `fe2b98b7544712fba6ef50f70cac8e8dd33a2624`. Divergencia `main...HEAD`: 108 commits exclusivos de main y 13 de HEAD. Comparación de árboles: 301 archivos, 5,565 inserciones y 22,678 eliminaciones desde main hacia HEAD.
- 42 worktrees registrados, dos temporales marcados prunable. No se alteró ninguno. `main` está ocupado en `.worktrees/astra-main-integration-20260928`.
- Sin modificaciones rastreadas al inicio. Se preservaron entradas no rastreadas: `.worktrees/`, `audit/H4-D67-A9-rules-report.json`, carpetas audit de voz, `docs/architecture/`, `docs/audits/`, `functions/.tmp-p4-r4-plan1-audit.cjs`.

Recomendación: crear la línea de remediación desde HEAD vigente para preservar las correcciones recientes de solicitudes, documentos, creador, reactividad, IQ y Facturama. Reconciliar posteriormente las capacidades de main y las de cada artefacto desplegado antes de publicar el componente afectado. No tratar HEAD como sustituto completo demostrado de producción ni efectuar un merge mecánico. La diferencia incluye `config/release-baseline.json` ausente y CI diferente respecto a main: se debe recuperar el contrato de protección acumulativa con evidencia, sin reintroducir estados históricos incompatibles.

La auditoría `docs/audits/pay0-system-integral-2026-10-07/01-PRODUCTION-VS-REPOSITORY.md` inspeccionó `d206a6c`, con 10 commits exclusivos de HEAD y sin verificar Firebase. Desde entonces se agregaron `f7dc2a6`, `e1a76d8` y `1f69460`. `docs/P0-IQ-LATENCY-REACTIVITY-2026-10-06.md` documenta recuperación previa del SSR `00576-hed`, ZIP SHA-256 `9f8b77de0a56843352ee39caae6ff57b31d9299466202a2222d23a51a0fc6395`, vinculada a `9c06705`; es evidencia histórica, no identidad de la revisión actual.

## Versiones y proyecto

- `.firebaserc`, sitio de `firebase.json` y proyecto activo gcloud coinciden en `pay-0-system`; número observado en recursos: `751158244178`.
- Functions y frameworksBackend: `us-central1`; runtime `nodejs22`.
- Node instalado: `v22.23.2`; Firebase CLI: `15.3.1`; Google Cloud SDK: `579.0.0`.
- Manifiesto actual: Next `15.5.25`, React `^18.3.1`, Firebase `^12.19.0`, Admin `^13.10.0`, Functions `^7.3.2`, TypeScript `^5.9.3`. La referencia Next 14 en AGENTS es histórica; no debe guiar una degradación de dependencias.

## Evidencia remota actual

Las consultas se limitaron mediante formatos/selección de campos. El sandbox normal impidió Firebase configstore y la apertura de gcloud credentials.db; las consultas con `require_escalated`, aprobadas por el mecanismo de plataforma, funcionaron. No es una ausencia de credenciales remotas.

| Componente | Evidencia verificada | Límite |
|---|---|---|
| Hosting live | Firebase CLI: versión `c4404dcc2a714e61`, release `2026-10-09T08:51:51.430Z`, sitio `pay-0-system` | Pendiente vincular artefacto con SHA Git probado |
| SSR | Inicialmente `DEPLOYING`, revisión `ssrpay0system-00582-xif`; segunda consulta `ACTIVE`, revisión `ssrpay0system-00584-jup`, update `2026-10-09T08:50:56.077845319Z`, Cloud Build `ac9df3c3-36a1-445e-bc41-fad9471ecddc` | Hubo cambio remoto concurrente durante esta inspección; no atribuible a esta remediación |
| Functions | Inventario regional de nombres, estados, runtime, updateTime y revisiones accesible. `setUserClientAccess-00015-cov` actualizado 2026-09-28; `dispatchQueuedPagoIqCreation-00001-coy` 2026-10-07; `createSolicitud-00061-fig` y `finalizePagoDocumentUpload-00033-xel` 2026-10-08 | No se obtuvo hash de código por función ni se atribuye igualdad a HEAD |
| Firestore | `(default)`, FIRESTORE_NATIVE, `nam5`, PESSIMISTIC, PITR deshabilitado y delete protection deshabilitada | No hay respaldo/restauración comprobados por esta inspección |
| Reglas Firestore | ruleset `042bafab-3487-418e-8245-2416e19d1963`, release update `2026-09-28T08:07:43.649443Z` | Pendiente comparación del contenido con candidato |
| Reglas Storage | ruleset `d37e96b3-5266-4a44-8ce6-c903a502a854`, release update `2026-09-28T08:07:42.831469Z` | Pendiente comparación del contenido con candidato |
| Storage | 6 buckets; aplicación `pay-0-system.firebasestorage.app` US-CENTRAL1, uniform bucket level access false, public access prevention inherited | Estos flags no prueban acceso público; faltan revisión IAM/ACL y retención |
| Service accounts | 4 cuentas no deshabilitadas: App Engine default, Compute default, Firebase Admin SDK y `hugo-voice-gateway` | Listado no demuestra privilegio mínimo; pendiente matriz IAM por recurso |

Buckets auxiliares observados: `gcf-sources-751158244178-us-central1`, `gcf-v2-sources-751158244178-us-central1`, `gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com`, `pay-0-system_cloudbuild`, `run-sources-pay-0-system-us-central1`. No se enumeraron objetos.

### Scheduler y Tasks

15 Scheduler jobs regionales. Pausados: `syncTodayIqInvoicesNow` (every 24 hours) y `checkPaymentComplementsDaily` (`0 19 * * 1-5`). Conservar pausas; publicar funciones no debe reactivarlos accidentalmente.

Habilitados: `processIqCreateQueue` y `processIqPagoDepositCreateQueue` cada minuto; `reconcileDirtyControlCenters` y `prepareDailyUserCommissions` cada 15 minutos; `purgeExpiredHugoTraces` a `0 3 * * *`; `processIqPaymentApplicationExecution`, `processIqPagoDepositReconciliationQueue`, `reconcileOperationRecovery`, `processIqStatusMonitorQueue`, `discoverIqWorkCandidates`, `processIqReconciliationQueue`, `processIqInvoiceImportQueue`, `processIqDispersionCreate` cada 5 minutos. Zona America/Mexico_City excepto `reconcileOperationRecovery` y `processIqReconciliationQueue`, que usan UTC. El campo retryCount no se mostró en el listado: no atribuir cero ni inferir configuración efectiva.

| Cola Cloud Tasks (todas RUNNING) | Concurrencia | Despachos/segundo | Máx. intentos |
|---|---:|---:|---:|
| processIqCreateOnDemandTask | 1 | 1 | 1 |
| processIqPagoDepositAutomaticTask | 1 | 1 | 3 |
| processIqPagoDepositOnDemandTask | 1 | 1 | 1 |
| processPagoApplicationIqPlanOnDemandTask | 1 | 1 | 1 |

No se leyeron payloads ni se ejecutaron tareas. La concurrencia por cola no demuestra exclusión con scheduler, trigger o entrada manual.

## Dependencias exactas para publicación y recuperación

1. Identificar origen y artefacto de Hosting/SSR que cambió durante esta lectura; comparar el candidato exacto con la revisión vigente antes de publicar. La observación final ACTIVE elimina el bloqueo transitorio DEPLOYING, no la incertidumbre de procedencia.
2. Vincular por componente revisión/source generation/build con archivos del candidato, preservando capacidades productivas no integradas en HEAD. No habilitar un despliegue global.
3. Obtener reglas publicadas y comparar semántica/hashes; ejecutar pruebas de reglas y autorización antes de cualquier publicación.
4. Antes de migraciones destructivas o de datos, demostrar respaldo y recuperación: PITR deshabilitado no aporta red de recuperación. No activar ni modificar infraestructura en esta subtarea.
5. Completar IAM, políticas de buckets, índices/TTL y configuración operativa mediante metadatos filtrados; no introducir respuestas de negocio ni secretos en artefactos versionados.
6. La consulta Hosting REST con identidad gcloud devolvió 403. Alternativa probada: `firebase hosting:channel:list --project pay-0-system --site pay-0-system --json`, con salida reducida a nombre, fecha, versión y URL. No queda bloqueo general de acceso Hosting.

Verificación realizada: comandos de Git, lectura de configuración, consultas metadata gcloud/Firebase/Rules API. No se ejecutaron builds ni pruebas en esta subtarea; corresponden al candidato de implementación. No se hizo commit ni cambio de rama.

## Implementación S-04: autorización y cuota de lectura de comprobantes

Subtarea posterior, separada del inventario de solo lectura. Archivos: `functions/src/modules/pagos/receiptPdfCallables.ts`, nuevo `receiptOcrQuota.ts` en el mismo módulo y `qa/scripts/remediation-ocr-quota.test.cjs`. No se cambiaron exports públicos, consumidores ni otros módulos.

El consumidor `src/services/pagoReceipt.ts` usa la lectura antes de crear pagos; se adopta el mismo permiso `pagos.create` que `createPago`. Antes del parser o Vision se lee el perfil PAY0 y se ejecuta `assertAuthorized` dentro de la transacción de reserva: cuenta existente, activa, rol permitido y permiso de creación. El root sale exclusivamente del perfil servidor, con el fallback histórico a UID de `createPago`. Un cambio concurrente del perfil leído provoca el reintento transaccional.

Se introducen límites técnicos conservadores explícitos: 60 intentos por actor y 600 por root en ventanas de una hora desde la primera reserva. No son datos de calibración ni reglas financieras. Dos registros persistentes con IDs hash en `receiptProcessingQuotas` limitan simultáneamente ambos ámbitos; la denegación general de reglas mantiene la colección inaccesible al cliente. La validez temporal se calcula al reservar, sin depender de limpieza asíncrona. La reserva no se devuelve si falla el parser/proveedor, para evitar consumo gratuito repetido; el actor mantiene su cuota aunque cambie de root. Contadores inválidos o reloj anterior al inicio registrado fallan cerrados.

Cada solicitud mantiene 1 MiB máximo y ahora limita base64 antes de decodificarlo. PDF se procesa como máximo en cinco páginas y la llamada Vision declara ese límite. Esta medida limita coste por solicitud; no equivale a aislamiento del parser ni a validación antivirus, que siguen en S-05. Los errores del proveedor ya no se devuelven al cliente.

Prueba ejecutada: `node --test qa/scripts/remediation-ocr-quota.test.cjs`, 5/5 pasando. Incluye perfil inexistente/inactivo/eliminado, roles y permisos, carreras actor/root mediante transacciones optimistas sintéticas con conflictos reales del fake, no débito parcial, instante de expiración, estado corrupto, cambio de root, root falsificado en payload, ausencia de invocación de parser/proveedor al denegar, compatibilidad de respuesta y redacción de fallo OCR. Ninguna conexión Firebase ni llamada Vision real. Estas pruebas no sustituyen un test con emulador ni la verificación de producción.

Estado S-04 de esta subtarea: implementado y probado sintéticamente; build central, integración y despliegue pendientes. El límite requiere observar uso legítimo después de publicación para ajustar valores si procede mediante cambio revisado; no hay excepción por entrada del cliente. El build lo ejecuta el agente principal para evitar compilaciones simultáneas.
