# Candidato local: entrega de comprobantes de dispersión

No publicado. Integración y servicios remotos sin cambios. Esta etapa sigue a
`4cd3475` (autorización transaccional de documentos) y no añade un endpoint ni
recuperación financiera. API del notifier conservada: uploadId/token como
argumentos internos; resultado ok/notified/reason/sentCount.

## Defecto y contrato propuesto

El único caller localizado es finalizeDispersionDocumentUpload en
`modules/dispersionDocuments/callables.ts`. Antes, el notifier leía el evento y
luego hacía merge PENDING fuera de transacción: dos llamadas podían enviar ambas.
FAILED habilitaba repetir todos los destinatarios y ambas partes del mensaje,
incluso si Telegram ya había recibido texto o archivo. La descarga usaba la última
versión de una ruta, sin fijar generación.

El candidato conserva el ID histórico
`COMPROBANTE_DISPERSION_CLIENTE_<client>_<dispersion>_<upload>` con safeDocId, pero
valida la identidad completa almacenada antes de escribir; una colisión por
truncamiento se rechaza. Eventos nuevos incorporan deliveryVersion=2, attemptId,
leaseUntilMs, máximo tres intentos previos al envío y destinatarios congelados.
Una transacción reclama el evento y registra PENDING. Cada destinatario tiene
etapas text/document READY→IN_FLIGHT→SENT. IN_FLIGHT se persiste **antes** del POST;
SENT exige respuesta `ok:true` y confirmación persistida. Nunca se guarda una
excepción, token o respuesta de Telegram en logs/errores de este flujo.

* SENT devuelve duplicate sin nuevos envíos ni auditorías.
* PRE_SEND_FAILED prueba que falló la lectura del objeto antes de cualquier POST;
  permite reintento acotado, conservando objeto y destinatarios. El cuarto intento
  pasa a NEEDS_REVIEW.
* Lease vencido sólo es reclamable si todas las etapas siguen READY. Si existe
  IN_FLIGHT o SENT, pasa a UNKNOWN y no se reenvía automáticamente.
* Error de transporte, respuesta no confirmada o fallo al guardar el recibo tras
  enviar: UNKNOWN/PARTIAL_UNKNOWN. Etapas confirmadas y sentCount se conservan.
  Los wrappers actuales no aportan prueba tipada de no-entrega, por lo que ni un
  texto de error ni `ok:false` se interpretan como reintento seguro.
* Revocación antes de una etapa pasa a NEEDS_REVIEW, preservando cualquier etapa
  anterior confirmada. No se reintenta el lote completo.
* Eventos legacy SENT conservan duplicate; otros estados legacy conservan su
  estado/evidencia y reciben reviewRequired/LEGACY_DELIVERY_UNCERTAIN. No se
  inventa certeza de no-entrega a partir de FAILED/PENDING/SKIPPED antiguos.

Una caída entre IN_FLIGHT y el POST puede dejar un falso incierto: es deliberado,
pues no hay transacción distribuida con Telegram ni clave de idempotencia remota.
Una respuesta tardía tras timeout también queda incierta. El wrapper compartido
no admite AbortSignal; el candidato limita la espera a 15 segundos y el avance de
la invocación a 45 segundos, pero no afirma cancelar un POST ya iniciado. Una vez
incierto, el intento no continúa ni se repite automáticamente.

## Objeto y destinatarios

Se exige generación explícita en el upload y se utiliza
`bucket.file(path, {generation})` para metadatos y lectura. Coinciden name, bucket,
generation, MIME y size; stream con CRC32C, timeout de 10 s y máximo preparado
<=1 MiB incluso si los metadatos mienten. No hay hash inventado, escáner ni
fallback a la versión más reciente. La generación y ruta del evento no pueden
cambiar durante un reintento seguro.

Antes de reclamar y de cada etapa se releen upload READY/activo, actor finalizedBy,
autorización vigente, dispersión y cliente con root exacto. Antes de cada POST se
relee también el vínculo clientTelegramUsers: activo, mismo root/client/chat. El
query usa limit 11 para máximo 10 destinatarios; supera el límite → NEEDS_REVIEW,
sin envío parcial. Chats repetidos se deduplican. El snapshot inicial congela la
lista: no se incorporan nuevos destinatarios a un intento anterior.

`telegram/repository.ts:1061` crea vínculos de cliente con root/client/chat y
active; no existe permiso granular de recibir este documento en ese registro.
El candidato preserva ese contrato y revalida su vigencia. No convierte un ID de
chat proporcionado por el caller en destinatario autorizado.

## Bloqueos de publicación explícitos

**USER:** pendiente respuesta de política del usuario solicitada por coordinación.
En `commissionDistributions` integrado no se encontró notifier de Telegram. Sí
existe vínculo de usuario `telegramUsers` (repository.ts:308) con uid/root/chat y
preferencias `enabled`/`notifyDispersiones` (types.ts:91; repository.ts:417), pero
eso no define si este comprobante de retiro debe enviarse al titular, cliente o
ambos. El candidato registra NEEDS_REVIEW/USER_RECIPIENT_POLICY_PENDING; **no se
autoriza desplegarlo así como cambio silencioso de la entrega existente**. No se
decidirá por tiempo transcurrido ni se trasladarán destinatarios por conjetura.

**READY legacy sin generación:** candidato NEEDS_REVIEW/GENERATION_UNVERIFIED.
No publicar hasta evaluar compatibilidad o implementar una atestación actual
autorizada, transaccional y explícita de metadatos, que nunca afirme un hash o
integridad histórica que no se midió. Tampoco se inventa finalizedBy histórico.

**Gates de ejecuci?n:** 133/133 pruebas sint?ticas PASS en 2.96 s (15 replay,
90 autoridad, 28 notifier). Incluyen claim simult?neo, crash por etapa,
resultados inciertos/parciales, persistencia fallida del recibo, timeout con
respuesta tard?a, reintento seguro acotado, legacy, generaci?n fija, stream
excesivo y revocaciones. Sender/Storage/Firestore fake; guard/resolver reales.
Los fixtures cachean s?lo JavaScript compilado por ruta y SHA256 del contenido;
instancias de m?dulos y estado mutable se recrean por caso. Fuente TypeScript
congelada y comunicada para build central.

Build Functions central ROOT PASS con notifier, Hugo y contrato firmado,
confirmado por coordinacion despues de congelar esta fuente. Contencion SDK
pendiente; no certifica despliegue, discovery Functions ni entrega real. No se
consultaron eventos, vinculos o documentos de produccion ni se enviaron mensajes.
