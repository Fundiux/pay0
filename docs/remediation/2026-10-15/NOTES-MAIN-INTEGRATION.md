# Integración acotada de notas sobre main

Base: main ccaf71e. Rama: integration/notes-main-20261015. El lote traslada el código de notas validado en 68c3972 y sus dependencias; no incorpora la rama general de remediación, el notificador ni cambios de Rules. No representa validación de todos los cambios históricos de main.

## Comportamiento

- Exporta listPagoNotes, listSolicitudNotes y listClientDispersionNotes, con sus clientes tipados. Los lectores validan perfil, módulo, root, relación y delegación antes de consultar notas, y reautorizan antes de entregar resultados.
- La página de Pagos utiliza lectura paginada en servidor, limpia resultados al perder autorización y distingue cabecera reciente e historial conservado. Se aplicó únicamente el diff de UI del commit 1b7306f; se preservaron los demás cambios de la página en main.
- Las notas manuales de Pago y Solicitud se crean junto con el marcador de no leído en una transacción. Cada reintento revalida permisos y conserva el ID de nota de esa invocación. No añade idempotencia entre peticiones HTTP independientes.
- Incluye paginación, autorización y restricciones de cuenta utilizadas por el código probado. El resolver de delegaciones y su servicio de escritura se trasladan juntos: validan la cadena de otorgantes, permisos y vigencia dentro de los límites existentes. Estas dependencias compartidas también alcanzan otros callables; esta rama no autoriza desplegarlos en bloque.

## Evidencia y límites

Comparación 62c7ef: los 17 módulos de la dependencia transitiva de los lectores/escritores, el servicio de delegaciones y los dos controladores UI coinciden con 68c3972 normalizando solo CRLF/LF. La política generada permanece sin cambios. Exportaciones y wrappers se integran en la base actual.

Primera ejecución 979d7c: 248 pruebas aprobadas, una omitida histórica y una fallida de delegaciones. Una ruta de copia incorrecta dejó el servicio de delegaciones antiguo; se corrigió la copia y se ejecutó únicamente esa prueba, aprobada en f572ad. La política de autorización también pasó en f572ad. No se repitieron las otras 248 pruebas ni las suites SDK aprobadas del código fuente.

Build Functions normal d4b559/sesión19614, terminal bd4e90: aprobado. El primer build frontend d2f45c se detuvo por configuración local ausente. Se copió la configuración .env.local ignorada, sin imprimirla ni añadirla a Git. Build frontend eb0ae0/sesión86239, terminal adac63: aprobado, 46 páginas estáticas, tipado, 7/7 valores de configuración y 22 controles críticos. Next advirtió que infirió la raíz del workspace al detectar varios lockfiles; no se alteró configuración de tracing ni se declara este build como paquete Hosting listo para publicar.

La publicación selectiva previa de addPagoNota está verificada en producción; no equivale a desplegar esta rama. Los lectores nuevos, frontend, integración en main y validación autenticada de UI siguen pendientes. No se cambian aquí Rules, índices, estados financieros, proveedores o colas. Los archivos generados y dependencias son locales y no forman parte del commit.
