# PAY0 Control Center — Contrato analítico v1

## Propósito

Este contrato separa la lógica operativa de la presentación analítica. Los módulos de PAY0 publican hechos inmutables; el Control Center consume agregados derivados y nunca modifica una operación financiera.

## Definiciones financieras

- **Facturación emitida:** importe de CFDI emitidos y no cancelados. No equivale a efectivo recibido.
- **Cobranza recibida:** importe de pagos recibidos, aun cuando todavía no estén aplicados.
- **Pagos aplicados:** importe de pagos efectivamente aplicado a solicitudes u operaciones. No equivale a ingreso propio.
- **Gastos registrados:** gastos reconocidos por una fuente canónica y vinculados a la operación.
- **Utilidad operativa:** requiere ingresos propios y gastos con cobertura contable validada. No se calcula restando gastos al volumen de pagos de clientes. Se mantiene no disponible mientras falte esa cobertura.
- **Flujo neto:** cobranza recibida menos salidas efectivas del periodo.
- **IVA/ISR estimado:** aproximación analítica identificada expresamente como estimación; no sustituye el cálculo contable o fiscal.

## Reglas obligatorias

1. Todo evento incluye `rootId`; no existe evento global implícito.
2. `eventId` es estable e idempotente. Un reintento no crea un segundo evento.
3. El mismo `eventId` no puede representar otra raíz, tipo o entidad.
4. Los importes se almacenan en centavos enteros (`*Minor`) para evitar errores de punto flotante.
5. La moneda inicial soportada es MXN.
6. Los días usan `America/Mexico_City`. Los buckets semanales conservan ISO para compatibilidad; la interfaz suma días del rango canónico de Solicitudes/Pagos (domingo a sábado), sin sustituirlos por una semana ISO diferente.
7. Todo KPI tiene versión, fórmula semántica, eventos fuente, dimensiones y ruta de evidencia.
8. Todo widget declara permisos, filtros, KPIs, renderer y política de actualización.
9. Los eventos no contienen secretos, CSD, contraseñas, tokens ni documentos completos.
10. Corregir una definición crea una versión nueva; no cambia silenciosamente el significado histórico.

## Periodos canónicos

- Día: `YYYY-MM-DD`
- Semana: `YYYY-Www`
- Mes: `YYYY-MM`
- Año: `YYYY`

## Ubicación de la implementación

- Contrato y validación: `functions/src/modules/controlCenter/contract.ts`
- Catálogo de KPIs y widgets: `functions/src/modules/controlCenter/catalog.ts`
- Persistencia idempotente: `functions/src/modules/controlCenter/eventStore.ts`

## Alcance de la fase 3A

La fase 3A formaliza el lenguaje analítico. Todavía no conecta todos los módulos operativos al almacén de eventos ni reemplaza el snapshot productivo actual. Esa migración corresponde al agregador incremental de la fase 3B.

## Interconexión 3B (2026-09-19)

- Sin entidad Proyecto ni filtros `projectId`.
- Adaptadores para 20 fuentes operativas. Transacción por contribución que lee la fuente actual, revierte el aporte anterior y suma el nuevo; soporta reintentos, cambios de dimensión y borrado. Publica `SOURCE_RECONCILED` en `analyticsEvents` y revisión dentro del root.
- Agregados diarios, semanales, mensuales, anuales y actuales. La API lee documentos agregados, no escanea operaciones. Máximo 366 días por consulta más comparación de igual duración inmediatamente anterior.
- Consolidación histórica por páginas de 50 con lease y cursor del servidor. Hasta completarla, la interfaz advierte histórico incompleto. Una vez completa, el resumen programado usa agregados y deja de escanear 5,000 documentos por fuente.
- Acceso consolidado sólo Superadmin, autorizado en backend con root derivado del perfil. No se amplían permisos de admin/operador ni reglas de Firestore/Storage.
- Una dimensión a la vez más periodo; no se anuncian combinaciones aún no implementadas. Selector limitado a 500 valores con aviso explícito. Saldo actual, incidencias y auditoría reciente se rotulan aparte del periodo.
- Pagos, aplicaciones, comisiones y saldos se separan. No se supone IVA del 16% para reconstruir el importe de CFDI. Emisión conserva `Total` del XML; importes históricos desconocidos se muestran como incompletos.
- Gastos: reconocimiento explícito Superadmin, evidencia de gasto activa del mismo root, idempotencia por operación y reversión auditable. No ejecuta pagos ni determina deducibilidad. La cobertura contable todavía requiere validación; utilidad no disponible.
- Recuperación: reintenta borrador/materialidad con permisos vigentes del actor original, máximo cinco intentos y lease; documentos quedan para revisión para no reemplazar evidencia por una versión incorrecta. Nunca timbra, cancela ni transfiere fondos.
- IQ, WhatsApp y Telegram reflejan trabajos registrados, no disponibilidad del proveedor. Hugo recibe avisos de emisión/recuperación, sin confundir observación con aprendizaje.
- El bloque de conteos de módulos no es un embudo de conversión de una cohorte. Predicciones e impuestos no se inventan con datos insuficientes.

## Verificación y operación de la entrega 3B

- Backend: compilar `functions` con Node 22. Suite local con `firebase emulators:exec --config .firebase.qa-control-center.json --project demo-pay0 --only firestore`. Ejecutar los scripts `qa/scripts/control-center-{contract,event-store,emulator,connections,ui}-smoke.cjs` dentro de esa sesión. UI requiere build frontend y Chromium de Playwright.
- El smoke fiscal es una prueba de integración con el trabajo fiscal previo del workspace; simula PAC/Storage y no timbra. La prueba concurrente de Hugo se activa con `PAY0_QA_HUGO_CONCURRENCY=true` cuando está disponible su callable de aprobación.
- Estos tests usan Admin SDK/handlers contra Firestore Emulator; no sustituyen pruebas de Security Rules ni navegación autenticada de producción.
- `scripts/deploy-control-center.ps1` limita explícitamente targets por fase; no publica reglas/índices. Requiere autorización para producción.
- `scripts/consolidate-control-center.cjs` usa autorización existente de Firebase CLI, sin guardar credenciales. Por defecto sólo inspecciona; `--apply` consolida datos derivados, `--verify` compara contribuciones con el agregado global. Exige un único root existente, nunca lo adivina.
- Cierre 2026-09-19: 2,070 contribuciones productivas, snapshot incremental v2 y 37 métricas verificadas sin diferencias; 30 Functions de Control Center activas y Hosting publicado. Sin movimientos financieros ni mensajes reales. No se verificó UI autenticada de producción por ausencia de sesión disponible.
