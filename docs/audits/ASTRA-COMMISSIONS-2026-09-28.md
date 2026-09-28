# Comisiones de usuario por cliente — 2026-09-28

## Alcance y origen contable

La configuración personal se identifica por `rootId + clientId + ownerUid`. No sustituye la regla BASE/comisionistas existente. Superadmin asigna instrumentos al titular utilizando un pago contabilizado de referencia; el usuario sólo decide la distribución de su propia utilidad. Ningún porcentaje recibido del navegador concede o incrementa utilidad.

El importe procede de `paymentFinancialSnapshots.resultSnapshot` (`superadminEarningAmount`, `adminEarningAmount` u `operadorEarningAmount`). Son elegibles los pagos `CONCILIADO`, `APLICADO_PARCIAL` y `APLICADO_TOTAL` con contabilización `POSTED`. Cancelados/rechazados quedan fuera. Aplicar un pago a facturas no elimina la utilidad ya contabilizada.

- `CONTRACT_COMMISSION_POINTS`: suma exactamente los puntos derivados del diferencial contractual y de una base comparable del snapshot. Precios fijos o bases distintas no inventan un porcentaje: esta modalidad queda bloqueada.
- `USER_EARNINGS_PERCENTAGE`: suma exactamente 100% del importe realmente ganado; admite contratos sin puntos comparables.
- Entre 1 y 50 instrumentos configurables, todos asignados al mismo propietario/cliente/root, activos y verificados en IQ. El reparto usa enteros/BigInt, resto mayor y orden estable para desempatar centavos.
- La reserva de todos los destinos es atómica. Se calcula previamente el tamaño de la transacción; una configuración que supere su capacidad se rechaza antes de escribir o enviar, con indicación de reducir destinos.

## Flujo y autorizaciones

`Mi cuenta > Tus destinos de comisión` permite seleccionar cliente, comparar ambas modalidades, validar cuentas, previsualizar centavos y guardar una versión. Cada distribución conserva la regla vigente al momento de contabilización; cambiar cuentas/reglas no modifica operaciones históricas. No se adopta retroactivamente una utilidad anterior a la configuración.

La solicitud manual parte del folio visible del pago. El servidor resuelve un único pago del root y comprueba el cliente seleccionado. La previsualización informa principal, costos vigentes de Dispersiones y total a descontar. Aceptar ese total reserva fondos; enviar es una operación explícita separada. La tabla Dispersiones muestra `Retiro de utilidad` y remite a Mi cuenta para la cancelación coherente de toda la solicitud.

La fuente discriminada `fundingSource` conserva `CLIENT` como valor predeterminado para operaciones anteriores. Para utilidad es `USER`, con propietario y `sourceClientId` obligatorios. Se reutilizan costos, folios, movimientos, reservas por despacho/canal, reversión y ejecutor IQ canónicos. El principal y sus costos se descuentan del saldo USER y del origen USER del cliente correspondiente; nunca del saldo CLIENT. También se preservan los abonos de costos que correspondan al propio usuario después del débito.

Los perfiles inactivos/eliminados o sin permiso de dispersión no pueden reservar ni ejecutar. Los instrumentos deben mantener identidad y verificación de IQ al calcular, reservar y enviar. Los lectores, notas, documentos y ejecutor genérico añaden alcance owner/root para USER; los incidentes genéricos no pueden liberar una reserva de comisiones. Los comprobantes USER no se notifican al grupo Telegram del cliente.

## Idempotencia y estados inciertos

La identidad de distribución/pedido depende de root, pago y propietario, no de la versión de la regla. Manual y diario utilizan el mismo pedido y los mismos IDs canónicos de dispersión. El ejecutor reclama transaccionalmente el pedido y sus principales antes de la validación final; ejecución concurrente/repetida no duplica envíos.

Una respuesta perdida o ejecución incompleta queda `UNCERTAIN`, sin segundo POST ni liberación automática. `PROCESSING` tras una interrupción exige conciliación, también sin vencimiento que reactive envíos. Principal y solicitud conservan el estado para impedir reintegros por caminos genéricos. La cancelación anterior al envío utiliza reversión y liberación idempotentes; `CANCELLING` permite terminar una cancelación interrumpida.

