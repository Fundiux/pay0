# Aplicación automática de pagos y continuación IQ

Estado: probado localmente; despliegue y postflight pendientes.

La medición previa de producción encontró 188 pagos y 81 aplicaciones. Entre
189 intentos de IQ había 63 `FAILED_SAFE` sin submit ni acción externa. Los
problemas más frecuentes fueron identidad de cliente y coincidencia del
depósito. Se recuperó la identidad de origen certificada, incluido el asociado;
no se reintentaron operaciones históricas ni se ejecutaron POST financieros.

## Aplicación local

- Sólo pagos nuevos con revisión `ASTRA_V1`, conciliación, posting `POSTED` y
  comprobante activo `READY` entran al motor automático.
- La referencia debe contener UUID fiscal completo, folio PAY0 completo o
  serie y folio de factura. Importe y semejanza de nombres no autorizan nada.
- Se exige el mismo root, cliente, empresa y moneda; la factura debe estar
  emitida y tener saldo. Una factura admite abono parcial. Varias sólo se
  aplican si la suma exacta de pendientes determina todo el reparto.
- Ambigüedad, exceso, moneda incompatible, duplicidad fiscal y falta de
  permisos quedan para revisión. Los límites de consulta son explícitos.
- Se reutiliza `applyPaymentApplicationBatchAtomic`: folios, saldos, asientos,
  notas y auditoría se escriben en la transacción existente. La transacción
  vuelve a verificar origen, usuario, comprobante y candidatos antes de escribir.
- Hay eventos para conciliación, comprobante listo y factura recién importada;
  no hay polling adicional. Los cambios de seguimiento no relanzan el proceso.
- Las decisiones repetidas sin cambios no escriben timestamps ni actividad.

## Continuación IQ

La escritura del pago continúa mediante el mismo plan y la misma Cloud Task
del flujo manual. El scheduler existente recupera entregas. Ambas vías respetan
master, flujo y horario IQ; los estados inciertos, en progreso, completados o
fallidos que requieren revisión no se reenvían automáticamente. Tres fallos de
preparación para la misma fuente detienen nuevos intentos hasta que cambie la
fuente. Los eventos tienen una ventana de recuperación de veinte minutos.

## Evidencia

- Functions build: PASS.
- `automatic-payment-application-emulator.cjs`: 44 verificaciones PASS con
  Firestore real local: concurrencia, aplicación parcial y múltiple, ausencia de
  duplicados, fuente modificada, usuario revocado, comprobante faltante,
  decisiones sin escrituras repetidas y compuertas IQ.
- Identidad IQ recuperada: 15 pruebas de dominio/contrato PASS.
- No se ejecutaron llamadas financieras externas. REP permanece pausado.

La aprobación humana de un caso ambiguo sigue usando la aplicación manual.
La validación productiva debe comprobar índices, revisiones y funcionamiento
visible sin inventar una operación financiera de prueba.
