# Auditoria de documentos y alta de cliente por CSF — 2026-09-24

## Alcance

Revision previa a despliegue sobre `integration/pay0-final-candidate-20260924`.
No se desplegaron Hosting, Functions, reglas, indices ni servicios Cloud Run, y
no se modificaron datos productivos.

## Documentos: produccion contra candidato

Produccion continua en el circuito anterior. El inventario de Cloud Run no
contiene `getAuthorizedDocumentDownloadUrl` y el JavaScript servido por Hosting
para `/solicitudes` no contiene el nombre del callable; si contiene el uso de
`getDownloadURL`. Por ello, el resultado observado en produccion no valida ni
refuta el circuito nuevo del candidato.

El candidato usa el mismo circuito para Solicitudes, Pagos y Dispersiones:

`UI -> authorizedDocuments({ uploadId }) -> getAuthorizedDocumentDownloadUrl`
`-> upload y recurso padre -> root/permisos/delegacion -> URL HTTPS efimera`

El navegador no declara `rootId`, tipo ni ID del padre como autoridad. El
backend los obtiene del registro `uploads`, vuelve a cargar el recurso padre y
verifica su root, modulo, permiso, delegacion y acceso operativo al cliente.

Se comprobo el flujo de UI de `DocsModal`, `PagoDocsModal` y
`DispersionDocsModal`: cada accion entrega al navegador exclusivamente la URL
HTTPS devuelta por el callable, rechaza rutas `gs://` y conserva un error
visible. No se encontro `getDownloadURL` en esos tres componentes. Las familias
independientes ASSETS, SAT y `entityDocuments` no se unificaron ni relajaron.

La matriz de backend firmo 39 descargas: 13 tipos documentales por
`superadmin`, `admin` autorizado y `operador` autorizado. Bloqueo correctamente
admin con modulo revocado, operador con modulo revocado, delegacion revocada,
otro `rootId` y recurso padre fuera de scope.

Tipos cubiertos:

- Solicitudes: factura PDF/XML, orden de compra, cotizacion, evidencia de
  entrega, evidencia operativa, constancia de recepcion y otro.
- Pagos: comprobante, complemento XML/PDF y otro.
- Dispersiones: comprobante de dispersion.

Conclusion documental: el fallo real corresponde al circuito viejo aun
desplegado. El candidato ya contenia la correccion de autorizacion; esta revision
agrego una prueba conductual de UI y amplio la matriz de tipos/roles.

## Alta de cliente por CSF

La traza productiva demuestra que el modal no cambio accidentalmente a modo
edicion:

- `21:18:18Z`: `parseClientCsfCallable`, HTTP 200.
- `21:18:36Z`: `saveClientCallable`, HTTP 200; el cliente fue creado.
- `21:18:44Z`: `initEntityDocumentUpload`, HTTP 403.

Los dos caminos llaman `saveClientCallable` con `editingId: null`. El flujo CSF
agrega `csfIntakeId`; el backend deriva `rootId`, owner y administrador desde el
usuario autenticado. La diferencia comenzaba despues de crear el cliente:
`initEntityDocumentUpload` admitia solo `superadmin`, y el cierre de la lectura
CSF exigia siempre `clientes.edit`.

La correccion conserva la politica canonica y no concede permisos. Para la
continuacion exacta de una alta CSF se valida que:

- intake y cliente existan y pertenezcan al mismo `rootId`;
- el intake haya sido creado por el usuario autenticado;
- intake, cliente y `fiscalProfile.csfIntakeId` formen la misma cadena;
- el documento sea `CLIENTE / CONSTANCIA_SITUACION_FISCAL`;
- el documento haya sido creado por el mismo usuario al finalizarse;
- el estado corresponda a la continuacion de alta.

Solo bajo esas condiciones se reutiliza `clientes.create`. Un cliente ajeno o
una sustitucion posterior requiere `clientes.edit`; toda otra escritura de
`entityDocuments`, asi como listar, desactivar o reactivar, permanece reservada
al gestor existente (`superadmin`).

La regresion ejecuta el alta manual y el flujo post-parser completo
`guardar -> iniciar documento -> upload con SDK cliente y reglas de Storage ->`
`finalizar documento ->`
`finalizar intake` para superadmin, admin y operador. Admin y operador se
configuran expresamente con `clientes.create=true` y `clientes.edit=false`, lo
que prueba que el flujo no depende de un privilegio superior. Tambien se
comprueba 403 para permiso de creacion revocado, otro root y una nueva carga
despues de finalizar sin permiso de edicion. `externalActions=0`.

## Despliegue pendiente

Este punto queda tecnicamente preparado, pero no fue desplegado. Un despliegue
posterior autorizado debera incluir conjuntamente:

1. Functions del callable documental autorizado y de la continuacion CSF.
2. Hosting con los tres modales que consumen el callable.
3. El resto del candidato acumulativo ya validado.
