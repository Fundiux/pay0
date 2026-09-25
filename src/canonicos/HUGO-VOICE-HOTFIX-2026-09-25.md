# Hugo Voice: hotfix de seguridad y configuracion, 2026-09-25

## Estado: hotfix publicado y compuertas tecnicas aprobadas; prueba humana de voz pendiente

Este registro complementa el corte acumulativo; no reemplaza su historial.

- Base funcional acumulativa: `1c44dcdd89f98be8596085d0f772a488f60d4fde`.
- Fuente del hotfix y de la imagen candidata: `67e320df9b532e950a6b89460c4cd328e84e5ca7`.
- Rama: `integration/pay0-final-candidate-20260924`.
- Proyecto/region/servicio: `pay-0-system` / `us-central1` / `hugo-voice-gateway-canary`.
- Revision segura activa: `hugo-voice-gateway-canary-00012-mev`, 100% del trafico.
- Digest: `sha256:8276294c1a55779242cc9de6da45f0ed8f67e5be2f06c8a85c6a9378cb38b238`.
- Rollback conservado: `hugo-voice-gateway-canary-00011-tzj`, 0%, Ready, no eliminado.
- Fuente de Hosting/SSR: `b06e4b036583d2e78b2e6ea5ba25259592ff4b4f`.
- Publicacion Hosting: `2026-09-25T15:26:00.621Z` (09:26:00 America/Mexico_City).
- Certificacion final: `2026-09-25T15:29:24Z`.

La revision 00012 se certifico primero etiquetada al 0% y solo se promovio tras
salud, rechazos y autorizacion positiva sin offer. En esta continuacion no se
reconstruyo ni redesplego su imagen. Hosting/SSR se publico una sola vez.
Este registro no declara completadas las validaciones humanas de otros modulos
ni sustituye el registro original del corte acumulativo.

## Compuerta de salud aceptada expresamente

Para este corte, **`/healthz/` es la compuerta de salud certificada**.
`/healthz` sin barra final NO es una comprobacion valida en Cloud Run: Google la
intercepta antes del contenedor. Su 404 no debe interpretarse como fallo del gateway.
Cloud Run documenta rutas reservadas terminadas en `z`:
https://docs.cloud.google.com/run/docs/known-issues

La etiqueta efectiva `security-67e320df` apunta a `00012-mev`. La URL se obtuvo de
`status.traffic`, no se infirio:
`https://security-67e320df---hugo-voice-gateway-canary-o4tesftjlq-uc.a.run.app`.

El 2026-09-25, `/healthz/` devolvio 200 `ok`, con request log a
`03:42:56.615170Z` y container log `gateway.http` a `03:42:56.619976Z`, ambos de
`hugo-voice-gateway-canary-00012-mev` y de la misma instancia.
Identificador de sonda: `pay0-hotfix-routing-7b5d43d8ff24481a9c710838efb17955`.
No se modifico etiqueta, imagen, IAM, ingress ni configuracion para resolver el diagnostico.

Mejora posterior separada: renombrar eventualmente la ruta a `/health` u otra
no reservada. **No realizar ese cambio durante este hotfix.**

## Sondas negativas certificadas

Ejecucion: `pay0-negative-9efecd9a-547c-43e7-8f13-b6cfa00dfbb4`,
2026-09-25 14:50:22Z a 14:50:28Z, revision `00012-mev`.
Request logs correlacionados por User-Agent, revision, instancia y orden temporal;
cierres y rechazos correlacionados por `gatewaySessionId`.

| Escenario | Cierre observado | realtimeCreationAttempts |
| --- | --- | --- |
| Conexion sin autenticacion, cerrada voluntariamente | 1000 | 0 |
| Authenticate sin token | 1008 | 0 |
| Token invalido | 1008 | 0 |
| Offer antes de auth | 1008 | 0 |
| Auth invalida seguida de offer | 1008 | 0 |
| Segundo auth despues del rechazo | 1008 | 0 |
| Mensajes despues del cierre | 1008; dos envios bloqueados localmente | 0 |
| Offer concurrente durante AUTHENTICATING | 1008; OFFER_NOT_AUTHORIZED | 0 |

No se enviaron tokens validos, SDP valido ni audio. No hubo eventos
`gateway.authenticated`, `gateway.session_ready` ni `gateway.realtime_create_attempt`
en esas sesiones. No hubo llamadas OpenAI. La eliminacion de token y contexto
se verifica adicionalmente con pruebas locales del mismo handler; no se expone
contexto de autorizacion mediante endpoints productivos.

