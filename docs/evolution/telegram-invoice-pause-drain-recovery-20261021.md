# Notificador de facturas: pausa y reversión no certificadas

Estado final: **NO_PUBLISH**. Continúa la candidata aislada `33bedf6` desde main
`e9b46a5dc275f04ce80735e1ab49ed50457150d1`. La autorización existe; el bloqueo es
un contrato de recuperación que falla, no falta de permiso para desplegar.

## Identidad y alcance

La función sigue en `finalizesolicituddocumentupload-00065-sun`, ZIP exacto
`865d9f9d24c28df990041918fd39f40cf541034a1ab7403bf82b694b521cee8d`.
Se prepararon dos ZIP privados exclusivamente de diagnóstico:

| Archivo | SHA-256 |
| --- | --- |
| Pausa | `a882337145032713400326d4b910ee2ff9b98faa967705fed2b8f30f80e7c939` |
| Candidata | `592e5aff696f7008ad3ab2fe76abe267dee42141d86544cb138384e98fa814a3` |

Cada ZIP cambia sólo fuente, JavaScript y mapa del helper de notificación.
Conserva 1.095 archivos restantes, incluidos index, callable, servicio y ciclo
documental, sin recompilarlos. Las fechas se normalizan y dos construcciones
en memoria producen los mismos bytes. Sus dependencias y lock siguen siendo
los de ese export productivo. Ninguno es una imagen certificada ni un input
de despliegue. La exclusión de archivos de entorno sólo permite diagnóstico
local: su tratamiento para una publicación no se ha certificado.

## Pruebas exactas con Firestore desechable

Se cargaron los helpers compilados exactos y el wrapper callable productivo
intacto. Se usaron autorización y perfiles reales del artefacto y Firestore
local real, con red limitada a su puerto. Telegram y Storage son sintéticos;
el núcleo finalizador se reemplazó deliberadamente por un resultado fixture.
No se invocó lógica financiera real y no se certifica su comportamiento interno.

Ocho comprobaciones de diagnóstico aprobadas:

- El anónimo se rechaza antes del finalizador.
- La pausa conserva el resultado del wrapper sin envíos ni escrituras del helper.
- Dieciséis solicitudes candidatas y un duplicado posterior producen tres intentos.
- Volver a la pausa conserva el recibo atendido.
- El solapamiento inseguro de una solicitud antigua retenida reproduce seis intentos.
- Esperar que esa solicitud termine antes de activar reduce el total a tres.
- Candidata → pausa → candidata conserva el recibo incierto y no vuelve a enviarlo.
- Los documentos centinela financieros permanecen idénticos.

Un segundo proceso, conectado al mismo emulador, conserva el recibo incierto y
no reenvía. La comprobación de tipos de cada ZIP abarcó 290 fuentes y dio cero
diagnósticos, usando el compilador y las dependencias de su lock exacto.

## Fallos que impiden certificar la pausa

Dos condiciones fallaron:

1. Tras finalizar durante la pausa no existe recibo ni cola pendiente de
   notificación. No hay un camino de recuperación automática certificado para
   esos eventos. Los uploads canónicos permanecen; esto no significa que se
   hayan borrado ni que sea imposible reconstruir una lista supervisada.
2. Lanzar un error `unavailable` en el notificador no provoca un reintento del
   cliente: el wrapper lo registra y retorna el resultado exitoso del núcleo.
   No se debe resolver propagando el error y repitiendo el finalizador sin una
   certificación independiente de sus efectos.

Una pausa sin envíos no basta. Hace falta registrar y consumir de forma durable
la intención de notificar, con deduplicación y permisos, sin volver a finalizar
el documento y sin reenviar entregas inciertas. No se ha implementado ni
certificado esa ruta en este corte. El trigger `queueControlCenterTelegram`
observado en las fuentes es una proyección administrativa; no demuestra que
reanude entregas pendientes. No se sustituyó por un envío manual a usuarios.

## Guardas y límites

25 pruebas de política aprobadas: identidad exacta, servicio correcto, estado
propio, concurrencia, versiones, revisiones, datos de métricas desconocidos o
anteriores a la pausa, ventana de 120 segundos, y recuperación exclusivamente
hacia una pausa certificada con intención recuperable. Son pruebas de controles
locales, no métricas productivas de drenaje.

El verificador agregado retorna NO_PUBLISH y salida no cero. Permisos completos,
convivencia productiva, recuperación de intención, imagen de reversión y estado
productivo de pausa todavía no están certificados. Las condiciones no se
marcan aprobadas por contar los contraejemplos como pruebas de diagnóstico.

No se publicó ni la pausa ni la candidata; no se solicitó un cambio de tráfico,
reversión, build cloud o despliegue. No existe plan ejecutable de recuperación
que pueda apuntar accidentalmente al webhook o a fuentes antiguas inseguras.
Los bytes previos se conservan como evidencia, no como reversión certificada.

La interfaz concurrente avanzó a `ssrpay0system-00622-xev`; se conserva su línea.
No se escribió en el checkout concurrente ni se modificó main. Audio real
permanece pendiente. Cero mensajes reales y operaciones financieras.
