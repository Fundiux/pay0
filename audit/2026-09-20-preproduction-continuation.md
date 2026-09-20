# PAY0 — auditoría maestra de cierre preproducción, continuación

Fecha: 2026-09-20
Cobertura: puntos 33–1608 entregados en los anexos posteriores. Es una continuación de `audit/2026-09-20-preproduction-part-1.md`, no un reemplazo.

## Dictamen ampliado

Se mantiene el dictamen **NO Production Ready**. La ampliación confirma que una certificación real requiere pruebas autorizadas contra Emulators y un smoke productivo controlado; no se deduce de los despliegues históricos descritos en `PAY0_ESTADO_MAESTRO.md`. El supuesto P0 de `upsertUser` quedó descartado al trazar su llamada previa a `getRootId`; la rama inalcanzable se eliminó como endurecimiento.

## Hallazgos nuevos

| ID | Origen | Severidad | Evidencia estática | Impacto / cierre exigido |
| --- | --- | --- | --- | --- |
| D-05 | CORREGIDO, pendiente de prueba | **P1** | `getPublicConstanciaVerification` y `getPublicQuotationVerification` ahora exigen `active === true`. | La baja o sustitución invalida el token. Falta prueba Emulator para activo/inactivo/expirado/sustituido y definir caducidad explícita de verificación pública. |
| D-06 | DISCOVERED | P1 | `getPublicConstanciaVerification` y `getPublicQuotationVerification` son callables con `invoker: "public"`; realizan búsqueda por token y devuelven metadata identificable. | El diseño de QR público puede ser correcto, pero es una decisión de divulgación, no sólo de integridad. Debe constar explícitamente qué campos son públicos, retención, revocación y rate limiting/monitorización de abuso. |
| D-07 | DISCOVERED | P2 | Hay múltiples scripts de despliegue dirigidos con diferentes conjuntos de targets; `package.json` despliega reglas/índices y `functions/package.json` despliega todas las Functions. | Riesgo de que el release no tenga manifiesto, smoke, rollback y revisión de funciones obsoletas uniformes. Crear un runbook canónico y un manifiesto de release; no sustituir los scripts históricos hasta inventariar sus consumidores. |
| D-08 | CORREGIDO | P2 | La alerta de complemento se alineó a siete días en política, automatización, dashboard, Agent007 y smoke Emulator. | El SLA operativo queda en una semana; conservar la prueba de borde día 6/día 7. |

## Validaciones positivas observadas

- Firma por enlace tiene expiración de siete días en `signatureLinks/callables.ts`; los endpoints verifican expiración antes de mostrar/enviar.
- Los tokens de descarga por Telegram tienen estado, expiración y respuesta `no-store`; se usan como capacidades temporales, no como acceso directo de Storage.
- Constancias guardan snapshot, `templateId` y `templateVersion`; esto coincide con el requisito de interpretar documentos históricos sin regenerarlos.
- Facturama usa llave de idempotencia para borradores y persiste identificador del proveedor antes de algunas fases posteriores; requiere prueba de timeout/reintento con proveedor simulado antes de certificación.
- La automatización de complementos evita reintento automático después de envío incierto y revisa una vez al día; preserva el principio de no duplicar una emisión remota.

## Matriz de auditoría de dominios restantes

| Área solicitada | Estado de evidencia | Siguiente prueba o análisis |
| --- | --- | --- |
| Adelantos y Wallet | Parcial: existen ledger, avances y dispersiones, pero no se inspeccionaron datos para confirmar que los liquidados desaparecen de la vista operativa. | Fixture Emulator con adelanto abierto, liquidado y revertido; confirmar saldo, historial y filtros. |
| Dispersión con timeout IQ | Parcial: hay reservas, locks y reconciliación; falta demostrar que no se libera saldo antes de conocer resultado remoto. | Prueba determinista: reservar → timeout → remoto completado/fallido → reconciliar, verificando una sola compensación. |
| Facturama producción | Parcial: hay idempotencia, emisión/cancelación/reconciliación. | Simulador de proveedor para timeout después de recepción, doble clic, XML/PDF fallido y cancelación 01. No timbrar producción como QA. |
| Queues IQ | Parcial: hay schedulers, task handlers, locks y estados. | Inventario de colecciones, cardinalidad/edad, terminales, reintentos y retención con lectura autorizada; no borrar históricos sin política. |
| IDOR / multiempresa | No certificado. | Rules Emulator y callable tests con usuario A contra root/empresa/cliente B para todas las entidades del enunciado. |
| MAT / Telegram / WhatsApp | Parcial, sin sesión/integración real. | Pruebas de sesión, expiración, scope por cliente y redacción segura de mensajes; validar webhook y enlaces de descarga. |
| UX, IDs internos y PDFs | No certificado visualmente. | Navegación autenticada con capturas mínimas y pruebas de strings para folio/UUID/errores; renderizar documentos de muestra sin datos reales. |
| Observabilidad y alertas | Parcial: Activity Log y algunos estados existen. | Matriz de alerta, deduplicación, dueño operativo, recuperación y SLA; probar transición incidente activo → recuperado → histórico. |

## Datos y producción que no se infieren del código

Quedan deliberadamente sin afirmar: documentos/Storage huérfanos, cardinalidad y antigüedad de queues, uso real de los 66 índices, costos, sesiones reales de MAT, estados históricos de adelantos, funciones aún desplegadas, secrets configurados, rendimiento y estado de proveedores. Requieren consultas de sólo lectura o pruebas controladas con autorización explícita.

## Próximo corte de evidencia

No ejecutar un deployment para “ver si funciona”. El siguiente corte debe ser: corrección de P0/P1 aprobada, Auth/Rules Emulator limpio, fixtures financieros desechables, pruebas de timeout e idempotencia, revisión de diffs y, sólo entonces, despliegue dirigido con post-deploy smoke y rollback documentado.
