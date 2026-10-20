# Canario Sentinel: replay de contenido inmutable

2026-10-09. Cambio exclusivamente local, posterior al binding de receipts `ab30e32`. No hubo llamadas cloud, despliegue, activación del sink, KMS ni edición de integración. El canario remoto continúa con su configuración previa apagada; este documento no certifica un nuevo E2E remoto.

El canario ahora exige `CANARY_OCCURRED_AT_MS` explícito en los modos CANARY_DRY_RUN/CANARY. Es un epoch decimal canónico de13 dígitos fijado por configuración de revisión; no se obtiene del cliente, del arranque del proceso ni de Date.now como fallback. DISABLED sigue admitiendo su ausencia, permitiendo publicar una imagen apagada sin preparar ventana.

La identidad sintética v2 es `canary_` seguido de SHA256 UTF-8 de `PAY0-CANARY@2:<revision>:<epoch>`. El evento conserva root/actor fijos del canario, AUTHORIZATION_DENIED/SERVER_AUTH_DECISION y occurredAtMs igual al epoch configurado. Replays dentro de la misma revisión y epoch conservan exactamente jsonPayload. Se sigue usando el publisher puro existente: el wrapper exclusivo de canario fija el instante del evento antes del writer; no altera el reloj utilizado por cuotas.

La metadata de entrega puede cambiar. timestamp del LogEntry sigue el reloj de envío e insertId es un UUID por envío, para que Logging no suprima el replay por deduplicación de transporte. Ninguno forma parte del binding semántico de Sentinel. No se añade endpoint, parámetro HTTP o modo que permita alterar un evento; POST /canary sigue vacío y privado, con root/actor elegidos por servidor.

Ventana máxima:60min desde el epoch fijado; un epoch futuro se rechaza. Antes de cada envío se exige margen3s para el presupuesto existente metadata+Logging; desde epoch+60min-3s se rechaza. Vencer devuelve el error fijo del publisher sin invocar el writer. Reiniciar procesos, repetir scripts o pasar de DRY_RUN a CANARY no renueva el epoch. Cambiarlo requiere una nueva configuración revisada, y crea otra identidad sintética; no se presenta como replay de la anterior. Las cuotas locales6/minuto,20/proceso y un inflight permanecen; sus límites ante reinicios siguen documentados.

## Parámetros y procedimiento futuro

Terraform agrega `canary_occurred_at_ms`, string opcional con default null. Una precondition rechaza modo activo sin epoch. La variable se escribe como CANARY_OCCURRED_AT_MS solo cuando existe. No usa timestamp() ni generación automática de la ventana. El cambio declarativo no concede permisos ni crea nuevas identidades.

Los dos scripts siguientes continúan en modo seguro sin `-Execute`; este cambio no los ejecutó contra cloud:

- `run-canary-observation.ps1`: nuevo `-ExpectedOccurredAtMs <epoch>` junto con `-ExpectedRevision <revision>`, Mode y MaxPosts. Valida ventana antes de credenciales en CLI y antes de bindings/POST en el flujo; compara exactamente el epoch de la revisión desplegada en cada preflight. DRY_RUN máximo1 POST y CANARY máximo2, sin retry. El script no establece el epoch ni cambia configuración/sink.
- `verify-canary-observation.ps1`: nuevo `-ExpectedOccurredAtMs <mismo-epoch>`. Deriva los dos paths exactos con identidad v2; exige occurredAtMs exacto, contentBindingVersion PAY0-EVENT-CONTENT@1 y contentDigest calculado con el mismo orden de campos del core. Conserva validación de eventCount1, authority NONE, OBSERVE_ONLY, scopes y TTL. Solo hace las lecturas exactas existentes; no descubre epoch mediante consultas extra, no imprime paths/eventos y no modifica IAM.

Una futura ventana revisada debe desplegar publisher y observer compatibles apagados, fijar epoch conscientemente, preparar modo DRY y revisar revisión real/allowlist/filtro. Si se cambia a CANARY, registrar la nueva revisión real y el epoch conservado. Después de los dos envíos, el verificador recibe esa revisión y epoch exactos. Si la ventana venció, cerrar; no regenerar hora automáticamente para hacer pasar una prueba. La eventual apertura, verificación remota y cierre pertenecen a integración central, fuera de esta tarea.

El verificador puede leer evidencia después de cerrar la ventana de emisión mientras conserve validez24h/TTL y cumpla sus restantes checks. Una respuesta Logging200 por sí sola no prueba persistencia, DUPLICATE ni ausencia de conflicto.

## Histórico v1 y conflicto

El E2E histórico que usó `PAY0-CANARY@1:<revision>` conserva su evidencia y alcance originales. No se transforma ni reescribe su receipt, ni se declara que cumplía el binding añadido después. El verificador actual deriva solamente v2 y rechaza receipts sin binding; no tiene fallback legacy. Si fuera necesario auditar historia, se debe identificar explícitamente el contrato/commit histórico y describir su alcance, no ejecutar el actual contra claves v1 esperando certificación nueva.

Cambiar occurredAtMs con el mismo eventId ahora es EVENT_CONTENT_CONFLICT. Las pruebas locales alteran ese campo en memoria y comprueban que no cambia receipt, incidente, cuota ni autoridad. No se añade una acción remota para emitir contenido conflictivo. Un replay exacto y un proceso nuevo con la misma revisión/epoch producen DUPLICATE y mantienen eventCount1.

## Evidencia local

- Publisher12 pruebas PASS: identidad inmutable, avance de reloj, reinicio, ventana vencida/futura, ausencia/formatos inválidos del epoch, DISABLED sin epoch y límites/transportes anteriores. Fixture usa productor y core reales para RECORDED → DUPLICATE → DUPLICATE y conflicto posterior sin cambios.
- Verificador de evidencia24 casos PASS, fixtures del core real con replay idéntico y conflicto alterado; rechaza binding incorrecto/ausente y epoch no esperado.
- Runner27 casos PASS con I/O fake: preflight epoch incorrecto o ausente/vencido/futuro impide mutación; límites de POST, errores ambiguos y limpieza IAM conservados. No llamadas IAM reales.
- Build publisher PASS, sintaxis main PASS; Terraform portable local fmt-check y validate PASS. No init, plan, apply o build cloud. El core/helper TS existente no se modificó.

La autenticación adicional de productores reales continúa pendiente. Este contrato solo utiliza el scope sintético fijo, sin permisos nuevos, datos reales, decisiones financieras o contención.
