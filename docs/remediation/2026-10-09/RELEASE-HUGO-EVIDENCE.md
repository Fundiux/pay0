# Hugo: publicacion de consumidores de evidencia

Publicado y verificado el 10 de octubre de 2026 desde integration `5a4457e`.
Solo se desplegaron estos cuatro consumidores, sin llamadas autenticadas, modelos
ni escrituras historicas de prueba. Cada revision esta ACTIVE, Run Ready y con
100% del trafico; cada POST vacio sin autenticacion devolvio 401.

| Export | Revision | Generacion fuente | Actualizacion UTC |
| --- | --- | --- | --- |
| linkAgent007VerifiedExperience | 00003-zaw | 1791653706049481 | 17:37:27.403236085Z |
| createAgent007LearningExperience | 00003-taj | 1791653826944230 | 17:37:26.630313858Z |
| createAgent007LearningDraft | 00003-dah | 1791653826964745 | 17:37:26.852390109Z |
| linkAgent007LearningOutcome | 00003-bij | 1791653827026763 | 17:37:26.560605835Z |

Se preservaron 30s/256Mi/CPU1/max20/concurrencia80, cuenta de servicio, ausencia
de secretos y configuracion de red. El helper060d407 comparo metadatos y variables
antes/despues. Dotenv local restaurado a SHA256
`572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856`.
Sesion26099 exit0; journal privado `.firebase/hugo-evidence-deploy/8af6e5c6351148ffaceb16b508975a3b/`.
Restauracion confirmada17:37:46.5710509Z y recheck local independiente PASS.

Evidencia del candidato: 90 pruebas sinteticas (incluye manifest92assertions),
Functions build y verificador de autorizacion PASS; fases4/5 y15comprobaciones
historicas en emulador, con3reintentos SDK controlados PASS. El predeploy normal
completo tambien paso. La prueba de reintento controlado no demuestra una carrera
natural observada en produccion. Compatibilidad documentada en
[HUGO-HISTORICAL-EVIDENCE.md](HUGO-HISTORICAL-EVIDENCE.md).

La promocion relee evidencia dentro de una transaccion y exige identidad,
cronologia y root compatibles. Observaciones historicas sin sourceSystem solo
se resuelven mediante una fuente backend inequivoca; no se reescriben historicos.
Esto no certifica todas las cohortes historicas ni las memorias ya existentes.
Los productores no incluidos conservan su observer empaquetado anterior.

El primer intento34858 fallo antes de subir fuente por discovery finalCLI10s,
despues de demoras extraordinarias del entorno. Env restaurado y4pins remotos
intactos fueron comprobados. La misma prueba estricta paso luego en2.517s/346,
limite7s intacto; se autorizo un nuevo intento acotado, no una repeticion automatica.

Los cuatro artefactos anteriores por generacion estan preservados segun
[HUGO-RUNTIME-ARTIFACT-PREFLIGHT.md](HUGO-RUNTIME-ARTIFACT-PREFLIGHT.md), hash ZIP
`c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
Preferir correccion hacia delante: rollback reabre guardas de identidad y carreras.
No se probo ni ejecuto rollback productivo.
