# Artefacto selectivo de addPagoNota

Estado: desplegado con autorización específica del usuario y verificado. Revisión addpagonota-00033-zup Ready con 100% del tráfico; ZIP publicado idéntico al candidato. Pertenece al pendiente 1 de la lista finita del cierre; no abre otro frente. No se ejecutó una transacción autenticada en producción.

## Código publicado recuperado

- Revisión observada: addpagonota-00032-vin; generación de código 1790583721270714.
- Metadatos del objeto: lectura abdd55; 6.053.816 bytes, MD5 84615b8bd6aac4b22a1074ddeb80fe93.
- Descarga exacta f765ec: tamaño y MD5 comprobados; SHA-256 c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f.
- ZIP original: 1.081 entradas, 14.081.553 bytes declarados expandidos. Lectura acotada de código 480ff9 confirmó que el manejador publicado hace dos escrituras separadas. No se ejecutó código del ZIP.

## Preparación local

Comparación 04c6d5 de los diez módulos JavaScript alcanzables por imports relativos del candidato 68c3972: cuatro iguales, cuatro distintos y dos ausentes en el ZIP publicado. La comparación comprende imports literales de esos módulos; no acredita todo el index ni dependencias npm.

Los módulos distintos son callables, helpers, authorization y authGuard. Los nuevos son readPagination y restrictions. Se incorporan sus JavaScript compilados, mapas y TypeScript correspondientes: 18 archivos. La autorización actual añade restricciones de cuenta; omitirla perdería comportamiento cubierto por las pruebas del candidato. El módulo callables también contiene addSolicitudNota: esta preparación no autoriza desplegar ese endpoint ni otros exports del index.

La primera preparación 727bce se detuvo antes de crear el candidato al detectar un archivo de entorno heredado. Se conservó el original privadamente y se excluyó ese archivo del nuevo paquete sin mostrar su contenido. No se eliminó ni alteró configuración remota.

Preparación b15a57: ZIP candidato de 5.615.016 bytes, SHA-256 007789611f1f70aaa73845779428840fd08bf0e405605b2d52dd636b0c2906a3. Tiene 1.086 entradas: 1.068 preservadas byte por byte y 18 añadidas o sustituidas; un archivo de entorno excluido. CRC de todas las entradas candidatas aprobado y diez módulos iguales al compilado probado. package.json, package-lock.json e index publicados se conservan. Los ZIP y recibos detallados permanecen ignorados en .firebase/pago-note-release-baseline-20261015/source-1790583721270714/.

## Condiciones pendientes antes de desplegar

1. Validar el artefacto con el lockfile publicado y el modo de build real. Revisión local 471e85 de los metadatos capturados: GOOGLE_NODE_RUN_SCRIPTS está presente y vacío; preservar esa configuración explícitamente. El package publicado tiene script de build que referencia ../scripts/copy-canonical-assets.mjs. Los lockfiles publicado y candidato coinciden en versión e integridad de firebase-admin 13.10.0, firebase-functions 7.3.2 y @google-cloud/firestore 7.11.6; esto no acredita la instalación completa. Las pruebas del worktree no certifican este paquete híbrido.
2. Verificación local completada en 8f91a5: npm ci --offline --ignore-scripts --no-audit --no-fund instaló 446 paquetes desde la caché usando el lockfile publicado (051d39, sesión30447, terminal f9f551). Sin scripts de instalación ni descargas. El index del artefacto cargó 341 exports en 3.817ms; addPagoNota rechazó una petición sin autenticación y otra con ID inválido. Se bloquearon las APIs de red y creación de procesos antes de cargar código; hubo cero intentos de IO. Esto no simula el contenedor de Cloud Build ni prueba una transacción nueva.
3. Preparar actualización exclusiva de addPagoNota, preservando configuración activa, variables y secretos, y verificar la versión y el código resultantes. No desplegar el index completo ni hacer pruebas con efectos financieros reales.

Cero escrituras en producción durante recuperación y preparación. La comparación inicial de TypeScript falló al imprimir un carácter BOM con la codificación de consola; la lectura corregida 81c756 usó UTF-8 y no repitió consultas remotas. No se afirma equivalencia del contenedor ni autorización IAM efectiva.

La validación 8f91a5 también volvió a comparar los 1.086 archivos extraídos con el recibo del ZIP después de instalar dependencias, los diez módulos compilados con los pins de la prueba SDK11 aprobada y cinco archivos del SDK de Firestore (incluido transaction.js). Todos coinciden. No se repitió SDK11: se conserva como evidencia del código probado, sin presentarla como una ejecución del nuevo paquete. Recibo privado artifact-validation-receipt.json SHA-256 bce9b5d986dce7f6877646f0c140c0278336bc3aa9b6e952668429d5acebb8e9. La instalación local está fuera del ZIP candidato y no debe incorporarse al despliegue.

## Despliegue autorizado y resultado

Preflight 86c4b8: cuatro lecturas de Function, servicio e IAM; configuración de Function idéntica a la capturada. Upload 7d1a4f creó un objeto nuevo con precondición generationMatch=0; metadatos 496331 confirmaron 5.615.016 bytes, MD5 RddkL5tZOVvPbZ3HU7aJaA== y generación 1792081523589429. La primera solicitud de PATCH fue rechazada por revisión automática antes de ejecutar proceso porque interpretó la autorización como lecturas. No hubo intención ni PATCH de ese intento. El usuario autorizó después explícitamente el despliegue de addPagoNota y su verificación.

Un único PATCH autorizado 300961, máscara buildConfig.source.storageSource,labels; generación exacta de upload y eliminación exclusiva de firebase-functions-hash de las etiquetas capturadas. Sin serviceConfig, IAM ni otros endpoints en el PATCH. Operación operation-1792081734910-65de38b37c24c-c4532813-50cb5b5f registrada antes de observarla; cinco GET de observación, terminal OPERATION_DONE (85286c/c42879). No reintento de mutación.

Postflight 5acaba/b80307: addpagonota-00033-zup ACTIVE/Ready y 100% de tráfico. Configuración de Function de ejecución y build conservada salvo fuente/build/revisión generados; ambas políticas IAM exactamente iguales. Configuración de contenedor, recursos, variables y plantilla preservada salvo imagen; comparación completa de rutas cambiadas guardada privadamente. Los cambios restantes son hashes eliminados y metadatos de build, revisión, generación, recurso, operación y transiciones de estado.

Código publicado: generación 1792081735884112 del objeto addPagoNota/function-source.zip. Descarga f841a6 comprobó SHA-256 007789611f1f70aaa73845779428840fd08bf0e405605b2d52dd636b0c2906a3, idéntico al ZIP validado. Prueba a46fd0: una petición sin autenticación y sin IDs ni datos financieros devolvió HTTP401/UNAUTHENTICATED. No prueba transacciones autenticadas, retiro instantáneo de invocaciones anteriores ni equivalencia binaria del contenedor. No se repitieron suites aprobadas. La integración Git del código permanece separada; no se desplegaron los lectores nuevos ni otros endpoints contenidos en el paquete.
