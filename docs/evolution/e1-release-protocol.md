# E1: publicación por capacidad

La referencia productiva se consulta, no se deduce de `main`. La captura de
2026-10-19 identificó Hosting `d446c05b06cc4941`, gateway con 100 % en
`hugo-voice-gateway-canary-astra-7dfcd8a` y fuentes distintas para chat,
delegación de voz y reporte público. Los archivos originales y metadatos completos
se conservan bajo `.firebase/modular-release/`, ignorados por Git.

R1 se limita a `sendAgent007Message` y `delegateHugoVoiceTurn`. El cuerpo del
reporte público ya desplegado es idéntico en las tres fuentes; no necesita otro
despliegue. La imagen del gateway se prepara como entrega separada.

## Identidad de un parche sobre producción

Un artefacto `PRODUCTION_OVERLAY_V1` no representa el árbol completo de un commit.
Su identidad combina hash del archivo productivo original, commit que aporta
el parche, hash del parche revisado y hash del archivo final compilado. Por eso
el manifiesto registra `sourceTree: null` y `sourceIdentity` explícito.
La etiqueta `pay0-source-commit` identifica **el commit del parche**, sólo cuando
`pay0-source-mode=production-overlay-v1`; no debe interpretarse como identidad
del checkout completo. Las etiquetas de base/parche y el manifiesto conservan
la procedencia compuesta. El hash del archivo publicado sigue siendo obligatorio.

El ejecutor existente admite dos scopes de un único endpoint, verifica prueba
del archivo exacto, compara de nuevo runtime/IAM/fuente, preserva la fuente
anterior y rechaza divergencias concurrentes. La comprobación de la fuente base
se realiza antes de subir o actualizar. Conserva variables, secretos, IAM,
configuración de tráfico y reglas; la nueva revisión de la Function sí recibe
las invocaciones conforme a esa configuración. Un update posterior de checkout completo elimina etiquetas
compuestas anteriores para no conservar procedencia engañosa.

`--prepare` y capturas son preparación; `--execute` es una escritura productiva
que requiere autorización explícita del paquete y sus hashes. La reversión usa
el archivo anterior por función y conserva datos y eventos. Los paquetes no se
declaran `COMPLETED` al compilar: quedan `DEPLOYMENT_PENDING`; tras publicación,
`DEPLOYED_NOT_VERIFIED` hasta comprobar el flujo autorizado real.

Pruebas locales: `qa/scripts/scoped-deployment.test.mjs`,
`qa/scripts/e1-overlay-provenance.test.mjs` y
`qa/scripts/e1-release-baseline.test.mjs`. No envían peticiones productivas.
