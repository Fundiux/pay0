# Hosting 61879: reconciliacion posterior al lanzamiento fallido

El lanzamiento local termino FAIL (37649f) tras RELEASE_ACCEPTED. Su recibo de quince estados permanece intacto, SHA256 99dcbf6caa33b5a287475f55eacb01a4c25a0c18597583e164fec10e60e5e132, sin POSTFLIGHT_VERIFIED. No se conoce la causa exacta del fallo final. No hubo redespliegue para intentar convertirlo en exito.

Cinco GET independientes (9a6023) y comprobaciones locales (fa3312) observaron SSR ssrpay0system-00590-gik, generacion1791920820865879, Ready100, configuracion preservada y Hosting sites/pay-0-system/versions/4cfd958c9a8694ae FINALIZED. Notas permanecieron sin cambios. Esto acredita estado remoto, no equivalencia completa de fuente ni funcionamiento del navegador.

## Verificacion de fuente que fallo

Se preparo un verificador separado de reconciliacion, con schema PAY0-NOTES-HOSTING-RECONCILIATION@1 y ambos campos originalLaunchPassed/originalReceiptCompleted false. Su validador exige exactamente los quince estados observados; no sintetiza eventos. Cincuenta y dos pruebas locales pasaron (34f13e).

Tres lanzamientos locales se detuvieron al obtener el token (c50da3, e71f90,716be0), antes de los GET. Diagnostico seguro5b2c80: gcloud salio1, stdout vacio, error de permisos; no evidencia de credencial vencida. El acceso autorizado mediante el mecanismo de escalado permitio continuar. No se imprimieron tokens ni respuestas privadas.

Primera lectura remota33191: once GET completados, pero inventario fallido (1067f8). Segunda lectura diagnostica5919: mismos once GET, fallo preservado1477ac. Se anadio persistencia privada del ZIP/metadatos antes de salir por error, sin cambiar la validacion ni declarar PASS. La causa local c0bc79 es ZIP_ENTRY_LIMIT.

Artefacto privado preservado: failed-source-reconciliation-61879-20261013.zip,93242509 bytes, SHA256 b44220d46a5960bbb9564fe7775b7cd67a33d25b0211e791f5885d962d3ac98a. Directorio central:581 entradas y551373077 bytes de expansion declarada. Incluye .next/cache/webpack/server-production/6.pack (94967691 bytes) y2.pack (84676359 bytes); ambos existen en el staging local con esos tamanos. Superan64MiB por entrada y el total supera512MiB. Esos limites originales siguen siendo validos y la prueba completa permanece fallida. La inspeccion del directorio central no demuestra CRC o contenido de las entradas.

## Siguiente prueba y limites

Preparar un verificador offline distinto de los cinco archivos seleccionados, sin expandir caches. Debe validar estructura del ZIP, rutas, duplicados y rangos; limitar la expansion efectiva de cada entrada seleccionada; comprobar CRC y SHA de esas cinco entradas; enlazar ZIP, metadatos y request por hash. Su resultado sera SUBSET_ONLY: no equivalencia completa del ZIP, no hashes o CRC de entradas no seleccionadas y no conversion del lanzamiento original a PASS.

La copia static de reconciliacion obtuvo29 pruebas locales (fe3f0c), pero aun apunta al primer verificador y no tiene proof aceptado. No ejecutar como gate remoto hasta adaptarla/revisarla para el nuevo contrato parcial. Assets y navegador siguen pendientes. La inclusion de caches en el paquete SSR tiene investigacion separada; no modificar el candidato Hosting a52959b ni borrar historicos para corregirla.

Las lecturas de reconciliacion no invocaron proveedores, funciones financieras ni enviaron mensajes. Las respuestas completas y el ZIP permanecen ignorados en .firebase, fuera de Git.
