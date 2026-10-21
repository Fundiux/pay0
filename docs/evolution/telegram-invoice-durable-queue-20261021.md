# Cola durable de facturas Telegram

Implementación en rama aislada, sin integración automática a main. La fuente
productiva de `finalizeSolicitudDocumentUpload` difiere de main: el empaquetador
parte del ZIP exacto `865d9f9d24c28df990041918fd39f40cf541034a1ab7403bf82b694b521cee8d`
y no incorpora las correcciones financieras ajenas que ya existen en main.

## Productor y consumidor

La intención se lee en la fase de lectura y se crea en la misma transacción que
publica el documento READY. El resto de la fuente financiera original se
reconstruye byte por byte retirando exclusivamente el import y esos dos hooks.
La intención fija root, solicitud, cliente, upload y tipo. Repetir la petición
no reemplaza una intención ni reinicia sus estados terminales.

El callable conserva autorización y resultado y retira el envío inline. Un
nuevo consumidor privado y programado lee únicamente la cola: nunca importa
ni invoca el finalizador. No copia credenciales financieras: utiliza la
configuración Firebase y el secreto de Telegram. Los clientes no pueden leer
ni escribir cola, control o cursor según las reglas productivas exactas.

La cola queda cerrada si falta el control, la versión es desconocida o enabled
no es true. Con el control cerrado las intenciones permanecen READY. Una nueva
época impide continuar un envío reservado antes de pausar y reactivar. Root,
cliente, documento y destinatario se vuelven a comprobar antes del despacho.
Los objetos Storage se leen por generación y con el límite canónico de tamaño.

READY y WAITING_PAIR son los únicos estados reclamables. ATTEMPTING, UNCERTAIN,
REVIEW y los estados terminales no se reciclan automáticamente. Un proceso
muerto después de reservar requiere revisión; la reserva no garantiza entrega.
El paginado por ID evita que los elementos que esperan una pareja bloqueen
indefinidamente a los siguientes. No se eliminan recibos ni datos históricos.

## Validación del archivo exacto

ZIP candidato: `33601d3fafcb523a5e7094406ffe629b0c59ca2abcc321d626d084b361e2c11c`.
Conserva 1.083 archivos originales y cambia o añade 24 archivos fuente/compilado/mapa.
Manifiesto y lock productivos permanecen intactos. Se excluye un archivo de
entorno tras contrastar sus valores en memoria con el runtime y descartar
cargadores de entorno. Los ZIP y capturas completas permanecen privados.

Pruebas con Firestore desechable real, productor compilado exacto, proveedor y
Storage sintéticos y adaptadores declarados para auditoría e integraciones
externas: veinte escenarios, reinicio separado, ocho productores concurrentes,
dieciséis consumidores concurrentes, conflictos atómicos, scopes ajenos,
permisos del callable y reglas productivas exactas. El relevo con la imagen
antigua reproduce el fallo si se activa prematuramente y evita duplicados
cuando el consumidor espera al drenaje. No se ejecutaron operaciones financieras
reales ni pruebas sobre documentos de usuarios.

La comprobación de tipos abarca 293 fuentes sin diagnósticos. El arranque
canónico registra 345 exports, incluido el worker, sin invocar handlers ni red.
23 casos del transporte exacto y los controles de alcance, cola y transición
pasan localmente. La CI remota se registra por separado cuando esté disponible.

## Publicación y recuperación previstas

Cada mutación lleva un diario exclusivo antes del envío; ante resultado incierto
se concilia la operación conocida por GET y no se repite. Se exige que los nuevos
recursos no existan y se rechaza una cola previa sin reconciliar. La creación
del worker no usa allUsers: su agenda invoca con OIDC y permiso en su servicio.

Primero se publica el consumidor cerrado y se verifica su funcionamiento sin
entregas. Después se publica el productor que sólo encola. El consumidor sigue
cerrado mientras se retiran las solicitudes antiguas. Métricas faltantes o ceros
anteriores a la barrera no prueban drenaje. Una eventual sonda GET sin sesión
usa sólo una ruta temporal del servicio antiguo con cero por ciento, sin cuerpo
ni operación financiera; debe retirarse antes de activar.

La activación exige imágenes/ZIP exactos, Function/Run/IAM propios intactos,
reglas productivas sin deriva, consulta de cola soportada y drenaje fresco.
Se abre el control con precondición de updateTime y nueva época. La reversión
cierra ese mismo control con CAS, conserva las imágenes y los pendientes y no
repite despliegues ni finalizadores. Nunca retorna al código antiguo inline.

Este documento describe la implementación y sus controles; no sustituye los
recibos de publicación. El estado productivo, el CI y los hashes del plan de
recuperación se documentan en las evidencias finales. Audio real pendiente.
