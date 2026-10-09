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

Ante fallo, salida fija `FAILED_REVIEW_REQUIRED` sin error del parser/payload. Un proceso abortado puede dejar lock/PREPARED: revisión central debe comprobar que no sigue ejecutándose, revisar hashes/backup y resolver el estado; el helper nunca rompe un lock existente. No restaurar bytes automáticamente tras un fallo ambiguo. Restaurar un archivo local no revierte una revisión remota desplegada. Los backups y el estado conservan evidencia para recuperación.

Pruebas: `node --test qa/scripts/remediation-telegram-env.test.mjs` — 12 PASS con parser Firebase real y archivos sintéticos en TEMP: CRLF/BOM, comentarios sin EOF, duplicados, quoting/multilinea, ventana fija/expirada, backup/manifest, lock, ignore, PREPARED y final. No se leyó ni ejecutó el helper sobre el `.env` privado real durante esta implementación. Los exports con inyección de workspace/parser/ignore existen para pruebas; la CLI no ofrece esos overrides.
