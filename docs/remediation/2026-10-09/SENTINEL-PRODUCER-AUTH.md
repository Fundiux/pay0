# Autenticación del productor Sentinel: propuesta acotada

Fecha de revisión: 2026-10-09. Diseño, sin implementación, consultas de IAM, API habilitada, firma, invocación, despliegue o activación. El adaptador local de listUsers sigue apagado por código (`b2192ce`). Las referencias oficiales se consultaron durante esta revisión. Los nombres nuevos son propuestos, no recursos existentes.

## Decisión recomendada

Usar firma asimétrica KMS por evento para conservar Logging → Pub/Sub → observer. Asignar exclusivamente a listUsers una SA dedicada, propuesta `pay0-listusers-observer@pay-0-system.iam.gserviceaccount.com`. El observer recibe únicamente una clave pública fijada en su artefacto/configuración revisada: ningún permiso KMS, secreto compartido, impersonación o acceso financiero adicional.

La firma elimina la posibilidad de fabricar un evento aceptable con solo `logging.logEntries.create`. No demuestra que un productor comprometido diga la verdad: quien controle la SA firmante puede firmar afirmaciones falsas dentro de su cohorte. Revisión, actor y root siguen siendo afirmaciones del productor, ahora vinculadas criptográficamente al evento. Se mantienen OBSERVE_ONLY, authority NONE y ninguna promoción automática, incluso tras verificar firma.