Una sonda anterior sin auth observo cierre de transporte 1006 despues del cierre
voluntario: el servidor registro `gateway.session_closed` y contador 0. Se ajusto
solo esa expectativa del arnes; los rechazos siguen exigiendo 1008. La matriz
certificada posterior completo los ocho casos sin usar esa excepcion.

## Preparacion de autorizacion positiva, posteriormente completada

La sonda positiva se prepara con `qa/scripts/serve-hugo-auth-only.mjs`,
exclusivamente en `127.0.0.1`. Usa las seis variables Firebase del archivo externo
`PAY0_BUILD_ENV_FILE`; esta sonda no requiere modificar la septima variable.
`PAY0_HUGO_AUTH_ONLY_TARGET_URL` y la revision esperada deben suministrarse desde
el mapeo efectivo de Cloud Run. Eliut inicia sesion normalmente en esa pagina
local y pulsa una sola vez "Probar autorizacion". Solo comunica el resultado
sanitizado; nunca comparte credenciales, tokens, cookies ni capturas de red.

Firebase Auth utiliza persistencia exclusivamente en memoria. El navegador envia
un unico `authenticate` directamente al WebSocket; no envia `offer` ni SDP, y
cierra la conexion y la sesion local tras el resultado. El servidor local no
recibe cuerpos de peticion ni credenciales. El bundle se genera en memoria;
CSP limita destinos y deshabilita microfono/camara. Sus siete pruebas locales
pasaron sin red externa. La confirmacion positiva definitiva exige evento
`gateway.authenticated` y cierre de esa misma sesion con contador Realtime cero.

El frontend productivo debe usar exclusivamente la URL estable
`https://hugo-voice-gateway-canary-o4tesftjlq-uc.a.run.app/voice`, nunca la etiquetada.

Hosting previo conservado: `305078af28ac2736`, release `1790303860914000`.
SSR previo: `ssrpay0system-00546-pin`.
Firestore ruleset conservado: `db5c1ca5-9354-4f26-b0ed-1b646c4890ac`.
No publicar Functions, Firestore Rules, indices ni Storage Rules en este hotfix.
`dispersionCreate` debe permanecer `false`. No ejecutar voz, pagos ni dispersiones.

## Causas y correcciones delimitadas

1. Seguridad: antes se conservaba identidad antes de aprobar allowlist,
   autorizacion canonica y ambito. El offer solo comprobaba su existencia.
   El handler ahora usa NEW -> AUTHENTICATING -> AUTHORIZED ->
   REALTIME_STARTING -> REALTIME_ACTIVE, con REJECTED/CLOSED terminales.
   Solo persiste contexto inmutable ligado al socket/sesion/uid/root despues de
   toda la autorizacion. Reserva el inicio antes de esperar, elimina token y
   contexto al rechazar/cerrar y aborta tareas pendientes. No modifica permisos,
   Tool Router, Hugo Core, modelo, voz ni herramientas PAY0.
2. Frontend: faltaba NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL al compilar. Se agrego
   al archivo externo protegido e ignorado, suministrado mediante
   PAY0_BUILD_ENV_FILE. No se agregaron credenciales al repositorio ni una URL
   hardcodeada en el componente. La guarda exige las seis variables Firebase
   y la URL HTTPS estable /voice; rechaza vacios, espacios, placeholders,
   credenciales, query/hash, puertos, etiquetas y servicio incorrecto antes de
   compilar o desplegar. El frontend conserva su rechazo seguro si faltara.
3. El 404 de /healthz fue una ruta reservada interceptada por Google; el mapeo
   security-67e320df -> 00012-mev era correcto. Se uso /healthz/ con autorizacion
   expresa, sin modificar imagen, IAM, etiqueta ni endpoint.

## Autorizacion positiva EBASOR certificada

Eliut inicio sesion normalmente en la pagina local aislada y comunico APROBO.
Firebase Auth uso persistencia en memoria y envio el token directamente del
navegador al WebSocket etiquetado. No se mostro, copio, archivo ni entrego a
Codex. No hubo offer, SDP, microfono ni audio. La allowlist externa contenia una
identidad y el backend valido identidad/ambito; no se modificaron permisos.

- Request HTTP 101: `2026-09-25T15:01:23.826461Z`, revision 00012-mev.
- Sesion de gateway: `bfb505da-21f7-4220-827e-ba03723b5547` (no es un token).
- `gateway.authenticated`: `2026-09-25T15:01:31.537034Z`, estado AUTHORIZED.
- `gateway.session_closed`: `2026-09-25T15:01:31.601411Z`.
- `realtimeCreationAttempts=0`; sin eventos de creacion/activacion Realtime.
- Sesion local cerrada y servidor de diagnostico detenido tras certificar.

## Promocion y comprobacion estable

