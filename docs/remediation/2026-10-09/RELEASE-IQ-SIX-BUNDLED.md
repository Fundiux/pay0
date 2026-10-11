# IQ: seis entradas desplegadas con fuente verificada

Despliegue completado el 2026-10-11 desde la rama integrada y publicada
`integration/pay0-remediation-20261009`, commit
`3f3c4c56091bb61f66bd28b5c4b520c9968ccabc`. Main no cambia. Este lote no incluye
el experimento fallido de reglas ni los candidatos aislados de notas/notificador.

Preflight9956 y StageDryRun93030 PASS. Execute82732 PASS, run
`6d17febf78674f49906a6dbd05e3a3de`: cinco funciones primero y Task despues.
Ambos grupos completaron predeploy, POSTFLIGHT_PASS y ENV_RESTORED; journal
termina COMPLETE. Se conservaron todos los controles de build/discovery/upload,
con BUNDLED_V1 limitado al proceso y sin aumentar timeouts de discovery.
Discovery CLI del segundo grupo:3394ms/346 endpoints, limite7000ms.

| Funcion | Revision efectiva | Generacion fuente |
|---|---|---|
| createSolicitudIq | createsolicitudiq-00058-xar | 1791680918326392 |
| processIqCreateQueue | processiqcreatequeue-00020-wug | 1791680918440111 |
| createClientDispersionIq | createclientdispersioniq-00023-kob | 1791680918529942 |
| processIqDispersionCreate | processiqdispersioncreate-00012-kib | 1791680918440088 |
| executeUserCommissionDispersion | executeusercommissiondispersion-00003-voc | 1791680869757086 |
| processIqCreateOnDemandTask | processiqcreateondemandtask-00010-caz | 1791682357976381 |

Postflight98100 PASS:30 GET de metadatos y seis ZIP por generacion exacta,
sin escrituras ni invocaciones de handlers. Cada archivo coincide en931 entradas
con la provenance instalada
`0bfdf35d9f1366a6093bd9d5ad87ab94426aca0542a50c7a073e8854057f6818`.
Bundle SHA256 `308ad5c99d96990df327e08bb0272ea9f52931bf43fcc630b97fcad6842e980d`.
ZIP de las primeras cinco funciones:
`74cb7d6552694cff30c52b89478dad48daf5d0c70931ff09e8b3121beb46c384`.
ZIP Task: `fad7d47c4447b0cea1c4816a797259233c899084c9631f9826548b790981fc9d`.
Los seis archivos y checkpoint se conservan en el directorio privado ignorado
`.firebase/bundled-iq6-postflight/evidence-6d17febf78674f49906a6dbd05e3a3de/`.
No se extrajeron ni publicaron variables de entorno o credenciales.

Cada funcion se comprobo ACTIVE y Ready100 en su revision exacta, junto con
limites GCF/Run, identidad, secretos y entorno frente al baseline capturado.
Cloud Build conserva GOOGLE_NODE_RUN_SCRIPTS vacio y no recibe el selector de
build. Task conserva su unica variable de timing; las otras cinco no la reciben.
Dotenv original restaurado, SHA256
`572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856`.

Comprobacion independiente59582 PASS:cinco GET de Scheduler/Tasks, fingerprint
igual al baseline02790f9f. Cola sigue RUNNING con concurrencia1/rate1/burst10,
un intento y backoff60..300s; schedulers de solicitud/dispersion mantienen sus
estados y frecuencias. REP y syncToday permanecen PAUSED. No se drenaron ni
ejecutaron trabajos de prueba; igualdad de configuracion no demuestra ausencia
de operaciones en vuelo.

## Alcance de la evidencia y recuperacion

La verificacion acredita bytes fuente y configuracion observada, no ejecucion
real de todas las ramas de cada handler. Las pruebas financieras previas usan
proveedores simulados. Este lote no produjo efectos financieros de prueba ni
mensajes a destinatarios reales. Las seis actualizaciones no son atomicas.

Baseline previo privado SHA256
`a4e0d206c879f9c6301640f6c87c4ac9a4994403a93d00a013bc2c10fa9139bc`, junto con
recibos/journal y fuentes anteriores preservadas por el trabajo. Los pins viejos
del helper de deploy ya no son un plan reutilizable: no volver a ejecutar ese
plan ni actualizar pins automaticamente. Ante un defecto, reconsultar el estado,
preparar correccion compatible y conservar las protecciones UNKNOWN/idempotencia.
No rollback automatico ni repeticion de efectos financieros inciertos.
