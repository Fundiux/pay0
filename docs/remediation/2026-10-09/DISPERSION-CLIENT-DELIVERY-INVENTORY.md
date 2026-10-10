# Inventario acotado previo a entrega CLIENT

Herramienta local: `scripts/dispersion-client-delivery-inventory.mjs`.
No ejecutada contra nube. Default DRY_RUN_NO_NETWORK, sin buscar credenciales.
34 pruebas sinteticas PASS, 0.95 s; no datos ni mensajes reales.

## Alcance de las lecturas

Proyecto fijo pay-0-system, Firestore (default), bucket fijo
pay-0-system.firebasestorage.app. Solo runQuery de lectura y GET de documentos
o metadatos GCS. Sin alt=media, URL firmada, download tokens, nombres, chatId,
username, email, importe, mensaje, contenido ni credenciales persistidas.
OAuth se obtiene mediante memoryCredential existente, en memoria, sin argumentos
con token ni logs de proveedor. Respuestas/error details nunca se imprimen.

Cada ejecucion selecciona explicitamente un root del bootstrap privado revisado,
con --root-index. Un checkpoint distinto por root y modo. El bootstrap puede
cubrir solo una parte de los roots: no se declara cobertura global del proyecto.
El hash SHA256 completo del archivo bootstrap, rootId, proyecto, schema y modo
quedan fijados en checkpoint privado; cambios requieren otro checkpoint y no
mezclan acumulados. Cursor por __name__, orden ascendente, limit+1. Se puede
reanudar por paginas; ninguna lectura constituye snapshot transaccional.

Modo clients: pagina de hasta 25 documentos clients del root (incluye registros
inactivos; no certifica vigencia), proyectando solo rootId. Por cada cliente,
query clientTelegramUsers con clientId/active=true y proyeccion de
rootId/clientId/active, sin chatId. NO filtra root en la consulta: replica la
seleccion del candidato antes de su limite y validacion de root. Asi un vinculo
con root ajeno, ausente o de tipo invalido cuenta para el fan-out previo, tal
como puede provocar overflow en el candidato. Lee hasta 101 filas para clasificar 0, 1, 2-10, 11-100 y
GT100_LOWER_BOUND. Los conteos son VINCULOS, no chats distintos ni destinatarios
actualmente autorizados. LINK_ROWS_OBSERVED suma todas las filas observadas;
LINK_ROWS_VALID_SCOPE y LINK_ROWS_INVALID_SCOPE separan root exacto del resto
y suman el total. El histograma usa el total heterogeneo ANTES de filtrar root.
Ninguna fila con root invalido se convierte en destinatario autorizado.
Hasta 100 filas la cantidad es un limite superior al
numero de chats deduplicados dentro de las filas observadas. Con 101 filas solo
hay un limite inferior del total de vinculos; no existe limite superior conocido
de chats ni deduccion de cuantos son diferentes. No se consulta chatId para
cerrar artificialmente esa incertidumbre. El sentinel no se omite del conteo
LINK_ROWS_OBSERVED, que es observacion parcial cuando hay mas de 100.

Modo uploads: pagina hasta 25 READY/active/clientDispersions del root. Proyecta
solo scope, tipo, ruta, generacion y finalizedBy. Lee padre con root/client y
fundingSource.holderType. USER se cuenta como USER_SKIPPED sin leer GCS ni decidir
politica. Funding ausente sigue el fallback CLIENT del dominio existente;
valores desconocidos requieren revision. No se cargan datos del actor: contar
finalizedBy presente no prueba que exista, este activo o autorizado.

Para upload CLIENT con identidad/ruta valida, GET GCS proyecta exclusivamente
name,bucket,generation,contentEncoding. Si hay generacion valida se pasa como
string exacta; si falta se observa metadata actual una vez, SIN backfill ni
atestacion. Generacion invalida no inicia GCS. Tipos Firestore integer/double/array/timestamp
en una generacion esperada string se decodifican a un marker fijo sin conservar
valores ni convertir numeros a string: producen GENERATION_INVALID por fila,
no abortan el lote. Tipos inesperados en otros campos escalares tampoco se
aprueban como strings. Estructuras o sobres REST fuera de contrato se rechazan. ContentEncoding ausente/identity
se separa de otros valores. Un objeto ausente o identidad discordante tiene
categoria propia. No mide bytes, hash, malware ni integridad historica. No lee
eventos de Telegram y NO autoriza replay de un evento legacy o incierto.

