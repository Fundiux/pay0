# Preparación local del entorno Telegram

`telegram-transition-env.mjs` modifica exclusivamente las tres variables de transición en `functions/.env.pay-0-system`, dentro del workspace que contiene este script. No admite otra ruta por CLI, no despliega ni hace llamadas remotas. Debe ejecutarlo la revisión central, después de los gates de navegador/build; durante su ejecución no editar el archivo con otra herramienta.

```powershell
node scripts/telegram-transition-env.mjs --mode bridge
node scripts/telegram-transition-env.mjs --mode bridge --execute-local
```

El primer comando es DRY_RUN: valida en memoria y muestra solo estado/hash SHA256 general anterior/posterior; no escribe backups ni estado. La fecha calculada en dry-run no queda reservada: `--execute-local` fija una sola vez inicio UTC actual y deadline de 60 minutos. Si ya existe un puente válido, adopta sus fechas sin ampliarlas. Reintentar conserva la ventana persistida; expirada, futura, parcial, contradictoria o previamente cerrada falla. No borrar estado para renovar el puente.

Solo tras acreditar los gates del consumidor y Hosting:

```powershell
node scripts/telegram-transition-env.mjs --mode final
node scripts/telegram-transition-env.mjs --mode final --execute-local
```

Final deja explícito `TELEGRAM_DOWNLOAD_TRANSPORT_MODE=POST_FRAGMENT` y elimina únicamente las líneas de los dos timestamps. No condiciona este cierre a que la ventana siga vigente. Registra estado cerrado para impedir reapertura accidental.

Usa `parse` y `validateKey` del Firebase CLI instalado (sin el logging de parseStrict), además de un scanner conservador. Rechaza duplicados de cualquier clave, UTF-8 inválido, CR aislado, sintaxis ambigua y valores multilinea. Conserva bytes de líneas ajenas, BOM, CRLF/LF, comentarios y orden; si falta newline al EOF y hay que anexar, conserva los bytes existentes y añade únicamente el separador necesario. Compara todos los valores ajenos con el parser Firebase antes y después. No reformatea todo el archivo.

Antes de escribir exige que Git ignore `.firebase/telegram-transition/`. Allí crea backup de bytes originales verificado por hash, manifest con hora/modo/fase/hashes generales/nombre de backup, estado de ventana y lock exclusivo. **El backup contiene el archivo privado completo**: mantener este directorio local protegido e ignorado, nunca adjuntarlo ni subirlo. Manifests/estado no contienen valores de otras variables. La ventana se persiste antes de sustituir el target; recuperación PREPARED no la renueva. Stage, backup y manifests se escriben con fsync y rename local; se relee el hash original justo antes del reemplazo y el final después. No es un bloqueo contra editores externos ni una transacción multiarchivo.

Ante fallo, salida fija `FAILED_REVIEW_REQUIRED` y `STAGE:<enum>` sin error del parser/payload, ruta ni stack. Etapas relevantes: TARGET_REPLACE, AFTER_TARGET_REPLACE, TARGET_VERIFY, STATE_APPLY, MANIFEST_APPLY, JOURNAL_RECOVERY y LOCK_RELEASE_FAILED. El código identifica dónde falló el procedimiento, no la causa del sistema operativo. Un proceso abortado puede dejar lock/PREPARED: revisión central debe comprobar que no sigue ejecutándose, revisar hashes/backup y resolver el estado; el helper nunca rompe un lock existente. No restaurar bytes automáticamente tras un fallo ambiguo. Restaurar un archivo local no revierte una revisión remota desplegada.

Un NO_CHANGE ejecutado ahora reconcilia un manifest PREPARED del mismo modo solo si su afterHash coincide exactamente con el archivo actual y el backup conserva beforeHash. Marca RECOVERED_APPLIED con hora de recuperación y confirma estado aplicado; no cambia bytes ni fechas del puente. Más de un candidato, hash diferente, backup corrupto o manifest inválido falla cerrado. Se inspeccionan como máximo128manifests de4KiB y backups de1MiB; no se imprime contenido. La recuperación no cambia la vigencia: un puente expirado no se renueva, aunque se puede cerrar con final.

Incidente comunicado por revisión central: la primera ejecución local bridge devolvió fallo genérico, pero el target tenía el afterHash previsto y state/manifest seguían PREPARED. Inicio persistido21:29:52.042Z/deadline22:29:52.042Z; sin deploy en ese momento. Un dry-run confirmó ausencia de cambios pendientes y una reinvocación anterior devolvió NO_CHANGE; el código anterior actualizaba state pero dejaba manifest PREPARED. Este gap queda corregido. No se dispone de la excepción original para atribuir la causa a un filesystem transitorio; este trabajo no leyó ni modificó los archivos reales ni la integración en ejecución.

Pruebas: `node --test qa/scripts/remediation-telegram-env.test.mjs` — **20 PASS** con parser Firebase real y archivos sintéticos en TEMP. Además de los12casos iniciales, simula fallos antes/después de rename, verificación, state y manifest, recuperación exacta sin renovación, backup corrupto y recuperación expirada. Los errores inyectados contienen un marcador sensible sintético que nunca aparece en el error público. Los exports con inyección de workspace/parser/ignore/checkpoint existen para pruebas; la CLI no ofrece esos overrides. No se ejecutó el helper sobre el `.env` privado real durante esta corrección.
