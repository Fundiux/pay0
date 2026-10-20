# Puerto metadata de credenciales Sentinel

Estado: implementación local aislada, sin import desde listUsers/publisher, sin activación, cambios IAM, metadata real o KMS real. `metadataCredential.ts` satisface el puerto tipado `ObservationCredential` del adaptador KMS sin modificarlo. Suite fake: PASS70 comprobaciones. Build central pendiente.

## Identidad y endpoints

La factoría `createObservationMetadataCredential({expectedServiceAccount,expectedProjectId,fetchImpl?,timeoutMs?})` devuelve `(parentSignal)=>Promise<ObservationCredential>`. Construirla no hace I/O. Proyecto requerido exacto `pay-0-system`; SA dedicada explícita `...@pay-0-system.iam.gserviceaccount.com`, sin default inferido ni credenciales suministradas por requests. No ADC, keyfiles, gcloud, token env, endpoint override, DNS alternativo ni fallback a Compute.

Sólo permite GET al host fijo `http://metadata.google.internal/computeMetadata/v1/` y tres paths constantes: `project/project-id`, `instance/service-accounts/default/email`, `instance/service-accounts/default/token`. En el contrato oficial de Cloud Run, `default` identifica la SA adjunta al recurso: no significa aceptar la cuenta Compute por omisión. Se compara email exacto y proyecto antes de solicitar token. Cloud Run documenta estos paths y el header `Metadata-Flavor: Google` en su [contrato de runtime](https://docs.cloud.google.com/run/docs/container-contract#metadata-server).

Ambas lecturas de identidad son paralelas y acotadas; token sólo sigue tras coincidencia. Cada request y response requiere Metadata-Flavor Google, status200, sin redirects. Cotas efectivas/declaradas: proyecto128bytes, email256bytes, token8192bytes. UTF8fatal; sin trim de identidad, decodificación tolerante ni normalización. Token application/json con tres campos exactos, sin duplicados ni nombres escapados: access_token, token_type, expires_in. Bearer exacto, token ASCII20..4096 más padding opcional y expires_in entero30..3600. No cache ni persistencia; toda salida de error es `OBSERVATION_CREDENTIAL_FAILED` sin datos del proveedor.

El header de metadata es una defensa de protocolo, no una firma criptográfica externa. La confianza depende del aislamiento y hostname de metadata del runtime de Google y de que fetch/config provengan de código revisado. Un proceso comprometido que pueda reemplazar puertos o código no queda autenticado por sus propias comparaciones. No ofrecer esta factoría mediante interfaz pública de configuración.

## Deadline y evidencia fake

AbortSignal padre es obligatorio. Se propaga a un controlador hijo con techo750ms, que aborta antes si el padre termina. Cuando lo llama KMS, prevalece su deadline total ya iniciado: no se suman dos750ms. El mismo signal hijo cubre los tres fetch y body readers. Timeout/abort rechaza incluso si fetch ignora señal, cancela body que llegue tarde y no permite iniciar la siguiente fase. Finalización cancela ramas paralelas/timer/listeners. No se promete deshacer tokens ya emitidos ni detener una dependencia arbitraria que ignore cancelación.

Pruebas: endpoints/headers exactos, construcción sin I/O, SA/proyecto discrepantes sin token, Compute rechazado, status/Flavor/redirect/body oversized/UTF8 inválido, token duplicado/malformado/campos extra/expiración, límites inclusive30/3600, cancelación antes y durante fetch/body, deadline real20ms de prueba, late body cancel y composición con KMS: metadata abortada, POST KMS cero. Todo usa Response/ReadableStream/fetch fake; `network=0`, `metadataReal=0`, `activation=0`.

## Revisión, servicio y proyecto antes de activar

El puerto demuestra coincidencia del proyecto y de la identidad adjunta dentro de la confianza de plataforma; no obtiene revisión/servicio desde esos tres endpoints. Cloud Run inyecta K_SERVICE, K_REVISION y K_CONFIGURATION según su [contrato de variables de entorno](https://docs.cloud.google.com/run/docs/container-contract#environment-variables). La futura composición deberá comparar esos valores del proceso contra configuración revisada y cohorte exacta del observer; no tomarlos de headers, body o parámetros cliente. Para listUsers, contrastar además el target esperado con export/candidate y metadatos de despliegue antes de emitir.

Esos env no son atestación criptográfica de la revisión frente al receptor ni certifican quién desplegó el código. Los labels y revisión firmados son afirmaciones del workload ya autenticado por su clave. Persisten gates de IAM efectivo/exclusividad SA y ausencia de impersonación, clave/version/algoritmo provisionados, revisión real y tráfico, permiso funcional de listUsers, configuración de región (este puerto no consulta region), medición de latencia, cuota antes de firma y ventana finita. La comparación runtime no sustituye esos gates.

No conectar aún al callable, cambiar SA, habilitar sink o crear recursos para probarlo. La composición con Logging seguirá necesitando presupuesto exterior compartido750ms y cancelación del writer; ese tramo permanece pendiente.