Se promovio la revision existente 00012-mev al 100%, sin nuevo deployment de
imagen. 00011-tzj permanece Ready, disponible sin trafico porcentual.

La URL estable `/healthz/` devolvio HTTP 200, request log
`2026-09-25T15:05:12.863016Z` y container log `15:05:12.876221Z`, revision 00012.
Sonda: `pay0-stable-health-baf9465e7b164e9c8aaac55d1ceb9666`.
Matriz estable: `pay0-negative-fae6de32-0330-488b-9dd9-e0a8e64349e4`;
ocho escenarios, todos con cero intentos Realtime.

## Builds, preflight y artefacto publicado

Los dos builds independientes se iniciaron a `15:07:54Z` y `15:09:58Z` del
2026-09-25. Antes de cada uno se elimino exclusivamente `.next`, con su ruta
absoluta comprobada. Ambos terminaron exit 0 y 43/43 paginas desde b06e4b0 limpio.
La eliminacion fue solo de artefactos regenerables; no se elimino codigo ni datos.

- Guarda de entorno: 7/7; pruebas de la guarda: 26/26.
- Gateway: 38/38 pruebas locales; E2E simulado sin red externa.
- Arnes auth-only: 7/7; matriz local: ocho cierres sin token/contexto retenido.
- Release-baseline, politica canonica y 20/20 guardas criticas: PASS.
- Discovery previo: 3438 ms, 309 endpoints; repetido por predeploy: 3206 ms,
  309 endpoints, bajo el limite de 7000 ms.
- Hooks de CSF, reglas y documentos: PASS en emuladores, externalActions=0.
- El empaquetado de Firebase tambien completo 43/43 paginas.

Verificacion independiente publica a `2026-09-25T15:26:47.315Z`:

- GET `https://pay-0-system.web.app/hugo`: HTTP 200.
- HTML -> `page-8ca1fc00a3a39e92.js`; client-reference manifest -> modulo 29028.
- Los 15 assets de Hugo/layout devolvieron 200 y fueron identicos byte a byte
  entre el ultimo `.next`, Hosting empaquetado y produccion. Los dos builds
  limpios produjeron el mismo asset Hugo y el mismo SHA-256 de esa pagina.
- SHA-256 del asset Hugo:
  `3269a924b77f8f5de6b8cbbd0ee83dd80a7295f438b1c93aece44a3957681c66`.
- Analisis AST con ambito lexico: una unica salida WebSocket; el argumento
  resuelve a una sola declaracion con la URL canonica estable /voice.
- Sin variable pendiente de resolver, `createHugoRealtimeSession` ni llamadas
  del navegador a `api.openai.com/v1/realtime/calls`.

## Versiones finales del hotfix

| Componente | Version o evidencia |
| --- | --- |
| Base funcional acumulativa | `1c44dcdd89f98be8596085d0f772a488f60d4fde` |
| Seguridad y guarda de siete variables | `67e320df9b532e950a6b89460c4cd328e84e5ca7` |
| Fuente frontend publicada | `b06e4b036583d2e78b2e6ea5ba25259592ff4b4f` |
| Hosting version | `b758c02a7bf83667` |
| Hosting release | `1790349960621000` |
| Hosting timestamp | `2026-09-25T15:26:00.621Z` |
| SSR revision | `ssrpay0system-00548-lub`, ACTIVE, Ready=True |
| SSR digest | `sha256:dcfa2f8be4ddafb28b48031f9f45f75b33dd73fb873e3b6fdf670dc8e3a769cd` |
| SSR Cloud Build | `642d2f23-ead9-4dfb-be47-b211f8115984`, SUCCESS |
| Gateway | `hugo-voice-gateway-canary-00012-mev`, Ready=True, 100% |
| Gateway digest | `sha256:8276294c1a55779242cc9de6da45f0ed8f67e5be2f06c8a85c6a9378cb38b238` |
| Firestore Rules conservadas | `db5c1ca5-9354-4f26-b0ed-1b646c4890ac` |
| Storage Rules conservadas | `7104a4d3-8f59-49b6-9af6-b3b9a1c35363` |
| dispersionCreate | `false`, lectura acotada de configuracion a 15:27:11Z |

El snapshot posterior comparo nombre, estado, revision y updateTime de las 312
Functions desplegadas: solo cambio ssrpay0system, el backend autorizado de
Hosting. Las otras 311 permanecieron identicas. Firestore/Storage Rules
conservaron ruleset y updateTime. No se publicaron indices ni Storage Rules,
ni se modificaron datos financieros. No se uso --force ni se hizo rollback.

### Veinte Functions acumulativas conservadas, todas ACTIVE