## Limites, salida y ejecucion futura

Maximo 51 HTTP por invocacion (uploads: 1+25x2; clients: 1+25). JSON por respuesta
<=512 KiB, timeout HTTP <=10 s, presupuesto de transporte 120 s comprobado antes
y despues de pedir credencial. El credential helper mantiene su timeout propio
de 30 s, por lo que la terminacion local puede superar el presupuesto por ese
residual. No retries ni fallback a scan sin filtros ante falta de indice/error.
Paths/IDs no admitidos se rechazan; este contrato no garantiza cubrir todas las
formas historicas de ID o nombre de objeto.

La salida contiene solo enums, booleanos y contadores. No devuelve root, cursor,
nombres, paths, IDs ni hash del bootstrap. Declara countsDistinctChats=false,
snapshotConsistent=false, allRootsCovered=false, deliveryAuthorized=false,
attestationPerformed=false y CURRENT_RESOLVER_REVALIDATION_REQUIRED.

Checkpoint privado bajo .firebase/document-inventory: lock exclusivo, escritura
temporal/fsync/rename; valida scope, hash y claves/conteos al reanudar. Contiene
root/cursor, nunca payloads/Storage paths/chatId/OAuth. Los permisos 0600 no
sustituyen las ACL Windows. No subir ni versionar estos artefactos.

Ejemplo de contrato futuro, NO ejecutado:

```powershell
node scripts/dispersion-client-delivery-inventory.mjs --execute-read-only --bootstrap .firebase/document-inventory/bootstrap.json --root-index 0 --mode clients --checkpoint .firebase/document-inventory/client-links-root0.json --limit 25
node scripts/dispersion-client-delivery-inventory.mjs --execute-read-only --bootstrap .firebase/document-inventory/bootstrap.json --root-index 0 --mode uploads --checkpoint .firebase/document-inventory/client-uploads-root0.json --limit 25
```

## Decision de compatibilidad

El candidato notifier 366f74a NO puede convertir 10 en contrato por una muestra,
ni por este inventario completo de una fotografia no consistente. Si hay mas de
10 vinculos, cobertura insuficiente, encoding no admitido o legacy sin generacion,
release permanece abierto. Un conteo alto puede contener chats repetidos; no se
infiere lo contrario para autorizar truncamiento.

La transicion completa requiere un trabajo paginado con cursor durable y recibos
por destinatario, sin truncar el conjunto autorizado. Debe definir snapshot o
cohorte estable de vinculos, deduplicacion privada, validacion actual antes de
cada POST, estado terminal por parte y prohibicion de reclamar IN_FLIGHT/UNKNOWN.
Los checkpoints del inventario NO son cola de envio ni autorizacion de entrega.
La planificacion de ese job debe preservar USER early return y no reabrir eventos
legacy inciertos. Esta herramienta no crea dicho job ni modifica contratos.

Revision root: consulta corregida para incluir roots heterogeneos antes del
limite; pruebas REST reales del adapter cubren 11 vinculos (3 scope valido,
8 invalido/ausente) y cuatro tipos de generacion incorrectos. Se corrigio un
error de sintaxis del fixture antes de obtener 34/34 PASS. Sin ejecucion remota.

## Evidencia remota reportada por coordinacion, 2026-10-10

Coordinacion ejecuto la herramienta revisada, sin modificarla, para root-index0.
Clients: 85 registros y pagina final agotada; 84 sin vinculos y uno con un unico
vinculo activo de root valido. Uploads: tres CLIENT READY/active, filtro agotado;
los tres sin storageGeneration y con finalizedBy presente. Las tres lecturas de
metadata actual coincidieron en identidad y contentEncoding ausente/identity.
Cero escrituras cloud, bytes de archivo descargados o mensajes enviados.

El bootstrap original cubria solo 100 uploads y un root observado. El agotamiento
se refiere a estos filtros/root en esas lecturas: NO acredita todos los roots,
un snapshot estable, autoridad actual, integridad historica ni compatibilidad
global de release. Los tres uploads siguen sin generacion persistida; observar
metadata actual no es backfill, atestacion ni permiso de replay. El gate legacy
continua abierto aunque la muestra de vinculos no haya superado diez.

Checkpoints privados y sus hashes de evidencia permanecen bajo control de
coordinacion; este cambio documental no los lee, modifica ni recalcula. No se
versionan IDs, rutas de objetos, respuestas o hashes de identificadores.
