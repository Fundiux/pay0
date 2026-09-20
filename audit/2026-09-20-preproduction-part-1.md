# PAY0 — auditoría maestra de cierre preproducción, Parte 1

Fecha: 2026-09-20
Método: revisión estática del árbol y configuración actual, más compilación de frontend/Functions y verificación de política. No se consultó producción, no se ejecutaron integraciones externas ni se alteraron datos.

## Dictamen

**No declarar PAY0 listo para producción.** Hay un P1 de expediente de Materialidad que puede quedar desactualizado. El supuesto P0 de autoalta administrativa fue descartado al trazar el flujo completo: `getRootId(uid)` ya exige que `users/{uid}` exista. La rama heredada inalcanzable se eliminó posteriormente para que el contrato sea explícito.

## Evidencia de verificación

| Comprobación | Resultado |
| --- | --- |
| `node scripts/verify-authorization-policy.mjs` | PASS: política `PAY0-USERS-PERMISSIONS@1` sincronizada en frontend, Functions y Firestore. |
| `npm run build` | PASS: build optimizado Next.js. |
| `functions/npm run build` | PASS: `tsc` y copia de recursos canónicos. |
| Producción, IQ, Facturama, Telegram, WhatsApp | No ejercidos: fuera de alcance y sin autorización para acciones reales. |
| Emuladores/reglas E2E | Ejecutados mediante `emulators:exec`; los puertos quedaron liberados tras las pruebas. |

Las compilaciones validan tipos y empaquetado; no sustituyen autorización, reglas ni recorridos financieros reales.

## Hallazgos bloqueadores

| ID | Origen | Severidad | Evidencia | Riesgo y acción propuesta |
| --- | --- | --- | --- | --- |
| D-01 | DESCARTADO | — | La lectura inicial omitió que `getRootId(uid)` precedía a la rama y niega el callable si `users/{uid}` no existe. | No fue un vector explotable. Se eliminó la rama inalcanzable; el callable ahora niega explícitamente perfiles ausentes. |
| D-02 | DISCOVERED / KNOWN (Materialidad no se actualiza) | **P1** | `functions/src/modules/materiality/service.ts:382-515` reconstruye por llamada y persiste un snapshot/referencias. Las rutas de invocación encontradas son creación de solicitud, documentos de solicitud, cotización, constancia, recuperación y UI; no existe trigger de `pagos`, `uploads` de pago, `facturamaInvoices`, firma ni comprobante. | Una operación ya creada puede no reflejar eventos posteriores, aunque `getActivePagoUploadsBySolicitud` los leería durante un nuevo sync. Definir eventos fuente y una proyección idempotente/cola; cubrir factura, pago, complemento, firma y nuevo documento con pruebas E2E. No tratar el botón “Sincronizar” como garantía de completitud. |

## Inventario actual y estado preliminar

Clasificación basada en rutas, servicios y exports; “activo” significa que hay superficie y backend, no que el flujo esté certificado.

| Dominio | Superficie / backend principal | Estado |
| --- | --- | --- |
| Dashboard, reportes, activity log | `/dashboard`, `/reportes`, `/activity-log`; reportes/control center/activity log | ACTIVO, pruebas de negocio insuficientes |
| Solicitudes, documentos, firma, cotización | `/solicitudes`, verificación pública; `createSolicitud`, documentos, IQ, cotizaciones, constancias | ACTIVO; flujo crítico pendiente E2E |
| Pagos, aplicaciones, complementos | `/pagos`, `/pagos/reproceso`; pagos, IQ depósitos, `paymentApplications` | ACTIVO; alto riesgo financiero, pendiente certificación |
| Wallet, adelantos, dispersión, beneficiarios, estados de cuenta | seis rutas `/wallet/*`; ledger/financing/beneficiaries | ACTIVO; navegación y estados requieren auditoría específica |
| Materialidad | `/materialidad`, `/materialidad/[id]`; módulo materiality | PARCIALMENTE ACTIVO por D-02 |
| Facturación / Facturama | `/facturacion`; drafts, emisión, cancelación y catálogo SAT | ACTIVO; integración productiva no probada |
| IQ | `/integraciones/iq`, diagnóstico y automatización;  múltiples workers/callables | ACTIVO; complejo y dependiente de configuración |
| Telegram, MAT, WhatsApp, Hugo | rutas Telegram/MAT/WhatsApp/Hugo; webhooks, mini-app, delivery, Agent007 | PARCIALMENTE ACTIVO; requiere revisión aislada de datos externos |
| Clientes, despachos, usuarios, módulos, catálogos | rutas y callables dedicados | ACTIVO; D-01 invalida la confianza en el onboarding |
| Assets | `/assets/*`; módulo assets | EXPERIMENTAL / cambio local no auditado: hay modificaciones sin confirmar en esta rama |
| `/setup-superadmin`, `/systems`, `/mensajes` | rutas presentes | NO DETERMINADO; confirmar si son onboarding, selector o rutas aún soportadas |

El inventario de rutas contiene 44 páginas App Router. La navegación visible procede de `getVisibleSidebarNav`; debe compararse explícitamente contra estas rutas antes de clasificar una página como huérfana.

## Mapa de flujos críticos