| Function | Revision |
| --- | --- |
| getAuthorizedDocumentDownloadUrl | getauthorizeddocumentdownloadurl-00001-tiv |
| initEntityDocumentUpload | initentitydocumentupload-00011-yuj |
| finalizeEntityDocumentUpload | finalizeentitydocumentupload-00012-kah |
| finalizeClientCsfIntakeCallable | finalizeclientcsfintakecallable-00008-wer |
| createClientDispersionIq | createclientdispersioniq-00019-fuh |
| resolveCommissionInstrumentIq | resolvecommissioninstrumentiq-00003-fam |
| listScopedClientDispersions | listscopedclientdispersions-00003-dek |
| createClientDispersion | createclientdispersion-00037-kix |
| createClientDispersionsMassive | createclientdispersionsmassive-00026-fiz |
| requestClientDispersionIncident | requestclientdispersionincident-00021-qun |
| addClientDispersionNota | addclientdispersionnota-00016-kiq |
| previewClientDispersionPricing | previewclientdispersionpricing-00007-top |
| getClientOperationalBalanceSummary | getclientoperationalbalancesummary-00016-fax |
| prepareDocumentDeliveryJob | preparedocumentdeliveryjob-00018-fem |
| createClientBeneficiary | createclientbeneficiary-00029-dor |
| addClientBeneficiaryMethod | addclientbeneficiarymethod-00026-voh |
| toggleClientBeneficiaryActive | toggleclientbeneficiaryactive-00023-cow |
| toggleClientBeneficiaryMethodActive | toggleclientbeneficiarymethodactive-00022-keb |
| replaceClientBeneficiaryMethod | replaceclientbeneficiarymethod-00018-hej |
| processIqDispersionCreate | processiqdispersioncreate-00008-yin |

## Smokes finales posteriores a Hosting

Matriz: `pay0-negative-3efbd351-557c-4ad0-9935-9610a75ec881`,
`2026-09-25T15:27:45.822Z` a `15:27:47.948Z`, siempre revision 00012-mev.
Se repitieron los mismos ocho escenarios de la tabla anterior: conexion ociosa
cerrada 1000; siete rechazos 1008; contador Realtime cero en cada sesion.
No hubo autenticacion inesperada ni eventos de creacion/activacion Realtime.
Dos mensajes posteriores al cierre fueron bloqueados localmente. No hubo SDP
valido, token valido, audio ni acciones financieras en estas sondas.

Salud estable final: HTTP 200, sonda
`pay0-final-health-42310b149d4f41cc82d10fa137256020`, request log
`15:27:43.506491Z`, latencia 2441 ms, container log `15:27:46.152810Z`.
Misma ruta, instancia y revision 00012-mev. La ventana inicial del arnes de
correlacion (un segundo desde inicio) no incluia esa latencia; se interpreto
correctamente como duracion de request mas margen de buffering de un segundo,
sin repetir la sonda ni modificar produccion.

## Rollback disponible por componente, no ejecutado

- Gateway: 00011-tzj, Ready=True comprobado a `15:29:24Z`.
  Digest `sha256:e00043816e2277b2d0b40a22b06f29a6cc50041b07fbe1a5d32a3336f0e688cf`.
  Conservado como emergencia autorizada; volver a el perderia el endurecimiento
  de este hotfix, por lo que no es una version de seguridad equivalente.
- Hosting: version `305078af28ac2736`, release `1790303860914000`;
  etiqueta SSR previa conservada `fh-305078af28ac2736`.
- SSR: `ssrpay0system-00546-pin`, Ready=True comprobado a `15:29:24Z`.
  Digest `sha256:657a75c4004ee75a1386cb617e2f44493684d745d5c5f53ceb76761170c8a11c`.
- Un rollback frontend no debe revertir el gateway seguro ni Functions/Rules.
  El frontend anterior conserva la carencia de configuracion que motivo el hotfix.

## Costo, limites y entrega

OpenAI: USD 0 por las comprobaciones de este hotfix, con cero sesiones Realtime
y cero audio enviados. No se afirma costo total de infraestructura cero:
Cloud Build, Cloud Run, Firebase, almacenamiento y logs pueden generar cargos;
no se consulto facturacion para cuantificarlos.

Hugo esta listo para UNA prueba humana completa de EBASOR en /hugo. Sigue
pendiente validar esa conversacion real, microfono/audio e interaccion completa;
no se ejecuto automaticamente. La restriccion canary backend permanece intacta.
La prueba humana no debe ejecutar pagos ni dispersiones.

El commit posterior que cierre este registro es solo documental: no cambia la
fuente publicada b06e4b0 y no autoriza otro deployment. No se realizaron
correcciones adicionales, un segundo deployment ni cambios de otros modulos.