No se proporciona un botón para reiniciar estados inciertos. La recuperación exige evidencia de la operación IQ y revisión del estado del principal/reserva; no se implementó una inferencia de «no enviado» por tiempo transcurrido.

## Automatización

El scheduler revisa cada 15 minutos configuraciones explícitas. Por defecto no existe configuración y no prepara, reserva ni envía. Guardar requiere `America/Mexico_City`, hora de corte, días y fecha inicial; habilitar preparación y habilitar ejecución son opciones distintas. El motor conserva política/versiones, cursor y lease por root; reserva y envío utilizan exactamente el servicio manual. Cada invocación escanea hasta 250 pagos y ejecuta como máximo una solicitud de un propietario (incluidos sus N destinos). Un barrido incompleto conserva fecha de corte, cursor y propietarios pendientes al cambiar de día. Sólo un barrido completo reinicia desde el principio para una fecha nueva; así se alcanzan tanto la cola como los pagos incorporados detrás del cursor.

La hora y los días operativos reales están pendientes de decisión del usuario. Esta implementación no escribió ni activó configuración en producción. El modo de ejecución automática acepta los costos vigentes del pipeline Dispersiones al habilitarlo; su UI lo informa expresamente.

## Exportaciones nuevas (12)

`configureUserCommissionEntitlement`, `previewMyCommissionDestinations`, `saveMyCommissionDestinations`, `getMyCommissionSettings`, `getCommissionAutomationConfig`, `saveCommissionAutomationConfig`, `runDailyUserCommissionPreflight`, `prepareDailyUserCommissions`, `requestUserCommissionDispersion`, `previewUserCommissionWithdrawal`, `executeUserCommissionDispersion`, `cancelUserCommissionDispersion`.

El coordinador integra exportaciones, reglas Firestore/Storage, índices y manifiesto de descubrimiento. La consulta de la tabla utiliza `rootId ASC / createdAt DESC / __name__ DESC`; aplica permisos antes del límite de resultados con lectura acotada/cursor de avance. No descarta la primera página propia cuando antes existen retiros de otros propietarios.

## Verificación local

- Functions build: PASS, sesión 25394 (incluye reparación del cursor diario).
- `node qa/scripts/commission-distribution-domain.test.cjs`: PASS.
- `node scripts/verify-authorization-policy.mjs`: PASS.
- Adapter HTTP IQ real con proveedor en memoria: **29 PASS**, sin red. El origen USER exige partner, cliente, beneficiario y cuenta históricos exactos; perfil, despacho, tipo y fingerprint coinciden antes del envío. Reemplazar una cuenta con el mismo nombre y últimos cuatro dígitos queda bloqueado antes del POST. CLIENT conserva su contrato existente.
- Fixture ampliado Firestore/Storage: **110 comprobaciones PASS**, sesión 88250, salida completa del wrapper 0 y cierre de ambos emuladores. Incluye 3 ejecuciones financieras falsas y 13 invocaciones del adapter simulado de planificación, 0 POST IQ reales y 0 llamadas de producción: pago aplicado, diario habilitado sólo en fixture, cancelación/reintento, perfiles revocados/inactivos, privacidad documental, reglas reales de ambos servicios y paginación tras 225 retiros ajenos. El scheduler se verifica además con Firestore/cursor/auditoría reales y request/executor simulados: 251 pagos no elegibles, dos pagos con tres propietarios y múltiples destinos, continuidad durante tres fechas y un pago posterior insertado antes del cursor.
- Frontend build y despliegue: coordinados por root, fuera de esta subtarea.

Comando aislado: `node scripts/run-firebase-clean-env.mjs emulators:exec --config firebase.emulator-tests.json --project demo-pay0-commission --only firestore,storage "node qa/scripts/user-commission-emulator.cjs"` con `GCLOUD_PROJECT=demo-pay0-commission`.

No se hicieron llamadas financieras IQ, mutaciones de producción, provisión de saldos, cambios de usuarios Auth ni activación de automatización desde esta subtarea.
