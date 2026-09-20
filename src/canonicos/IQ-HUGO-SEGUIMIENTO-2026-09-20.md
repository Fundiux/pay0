# IQ, Hugo y seguimiento de complementos — 2026-09-20

## Alcance real

El alta de beneficiarios en PAY0 no equivale al alta en IQ. El conector actual de dispersión busca un beneficiario/cuenta ya existente en IQ. No se implementan ni se adivinan endpoints de registro o de solicitud/descarga de complementos. El usuario confirmó que compartirá ese recorrido al regresar.

## Correcciones

- Beneficiarios: nombres con cifras válidos (por ejemplo, 204 PUBLICIDAD), autorización canónica `operateBeneficiarios`, creación exclusiva de la cuenta para impedir reasignarla por dos altas simultáneas. Conflictos concurrentes devuelven un error comprensible.
- Dispersiones: antes de preparar el envío se comprueban root, estado activo, pertenencia cliente/beneficiario/cuenta y ámbito de todos los tramos. No se cambió la resolución existente por últimos cuatro dígitos ni se activaron canales nuevos. El efectivo continúa bloqueado por el conector existente.
- Hugo: historial ordenado en servidor antes de limitar a los últimos 80 mensajes; contexto de conversación de los últimos 12; filtros root/conversación. Un folio se busca directamente, no sólo dentro de una muestra. Avisos por aplicación, beneficiario, dispersión/incidencia y seguimiento de complementos. Las capacidades no conectadas se declaran expresamente. Sólo Superadmin.
- Seguimiento: un registro idempotente por aplicación PPD en `paymentComplementRequests`. Comprueba root de aplicación, solicitud y pago. Estados `NEEDS_FISCAL_DATA`, `WAITING_IQ_APPLICATION`, `PENDING_PROVIDER_CONTRACT`, `VOIDED`; nunca presenta una solicitud como enviada ni un documento como recibido sin esa integración. Los cambios en pago/solicitud refrescan sus aplicaciones. La revisión histórica es explícita, paginada y no invoca IQ.
- Reportes muestra los 100 seguimientos más recientes de todo el ámbito, con aviso de truncamiento; no aplica el filtro de fechas a esa cola actual.

## Evidencia

- Auditoría productiva de sólo lectura: 411 solicitudes, 154 pagos, 60 aplicaciones, 3 CFDI productivos emitidos y 9 expedientes. Cero padres faltantes, diferencias de abonos o discrepancias UUID entre factura/solicitud/expediente en las comprobaciones realizadas. No es una auditoría fiscal ni una verificación visual de todos los documentos.
- Consolidación local del seguimiento histórico: 16 registros; 12 `PENDING_PROVIDER_CONTRACT`, 4 `WAITING_IQ_APPLICATION`. Cero solicitudes externas.
- `qa/scripts/iq-followup-emulator-smoke.cjs`: permisos negativos/positivos de administrador delegado, concurrencia, nombres, destino, aislamiento, PPD/PUE, cancelación, borrado, búsqueda de folio antiguo e historial mayor a 100 mensajes.
- `qa/scripts/iq-followup-ui-smoke.cjs`: tabla, importe, parcialidad, actualización histórica y advertencia del proveedor. Chromium aislado, backend real de emulador. Captura local no versionada en `output/iq-followup-emulator-ui.png`.
- Regresión fiscal `control-center-fiscal-link-smoke.cjs` PASS, con PAC/Storage simulados. No se emiten facturas reales.
- Builds frontend/Functions y verificador de autorización PASS. No son pruebas de Security Rules ni recorrido autenticado en IQ/producción.

## Despliegue acotado

Publicación completada el 2026-09-20: Backend 21/21 funciones verificadas ACTIVE, Hosting y SSR publicados, índices acotados publicados y siete consultas verificadas. No se desplegaron reglas.

`scripts/deploy-iq-followup.ps1` separa Backend (21 funciones), Hosting e Indexes. La fase Indexes usa un manifiesto explícito y **nunca `--force`**: no borra índices ajenos ni despliega reglas. Las consultas requeridas se verifican con `scripts/audit-operational-followup.cjs --check-indexes --cli-lib <ruta instalada>`.

El mantenimiento es de lectura salvo `--reconcile-complements`, que sólo actualiza seguimiento y auditoría/Hugo. No emite, dispersa ni contacta IQ.

## Pendiente del contrato IQ

Solicitar pantallas/campos y rutas con cookies, tokens, claves y datos personales ocultos. Verificar alta/consulta de beneficiario y cuenta, solicitud de complemento después de aplicación confirmada, respuesta/identificador, estados de espera y descarga XML/PDF. Antes de habilitar escrituras: idempotencia, resultado incierto, raíz/perfil de credencial, correspondencia de UUID/parcialidad/importes y prueba autorizada. No repetir un envío externo cuyo resultado sea incierto.

Los estados futuros `REQUESTED`/`RECEIVED` quedan reservados: ninguna API actual permite marcarlos manualmente. Su conciliación al cambiar una aplicación se deberá definir al implementar la integración real.
