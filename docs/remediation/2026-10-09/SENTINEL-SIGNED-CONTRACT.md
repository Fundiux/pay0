# Contrato firmado Sentinel: propuesta implementable

Estado: DISEÑO, 2026-10-09. Lectura local de `7ed52e3` (propuesta de autenticación) y `ab30e32` (binding semántico). No implementación, claves creadas, IAM, firma remota, activación ni despliegue. `authorizeListUsersObserved` conserva `disabledPort`; el sink/canario no se habilitan por este documento.

## Decisión y frontera

Conservar Logging -> Pub/Sub -> observer, con firma asimétrica exclusiva del productor listUsers y verificación local mediante clave pública fijada. Push OIDC autentica al transportista; la firma autentica el contenido atribuido a la clave productora. Ni uno ni otra prueban que un workload comprometido describa hechos verdaderos. Root, actor y revisión siguen siendo afirmaciones del productor, restringidas por cohorte y asociadas criptográficamente al evento.

El resultado continúa `OBSERVE_ONLY`, `restricted:false`, `authority:NONE`. El observer no recibe permisos de firma, impersonación, datos financieros ni writer de restricciones. La SA dedicada del productor necesita una revisión aparte de sus lecturas funcionales: su lectura Firestore no queda limitada automáticamente a users por el nombre del método.

## Formato y bytes exactos

Nuevo `jsonPayload` cerrado: `{schemaVersion:"PAY0-SECURITY-SIGNED@1",context:{rootId,actorUid},signedBytesB64,signatureB64}`. Sin `event` paralelo, `alg` negociable, URL de clave o publisherId elegido por el mensaje. Esto concreta la lista firmada de la propuesta previa como bytes codificados, para poder rechazar representaciones alternativas antes de verificar.

`signedBytesB64` decodifica exactamente esta tupla de 15 posiciones:

```text
["PAY0-SECURITY-SIGNED@1", audience, keyVersion, "pay-0-system", "listUsers",
 serviceName, revisionName, rootId, actorUid, eventId,
 "AUTHORIZATION_DENIED", "SERVER_AUTH_DECISION", occurredAtMs, issuedAtMs, expiresAtMs]
```

El productor usa `Buffer.from(JSON.stringify(tuple),"utf8")`. El receptor exige UTF-8 válido, array denso de longitud15, tipos exactos, ninguna estructura anidada, y bytes idénticos a su propia serialización tras validar. Rechaza espacios alternativos, escapes alternativos, notación numérica distinta y cualquier Unicode fuera de los identificadores ASCII permitidos. Base64 canónica se prueba por decode/reencode; no base64url ni tolerancia de padding. eventId UUIDv4 generado una vez por decisión denegada; no dato del cliente. Los identificadores existentes conservan regex `[A-Za-z0-9_-]{1,128}`. audience fija <=128; keyVersion exacta del manifest <=512; timestamps enteros seguros no negativos.

No existe riesgo de claves JSON duplicadas dentro de la tupla plana. Para prometer rechazo de duplicados en wrappers, modificar explícitamente los dos parsers de JSON crudo: body Pub/Sub y LogEntry. Hoy `JSON.parse` pierde esa evidencia. Usar un parser estricto acotado que rechace nombres repetidos en todos los objetos; no afirmar que `Object.keys` detecta duplicados después del parseo. El verificador de firma nunca toma decisiones de autoridad de atributos Pub/Sub.

Presupuestos independientes: body HTTP16KiB, LogEntry decodificado8KiB, bytes canónicos4KiB, firma exactamente384bytes (512 caracteres base64). Además el writer actual limita a8KiB el request completo `entries:[entry]`; comprobar ambas cotas al construir, sin ampliar para que un caso pase. Los máximos de campo no garantizan por sí solos el máximo combinado: prevalece el tamaño total. Respuesta KMS <=4KiB, token metadata <=8KiB, email <=256bytes y project <=128bytes. Comprobación incremental de streams, `redirect:error`, sin compresión aceptada.

