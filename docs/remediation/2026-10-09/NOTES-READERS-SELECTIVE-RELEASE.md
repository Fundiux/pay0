# Lote selectivo de lectores de notas

Estado vigente: lote autorizado, desplegado y verificado. Pertenece al punto 2 de la lista finita del cierre. No incluye publicación del frontend, Rules ni notificador. La verificación autenticada de UI permanece pendiente.

## Baseline y alcance

Consulta c43f46: listPagoNotes ausente (HTTP404); listSolicitudNotes ACTIVE en listsolicitudnotes-00001-hos, generación 1792004057956047; listClientDispersionNotes ACTIVE en listclientdispersionnotes-00003-fac, generación 1792009849291422. Ambos lectores existentes usan Node22, 256Mi, 60s y concurrencia1. El primer intento e01365 no clasificó el formato de error 404 del CLI; se corrigió la clasificación sin interpretar permisos como ausencia.

IAM 3dad29: ambos lectores tienen política Function sin bindings y política Cloud Run con invocación pública incondicional. Los permisos de datos se validan dentro de los callables. El plan conserva las políticas existentes; el lector nuevo requiere su propia habilitación de invocación HTTP, no acceso público a Firestore.

## Artefacto y validación

Base: ZIP de addPagoNota publicado y verificado, SHA 007789611f1f70aaa73845779428840fd08bf0e405605b2d52dd636b0c2906a3. Se incorporan los módulos compilados y fuentes de notas desde main ee2a7d0, y tres exports al index original. Se conservan package y lockfile publicados, iguales al lockfile de main. No hay archivos de entorno ni node_modules en el paquete.

Preparación 9cc9ac: 1.098 entradas, 20 añadidas o modificadas, CRC de todas las entradas comprobado. ZIP de 5.641.140 bytes, SHA-256 7674fbfa4c67e9ffa1a639ff790af4e6d6338fc170011e2bae44cb41b55d29a6.

Validación e7353e: baseline y candidato cargados en procesos separados, 341 exports conservados con configuración idéntica y tres añadidos (344 en total). Seis rechazos antes de IO: petición sin autenticación e ID ausente para cada lector. Cero intentos de red/procesos externos. No se repitieron las pruebas transaccionales aprobadas. Las primeras validaciones f667a9/11aa65/aaf0fd/0c8df7 cargaron ambos index en un proceso compartido, advirtieron doble setGlobalOptions y detectaron una diferencia de region en debugFindPagoIqDepositCandidates; la captura aislada eliminó la contaminación del entorno de prueba sin cambiar el ZIP ni relajar la comparación.

Upload e46ee7/sesión86858, terminal 0add22: objeto nuevo con generationMatch=0 en el bucket existente, generación 1792084029502590; tamaño y MD5 72qt3rGxhsjTyw7jwHIaMA== coinciden con el ZIP local. No se actualizó una Function al subirlo.

## Plan ejecutado tras autorización

- Actualizar listSolicitudNotes y listClientDispersionNotes con PATCH limitado a source y retirada de firebase-functions-hash, preservando el resto de etiquetas, configuración y políticas.
- Crear únicamente listPagoNotes con Node22/256Mi/60s/concurrencia1 y configuración del lector de Solicitudes. FUNCTION_TARGET y EVENTARC_CLOUD_EVENT_SOURCE se ajustan al nuevo nombre. Fuente vinculada a la generación exacta del ZIP; build scripts conservados vacíos.
- Habilitar en el servicio nuevo el contrato HTTP de callable existente y verificar rechazo sin autenticación, sin ampliar permisos de datos.
- Observar operaciones concretas sin repetir mutaciones y verificar configuración, IAM, Ready, tráfico y ZIP publicado exacto de cada función. Frontend sigue fuera de este lote.

Plan local 065249 preparado. La revisión automática rechazó ejecutar el primer PATCH antes de iniciar proceso: la aprobación vigente cubría addPagoNota, no los lectores. No se creó intención ni operación del despliegue. Se solicitó autorización específica del lote mediante la herramienta; pendiente al redactar este documento. No eludir la denegación con otro CLI o endpoint.

## Autorización y resultado posterior

El usuario respondió «Autorizar los tres lectores y su verificación» al pedido que identifica el ZIP 7674fbfa4c67e9ffa1a639ff790af4e6d6338fc170011e2bae44cb41b55d29a6, los dos PATCH, la creación de listPagoNotes y su invocación HTTP. Después de esa respuesta se ejecutó una sola mutación por endpoint, precedida por comprobación de baseline (o ausencia para la creación) y registro durable de intención. No se repitió el intento rechazado sin autorización.

| Endpoint | Operación registrada | Revisión verificada | Evidencia terminal / postflight |
|---|---|---|---|
| listSolicitudNotes | operation-1792110517058-65dea3ec47cc0-822a28d4-46b37fd6 | listsolicitudnotes-00002-bub | ab1821 / fb66f4 |
| listClientDispersionNotes | operation-1792110627719-65dea455d08b9-cbd4ded8-96164321 | listclientdispersionnotes-00004-qof | c3149e / 8cd40f |
| listPagoNotes | operation-1792110799648-65dea4f9c7817-d56b7fa8-6a3f1a59 | listpagonotes-00001-yet | 7fe589 / f4b915 |

Los tres quedaron ACTIVE/Ready y con el 100% del tráfico en su nueva revisión. Se descargó la generación publicada de cada ZIP: todos coinciden exactamente con los 5.641.140 bytes y SHA autorizado. Los lectores existentes conservaron configuración e IAM; el nuevo coincide con el plan de creación. Los recibos y respuestas permanecen ignorados en .firebase/notes-readers-release-20261015/deploy-<endpoint>/.

Invocación HTTP de Pago: una sola escritura de política Cloud Run, con etag y únicamente roles/run.invoker para allUsers; no se concedieron permisos de datos ni roles en la política Function. La primera comprobación 164f1c detectó IAM_OTHER_FIELDS_CHANGED después de la escritura. Revisión 6c910b: la API materializó version=1, antes omitida; la respuesta y lectura posterior son idénticas y contienen exclusivamente el binding aprobado. Reconciliación local 4da1b6 aprobada, sin otra escritura ni reintento. La autenticación y permisos siguen dentro del callable.

Verificación HTTP 881865: exactamente tres peticiones sin autenticación, una por lector, con data vacío y sin IDs, devolvieron HTTP401/UNAUTHENTICATED. Cero peticiones autenticadas o payloads financieros. Esto acredita el rechazo de acceso anónimo, no una lectura autenticada completa ni la UI. No se repitieron suites aprobadas ni pruebas SDK.
