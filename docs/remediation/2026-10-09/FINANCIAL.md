# S07 / AR03–AR05 — concurrencia financiera

Fecha: 2026-10-09. Alcance: verificación local y corrección puntual autorizada de resultado HTTP ambiguo; no despliegue, datos productivos, credenciales ni proveedores remotos.

## Fuentes y controles revisados

La trazabilidad de auditorías está en `ARCHITECTURE-REVIEW.md` (AR03–AR05). Se revisaron `iq/pagoDepositCallables.ts`, `pagoDepositHttpCreateFlow.ts`, `depositHttpCreateCore.ts`, `depositHttpCreateFirebaseAdapters.ts`, `automationSafety/runtime.ts`, `paymentApplications/complementAutomation.ts`, `complementGates.ts`, y `commissionDistributions/service.ts` y `triggers.ts`.

El trigger de pago encola una generación por comprobante. Task automático y scheduler comparten `createPagoIqDepositFromQueueCoreH4D62C` y el mismo core HTTP/adaptadores. El Task comprueba generación, elegibilidad y configuración; el scheduler aplica intervalo y recuperación. La exclusión de efecto proviene de la transacción Firestore, no del límite de concurrencia de Cloud Tasks. El core persiste intención antes del POST; una excepción del transporte deja resultado desconocido y bloqueo de reintento.

REP reclama QUEUED/PAUSED transaccionalmente a PREPARING, valida origen/configuración, consume cuotas por raíz/perfil/acción/día y persiste SENDING antes de pedir al proveedor. UNKNOWN no vuelve a ejecutar la solicitud; la consulta diaria solo busca/importa. SafetyRuntime añade identidad por operación, lease, intención de efecto y fencing. Comisión deriva identidad de raíz/pago/versión de regla y crea distribución más auditoría en una única transacción.

Se inspeccionaron las suites existentes `payment-complement-gates-emulator-smoke.cjs`, `commission-distribution-domain.test.cjs` y las secciones relevantes de `iq-immediate-discovery.emulator.test.cjs`. La nueva suite reutiliza sus contratos de fixtures y transporte; ejecuta TypeScript actual, sin depender de `functions/lib` ni lanzar compiladores en paralelo.

## Reproducción

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File qa/scripts/remediation-financial-concurrency-run.ps1
```

Proyecto exigido: `demo-pay0-financial`; Firestore loopback `127.0.0.1:18087`. CLI con configuración temporal aislada y DEBUG desactivado. `global.fetch` rechaza red; el core IQ recibe transporte falso con origen loopback; adaptadores REP registran llamadas. Los datos son sintéticos y se pierden al cerrar el emulador. No se ejecuta Functions emulator, Tasks remoto, scheduler remoto, IQ, Telegram o WhatsApp.

## Evidencia ejecutada

Primera ejecución: exit 0, siete escenarios aprobados:

| Escenario | Evidencia |
|---|---|
| Pago IQ, cinco workers concurrentes y replay | Una ejecución completada, un POST, replay rechazado por vínculo existente |
| Pago IQ, efecto externo seguido de excepción de transporte | OUTCOME_UNKNOWN; lease vencido no permite segundo POST |
| SafetyRuntime, orígenes TASK/TRIGGER/SCHEDULER | Una admisión; lease con efecto pendiente vence a OUTCOME_UNKNOWN; ticket antiguo pierde fence y no finaliza |
| REP, cuatro workers y respuesta perdida | Una solicitud; UNKNOWN; ejecución directa, protegida y consulta diaria no repiten POST; una consulta |
| Cuota LOOKUP, dos jobs distintos y última plaza | Una admisión; competidor REP_GATE_QUOTA_EXHAUSTED |
| Cuota REQUEST, dos jobs distintos y última plaza | Una admisión; competidor REP_GATE_QUOTA_EXHAUSTED |
| Comisión, cinco entregas del trigger y replay | Una distribución y un evento de auditoría; suma de legs conserva 60000 centavos |

La prueba de orígenes de SafetyRuntime invoca el runtime real con metadatos distintos; no es una ejecución del scheduler desplegado. El core de depósito sí usa adaptadores Firestore reales; autenticación y catálogos previos al core quedan fuera. Comisión prueba materialización, no desembolso externo de cada leg ni entrega documental.

Ejecución final tras corrección IQ-504: **exit 0; 17 escenarios aprobados** (siete base, nueve respuestas ambiguas y control HTTP422). Todos los estados ambiguos conservan exactamente un POST tras replay. El CLI emitió aviso al detener Firestore después del resultado exitoso; no altera las aserciones ejecutadas.

## Seguimiento

- IQ-504 (alto, confirmado y corregido): segunda ejecución exit 0 reprodujo **dos POST** para un mismo pago cuando el proveedor falso registra efecto y devuelve HTTP504. El core clasificaba toda respuesta distinta de HTTP201/message success como POST_REJECTED; el adaptador liberaba el bloqueo y el callable traducía a FAILED_RETRYABLE. Tras autorización de root, `depositHttpCreateCore.ts` conserva OUTCOME_UNKNOWN para respuestas ambiguas y utiliza la recuperación por consulta existente; si no encuentra vínculo, mantiene retryBlocked. La regresión sustituye la caracterización del fallo por exigencia de un único POST para 408, 500, 502, 503, 504, 200, 201 con cuerpo inesperado, 409 y 429. HTTP422 comprueba que el rechazo explícito sigue siendo rechazo.
- Clasificación de rechazos explícitos: HTTP400, 401, 403, 404, 405, 410, 413, 415 y 422 mantienen POST_REJECTED. Son códigos de negativa de solicitud, autenticación, autorización, ruta, método o validación; no contienen códigos de timeout/servidor. Cualquier otra respuesta, incluso 2xx diferente de 201 o 201 sin mensaje success, se trata conservadoramente como resultado incierto. No se añadieron reintentos ni segundo POST automático.
- Fencing del adaptador IQ: `release` no compara token. No se declara duplicación confirmada: el core actual mantiene retryBlocked desde adquisición hasta resultado, y PREVALIDATED no se emite por el flujo actual. SafetyRuntime sí tiene fencing demostrado. Un cambio futuro que habilite recuperación de lease debe revisar este contrato.
- No se afirma cierre general AR03–AR05: faltan matriz completa de estados operativos, ejecución externa de legs/complementos y validación contractual de proveedores. La prueba local no puede demostrar garantías de idempotencia de un proveedor real.

Verificador de política de autorización aprobado. Builds frontend/Functions pertenecen al gate coordinado por root; esta suite no lanza tsc ni build. Sin commit o despliegue desde este agente.
