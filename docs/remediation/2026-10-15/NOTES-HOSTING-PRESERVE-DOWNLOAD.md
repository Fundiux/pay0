# Conservar la descarga documental al publicar el frontend de notas

La comparación con la release Hosting 4cfd958c9a8694ae detectó que el candidato a5eed7e omitía /descarga/documento, una ruta ya publicada. Las cabeceras de todas las rutas compartidas coincidían. Por ello el ZIP SSR a2abc33ca6ad73a85deeed39c5bb297809d2b5b6d0a09f71aac386bb180d9b9b queda como diagnóstico, no publicable.

Se incorporaron exactamente desde d08acda la página de descarga, RootClientShell y sus pruebas focalizadas. La diferencia en el shell es únicamente la excepción pública para la ruta exacta /descarga/documento. La página conserva el token en el fragmento, lo retira antes de usarlo, lo envía por POST y descarta respuestas de descargas invalidadas. No se modificaron Functions, App Check, permisos de datos ni otras rutas.

Validación del cambio integrado:

- Ocho pruebas focalizadas aprobadas y política de autorización sincronizada (59f1cb). Cubren limpieza del fragmento, POST, fallos sin datos sensibles, rutas vecinas protegidas, navegación repetida, aborto y respuestas obsoletas.
- Build Next 15.5.27 aprobado (112034, sesión 52909, terminal 1069d1): configuración, baseline, 22 controles críticos, tipos y 47 páginas estáticas, incluida /descarga/documento. Se justifica por el cambio de código; no se repitieron suites de Functions ni SDK.
- Comparación Hosting ff09ad: las 46 reglas de cabeceras coinciden con la release actual. Se conserva el orden de las dos reglas globales; las restantes corresponden a rutas literales distintas y se comparan por ruta, ya que el generador devuelve otro orden. Cookie de configuración vigente y equivalente al SSR, cleanUrls y trailingSlash conservados. No se debilitó la comprobación de rutas ausentes.

La publicación sigue dentro del punto 2 del cierre: preparar un nuevo artefacto con este build, verificar el runtime y publicar conservando configuración e IAM. Los recibos locales están ignorados en .firebase/notes-hosting-stage-20261015/. No hubo despliegue frontend ni acciones financieras durante este cambio.
