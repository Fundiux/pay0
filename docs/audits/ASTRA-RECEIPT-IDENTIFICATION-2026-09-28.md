# Identificación y registro de comprobantes

Estado de publicación y comprobaciones conjuntas:
[cierre técnico ASTRA](ASTRA-PUBLICATION-2026-09-28.md).

El lote de Pagos analiza PDF e imágenes con el servicio existente. El servidor propone un registro sólo con cliente y empresa inequívocos: RFC o cuenta completa, corroboración de identidad, mismo root y permisos vigentes. Las sugerencias aproximadas del navegador siguen disponibles para la captura manual; nunca autorizan un registro automático.

El tipo de operación requiere selección explícita porque determina los costos. Al validar esa selección, una propuesta `READY` se registra y adjunta sin un segundo botón de creación. Si falta identidad, hay señales contradictorias, importes ambiguos, moneda sin confirmar, fecha ambigua o ejecución de transferencia sin confirmar, la fila permanece para revisión con motivo en español. Un saldo bancario no se convierte en importe autorizado. La lectura conserva separadores de miles y centavos.

El servidor guarda una identificación privada por root, actor y SHA-256 del archivo. `createPago` vuelve a comprobar la propuesta dentro de su transacción existente, junto con el deduplicador y las secuencias financieras. Referencia y concepto se conservan para la aplicación posterior a facturas. Cambiar empresa, cliente, tipo, monto, fecha o señales invalida la propuesta.

Si se creó el pago y falló la carga, volver a analizar el mismo archivo permite retomar únicamente ese pago, con el mismo actor, root, identidad y permisos. El backend verifica el SHA-256 real de Storage y relee pago, carga e identificación dentro de una transacción antes de pasar de `REGISTERED_AWAITING_RECEIPT` a `RECEIPT_READY`. Dos cargas idénticas convergen al comprobante publicado; repetir la finalización no aumenta versiones, escribe actividad ni desbloquea IQ otra vez. Un archivo diferente no completa la identificación original.

La tabla de Pagos también muestra «Aplicación por revisar» y un motivo humano para las decisiones `automaticApplication.REQUIRES_REVIEW`. La resolución usa la aplicación manual existente; ningún UID o código interno se presenta como motivo.

## Evidencia local

- Ejecución 2026-09-28: `75 PASS`, salida 0; Functions build y comprobación completa de tipos del frontend PASS. El lanzador cerró sus emuladores y dejó libres sus puertos al finalizar.
- `qa/scripts/receipt-identification-emulator.cjs` usa los módulos compilados y las funciones reales de presentación. Ejecuta Firestore y Storage locales con proyecto `demo-*` y bloquea transporte HTTP externo.
- Cubre parser, tres roles, permisos revocados, scopes cruzados, reglas privadas, propuesta alterada, consumo concurrente de identificación, recuperación, hash de bytes y finalización repetida.
- La primera prueba ejercita el guard y su consumo transaccional. Después se agregó un fixture que invoca `createPago.run` completo: **17 PASS**, salida 0, sobre Firestore/Storage locales. Dos registros simultáneos producen un solo pago, el folio canónico y los costos vigentes; se comprueban archivo correcto, alteración de propuesta, permisos revocados, actor ajeno y repetición. La actividad se verifica en la colección canónica PAY0. El pago conserva el flujo de conciliación y no se aplica anticipadamente a facturas.
- No se ejecutaron OCR externo, IQ, mensajería ni operaciones financieras productivas. REP permanece sujeto a la pausa del usuario.

El resultado final de las compuertas se registra en el informe general del ciclo.