| Flujo | Ruta técnica identificada | Estado de auditoría |
| --- | --- | --- |
| Solicitud → documentos → IQ → factura | UI → `src/services/solicitudes.ts` → callables → `solicitudes/uploads/iq*` → Facturama/Materialidad | Parcial; la creación genera folio y hace control de root/cliente/empresa, pero no se ejecutó contra emulador/IQ. |
| Pago → conciliación → aplicación → Wallet | UI → `pagos*.ts` → `createPago`/aplicaciones/IQ depósitos → pagos, aplicaciones, ledger | Parcial; el flujo de complementos tiene smoke aislado, no hay certificación de posteo, reversa, parcialidades ni terminalidad. |
| Complemento PPD | trigger `pagoAplicaciones` → `paymentComplementJobs` → proveedor → scheduler diario → documentos | Diseño robusto observado: deduplicación por hash, estados UNKNOWN/BLOCKED, persistencia de ID antes de descargas y chequeo diario 19:00 CDMX. La alerta se alineó a los 7 días y se cubre con smoke Emulator. |
| Materialidad | solicitud/documento/UI/recovery → `linkSolicitudToMaterialityOperationCore` → `materialityOperations` | Parcial; ya hay trigger ante cambios relevantes en `uploads`, pero faltan pruebas E2E de todos los eventos fuente y proyecciones de eventos que no pasan por uploads. |

## Automatización, Functions y costo

Se identificaron 13 schedulers declarados: Control Center (2), IQ solicitud/depósito/factura/status/reconciliación/dispersiones, aplicaciones y complemento. Hay 3 task handlers y al menos 10 triggers Firestore. La clasificación completa por función todavía exige extraer consumidor, auth, persistencia e idempotencia de cada export (el índice concentra más de cien exports).

| ID | Origen | Severidad | Evidencia | Acción propuesta |
| --- | --- | --- | --- | --- |
| D-03 | DISCOVERED | P1 | `iqIntegrationConfigs/{rootId}.enabled` es un Master Switch de IQ (`operatingCalendarCallables.ts`). Complementos usan su propio `paymentComplementConfigs/{rootId}` y Control Center/WhatsApp tienen automatizaciones separadas. | No hay evidencia de un interruptor maestro transversal que pause toda automatización. Documentar el contrato de cada interruptor y, si el requisito es global, crear una sola política consultada por cada trigger/scheduler antes de escribir. |
| D-04 | DISCOVERED | P2 | `checkPaymentComplementsDaily` pagina **todos** los `paymentComplementJobs` globales cada día, aun cuando sólo unos estados requieren chequeo. | Riesgo de costo/latencia creciente. Crear consulta indexada por estado/próxima revisión o cola de trabajos vencidos; medir cardinalidad en producción antes de cambiar. |
| K-01 | KNOWN | P2 | Los schedulers IQ retirados dejan comentarios históricos en `functions/src/index.ts`; los workers activos se exportan más abajo. | Comparar `firebase functions:list` de producción con este inventario antes de eliminar funciones. No hay evidencia local suficiente para decidir qué deployment legacy sigue activo. |

## Firestore, Storage y aislamiento

- `firestore.rules` niega escrituras directas en las colecciones financieras principales y las operaciones pasan por Functions. Las reglas incluyen root, asignación y delegación para Solicitudes/Pagos.
- `storage.rules` restringe rutas de Solicitudes, Pagos, Dispersiones, documentos de entidad y Assets a una preparación previa; objetos son inmutables tras la carga.
- Hay 66 índices compuestos, de ellos Pagos tiene 4. La “proliferación” indicada como pendiente conocido no puede confirmarse ni corregirse desde configuración estática: falta cruzar cada índice con consultas reales y métricas/errores de producción.
- No se pueden afirmar referencias huérfanas, duplicados de Storage ni documentos atrapados sin un scan de datos autorizado y de solo lectura.

Pruebas obligatorias siguientes: Auth/Rules Emulator con dos roots para leer y mutar entidad A desde usuario B en Solicitudes, Pagos, Wallet, Dispersiones, Beneficiarios, Materialidad, documentos, Facturama, reportes y Activity Log. D-01 debe corregirse antes de considerar estas pruebas suficientes.

## Estados, UX y exposición de IDs

No se hizo aún una normalización global de estados ni una revisión visual navegada. Sí se localizaron máquinas de estado para Solicitud y Pago (`functions/src/utils/solicitudStatusMachine.ts`, `functions/src/modules/pagos/domain.ts`) y múltiples superficies Wallet. Quedan pendientes: inventario de enums/strings, transiciones terminales, revisión responsive y el barrido de UUID/Firestore IDs en tablas, toasts, URLs y mensajes externos. No certificar cumplimiento de la prohibición de IDs internos por una búsqueda textual solamente.

## Procesos de prueba y emuladores

Los wrappers de reglas usan `firebase emulators:exec`, y varios scripts tienen `finally`; `scripts/assets-v2-emulator-smoke.cjs` también cierra recursos. Aun así, no hay un único lanzador obligatorio para todo script que use emuladores, ni una comprobación común de puertos/limpieza. Estandarizar un runner que compruebe puertos, propague SIGINT/SIGTERM y cierre hijos en `finally`; no introducir emuladores persistentes con `emulators:start` en pruebas CI.

## Plan de cierre recomendado

1. Diseñar y probar la proyección idempotente de Materialidad para cada evento fuente (D-02); definir si conserva referencias o snapshots mínimos.
2. Resolver el contrato de Master Switch; la política de complementos ya se alineó a 7 días.
3. Ejecutar Rules Emulator multiempresa y flujos E2E con fixtures desechables y cleanup garantizado.
4. Hacer el scan de producción de solo lectura para índices, colecciones, Storage, tamaños, referencias y costos; después completar la matriz función por función y el inventario de estados.

Se realizaron endurecimientos acotados de seguridad, verificación pública, alerta de complementos y sincronización de Materialidad; las pruebas y el despliegue final permanecen sujetos al cierre de los restantes criterios de esta auditoría.