Cloud KMS firma con la parte privada de una clave ASYMMETRIC_SIGN y permite validación con la pública. Propuesta de algoritmo único: `RSA_SIGN_PSS_3072_SHA256`, protección SOFTWARE, firma de 384 bytes, MGF1 SHA256 y salt de32 bytes; no negociación desde el mensaje ni algoritmo `none`. Coincide con una opción recomendada por Google; no se necesita HSM para este piloto. [Firmas KMS](https://docs.cloud.google.com/kms/docs/create-validate-signatures), [algoritmos](https://docs.cloud.google.com/kms/docs/algorithms).

| Opción | Prueba aportada | Cambios y limitación |
| --- | --- | --- |
| KMS + transporte actual | Firma del contenido verificable tras Logging/PubSub y en reentregas | Una clave, permiso de firma exclusivo, envelope v2 y verificador público. El transporte puede suprimir/repetir, pero no modificar ni fabricar firmas |
| OIDC directo | Identidad Google del invocador en una conexión HTTPS al receptor | Nuevo endpoint privado y mapping de SA; la afirmación no conserva firma propia después de almacenar/reexportar el body. Quita Logging/PubSub de ese recorrido o exige collector adicional |
| Labels Logging o HMAC compartido | Insuficiente para la frontera requerida | Labels falsificables por escritores; HMAC permitiría al verificador fabricar eventos. Descartados |

## Identidad y mínimo IAM: gate antes de habilitar

No conceder firma a Compute/default, a la SA compartida de Functions, al canario, al push ni al observer. No permitir que la SA compartida impersonifique la dedicada. La revisión debe cubrir grants heredados, TokenCreator/getAccessToken/getOpenIdToken/signJwt/signBlob y capacidad de desplegar o adjuntar esta SA: comprobar solo un binding local no prueba exclusividad. Un administrador con poder de cambiar IAM sigue dentro de la frontera administrativa.

Cloud Run functions permite configurar una SA administrada por el usuario al desplegar una función concreta. Se preservan nombre, protocolo callable y permisos de los clientes de listUsers. Primero se prueba el cambio de identidad con observación apagada. [Identidad de Functions](https://docs.cloud.google.com/functions/docs/securing/function-identity).

Propuesta KMS: key ring regional us-central1 y una CryptoKey exclusiva `listusers-observation-signing` en el proyecto aislado existente; ningún wildcard entre claves. El rol custom del productor contiene solamente `cloudkms.cryptoKeyVersions.useToSign`, vinculado a esa CryptoKey. IAM se aplica a la clave, no se presenta como un binding independiente por versión. El código selecciona una versión exacta; para detener firma con versiones antiguas, deshabilitarlas mediante el administrador. No dar KMS Admin, gestión de versiones o permisos de lectura de claves al runtime. [IAM de KMS](https://docs.cloud.google.com/kms/docs/iam).

El operador de publicación de confianza descarga la pública con `cloudkms.cryptoKeyVersions.viewPublicKey`; revisa recurso, algoritmo y SHA256 del SPKI. El observer recibe PEM + fingerprint + keyVersion + mapping de productor; no descarga claves desde URL o kid proporcionados por eventos. El administrador de claves es distinto del runtime y requiere únicamente las operaciones de gestión aprobadas para creación/rotación/revocación. No se amplían automáticamente permisos por un error de API.

La SA de listUsers necesita además su lectura funcional existente: `datastore.entities.get` para perfil y `datastore.entities.get`/`datastore.entities.list` para consulta, sujetos a verificación del SDK con el perfil mínimo; y Logging create si se conserva este transporte. Sin escrituras Firestore, Storage, secretos, Auth admin, Pub/Sub publish o autoridad sobre restricciones. **IAM de servidor no ofrece aquí una garantía de lectura solo de users por el simple path usado en TypeScript**: el alcance de lectura de la DB financiera y cualquier condición por database deben revisarse como riesgo residual antes de cambiar SA. No denominar a listUsers un proceso sin acceso financiero solo porque sea de lectura. El detector aislado conserva su IAM actual. [Permisos Firestore](https://firebase.google.com/docs/firestore/security/iam).

## Contrato firmado propuesto: sin ambigüedad de serialización

Versión nueva `PAY0-SECURITY-SIGNED@1`, separada del envelope sintético v1. No aceptar unsigned como fallback para un origen real configurado como signed-required. Mapping por clave pública determina publisherId; nunca confiar en publisherId libre del body.

Se propone firmar una secuencia JSON de posiciones fijas, reconstruida por ambos extremos, sin objetos ni texto libre:

`["PAY0-SECURITY-SIGNED@1", audience, keyVersion, "pay-0-system", "listUsers", serviceName, revisionName, rootId, actorUid, eventId, "AUTHORIZATION_DENIED", "SERVER_AUTH_DECISION", occurredAtMs, issuedAtMs, expiresAtMs]`

- audience es un identificador lógico fijo exclusivo de la ingesta aislada, no una URL elegida por cliente. keyVersion es un recurso KMS exacto del trust manifest.
- rootId/actorUid/eventId/serviceName/revisionName ASCII y máximos actuales del core; keyVersion exacta de máximo512 caracteres y audience fija de máximo128; timestamps enteros seguros no negativos. JSON.stringify de esta lista estrictamente tipada produce bytes UTF-8; no floats, escapes alternativos aceptados, propiedades duplicadas o normalización Unicode implícita.
- Sobre exterior cerrado: versión, lista firmada y firma base64 canónica. Dentro de LogEntry, conservar context root/actor solo para el filtro de sink y exigir igualdad con los valores firmados. El nuevo evento del core se reconstruye de la lista verificada; no consumir un segundo objeto event libre.
- occurredAtMs fija la decisión real; issuedAtMs no anterior a la decisión y dentro de 60s; expiresAtMs exactamente occurredAtMs+24h. issuedAtMs futuro máximo60s; ningún timestamp firmado sustituye el reloj del receptor. Límites del envelope/log actuales16KiB/8KiB siguen vigentes; lista firmada máximo4KiB.
- eventId UUID generado una vez por intento autorizado del servidor, no por cliente. Reentregas conservan lista/eventId/firma/tiempo originales. Un nuevo intento de llamada es otro evento; no se afirma deduplicación de intentos humanos distintos.

Productor: construir desde auth.uid y perfil recién leído, reservar límite antes de firmar, SHA256 de los bytes y `asymmetricSign` sobre digest. Enviar CRC32C del digest, exigir verifiedDigestCrc32c, comprobar signatureCrc32c y nombre de versión retornado. No reintentar automáticamente si checksum, timeout o respuesta son ambiguos; reportar enum de pérdida y preservar denegación. [API asymmetricSign](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign).

Observer: verificar primero OIDC push y tamaño, luego estructura/firma/tiempos/mapping, después crear VerifiedIngress y entregar al core. Clave desconocida, revocada, algoritmo distinto, firma inválida, labels/context contradictorios o cohorte no permitida terminan en resultado permanente sin persistencia de incidente. No registrar body, firma, identificadores o tokens en métricas; únicamente enums agregados. La firma no reemplaza IAM del endpoint ni controles de volumen previos a verificación.

## Replay, loop y entrega

No usar signature como llave de deduplicación. Mantener publisherId lógico estable durante rotaciones y eventId original, para que el receipt actual deduplique por policy/origin/publisher/actor/event dentro del root. Un mensaje con mismo eventId y otro contenido firmado debe rechazarse como conflicto de evidencia: añadir comparación del digest completo de la lista firmada con el receipt; el core actual comprueba identidad del evento pero no esta equivalencia completa. Este es un cambio explícito pendiente de revisión, no una propiedad ya implementada.

Receipt48h > validez24h: limpiar TTL no permite volver a aceptar un evento viejo. Replay de mensajes válidos dentro de24h resulta DUPLICATE, nunca otro débito o incidente promovido. No refrescar timestamps al reintentar desde DLQ. Eventos caducados van a revisión humana de pérdida, no se re-firman para simular una decisión reciente.

Firma y Logging comparten presupuesto total <=750ms; adapter conserva error original con techo1000ms. Un intento, sin cola financiera ni bucle de reintentos. Timeout puede perder observación; no repetir operación de negocio para recuperarla. Antes de habilitar se mide latencia real: este presupuesto propuesto podría resultar insuficiente, especialmente en frío, y no se amplía sin revisar impacto.

Conservar un inflight,6 intentos/minuto y20 por proceso durante piloto, cohorte explícita y ventana finita <=60min no renovada en reruns. Estos límites no son globales ante reinicios/réplicas. Observer conserva cuotas durables60/min y10000/día además del core. Reducir carga antes de KMS evita costes evitables; cuotas de ingesta no limitan firmas/logs ya hechos. Sink excluye salidas del detector; ningún publisherId de Sentinel y ningún trigger desde incidents vuelve al emisor.

## Rotación, compromiso y recuperación

KMS no ofrece rotación automática para claves asimétricas; se planifica una operación revisada. Crear versión siguiente con el mismo algoritmo, distribuir pública nueva y antigua al receptor con mapping a un único publisherId, verificar fixtures; después cambiar firmante a la versión nueva. Deshabilitar firma antigua una vez retirada la revisión productora vieja. Mantener pública antigua verificable hasta expirar la última observación admitida (24h+skew desde retiro comprobado), luego retirarla del trust manifest. Retención documental de evidencia no exige mantenerla como clave aceptada en ingesta. [Rotación KMS](https://docs.cloud.google.com/kms/docs/rotate-key).

Compromiso: cerrar sink y apagar emisor, quitar permiso de firma/deshabilitar versión y retirar inmediatamente esa clave del trust manifest de todas las revisiones receptoras con tráfico. **Deshabilitar en KMS no invalida matemáticamente firmas anteriores verificadas offline**: el receptor debe revocar el kid. No continuar aceptándola por compatibilidad durante un incidente. No destruir la versión impulsivamente; preservar auditoría y seguir política de recuperación. Los receipts/incidentes existentes no se borran ni se convierten en decisiones autorizadas. [Estados de versiones](https://docs.cloud.google.com/kms/docs/key-states).

Rollback funcional de listUsers siempre vuelve a observación apagada, nunca a unsigned ni a compartir SA con permiso de firma. Caída KMS, confianza pública ausente o error de firma no abre autorización. El cambio de SA tiene su propio gate de compatibilidad; no mezclar rollback de permisos funcionales con reactivación del productor.

## Alternativa OIDC directo, sin KMS

SA dedicada de listUsers con `roles/run.invoker` solo sobre el receptor privado; ID token obtenido de metadata con audiencia exacta del servicio. Verificar firma Google, issuer, audiencia, exp/iat, email_verified y sub/email exactos contra mapping. La SA push no debe pasar el endpoint directo; la SA listUsers no debe pasar /pubsub. IAM de Run es por servicio, por eso el handler debe separar identidades por ruta. Tokens duran aproximadamente1h; no prometer600s configurables con metadata. No conceder TokenCreator a la SA compartida. [Autenticación entre servicios](https://docs.cloud.google.com/run/docs/authenticating/service-to-service), [generateIdToken](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken).

Es una opción válida para ingesta directa: Google autentica al llamador, TLS protege el body en tránsito y el receptor fija publisherId desde identidad. Un token copiado puede reutilizarse hasta expiración; no publicarlo en Logging/PubSub ni tratar un token adjunto al evento como firma de su body. Necesita los mismos controles de payload, replay, root/actor y observación sin autoridad. OIDC no demuestra revisión exacta del productor: ese dato sigue siendo una afirmación del workload.

Un puerto directo al observer evita otro servicio pero carece de la entrega durable Pub/Sub antes de la recepción. Un collector separado añade recursos y autoridad de publish, y exige conservar procedencia verificada al siguiente salto. No construir ese collector sin necesidad. Para este sistema ya transportado por Logging/PubSub, KMS evita ese cambio topológico y conserva evidencia firmada; por eso es la recomendación.

## Coste proporcional, no límite duro

Precio publicado SOFTWARE: aproximadamenteUSD0.06 por versión activa/mes y USD0.03 por10000 operaciones criptográficas. Una versión con10000 firmas/mes aproximaUSD0.09; dos versiones durante todo ese mes,USD0.15. A10000 firmas/día durante30d: una versión +300000 operaciones aproximaUSD0.96. Son cálculos de KMS, no factura completa, tipo de cambio ni impuesto; no se presupone free tier Autokey. [Tarifa KMS](https://cloud.google.com/kms/pricing).

Verificación local no llama KMS por evento. Lecturas públicas puntuales se contabilizan aparte; Logging, PubSub, Cloud Run/Functions y Firestore ya generan costes independientes. El presupuesto300MXN aislado actual no limita gasto duro ni cubre automáticamente el proyecto financiero. Una firma no añade un nuevo servicio siempre activo, pero sí latencia y coste por abuso del firmante. Revisar alertas, cuotas efectivas y ventana antes de activar. OIDC evita coste de firmas KMS; no elimina cómputo ni lecturas/escrituras y no se declara gratuito todo el recorrido.

## Archivos y gates posteriores

Sin editar estos archivos ahora: módulo puro nuevo de formato firmado, adapter KMS por puerto, trust manifest público/verificador del observer, modificación explícita de transport/schema-version, binding de digest en receipts y sus tests, configuración SA exclusiva de listUsers y recursos IAM/KMS declarados en IaC. Reusar evento/core actual; actualizar manifiestos de fuentes solo tras revisión del cambio de receipt. El canario unsigned queda separado y apagado, nunca origen real por fallback.

Pruebas fake obligatorias: firma válida, byte alterado, root/actor/revisión/audiencia alterados, kid desconocido/revocado, tipo/algoritmo inválido, campos extra/duplicados, fecha expirada/futura, replay idéntico, colisión eventId con contenido diferente, rotación conservando dedup, timeout/checksum/error KMS, límite concurrente y error autorizado idéntico. Caso crítico: LogEntry fabricado con labels correctos y sin firma jamás crea receipt.

Gates centrales antes de cualquier activación: inventario de IAM efectivo y exclusividad SA; lectura funcional listUsers con nueva SA y ausencia de writes; permiso de firma exclusivo y observer incapaz de firmar/impersonar; trust manifest verificado; build/tests; metadatos de revisiones reales; medición de presupuesto; ventana finita+rollback revisados. Ninguno se considera satisfecho por este documento. No se solicita decisión al usuario en esta fase de diseño.
