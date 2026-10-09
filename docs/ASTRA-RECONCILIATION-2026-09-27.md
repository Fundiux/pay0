# Reconciliación ASTRA — 2026-09-27

Rama de cierre: `fix/astra-activity-log-reconciliation`.

## Estado inicial verificado

- Se inspeccionaron 26 worktrees antes de modificar archivos. La carpeta principal seguía en `feature/commission-distribution-cycle@fe2b98b`; sus cambios ya estaban incorporados en la base acumulativa. No era una fuente segura para volver a publicar todo el sistema.
- La línea PAY0 publicada provenía de `cycle/base860115-05`: Hosting `4c8e05bb6c341e65`, SSR `00560-mum`, liberado el 27 de septiembre a las 21:21 UTC. El commit posterior `6ae63ed` todavía no estaba publicado.
- Otro chat intentó publicar esa corrección tres veces y documentó el bloqueo en `f245ebe`. La comprobación de descubrimiento superó siete segundos bajo el proceso de despliegue, aunque aprobaba por separado.
- Las reglas Firestore publicadas coincidían con el blob Git `6265999f0fb79010fbedeba442b57b3489a1915a`. Faltaban el acceso a `pay0ActivityLog` y sus tres índices originales. Storage coincidía con ambas bases y no necesitaba cambios.
- Había 85 índices compuestos, todos listos; nueve no estaban representados en el manifiesto local. Se conservaron sus identidades y definiciones.
- Se confirmaron por lectura 310 Functions v2 con Node 22, 311 servicios Cloud Run listos y 14 schedulers. El scheduler pausado de sincronización diaria IQ se preservó.
- `git ls-remote` confirmó que el remoto conserva `main@6f9865b`, `codex/hugo-production@c92e239` y `feature/hugo-realtime-voice@8d02c55`. No se confundieron ramas locales con cambios publicados en GitHub.

## Correcciones

1. `f55d797`: prepara la caché de compilación y realiza un descubrimiento previo antes de la medición estricta. Conserva 309 endpoints esperados, límite de 7.000 ms y timeout de 10.000 ms; ninguna variable omite la medición. Mejora el cierre de procesos propios.
2. `cb3186c`: coordina las consultas reales de Actividad, las reglas y los índices. Ambas bitácoras exigen el `rootId` autorizado; la colección PAY0 además exige `sourceSystem == PAY0`. Admin y operador mantienen su filtro de propietario. La interfaz indica errores de lectura, en lugar de presentar el fallo como ausencia de registros.
3. Se recupera la corrección anterior `6ae63ed` de identificadores técnicos residuales como parte de la base de frontend, sin sustituir código de los frentes financieros concurrentes.
4. `acede3c`: incorpora al manifiesto los nueve índices que ya existían en producción y faltaban localmente. Los 93 índices del manifiesto corresponden exactamente a los 85 conservados y los ocho añadidos; una publicación futura no debe proponer borrar los existentes.
5. `88c7369`: recupera y endurece el arranque secuencial de emuladores de `88e6042`/`e7d4483`: configuración local sin UI, carga explícita de las reglas reales de Storage por la prueba CSF, entorno sin `DEBUG` heredado y exclusión de ejecuciones concurrentes. Se preservan las pruebas obligatorias y los procesos ajenos. La revisión detectó y corrigió una carrera al recuperar locks obsoletos: un mutex exclusivo protege la relectura del propietario y su recuperación.
6. `3368070`: corrige otro defecto del descubrimiento: abortar HTTP cada 500 ms dejaba al SDK procesando la petición y podía descartar la primera respuesta con sus declaraciones globales. Ahora una petición aceptada se conserva bajo el plazo global medido desde el arranque; sólo se reintentan conexiones rechazadas. Los límites de 7.000/10.000 ms no cambian.
7. `be90fca`: aplica los cinco encabezados existentes de Next mediante el patrón nativo `**` de Hosting. La comprobación post-deploy encontró que `/` e `/index.html` no los recibían: el adaptador descartaba la expresión regular de Next y copiaba `/:path*` como glob. No se modifican los valores de las políticas, incluida la autorización de micrófono `self` necesaria para voz.

## Verificación local

