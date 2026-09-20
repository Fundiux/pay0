# Complementos automáticos después de la aplicación

## Alcance autorizado

Sólo aplicaciones PPD nuevas posteriores a la activación de `paymentComplementConfigs/{rootId}`. No se despacha el histórico al desplegar, activar o pulsar Revisar histórico. Superadmin puede pausar por proveedor desde Reportes. No se envía WhatsApp. Una solicitud local no equivale a aceptación ni a emisión.

## IQ

- Requiere `IQ_APPLIED`, `iqActionExecuted=true`, plan/intento del mismo root y perfil, depósito numérico y permisos vigentes del usuario/perfil.
- Un job por root/perfil/depósito evita POST duplicado entre aplicaciones concurrentes. Se verifica el depósito conciliado y su disponibilidad para solicitar; estados desconocidos se bloquean.
- `POST /deposits/{id}/complement` sin cuerpo, con aceptación explícita `200 {message:"success"}`. El cuerpo vacío es la implementación inicial de la ruta capturada: no se presentó evidencia del Payload del POST. No se usan tokens pegados en conversación. Un 401 permite una sola autenticación nueva; timeout/5xx/respuesta incierta nunca repiten el POST automáticamente.
- `GET /deposits/complement/{id}`: sólo el 400 con el mensaje exacto de ningún REP adjunto representa pendiente. 200 con URL habilita la descarga, no prueba todavía correspondencia fiscal.
- Scheduler `0 19 * * *`, `America/Mexico_City`; marca por job/día antes de consultar. A los diez días naturales desde aceptación, una alerta a Hugo/actividad para gestión manual por WhatsApp. Continúa revisando diariamente.
- ZIP acotado y sin extracción al disco; se limitan tamaño, entradas y expansión. Redirects HTTPS sólo a IQ/Active Storage y S3 permitido, sin transmitir Authorization. Se exige pareja XML/PDF con el mismo nombre base y correspondencia de UUID/parcialidad/saldos/moneda. Un formato distinto requiere revisión, no asociación por parecido.
- Aplicaciones posteriores al primer REP del depósito requieren validación del archivo contra esa nueva parcialidad; nunca se asumen cubiertas ni se vuelve a solicitar a ciegas.

## Facturama

La implementación anterior sólo emitía CFDI de ingreso. El adaptador nuevo prepara CFDI tipo P / uso CP01 desde el XML timbrado de origen, no desde la OC ni datos inventados. Requiere Facturama de producción, emisor y solicitud del mismo root y datos fiscales originales consistentes.

Versión inicial: MXN, concepto(s) uniformes no objeto de impuesto o IVA 16 %, sin descuentos ni retenciones. Impuestos mixtos, retenciones, moneda distinta y datos incompletos se bloquean. Los impuestos se distribuyen por parcialidad conservando centavos acumulados. Fecha real y forma SAT del pago son obligatorias; si falta la forma, Superadmin puede confirmarla en la fila de Reportes. No se toma de la OC como sustituto del pago real.

Se guarda el ID de Facturama inmediatamente después de aceptar, antes de descargar. Un fallo posterior sólo permite recuperar archivos, no volver a timbrar. Un resultado incierto requiere revisión manual. La configuración automática es prospectiva y no constituye prueba de timbrado real. Nuevo pago permite capturar explícitamente la forma SAT; las fechas civiles guardadas a medianoche UTC conservan el día capturado.

Referencia oficial verificada: https://apisandbox.facturama.mx/guias/cfdi40/complementos/complemento-pago-20

## Documentos, seguridad y pruebas

XML/PDF en el flujo backend de documentos de solicitud, hash SHA-256 y clave REP para conservar parcialidades anteriores activas. No se cambian reglas Firestore/Storage; nuevas colecciones siguen deny-by-default y se exponen por callables Superadmin con root del perfil. Cancelar una aplicación abre revisión; no cancela CFDI externos automáticamente.

Evidencia: compilación backend/frontend, verificador de autorización y cuatro suites en emulador: automatización (concurrencia, aislamiento, histórico, 401/400 lógico, resultado incierto, una revisión diaria, alerta, payload fiscal y conservación de parcialidades), IQ/Hugo, UI y regresión fiscal. Proveedores/PAC/Storage simulados; cero timbrados o solicitudes externas de prueba. La UI se inspeccionó con captura Chromium aislada.

Producción: doce funciones verificadas ACTIVE; configuración IQ/Facturama activada prospectivamente en el root autorizado, cero jobs históricos creados. Scheduler ENABLED `0 19 * * *`, America/Mexico_City. Configuración sin sesión rechazada con HTTP 401. Hosting final publicado correctamente.

La recepción de un ZIP real y aceptación de un REP real por el PAC deberán comprobarse con la primera operación autorizada; no se declaran probadas por el emulador. No se modificaron reglas. Npm reportó once vulnerabilidades en el conjunto de dependencias; no se ejecutó un audit-fix global fuera de alcance.

## Datos fiscales del pago por transferencia

Para REP automático la forma es `03` (transferencia). La fecha corresponde al movimiento del comprobante, no a su carga en PAY0. Se conserva la hora detectada; cuando el comprobante no contiene hora se registra explícitamente `12:00:00`. El número de operación, cuenta ordenante, cuenta beneficiaria y banco se incorporan cuando fueron identificados. Antes de timbrar, PAY0 exige que el RFC ordenante detectado o canónico coincida con el receptor del CFDI original y que el RFC beneficiario detectado o canónico coincida con su emisor. Los RFC fiscales del cliente y de nuestra empresa permanecen en los nodos Receptor y Emisor; el RFC bancario condicional es un dato diferente y no se inventa a partir del RFC del contribuyente.
