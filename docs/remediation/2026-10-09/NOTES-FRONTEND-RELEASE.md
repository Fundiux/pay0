# Publicación del frontend de notas

Este lote pertenece al punto 2 del cierre finito. No modifica Rules, notificador ni funciones de negocio adicionales. Conserva configuración e IAM del SSR y no ejecuta operaciones financieras ni envíos de prueba.

## Código y build

main integra a5eed7e y e215e58 mediante fast-forward (0a5181, 9d51cb). El primero alinea Next 15.5.27 y las dependencias ya revisadas, con instalación propia; el segundo conserva /descarga/documento, ruta presente en Hosting que faltaba en main. Ocho pruebas focalizadas y política aprobadas (59f1cb); build del código final aprobado (1069d1), tipos y 47 páginas. Trazas 96090a: 62 manifiestos, 830 rutas presentes dentro del worktree. No se repitieron suites SDK ni builds Functions sin cambios.

La comparación inicial de Hosting falló (efe5f5/9d9639): detectó la ruta ausente y un orden distinto en las cabeceras generadas. Se incorporó la implementación existente d08acda, sin añadir otros frentes. La comprobación final ff09ad conserva el orden de las reglas globales y compara por ruta las reglas literales disjuntas: 46 cabeceras equivalentes, cookie vigente y equivalente al SSR, cleanUrls y trailingSlash conservados.

## Artefacto y comprobaciones locales

El generador Firebase 15.3.1 produjo un primer candidato con fallback de configuración por denegación del sandbox. El bundle específico de next.config.mjs se resolvió con esbuild local sin recompilar Next (16afc0): cabeceras conservadas y raíz de trazas reubicable. El ZIP a2abc33c del candidato a5eed7e se conserva como diagnóstico no publicable porque omitía la ruta documental.

El candidato final reutiliza el build de e215e58 y el bundle de configuración sin cambios. El manifest/lock SSR histórico coincide con las dependencias actuales más firebase-frameworks 0.11.8; instalación offline sin scripts, 430 paquetes (782bf2). Runtime local final 8f93aa: /login, /pagos y /descarga/documento HTTP200, recurso estático idéntico, cero intentos de red externa o procesos, puerto cerrado. La prueba local se ejecutó en Windows; la verificación posterior de producción cubre el runtime desplegado.

Artefactos 759b65: ZIP SSR **b5fca72c68e2365bc063c7443a9b4b25bacbe6406f33536a93addff3c22a85ec**, 6.308.661 bytes, 529 archivos; sin dotenv ni node_modules. Hosting: 158 archivos, manifiesto SHA e59bbce6c6a83c14030aa2c86af62563add02a123f07bb94eb2ed45c032920d8. CRC y cada archivo cotejados. Recibos privados ignorados: .firebase/notes-hosting-stage-20261015/.

## SSR desplegado y verificado

Baseline 828bd0: cinco lecturas de metadatos; SSR ssrpay0system-00590-gik, Hosting 4cfd958c9a8694ae. Comparación 0abb09: opciones del wrapper, configuración Firebase y entrada del framework coinciden con el servicio actual; build scripts vacíos.

Upload 965e91: objeto nuevo del bucket existente, generationMatch=0, generación 1792111854284454. Un único PATCH 984c3d, máscara buildConfig.source.storageSource,labels, conservando configuración e IAM. Operación operation-1792111899864-65dea91306ed2-c40b10bd-961641c5; terminal b4fbf6 tras veinte observaciones, sin reintento.

Postflight d92744: **ssrpay0system-00592-yis**, Ready y 100% del tráfico directo del servicio, configuración e IAM conservados; todas las etiquetas Hosting anteriores siguen vinculadas a sus revisiones previas. Código publicado generación 1792111900844137, ZIP exacto comprobado. Runtime de producción 6aab21: tres GET de páginas HTTP200 con el BUILD_ID nuevo y un recurso estático byte por byte idéntico. Sin peticiones autenticadas ni operaciones financieras. Esto no acredita aún interacción autenticada de UI.

## Hosting

Versión nueva **74c7e28d86fe69ff** creada una vez. El primer controlador 9641f8 se detuvo al recibir el nombre con prefijo projects/751158244178; se cotejaron proyecto, sitio, versión, configuración y estado CREATED en la respuesta guardada, y se reconcilió localmente (ef6075). No hubo una segunda creación. Manifiesto registrado en 3e97c3; 110 hashes requeridos subidos para los 158 archivos propios (73c08f).

Etiqueta fh-74c7e28d86fe69ff añadida a ssrpay0system-00592-yis (da5c33). Se verificaron plantilla, porcentajes y todas las etiquetas anteriores sin cambios. Finalización aplicada una sola vez (1231ec); la respuesta inmediata omitió fileCount. La lista ACTIVE contenía 160 archivos: los 158 propios con paths y hashes exactos, más /__/firebase/init.js y /__/firebase/init.json. Los dos hashes reservados se cotejaron con la versión anterior y son idénticos (dcc2bb). No hubo otro PATCH. Firebase documenta el [cálculo posterior de fileCount](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions) y los [recursos de inicialización reservados](https://firebase.google.com/docs/hosting/reserved-urls).

Publicación live aplicada una sola vez: **release 1792112583214000**, 2026-10-16T01:03:03.214Z (15 de octubre en Ciudad de México). El controlador 712d5f se detuvo al comparar el nombre de respuesta con channels/live frente al alias del sitio. Se verificaron ID, hora, tipo y versión idénticos en ambas respuestas ya guardadas; reconciliación 809c33, sin otra publicación.

Postflight público fd17eb: /login, /pagos y /descarga/documento HTTP200, BUILD_ID final y cinco cabeceras comprobados; recurso estático de 143.813 bytes idéntico. El primer chequeo 9cb6c6 falló al exigir igualdad literal de HSTS. Lectura e51473: Firebase sirve max-age=31556926; includeSubDomains; preload. Es el reemplazo administrado documentado para [subdominios web.app](https://firebase.google.com/docs/hosting/full-config?hl=en); las otras cuatro cabeceras coinciden literalmente. Se reutilizó el recibo de /login y se completaron únicamente las rutas restantes y el recurso estático. No se volvió a desplegar ni recompilar por estas diferencias de representación.

## Pendiente para cerrar el punto 2

La publicación, el runtime SSR y la entrega pública están verificados. Falta la interacción autenticada de UI. El navegador conectado no pudo iniciar su runtime (os error 3); el estado QA configurado qa/.auth/superadmin.json no existe y las variables PAY0_QA_EMAIL/PAY0_QA_PASSWORD no están presentes (c2bdda). No se leyeron contraseñas ni tokens. Se pidió al usuario elegir entre iniciar sesión en un navegador QA dedicado o realizar la comprobación manual. Los HTTP200 públicos no acreditan acceso autorizado a notas ni el flujo completo de UI.
