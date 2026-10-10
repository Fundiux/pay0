# Helper de publicación selectiva de descarga autorizada

`scripts/deploy-authorized-download.ps1` sólo puede seleccionar
`functions:getAuthorizedDocumentDownloadUrl`. Default `Preflight`; también
`LibraryOnly` y `Execute` explícito. No se ha ejecutado Preflight/Execute con este
helper. La revisión remota previa está en `AUTHORIZED-DOWNLOAD-RUNTIME-PREFLIGHT.md`
del candidato aislado. No integra ni despliega automáticamente el candidato.

Fija revisión previa `getauthorizeddocumentdownloadurl-00004-vat`, generación
`1791586901568255`, proyecto `pay-0-system`, runtime node22,30s,256Mi,CPU1,max20,
concurrencia80,min ausente/null,ALLOW_ALL,VPC/egress ausentes/null y SA compute
`751158244178-compute@developer.gserviceaccount.com`. No admite secretos ni volumes.
El objeto de configuración usa nombres y conserva null en cada posición.

Admite **exactamente dos claves** de usuario: `PAY0_FIREBASE_WEB_API_KEY` y
`TELEGRAM_DOWNLOAD_TRANSPORT_MODE=POST_FRAGMENT`. Compara ambas con dotenv local;
la primera nunca se imprime. Rechaza otras claves, duplicados, sintaxis no revisada
y transporte distinto. No usa scope public-key-only. Genera las dos líneas de
staging con validación cerrada y restaura todos los bytes originales por hash/CAS.
Hash histórico restaurado observado:
`572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856`;
el coordinador debe volver a comprobarlo, no inferir aprobación sólo de esta nota.

El worktree objetivo es fijo `.worktrees/pay0-remediation-integration-20261009`
relativo al checkout del helper. Exige HEAD40hex aprobado, árbol limpio y único
archivo `.env.pay-0-system`. Antes de publicar vuelve a leer configuración/pins;
tras éxito exige nueva revisión y generación, misma configuración y ambas claves.
Nunca invoca una descarga de usuario, Telegram, ni una mutación financiera.

El helper reside en fuente principal porque la integración base `a276e03` no
contiene `deploy-iq-deposit-preserving-env.ps1`. Dot-source de esa librería en
`LibraryOnly` reutiliza sólo hashing, mapas, CAS y captura nativa de stdout/stderr.
No copia sus planes/pins, no ejecuta su flujo y no usa su serializador: éste
deliberadamente no admite la clave de transporte. No se modificó la librería.

`Execute` crea lock exclusivo y backup verificado con CreateNew, journal privado
con tiempo/hash/selector y log privado de CLI bajo `.firebase/download-evidence-deploy`.
Se comprueba que los backups estén ignorados. Restaura dotenv aun ante error de
CLI/postflight/abort; ante edición concurrente falla sin pisarla y conserva backup.
No hay retry automático ni rollback remoto. Un fallo después de update remoto
no implica que el código anterior siga publicado: revisar metadatos antes de otro
intento. El lock es de este helper, no exclusión global frente a otro despliegue;
el coordinador debe mantener la ventana única de release.

Prueba local `node qa/scripts/remediation-authorized-download-deploy-helper.test.cjs`:
**63 checks PASS**, `remoteCalls=0`. Fakes cubren selector único, pins, runtime,
nulls, secretos prohibidos, alcance/valores de entorno, backup, no overwrite,
postflight, abort, exit no numérico, restitución exacta y conflictos CAS. La
primera prueba detectó la librería ausente del worktree aislado; se ubicó el helper
en fuente principal. La siguiente detectó la restricción del serializador IQ;
se añadió el serializador de dos claves y se repitió con PASS. No se ejecutó
ninguna acción remota durante esas pruebas.

Para futura ejecución revisada desde la fuente principal:

```powershell
./scripts/deploy-authorized-download.ps1 -Mode Preflight -ExpectedHead <HEAD40> -ExpectedEnvHash <HASH64>
# Execute sólo después de revisión central, integración y gates:
./scripts/deploy-authorized-download.ps1 -Mode Execute -ExpectedHead <HEAD40> -ExpectedEnvHash <HASH64>
```

No se fija HEAD candidato aquí: el coordinador debe integrar los commits
`b77765a` y el ajuste de opciones, completar gates y pasar el HEAD exacto.
Este lote conserva URL bearer300s; generation pin no es revocación por GET.

## Primer Execute, 2026-10-10: sin upload

Candidato integrado/subido `26135597ce50f23818150a696218d17079e44596` incluye
pin de generacion (`c691095`), limites (`6e28949`) y QRCode diferido (`2613559`).
Build Functions, 35 pruebas de descarga, 24 comprobaciones de runtime y 15 de QR
PASS. Gate previo warm3568/strict3218/CLI3605 ms con346 endpoints PASS. El cambio
QRCode conserva dos PNG reales y manifest completo; no garantiza estabilidad
bajo carga variable del host.

Preflight exacto PASS. Execute95532/journal8100617d8eff41ac8cff6fe978ecdd2c empezo
20:30:43.8500614Z; guard inicial2579ms PASS, gate CLI final STARTUP_LIMIT9351ms
frente al maximo7000ms. Fallo20:36:42.9670329Z antes de upload; dotenv restaurado
20:36:43.0408582Z a SHA572b76d72c40c427b9ac33220a9a004f2717bd412b67f53e20ed27d19fd86856.
Lectura de hash independiente y Preflight posterior PASS1funcion/cloudWrites0/
dotenvWrites0: revision00004-vat y configuracion previas conservadas.

No segundo Execute identico ni nueva revision publicada. El postflight privado
c20f0b1a esta preparado para pins nuevos explicitos y journalcompleto, pero no
se ejecuta sobre este fallo. Incluye GCF/RunReady100, dotenv/env/config y POSTsin
Auth401; declara falta de baseline historico de maxInstances a nivel servicioRun.
Siguiente investigacion: distinguir CPU/wall/I/O del descubrimiento local tras
predeploy; no relajar gates ni atribuir un fallo al ENOENT secundario del wrapper.
