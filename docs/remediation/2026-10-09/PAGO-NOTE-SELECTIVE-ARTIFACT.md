# Artefacto selectivo de addPagoNota

Estado: preparado, pendiente de validación del artefacto. No desplegado. Pertenece al pendiente 1 de la lista finita del cierre; no abre otro frente.

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
2. Verificar el manejador y su carga con el entorno de dependencias publicado. Esta validación responde a evidencia nueva; no requiere repetir suites ajenas ni las pruebas del worktree sin cambios.
3. Preparar actualización exclusiva de addPagoNota, preservando configuración activa, variables y secretos, y verificar la versión y el código resultantes. No desplegar el index completo ni hacer pruebas con efectos financieros reales.

Cero escrituras en producción durante recuperación y preparación. La comparación inicial de TypeScript falló al imprimir un carácter BOM con la codificación de consola; la lectura corregida 81c756 usó UTF-8 y no repitió consultas remotas. No se afirma equivalencia del contenedor ni autorización IAM efectiva.