| Comprobación | Resultado |
| --- | --- |
| Instalación con ambos lockfiles | PASS |
| Build Functions, Node 22.23.2 | PASS |
| Build frontend, Next 15.5.25 | PASS; 44 páginas estáticas generadas |
| Política de autorización | PASS; frontend, Functions y reglas sincronizados |
| Baseline acumulativo | PASS |
| Controles críticos | 22 PASS |
| Fronteras PAY0/Assets/TTT/Hugo | PASS |
| Reglas de documentos, pagos, dispersiones y Wallet | PASS |
| Actividad con el constructor de consultas usado por la UI | 96 comprobaciones PASS; tres roles; accesos propios y rechazos entre roots/sistemas, sin perfil, inactivos, módulo revocado, anónimos y escrituras |
| Descubrimiento real tras preparar caché | PASS; 309 endpoints en 3.920 ms, límite 7.000 ms |
| Descubrimiento dentro del primer intento de deploy | PASS; 309 endpoints en 3.381 ms |
| CSF con Firestore y Storage locales | PASS; creación manual/CSF para tres roles, rechazos por permisos y root, documento finalizado y restricciones de reemplazo; cero acciones externas |
| Contención al recuperar lock obsoleto | PASS; dos procesos sincronizados adquirieron acceso exclusivo sin solapamiento y liberaron ambos locks |
| Protocolo de descubrimiento HTTP | 5 PASS con `node --test qa/scripts/functions-discovery-http.test.cjs`: respuesta lenta única, APIs/lifecycle intactos, deadline acumulado, reset y JSON inválido fatales, cierre de procesos y puertos |
| Descubrimiento real con protocolo corregido | PASS; 309 endpoints en 3.278 ms, límite 7.000 ms, en el contexto local usado por deploy |
| Descubrimiento corregido dentro de ambos deploys estándar completados | PASS; 309 endpoints en 2.336 y 2.624 ms, límite 7.000 ms |
| Descargas documentales autorizadas | PASS; 42 casos con firmador simulado y URLs sintéticas, ocho rechazos esperados, metadatos históricos y objetos ausentes/incompletos; no prueba firma real de Storage |
| UI documental | PASS; Solicitud, Pago, Dispersión y Materialidad usan el callable y rechazan URL Storage legacy |
| `git diff --check` | PASS |

Las pruebas de acceso utilizaron emuladores locales con proyectos de prueba separados; Actividad creó un proyecto demo único por proceso. No ejecutaron pagos, transferencias, solicitudes IQ, timbrado ni mensajes externos.

No se ejecutó `qa:pay0`: `AGENTS.md` documenta que su fixture de materialidad fue archivado y no constituye una compuerta fiable. No se utilizaron sesiones autenticadas de producción para crear operaciones de prueba. La validación visual autenticada y las pruebas humanas de voz siguen perteneciendo a sus respectivos frentes.

## Publicación y validación

- Índices: ocho creaciones aditivas; se conservaron los 85 anteriores por identidad y definición. Los 93 quedaron `READY`, con correspondencia exacta contra el manifiesto y sin overrides de campo.
- Primera publicación propia de Hosting: `a601e3d72f58fffc`, liberada el 27 de septiembre a las 23:02:20 UTC, fijada a `ssrpay0system-00564-vuv`. Flujo estándar completo aprobado; ningún hook omitido. Recuperó `6ae63ed` y la consulta de Actividad corregida.
- Reglas Firestore: publicadas a las 23:05:17 UTC; ruleset `9d84c6cb-754c-4f68-914b-ff55edf6d25e`; SHA-256 normalizado a LF `24b3b3d65f3f86cfc9adf7f7d14fd35dfd98504196c4288bc258040482324e34`, idéntico al candidato probado. Storage mantuvo su hash anterior y no se desplegó.
- Primera comprobación pública: nueve rutas y manifest HTTP 200 con título/nombre PAY0; 26 archivos JS coincidieron byte por byte con el build; siete rutas en Chromium sin sesión llegaron al login, incluida una ruta dinámica, sin excepciones, errores de consola ni respuestas fallidas del mismo origen. El verificador necesitó decodificar `%5Bid%5D` para localizar un archivo dinámico local; no había divergencia del contenido servido.
- Esa comprobación también encontró la ausencia de encabezados en la raíz. Se corrigió en `be90fca` y se publicó nuevamente por el flujo estándar completo, preservando todos sus hooks.
- Metadata comprobada a las 23:07 UTC: SSR listo, live fijado a la revisión propia, canary fijado todavía a `00562-yiw`, gateway y tres revisiones REP preservados; cero logs SSR con severidad ERROR desde la publicación.
- **Publicación final:** Hosting `95413a190fd561ea`, liberada a las 23:18:35 UTC y fijada a `ssrpay0system-00566-tig`, `Ready`. Código de release: `be90fca`.
- **Validación final, 23:20 UTC:** diez rutas y manifest HTTP 200; título/nombre PAY0; 26 archivos JS idénticos al build; siete rutas públicas sin sesión redirigen al login sin errores de página, consola ni respuestas fallidas del mismo origen. Los cinco encabezados cumplen la política en las diez rutas, incluidas `/` e `/index.html`: cuatro coinciden exactamente y Firebase sirve HSTS `max-age=31556926; includeSubDomains; preload`, que supera la duración de un año configurada.
- **Estado final de Firebase:** reglas idénticas al candidato probado; 93 índices listos y coincidentes, incluidos los 85 originales sin cambios; Storage intacto. Canary mantiene versión `2495099408004b59` y SSR `00562-yiw`; gateway y las tres revisiones REP siguen preservados. Cero logs SSR de severidad ERROR entre las 23:18:35 y las 23:22:49 UTC.

