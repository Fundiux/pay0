# Ejecutor futuro de configuración de gates D

Estado: **LOCAL_TESTED_NOT_USED_IN_PRODUCTION**. No se generó input ni plan productivo, no se obtuvo un token y no se ejecutaron llamadas de nube. Este módulo no activa D por instalarse ni certifica aprendizaje operativo.

`scripts/execute-supervised-learning-gates.mjs` reutiliza el planificador puro y las primitivas existentes `previousSource`, `assertOperationScope`, `assertOperationMatchesGet` y `tokenInMemory`. No modifica helpers, whitelists ni controladores fijados por otros paquetes. No contiene upload, build, cambios de IAM o de fuente. El único PATCH admitido tiene máscara `serviceConfig.environmentVariables`, destino fijo review/chat y mapa completo conservado salvo `HUGO_SUPERVISED_RULES_ENABLED`.

Los dos ZIPs fijados por el planificador son review `c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d` y chat D1 sobre R1.5 `763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62`. No admite presentar R1.5 sin D1 ni un artefacto etiquetado arbitrariamente como D1. La validación de evidencia pinneada no autentica por sí misma quién capturó los metadatos; el ejecutor hace readback fresco y hash de los bytes de fuente antes de mutar.

## Entrada y autorización

El JSON privado tiene `kind: D_GATE_EXECUTION_INPUT_V1`, modo explícito `ACTIVATE`, `RESTORE_PREVIOUS` o `EMERGENCY_OFF`, y el bundle `evidence` definido por el planificador. Restore incorpora `rollbackContext` con evidencia original, plan de activación y recibo posterior fijados por SHA. No se infiere el estado original desde el journal actual.

La invocación sin `--execute` sólo valida localmente y escribe `gate-plan.json` en un directorio privado nuevo. No toca credenciales ni red. La ejecución futura exige `--execute`, `--input-sha256`, `--plan-sha256` y `--approve-gate-mode` con el modo exacto. Pins, reconstrucción del plan, pruebas de fuente y rutas locales se validan antes de crear el adapter de red. Esta combinación de argumentos es una guardia técnica; no sustituye la aprobación expresa del usuario para los bytes/configuración concretos.

El estado de salida es CONFIGURATION_VERIFIED con `functionalVerification: NOT_VERIFIED`. La rama V2 real depende de `input.promptVersion === "hugo-v2"` en Core. El callable WEB del ZIP fijado pasa ese valor de forma explícita; no hay un flag V2 adicional que deba inventarse o modificarse. La QA inspecciona ambos módulos del ZIP exacto. Ni la configuración ON ni esta comprobación equivalen a aprobar una regla o demostrar una recomendación en un caso real.

## Persistencia, estados e incertidumbre

El CLI usa los locks compartidos `active-executor.lock` y `deployment.lock`. La persistencia escribe un archivo temporal, hace fsync y rename; sincroniza el directorio cuando el sistema lo permite. En Windows algunos directorios no admiten fsync: se conserva fsync del archivo y rename, sin prometer resistencia absoluta a un fallo de energía del sistema de archivos. Resume valida journal, identidad/pins/nonce y dueño anterior antes de abrir la ejecución; no borra locks ajenos, corruptos ni stale automáticamente.

Cada paso conserva `DISPATCHING` y `networkMutationStarted` durable antes del PATCH; persiste su operation ID antes de poll. Un resultado desconocido sin operation ID no se repite. Un ID conocido sólo se consulta mediante GET al reanudar. GET puede renovar credenciales una vez ante 401; PATCH nunca se reintenta por 401 o desconexión. Los fallos con incertidumbre retienen el lock.

Antes de cada cambio se cotejan los dos snapshots completos, ausencia de operaciones activas/paginación incompleta y bytes de fuente descargados con bucket/object/generation exactos. Se repite esa lectura después del marcado durable y antes del PATCH. Después se preservan fuente/build/env ajeno, labels, configuración de red, cuenta, imagen e IAM. La revisión de Function debe coincidir con latestCreated/latestReady/template de Run; observedGeneration debe alcanzar generation y el tráfico efectivo debe apuntar al 100% a la revisión verificada. Un estado antiguo aparentemente SUCCEEDED no basta.

El lock compartido coordina estos ejecutores, pero no bloquea a un administrador externo. La [referencia de PATCH v2](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch) documenta `updateMask` y un cuerpo Function; este flujo no dispone de una precondición CAS documentada ni inventa If-Match, updateTime o actualizaciones por clave de mapa. Persiste una ventana entre lectura y escritura del mapa completo: un escritor externo podría provocar una sobrescritura no detectable después. Hace falta una ventana operativa exclusiva, además de las comprobaciones frescas; no se promete atomicidad ni protección absoluta frente a escritores ajenos.

## Recuperación parcial autorizada

Una operación terminada con error sólo se declara `FAILED_VERIFIED` después de confirmar que el snapshot y la fuente siguen siendo el estado esperado del prefijo anterior. Se guarda el recibo de pasos verificados; si la fuente o configuración deriva, permanece incierta y bloqueada. No hay resolución automática de un PATCH desconocido.

Para restaurar un prefijo con lock retenido, el nuevo input necesita `recovery` con rutas privadas y SHA de input, plan y journal de la activación anterior. Se exige además `--approve-owned-recovery`. Se reconstruye el plan original, el recibo/prefijo y el estado actual; se rechazan outcomes desconocidos y un dueño anterior vivo. Bajo el lock activo global se transfiere la propiedad al journal nuevo sin modificar ni borrar el original. Un fallo de esa transferencia conserva el lock para reconciliación. No existe opción para borrar un lock y forzar el avance.

Activación conserva orden review→chat. Restore restaura exactamente el valor o ausencia anteriores y sólo los pasos aplicados en reversa. Emergency OFF es otro modo: chat→review y valor `false`; no significa revocar reglas. La revocación persistente autorizada sigue disponible con gate OFF en los artefactos fijados.

## Verificación local y límites

`node --test qa/scripts/supervised-learning-gate-execute.test.mjs`: **21/21 PASS**, sin omisiones. Usa IO de nube sintético, archivos temporales propios y los ZIPs locales exactos como prerrequisito para verificar hashes reales; no descarga esos ZIPs ni usa credenciales. Se pueden proporcionar las rutas mediante `PAY0_D_GATE_REVIEW_ARCHIVE` y `PAY0_D_GATE_CHAT_ARCHIVE`; los hashes permanecen obligatorios. Una ausencia o mismatch falla explícitamente, sin skip.

Se prueban persist-before-dispatch, no-op, fallos de persistencia, PATCH incierto sin replay, operación conocida reanudada, deriva previa/posterior de fuente/generación/IAM/env/imagen, readiness/tráfico obsoletos, locks/journals corruptos, rollback parcial con handoff real de archivos, restauración de ausencia frente a apagado de emergencia y hash/autorización local antes de red. Log local: `tmp/d-gate-executor-tests.log`.

No se ha ejercitado el adapter contra APIs productivas ni se certifican las diferencias de metadatos de un rollout real. La comparación falla de forma cerrada ante campos generados no contemplados; cualquier adaptación requiere evidencia y revisión. Antes de usarlo hacen falta publicación de las fuentes correctas, captura fresca, paquete/input/plan y aprobación específicos, además de verificación funcional supervisada separada. No hay activación ni endpoint financiero nuevo en este trabajo.
