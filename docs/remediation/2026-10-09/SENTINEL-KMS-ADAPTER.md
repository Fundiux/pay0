# Adaptador KMS aislado para Sentinel

Estado: implementado localmente, sin integración, activación, IAM, claves creadas ni llamadas remotas. El productor listUsers continúa apagado y el trust manifest permanece vacío. Este adaptador no está importado por un callable, publisher ni loggingWriter.

## Contrato

`functions/src/modules/securityObservation/kmsSigner.ts` exporta `createKmsObservationSigner(options)` y `observationCrc32c(bytes)`. La factoría devuelve `(tuple, parentSignal?) => Promise<{signedBytesB64, signatureB64}>`. Sólo admite la tupla de15campos del canonicalizador existente, no bytes arbitrarios. Proyecto `pay-0-system`, función `listUsers`, tipo y origen son fijos en ese contrato. Audiencia, servicio, revisión, root único, actores y versión KMS se fijan en configuración de servidor copiada al crear la factoría. La versión del evento debe coincidir exactamente con la configurada y con una allowlist de hasta2versiones revisadas.

El puerto `credential(signal)` devuelve `{accessToken,serviceAccount,projectId}`; sólo se acepta la SA dedicada configurada del proyecto financiero. Es un puerto de confianza que deberá implementar lectura autenticada de identidad del workload: comparar esos campos no convierte una afirmación externa en identidad criptográficamente probada. No se implementa metadata/ADC en este lote, ni se acepta este puerto o configuración desde un request. El token sólo alimenta Authorization del request KMS y no se registra ni persiste.

No se consulta el algoritmo remotamente: la versión exacta provisionada debe verificarse como `RSA_SIGN_PSS_3072_SHA256` antes de activación. El response estándar no incluye algoritmo; si aparece, el adapter exige ese valor. No negociar algoritmo desde el evento. El adapter comprueba integridad de la firma, no reemplaza la verificación RSA pública del observer.

## API y controles

Único destino: `https://cloudkms.googleapis.com/v1/{config.keyVersion}:asymmetricSign`. POST con SHA256 de bytes canónicos en `digest.sha256` y CRC32C de los32bytes de digest como decimal string en `digestCrc32c`. Sin campo `data`, redirects ni reintentos. El nombre retornado debe coincidir exactamente, `verifiedDigestCrc32c` debe ser true y `signatureCrc32c` debe coincidir con CRC32C de la firma384bytes. El checksum se representa como uint32 no negativo; se rechazan conversiones permisivas o cadenas no canónicas. Contrato revisado contra la [API oficial asymmetricSign](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign).

Respuesta sólo status200 y application/json, <=4096bytes declarados y efectivos, UTF8fatal, JSON plano de campos string/boolean admitidos. El parser específico rechaza duplicados incluso con escapes de nombres, campos inesperados, arrays, números/null y trailing content. No se registra body/error remoto. Base64 canónica y longitud exacta; optional verifiedDataCrc32c sólo false y protectionLevel sólo SOFTWARE. Todo fallo externo se reduce a `OBSERVATION_SIGN_FAILED`.

CRC32C usa polinomio Castagnoli; vector independiente `123456789 -> e3069283`. Google recomienda verificar flags y checksums de entrada/salida en sus [guías de integridad](https://docs.cloud.google.com/kms/docs/data-integrity-guidelines). La política local elige cero reintentos en este piloto para limitar latencia/coste; un timeout o rechazo local no prueba que KMS no haya firmado.

## Cancelación y límites pendientes

Un AbortController y timer real de hasta750ms se crean por intento. El mismo signal llega a credenciales y fetch; la lectura de body registra cancelación del reader. Abort externo acorta ese presupuesto. Antes de cada I/O y de retornar se comprueba signal. Si un puerto ignora cancelación, el caller recibe fallo al vencer y una respuesta tardía no puede convertirse en éxito; un body fetch recibido tarde se cancela. Un puerto externo mal implementado puede seguir ejecutándose: el adaptador no afirma detener el proveedor remoto ni código arbitrario que ignore signal.

El cierre `finally` borra timer/listener y aborta el controlador. La futura composición firma+Logging necesita un controlador exterior de750ms compartido por ambas operaciones: no encadenar dos presupuestos750ms independientes. Aquí sólo se implementa el tramo KMS. El `Promise.race` de authorizationDenied y loggingWriter no se modifican y todavía requieren el lote coordinado de cancelación antes de activar.

Quotas de1inflight/6por minuto/20por proceso y ventana/cohorte de piloto siguen siendo obligación del futuro publisher antes de firmar. Este adapter no declara una cuota global ni calibración. Mantiene ausencia de autoridad financiera: no lee/escribe Firestore, Storage, restricciones o IQ.

## Verificación local y gates

`qa/scripts/remediation-sentinel-kms.test.cjs` transpila sólo adapter+contrato mediante loader allowlist y usa credenciales/Response/fetch sintéticos; ningún token, clave privada o KMS real. Casos: request exacto+CRC, response inválida/duplicada/overflow, identidad/cohorte/versión inválidas antes de I/O, parent abort antes y durante credenciales/fetch/body, deadline real20ms de prueba, respuesta tardía sin éxito, snapshot de configuración. Los bytes de firma fake sólo ejercitan integridad del adapter; no se presentan como evidencia criptográfica RSA. Las pruebas RSA efímeras del verificador pertenecen al lote puro anterior.

Pendiente al escribir este documento: ejecutar esta suite al liberar discovery IQ y revisión/build central de Functions. No ejecutar infraestructura ni activación para validar el adapter. Gates de identidad exclusiva, IAM efectivo, algoritmo provisionado, latencia real, quotas antes de firma y deadline compartido con Logging siguen abiertos.