La fuente de frontend reconciliada es esta rama. No debe sustituirse por la carpeta principal histórica ni publicarse masivamente su backend sobre el hotfix REP concurrente. Las pestañas antiguas de PAY0 deben actualizarse para utilizar las consultas que incluyen `rootId`.

## Trabajo preservado y exclusiones concretas

- REP/IQ: se observó la preparación y publicación concurrente del hotfix quirúrgico `45df736`, basado en fuentes exactas previamente desplegadas. A las 22:34 UTC las tres Functions estaban `ACTIVE`, sin operaciones pendientes: `executeAutomaticPaymentComplement-00007-mid`, `runHugoIqRepRequestCanary-00004-yol` y `checkPaymentComplementsDaily-00010-rut`. No se publicaron las Functions financieras desde esta rama de frontend.
- Hugo: se conservó el canal `base8601-02-canary` y la separación entre la revisión de voz predeterminada y las revisiones etiquetadas. P0/P0.5 tienen aceptación humana de ruido/interrupciones pendiente; no se promovió el canary completo a PAY0.
- Identidad de origen IQ: el trabajo de `2376d35`/`c6fc0b6` tiene validación sintética, pero su diseño de staging registra `IQ_SANDBOX_UNKNOWN`; además se solapa con la adopción posterior de REP y el hotfix concurrente. No se realizó una publicación masiva de sus 37 destinos ni se alteraron esas decisiones de autorización.
- Canónicos: las fronteras existentes sí forman parte de la base. La pantalla administrativa, migración de recursos, empresa piloto y aprobaciones siguen siendo diseño explícito; no se inventó una implementación ni se migraron datos.
- El símbolo/favicon y los puntos aún sin implementación del ciclo BASE860115-05 se conservaron como decisiones/trabajo de su frente original, no como deploys terminados.
- Se preservaron los archivos de arquitectura y auditoría no versionados de la carpeta principal, los worktrees ajenos y el cambio previo de `serve-hugo-auth-only.mjs`.
- Durante el cierre aparecieron frentes activos `visual-canary` y `base8601-03-staging-safe`; sus procesos y trabajo se preservaron. El inventario pasó de 26 a 29 worktrees: uno es esta reconciliación y los otros nuevos pertenecen a trabajo paralelo.
- No hubo merge, rebase, eliminación de ramas, push ni eliminación de recursos productivos.

## Limpieza

La auditoría final de las 23:22:24 UTC no encontró procesos Node, Java o Chromium propios ni servidores/emuladores huérfanos de ASTRA. Los puertos 4000, 4400, 4500, 8080, 8187, 4487, 4587, 9150 y 9199 estaban libres. Los locks de emuladores y de recuperación estaban ausentes. Las sesiones Chromium cerraron en `finally`.

Se retiraron la configuración temporal del primer emulador, los helpers/resultados locales de auditoría y perfilado, el log Firestore, el plan temporal de índices y siete directorios vacíos de metadata CLI; también se retiró la carpeta `tmp` propia al quedar vacía. No se aplicó borrado recursivo. Los artefactos normales de instalación/build permanecen ignorados por Git.

Se conservaron `visual-canary` en el puerto 3010 con ascendencia activa, Playwright del IDE y el servidor auxiliar de Codex. Las revisiones y previews ajenos se mantuvieron como recursos de validación y rollback. La carpeta principal conservó exactamente sus archivos no versionados iniciales.

## Cierre del frente reconciliado

Código de producto y configuración publicados; comprobaciones técnicas aprobadas; temporales y procesos propios cerrados. El tracker registra el cierre de publicación del Punto 4 sin cerrar el resto del ciclo. No quedan bloqueos técnicos propios pendientes.

Queda validación humana visual con las cuentas reales: actualizar PAY0 y revisar Actividad y la presentación de folios. Las decisiones de diseño, aceptación de voz y staging IQ descritas arriba conservan sus responsables y condiciones; no se presentan como funcionalidades listas ya publicadas.
