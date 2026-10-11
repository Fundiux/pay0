# Actualizacion exclusiva de notas: core de control

Estado: core inerte, sin launcher ni ejecucion. La funcion ya existe:
listclientdispersionnotes-00001-mug, sourcegeneration1791691748273508.
No reutilizar el helper create-only para corregir el empaquetado.

El plan admite una actualizacion callable GCFv2 de listClientDispersionNotes
en pay-0-system/us-central1, codebase default. Rechaza create/delete/skip,
recreacion, otro endpoint o cambio de tipo. Conserva Node22,60s,256Mi,CPU1,
concurrency1,min0 y max GCF ausente observado. Run tiene max20 en servicio;
un launcher posterior debe verificarlo antes/despues, sin inferirlo del GCF.

El API exige entorno exacto contra baseline, normalizando solo los valores
deterministas FUNCTION_TARGET y LOG_EXECUTION_ID cuando el conversor los
omite. La reserva de dispatch ocurre antes del primer await y no se libera
ante resultado incierto. beforeUpdate es obligatorio y debe comprobar pins
locales, GCF/Run/Ready y baseline fresco. assertUploadSource tambien es
obligatorio: debe ligar storageSource a los bytes realmente verificados y
subidos, no al ZIP separado del predeploy. El core no implementa esos IO.

CLI15.3.1 updateV2Function no incluye rama de setInvokerUpdate para callables.
El guard hace GET del binding roles/run.invoker existente allUsers sin
condicion antes del update; todos los setters IAM y mutadores Run estan
prohibidos. Este GET no es una precondicion atomica frente a terceros.

La operacion aceptada queda fijada por nombre. Solo su poller puede registrar
ACTIVE, revision nueva y sourcegeneration nueva con bucket/object conocidos.
El launcher debe conservar este recibo y comparar revision/source exactos en
postflight, ademas del ZIP independiente. Ningun exit0 del core sustituye
esa verificacion ni autoriza publicar Hosting.

Pruebas: 10/10 PASS8df4cf, incluidas rutas negativas, dispatch concurrente o
incierto, cambio de env/IAM/storageSource, y planner/conversor/Fabricator
reales CLI15.3.1 con transporte falso. No cloud calls ni mutaciones reales.
La revision independiente del core anterior de9casos no encontro bypass;
el decimo caso agrega el callback obligatorio de binding del upload.

Pendiente: launcher con dotenv CAS/restauracion, baseline/pines completos,
guard del stream del ZIP realmente subido, pruebas del launcher y ejecucion
gradual update-only. Conservar originales y evidencia; no borrar maps
historicos locales para satisfacer el conjunto del ZIP.