Tiempo: `occurredAt <= issuedAt <= occurredAt+60000`; `expiresAt === occurredAt+86400000`; receptor exige `issuedAt <= now+60000`, `occurredAt <= now+60000`, `now < expiresAt`. Usar reloj receptor, no publishTime para extender validez. Verificar overflow safe integer de sumas. Reentrega conserva bytes/eventId originales; no re-firmar eventos vencidos ni reconstruir issuedAt en DLQ.

## APIs y archivos propuestos

| Archivo | Contrato y responsabilidad |
| --- | --- |
| `functions/src/modules/securityObservation/signedContract.ts` nuevo | Tipos `SignedTuple`, `SignedEnvelope`; `canonicalizeSignedTuple(input):Buffer`; validación pura, sin SDK, red, credenciales o rutas Firestore |
| `functions/src/modules/securityObservation/kmsSigner.ts` nuevo | `createKmsObservationSigner({keyVersion,expectedServiceAccount,fetchImpl,now}): (bytes,signal)=>Promise<signatureB64>`; URL fija derivada exclusivamente de configuración validada; puerto sin acceso a datos de negocio |
| `functions/src/modules/securityObservation/publisher.ts` | Nueva factoría explícita de productor firmado, conservando factoría sintética v1 separada; reservar cuotas antes de KMS; construir evento desde perfil leído/auth verificada; una llamada de firma y una de Logging |
| `functions/src/modules/securityObservation/loggingWriter.ts` | Aceptar tipo firmado cerrado validado; compartir deadline/AbortSignal con signer; conservar metadatos de identidad y límites; no activar mediante este cambio |
| `services/pay0-sentinel-observation/src/signedVerifier.mjs` nuevo | `createSignedVerifier(trustManifest,now): (payload,resource)=>{event,ingress}`; sólo crypto local; reconstruye evento core desde tupla verificada |
| `services/pay0-sentinel-observation/src/trusted-producers.json` nuevo | Manifest público versionado, revisado, sin claves privadas ni cohortes productivas incorporadas incidentalmente; mapping exacto de keyVersion a SPKI/publisher/service/audience/estado |
| `services/pay0-sentinel-observation/src/config.mjs` | Modo por origen `SYNTHETIC_V1` o `SIGNED_REQUIRED`; validar manifest y cohorte al arranque; nada de fallback automático |
| `services/pay0-sentinel-observation/src/transport.mjs`, `http.mjs` | Parser estricto y selección de verificador tras OIDC/tamaño; exigir igualdad de context y labels con campos firmados; v1 sintético no puede seleccionar origen signed-required |
| scripts `build.mjs`, `stage-build.mjs` y manifest de fuentes | Empaquetar contrato compartido y trust manifest de modo determinista; hash y fixtures cruzados evitan dos implementaciones divergentes |
| `qa/scripts/remediation-sentinel-signed.test.cjs`, `qa/scripts/remediation-sentinel-signed-service.test.mjs` nuevos | Firmas con clave RSA sintética local y KMS fake; nunca KMS real; vectors de bytes compartidos y pruebas negativas |

La forma de compartir el módulo TS con el servicio ESM debe usar el staging existente, o generar un artefacto desde una fuente única validada por hash. No copiar manualmente dos canonicalizadores. No modificar ahora `authorizationDenied.ts` ni el export callable para inyectar el puerto: ese es un lote de activación independiente después de identidad, IAM, revisión y latencia.

## KMS y verificación pública

Algoritmo fijo `RSA_SIGN_PSS_3072_SHA256`, SHA256/MGF1 SHA256, salt32. REST `POST https://cloudkms.googleapis.com/v1/{keyVersion}:asymmetricSign`, cuerpo `{digest:{sha256:base64(SHA256(bytes))},digestCrc32c:"uint32 decimal"}`. No enviar simultáneamente `data`. Exigir respuesta de versión exacta, `verifiedDigestCrc32c:true`, CRC32C de firma coincidente y firma384bytes. Estos campos y permiso `cloudkms.cryptoKeyVersions.useToSign` están definidos en la [API oficial asymmetricSign](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign).

