# Puntos 7–12 y 18: filtros, presentación, notas e identidad

Implementación local del 28 de septiembre de 2026 sobre el worktree de reconciliación. Esta evidencia no declara una publicación en producción. Las especificaciones originales son los adjuntos `12015628-65bf-4c1d-94ed-a1cbfa91caa3`, `15dcff07-c85c-4056-80ba-141f0268c957` y el mandato de continuación `dab326cb-22a1-4dcc-a961-95370392bc82`.

| Punto | Implementación | Límite conservado |
|---|---|---|
| 7 | `creatorUid` en listPagos/listSolicitudes, wrappers tipados y selector Usuario. Filtro antes de ordenar/paginar. Directorio con nombres/username del root, jerarquía admin y autores de filas ya autorizadas. | Operador no puede usar el filtro ni obtener directorio. Admin conserva adminId; toda consulta exige rootId. No se muestra UID como nombre. |
| 8 | `CompactBalanceCells`: tres valores conservados, columnas de 84px, tipografía y espaciado compactos, amarillo pendiente/disponible, verde abonado/aplicado, estado parcial explícito. | No cambia fórmulas, campos, ordenamiento, totales, exportaciones ni número de columnas. Disponible de Pago no se presenta como deuda. |
| 9 | Token compartido `--pay0-row-hover` y capa amarilla tenue en filas de todas las tablas. | Conserva fondos de estado. Filas con aria-selected/data-state selected no reciben la capa. |
| 10 | Autoría de notas asignada por servidor; manual = usuario real, automática = Sistema con iniciador separado. Lectura de legado no destructiva. Eliminados productores rutinarios descritos abajo. | ActivityLog y estados financieros se conservan. Notas con información de rechazo, recuperación, corrección o aplicación se mantienen. |
| 11 | Nombre del creador debajo del folio en Solicitudes/Pagos para superadmin; misma fuente que el filtro. | Legado sin identidad resoluble muestra No disponible. No se inventa usuario ni se amplía el acceso. |
| 12 | María en launcher, burbuja, cabeceras, chat, etiquetas de historial, botones, errores visibles, diagnósticos y prompt de conversación. | Identificadores HUGO, rutas /hugo, colecciones, exports, APIs, códigos e histórico permanecen compatibles. El puente posterior de voz recupera Marin/P0/P0.5 sin promoción; su alcance y pruebas están en `ASTRA-VOICE-IQ-STAGING-20260928.md`. |
| 18 | Plantilla operativa Telegram de pagos IQ: evento, folio/importe, contexto breve y motivo/acción en eventos relevantes. Sin UID ni nombre técnico de origen. | Se mantienen deduplicación, destinatarios y condiciones de envío. No se enviaron mensajes. Esta rama no conecta conversación agent007 con Telegram; no se creó un canal paralelo. |

## Inventario de productores de notas

| Productor | Clasificación y decisión |
|---|---|
| index.createSolicitud / createPago | Sólo escribían comentario/notaInicial explícitos. Se conserva la condición y se agrega identidad humana del perfil autenticado, tipo COMMENT, origen MANUAL y referencia. |
| notes.addSolicitudNota / addPagoNota | Manual: perfil autenticado, texto recortado, root/propietario/admin verificados. No acepta autoría enviada por cliente. |
| financing.addDispersionNota | Manual: misma identidad, conservando autorización por delegación y contexto de dispersión. |
| iq.solicitudCreation / CreateQueue / Reconciliation | Se retira nota `iq-folio`; el folio ya está en solicitud/creación IQ. No genera aviso de nota sin conversación. Históricos permanecen. |
| iq.solicitudInvoiceImport | Se retira nota rutinaria de PDF/XML importados y su badge. Se conserva `IQ_FACTURA_IMPORTADA` y los documentos. |
| iq.solicitudStatusMonitor | Rechazo/corrección útil: Sistema, origen IQ, tipo REJECTION, motivo completo. |
| iq.pagoDeposit creation | Se retira nota de depósito creado/vinculado automáticamente. Estado, notificación y auditoría existentes se conservan. |
| iq.pagoDeposit recovery/reconciliation/terminal | Se conserva contexto relevante como Sistema. Rechazo incluye motivo disponible y acción; iniciador humano separado. |
| iq.pagoDeposit manualLink/omit, callable y HTTP | Observación/decisión manual: autor real, sin atribuirla a IQ. |
| pagoDocuments retry / controlled amount edit | Reintento habilitado = Sistema; corrección con motivo del humano = usuario real. Se conservan montos y referencias. |
| paymentApplications atomic batch | Se conserva nota útil de monto aplicado y lote; autor Sistema, iniciador y batchReservationId auditables. No cambia transacción ni asientos. |
| Legado | `notePresentation` interpreta metadatos y formatos automáticos conocidos. No reescribe ni borra documentos; autor humano desconocido se muestra como Usuario no disponible. |
| Materialidad/comunicaciones | Sin productor adicional de subcolección notas encontrado en esta fuente. Sus auditorías/documentos mantienen sus contratos. |

## Verificación local

- `record-creators-notes-emulator.cjs`: PASS 47 controles de scope, filtro, paginación con timestamps iguales, identidad humana, notas manuales, autoría no suplantable y rechazo simulado. Proyecto demo-pay0; ninguna acción externa.
- `notes-identity-telegram-smoke.cjs`: PASS 46 aserciones de legado, identidad, prompt María, seis eventos Telegram y prevención de productores rutinarios.
- `record-presentation-ui-smoke.cjs`: PASS con Chromium local; selector/teclado/reset, tres importes, parcial/pagado, ancho compacto, hover y selección, móvil sin overflow global, sin errores de navegador. Fixture usa componentes reales y CSS; no simula la página operativa completa.
- Frontend `tsc --noEmit --incremental false`: PASS. Verificador de política: PASS. `git diff --check`: PASS.
- Build Functions de integración detectó dos incompatibilidades Buffer en documentos de otro frente; el propietario las corrigió. Rebuild integrado queda a cargo del agente raíz.
- No se ejecutaron IQ, timbrado, Telegram, WhatsApp ni handlers productivos. REP permanece pausado.

## Hallazgos transversales entregados al agente raíz

| Punto | Fuente existente y commits observados | Brecha al iniciar esta continuación |
|---|---|---|
| 13 | paymentApplications/{service,callables,iqExecution}; bases 6f9865b, 3323300, db2a769; correcciones IQ 9fcd8c9/ffd673b/ff98f54. | Motor atómico y ejecutor existen; falta demostrar asignación automática completa desde identificación. |
| 19 | solicitudCreateQueueCallables: tarea inmediata y lock por perfil; 332df25/c94c6f8/7d817b2. | Seguimiento/SLA real y resolución de identidad deben comprobarse; no duplicar cola. |
| 20 | Reportes manuales y comisión contabilizada. | No se encontró cierre/entrega diaria automática. |
| 21 | commissionDistributions + ClientCommissionRulePanel + reporte, 1c60ec8/fe2b98b/4ee9403. | Reglas y cálculo existentes; falta entrega financiera y vinculación contractual por usuario. Se informó scope insuficiente en preview/process para corrección de raíz. |
| 22 | receiptPdfCallables, pagoReceipt y flujo batch en pagos; 6f9865b/33a4a26. | Parser y matching asistido existentes, pero creación exige acción manual y matching inicial estaba en navegador. No existe integración bancaria entrante en esta fuente. |

El tracker raíz registra la evolución posterior de estos hallazgos; esta tabla conserva el punto de partida, no reemplaza su estado actual.
