# Ejecutor acotado de observaciones sintéticas

Estado: fuente y pruebas locales listas; **no se ejecutó contra producción**. La ejecución central previa del verificador DISABLED pasó (mint ACCESS/ID 200, POST 503/PUBLISHER_DISABLED, tres negativos 403, ambas retiradas REMOVED_VERIFIED; commit `d1cd871`). Esa evidencia no acredita todavía el recorrido Logging → sink → Pub/Sub → observador → Firestore.

Archivo nuevo: `services/pay0-sentinel-observation/scripts/run-canary-observation.ps1`. Importa `verify-canary-runtime.ps1 -LibraryOnly` sin modificarlo. El wrapper preserva sus flags al importar. Sin `-Execute` no hace llamadas remotas. No crea roles, modifica variables de entorno, hace despliegues, modifica Terraform/state ni configura o activa el sink.

## Parámetros y preflight

`-Mode` solamente admite CANARY_DRY_RUN o CANARY. `-ExpectedRevision` requiere el nombre **corto exacto** de una revisión desplegada, formato `pay0-security-canary-00002-abc` (ejemplo sintáctico, no evidencia de una revisión real). `-MaxPosts` admite uno o dos; DRY_RUN exige exactamente uno. Ningún parámetro admite body, evento, URL, root, actor o publisher arbitrarios.

Antes de modificar bindings y antes de cada POST, valida:

- Metadata del servicio: URI incluida en las dos URLs reales ya revisadas; IAM habilitado; no reconciling; latestReady/Created exactamente la revisión esperada; un único destino de tráfico 100% para esa revisión.
- Revisión inmutable: SA canario exacta, un contenedor, modo solicitado y PAY0_SOURCE_PROJECT_ID=pay-0-system.
- Sink `pay0-sentinel-observe-v1`: destino exacto al topic aislado, sin exclusiones ni propagación a hijos. Filtro canónico **completo**, equivalente al Terraform actual para un solo origen y revisión. Exige resource.type/location, logName dedicado, schemaVersion, service, revisión, root `canary-observation-root` y actor `canary-observation-actor`. Solo normaliza espacios; un OR adicional, otro root/revisión/destino o un filtro diferente falla cerrado.
- Sink disabled=true para CANARY_DRY_RUN y false para CANARY. JSON protobuf puede omitir disabled cuando es false; valores no booleanos se rechazan.

El sink se consulta con el comando fijo `gcloud logging sinks describe`, especificando explícitamente la cuenta del operador. No se imprime su JSON. El ID `pay0-observation-canary-v1` lo asigna el contrato de transporte del observador; no es una propiedad arbitraria que este script inserte en el evento. Root debe actualizar/verificar la allowlist del observador para la revisión real antes de CANARY: este ejecutor valida el sink, **no certifica la configuración del observador**.

## Credenciales, llamadas y retirada

Reutiliza los helpers revisados de policies v3/etag, HTTP acotado y cleanup. Verifica el rol preexistente exacto `canaryRuntimeVerifier` con getAccessToken/getOpenIdToken; añade solo los dos bindings temporales de veinte minutos: usuario→rol sobre SA canario y SA→run.invoker sobre servicio canario. Conserva otros miembros y condiciones. No amplía roles ni concede permisos de proyecto.

Aquí se necesita solamente ID token con audiencia de la URI validada e includeEmail; **no se emite access token de la SA** ni se repiten pruebas financieras. El rol reutilizado incluye getAccessToken por el contrato previo, pero esta ejecución no usa esa facultad. Mint permite hasta siete intentos de propagación; tras mint espera veinte segundos una vez para invoker. El ID token queda solo en memoria y mantiene el límite de aproximadamente una hora del proveedor. Retirar el binding de mint no lo revoca; invoker retirado deja de autorizar cuando propaga IAM. Véase [contrato del verificador](CANARY-RUNTIME-VERIFICATION.md).

Cada POST `/canary` está vacío y usa el mismo token. El contador aumenta **antes** de enviar: timeout, 401, 403, 503 y respuesta ambigua cuentan contra el máximo. No hay reintento automático de POST; cualquier respuesta distinta de 200 + `LOGGING_DRY_RUN_ACCEPTED`/`LOGGING_ACCEPTED`, según modo, detiene la tanda y ejecuta cleanup. Un éxito tampoco crea una llamada adicional fuera de MaxPosts.

`finally` retira y confirma ambos bindings en orden inverso, incluyendo errores durante alta/mint/preflight/post. Si una retirada no se confirma, el resultado no es éxito. Logs únicamente enums/status en TEMP; no guarda tokens, cuerpos de respuesta ni policies. Terminación forzada o pérdida de conectividad pueden impedir finally; el vencimiento de veinte minutos limita el grant temporal.

## Interpretación del resultado

Exit 0 significa **aceptación por Logging y retirada confirmada**, no E2E completo. DRY_RUN no exporta una observación. En CANARY, dos POST generan el mismo eventId/insertId estable por revisión, con tiempos distintos; la segunda llamada sirve como estímulo para revisar deduplicación. No afirmar deduplicación por observar dos HTTP200: verificar aparte recepción/procesamiento y estado persistido sintético, sin lecturas de datos financieros. El transporte puede deduplicar antes del observador, por lo que un único documento no acredita por sí solo todas las capas.

Revisión/mode/sink pueden cambiar entre GET y POST: reservar una ventana sin rollouts ni cambios de configuración. Cada recheck reduce ese riesgo, pero no es una transacción distribuida. El tope es por invocación del script; no ejecutar copias concurrentes ni reiniciar automáticamente ante resultado ambiguo. Root controla la ventana y cualquier lectura E2E posterior, regreso a DISABLED y apagado del sink. Este script no cambia esos estados.

## Pruebas

`powershell -NoProfile -File qa/scripts/remediation-canary-observation.test.ps1`: **23 casos PASS**, sin red, con helpers reales de policies/cleanup y HTTP sustituido. Incluye ambos modos, máximo de POST, contador ante timeout/403, rechazo de modo/revisión/parámetros inválidos, filtro OR amplio, root/revisión/destino incorrectos, exclusiones, cambio de sink antes del segundo POST, rol amplio, mint agotado, alta ambigua y cleanup fallido. Comprueba rechecks por POST, preservación de bindings ajenos e importación LibraryOnly sin ejecutar.

Dry-run sin flags PASS. Verificador original permanece intacto; sus veinte pruebas siguen siendo la cobertura del adapter HTTP compartido. No se activaron modos remotos ni se emitieron logs sintéticos durante esta implementación.