Trust manifest fija SPKI PEM, SHA256 de DER SPKI, versión KMS, algoritmo, producer lógico, audiencia y estado de aceptación. Validar RSA3072 y fingerprint al arrancar; no descargar clave indicada por evento. Verificar con `crypto.verify("sha256", canonicalBytes, {key:publicKey,padding:RSA_PKCS1_PSS_PADDING,saltLength:32}, signature)`: pasar bytes canónicos, no su digest, para evitar doble hash. La clave privada permanece en KMS; Google documenta [firma y validación](https://docs.cloud.google.com/kms/docs/create-validate-signatures).

Una credencial de metadata verificada contra SA dedicada puede servir ambos requests dentro del mismo intento; token nunca en logs ni disco. Un deadline compartido <=750ms cubre metadata, KMS y Logging, con techo exterior1000ms. `Promise.race` actual no cancela trabajo: añadir propagación AbortSignal y chequeos antes de cada llamada. Timeout no prueba que KMS/Logging no procesaron la solicitud: emitir enum de pérdida, sin reintentos ni repetir operación de negocio. Los límites1inflight/6min/20proceso preceden firma; no representan una cuota global ni garantizan coste máximo frente a réplicas.

## Compatibilidad con ab30 y namespaces

Corrección de la propuesta anterior: `ab30e32` YA implementa `PAY0-EVENT-CONTENT@1` y conflicto de contenido admitido. No reemplazarlo por digest de bytes firmados: keyVersion, issuedAt, audience, firma y metadatos de entrega no forman parte de la identidad semántica. Rotar clave o recodificar transporte legítimo no debe duplicar la observación.

Conservar exactamente publisherId lógico estable, policy y rutas. Root namespace es hash de root; eventDigest depende de publisherId+actorUid+eventId. ReceiptKey incluye policy+origin+eventDigest; core lee las tres origins fijas para impedir evasión cambiando origin. Comparación de contenido incluye root/actor/eventType/occurredAt y los IDs opcionales normalizados. La reconstrucción del piloto omite intentionId/attemptId/effectId y core normaliza null. Misma identidad/contenido devuelve DUPLICATE; otro contenido devuelve EVENT_CONTENT_CONFLICT; receipt antiguo sin binding devuelve LEGACY_RECEIPT_UNVERIFIED sin backfill. No migrar receipts ni ampliar writeset por introducir firma.

Los namespaces permiten eventos distintos por actor/root; no afirmar que un eventId sea globalmente único. Una firma alterada para cambiar root/actor falla; un firmante autorizado que emita nuevamente otro root/actor sigue sujeto a cohorte, no a una supuesta dedup global. Revisiones/labels discrepantes se rechazan antes del core. El trust manifest conserva publisher estable incluso durante dos claves aceptadas.

## Rotación, gates y orden

Rotación ordinaria: distribuir clave pública nueva junto a anterior con publisherId estable; verificar vector/test; cambiar firmante a versión exacta nueva; retirar revisión firmante vieja y permiso de firma de versión mediante su estado administrado; aceptar pública vieja hasta24h+60s desde retiro demostrado, luego quitarla. IAM de firma se concede en CryptoKey, no como supuesto binding por versión. En compromiso, cerrar emisor/sink y revocar inmediatamente la clave en todas las revisiones receptoras con tráfico; deshabilitar KMS por sí solo no invalida firmas verificadas offline.

Gates antes de implementación/activación: revisión del contrato; pruebas de corrupción por cada campo, RSA incorrecta, algoritmo/key desconocidos, duplicados JSON, expiración/skew, replay/colisión/rotación, cuotas antes de firma, checksums/timeouts y denegación original idéntica; empaquetado reproducible con core ab30; revisión de IAM efectivo de SA dedicada y ausencia de impersonación; compatibilidad listUsers con observación apagada; medición de deadline frío/caliente; cohorte+revisión exactas y ventana finita <=60min; rollout/rollback explícitos. Ninguno queda satisfecho por este diseño. El canario v1 permanece aislado y apagado; no usarlo como prueba de autenticación productora real.
