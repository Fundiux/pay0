# Hugo Voice: hotfix de seguridad y configuracion, 2026-09-25

## Estado: validacion en curso, NO aprobado ni promovido

Este registro complementa el corte acumulativo; no reemplaza su historial.

- Base funcional acumulativa: `1c44dcdd89f98be8596085d0f772a488f60d4fde`.
- Fuente del hotfix y de la imagen candidata: `67e320df9b532e950a6b89460c4cd328e84e5ca7`.
- Rama: `integration/pay0-final-candidate-20260924`.
- Proyecto/region/servicio: `pay-0-system` / `us-central1` / `hugo-voice-gateway-canary`.
- Candidata: `hugo-voice-gateway-canary-00012-mev`, sin trafico porcentual.
- Digest: `sha256:8276294c1a55779242cc9de6da45f0ed8f67e5be2f06c8a85c6a9378cb38b238`.
- Revision productiva y rollback conservado: `hugo-voice-gateway-canary-00011-tzj`, 100%.

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

## Compuertas pendientes

1. Autorizacion positiva EBASOR exclusivamente en navegador, sin offer ni token compartido.
2. Promocion al 100% y certificacion de `/healthz/` y rechazos en URL estable.
3. Configuracion externa protegida, dos builds limpios y Hosting/SSR.
4. Smokes finales y registro de versiones del hotfix completado.

La sonda positiva se prepara con `qa/scripts/serve-hugo-auth-only.mjs`,
exclusivamente en `127.0.0.1`. Usa las seis variables Firebase del archivo externo
`PAY0_BUILD_ENV_FILE`; no requiere ni modifica todavia la septima variable.
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
