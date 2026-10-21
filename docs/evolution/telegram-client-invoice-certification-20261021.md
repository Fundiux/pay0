# Entrega Telegram de facturas: publicación bloqueada

Estado: **NO_PUBLISH**. Siguiente consumidor revisado de la auditoría de transporte,
sin regenerar el inventario global. Base GitHub main `e9b46a5dc275f04ce80735e1ab49ed50457150d1`.
Rama aislada `audit/telegram-invoice-delivery-20261021`; no modifica el checkout concurrente.

## Comparación exacta

Export productivo: `finalizeSolicitudDocumentUpload`, revisión `finalizesolicituddocumentupload-00065-sun`.
ZIP descargado por generación `1792190632231633`: SHA-256
`865d9f9d24c28df990041918fd39f40cf541034a1ab7403bf82b694b521cee8d`.
Las fuentes de `clientNotifications.ts` y del callable coinciden con main;
el transporte productivo es anterior a la corrección integrada en main.
No se considera que la publicación de otros exports haya actualizado éste.

## Fallos reproducidos y candidata

Se ejecutó el módulo JavaScript productivo intacto con dependencias de base de
datos, Storage y proveedor sintéticas, sin cargar SDK de producción ni red:

- Duplicado secuencial después de éxito: tres envíos totales, correcto.
- Ocho ejecuciones simultáneas: 24 intentos, máximo esperado tres.
- Repetición después de una entrega parcial incierta: tres intentos adicionales.
- Recipiente de otra raíz y solicitud de otra raíz: tres intentos en cada fixture.
  Es un fallo de la frontera interna; no demuestra que el callable sea explotable
  externamente ni que su finalizador acepte esos datos inconsistentes.

La candidata modifica sólo el helper de notificación: valida raíz de solicitud,
cliente y destinatario; reserva el ID histórico con `create`; no reenvía ningún
recibo existente; elimina texto remoto de los errores guardados. Una entrega
incierta conserva `status=PENDING`, reconocido por el código antiguo, y añade
`deliveryState=UNCERTAIN`. No elimina recibos ni escribe documentos financieros.
Las lecturas antiguas sin root quedan rechazadas; no se migraron datos reales.

La candidata compilada pasa 14 controles de frontera: permisos internos,
concurrencia, duplicados, fallo al reservar, cinco estados heredados, nueva
instancia del módulo y reversión de una entrega incierta al código antiguo.
Esto no certifica un ZIP de publicación ni reemplaza pruebas de emulador reales.
La comprobación de tipos del árbol productivo con ese único helper sustituido
abarcó 290 fuentes, sin diagnósticos. Se instalaron las dependencias desde el
lock exacto de este export, con scripts deshabilitados; no se reutilizaron las
del webhook porque sus manifiestos difieren. Política de autorización aprobada.

## Transición que impide publicar

Una solicitud antigua retenida después de leer que no existe recibo puede
reanudar después de la reserva de la candidata y sobrescribirla. La mezcla
reproducida produjo seis intentos, máximo esperado tres. El runner conserva
este control fallido y sale con código 2: nunca presenta NO_PUBLISH como éxito.

Hace falta una pausa de **notificaciones** compatible que deje intacto el
finalizador documental, un drenaje comprobado de las solicitudes antiguas y
una reversión exacta certificada. No sirve reutilizar la pausa de telegramWebhook:
es otro export, otra imagen y otro contrato. No se añadió un grupo genérico que
permita desplegar el finalizador sin estas pruebas.

La fuente anterior se conserva como evidencia, no como reversión certificada.
No se construyó un ZIP liberable ni se declaró CI remoto aprobado. Faltan la
certificación integrada del callable real con Firestore desechable, Storage
sintético, rechazos de acceso y guardas que preserven el finalizador; transición
y recuperación probadas con ambas imágenes exactas. Ningún recorrido financiero
real debe usarse para sustituir esas pruebas.

## Preservación

Cero despliegues, cambios de tráfico, mensajes reales u operaciones financieras.
Function, servicio e IAM del export conservaron sus metadatos exactos al cierre.
createPago `00063-vif`, webhook `00037-ged`, notificación de prueba `00016-mix`,
voz `00011-nom` e interfaz concurrente `00620-zuz` siguen presentes, sin escritura
sobre ellos. Main no se modificó. Audio real permanece pendiente.

ZIP, capturas y dependencias productivas permanecen privados fuera de Git. El
runner requiere explícitamente el manifiesto privado y valida el hash del ZIP.
