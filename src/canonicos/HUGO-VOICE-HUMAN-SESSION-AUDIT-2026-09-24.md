# Auditoría de sesión humana de Hugo Voice — 2026-09-24

## Resultado

La sesión humana posterior al E2E no utilizó la arquitectura validada. Entre
`2026-09-24T17:42:50Z` y `17:44:59Z`, Opera 135 sobre Windows invocó
`createHugoRealtimeSession` y `saveHugoVoiceHistory`. No existe una apertura de
WebSocket, autenticación, `session_ready` ni tool call correspondiente en
`hugo-voice-gateway-canary`. El UID/root observado en el canario es
`Ab4z0RttIqXbZFT0NuWsDjBkt6J2`.

El E2E aprobado sí abrió `rtc_u0_ERgXRp3oMMnXYswMZiboahqXEVDezFD9` a las
`16:24:42Z` en la revisión `hugo-voice-gateway-canary-00011-tzj`, modelo
`gpt-realtime-2.1`, voz `marin`, con cuatro tools registrados. Ejecutó tools
determinísticos, entregó `function_call_output` y creó la continuación de
respuesta.

## Punto exacto de divergencia

El frontend sólo seleccionaba gateway cuando `voiceCanary=1` estaba presente en
la URL o en `sessionStorage`. Sin esa bandera, pedía un secreto efímero mediante
`createHugoRealtimeSession` y conectaba el navegador directamente a Realtime.
Aunque esa sesión declaraba `delegate_to_hugo_core`, el navegador no tenía un
handler que ejecutara la función. Por tanto, la sesión humana no podía alcanzar
sideband, `delegateHugoVoiceTurn`, Tool Router ni PAY0.

El candidato elimina esa bifurcación: si falta
`NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL`, la voz falla cerrada; si está configurada,
toda sesión humana autentica y negocia a través del gateway server-side. No se
añadieron afirmaciones al prompt ni datos hardcodeados.

## Historial, contexto y memoria existentes

- **Historial almacenado:** texto en `agent007Messages`; sesiones de voz en
  `agent007Conversations/{rootId}_{uid}_global/voiceSessions`, con turnos y una
  lista acotada de eventos. No se almacena audio.
- **Historial visible:** `/hugo` combina mensajes de texto y sesiones de voz por
  fecha; los turnos de voz se abren bajo demanda. Esto es UI, no contexto del
  modelo.
- **Contexto de Hugo Core:** al delegar, carga como máximo 12 mensajes de texto
  recientes, estado conversacional, entidades recientes, hechos PAY0 obtenidos
  por tools y memoria seleccionada. Los turnos guardados en `voiceSessions` no
  se cargan como historial del Core.
- **Contexto de Realtime:** instrucciones de sesión, conversación viva desde que
  se abre la conexión y schemas de tools. No recibe conversaciones previas ni el
  historial visible de `/hugo`.
- **Memoria persistente:** existe `agent007Memory` v2 para memorias explícitas o
  verificadas, con estados, alcance y recuperación selectiva por entidad. No es
  una memoria autobiográfica general ni se alimenta automáticamente con cada
  conversación. Sólo participa cuando el turno llega a Hugo Core y la consulta
  permite recuperar una entidad aplicable.
- **Texto frente a voz:** comparten `rootId`, usuario y conversación global para
  delegaciones al Core, pero no comparten hoy un transcript conversacional
  unificado. La voz directa anterior no usaba Core; la voz por gateway sólo usa
  historia/memoria en turnos delegados.

## Propuesta de memoria conversacional (diseño, no implementación)

1. Crear un resumen versionado por conversación y usuario, separado del log de
   mensajes, con procedencia, fechas de vigencia y referencias a turnos.
2. Extraer candidatos de hecho, decisión, preferencia y corrección; dejarlos en
   estado candidato salvo fuentes determinísticas o confirmación humana.
3. Aislar todo por `rootId` y `ownerUid`; aplicar autorización efectiva también
   al recuperar, no sólo al escribir.
4. Recuperar por intención, entidad y recencia con presupuesto fijo; enviar al
   modelo sólo fragmentos seleccionados y sus fuentes, nunca el historial total.
5. Hacer prevalecer el estado actual de PAY0 sobre memoria histórica. Registrar
   contradicciones, supersesión, correcciones e invalidación por cambio de
   permisos, entidad, vigencia o eliminación de origen.
6. Unificar texto y voz en un índice de turnos normalizado. El transcript de voz
   debe pasar una política de consentimiento/retención y conservar la
   distinción entre transcripción y dato verificado.
7. Registrar en cada traza memorias consideradas/incluidas, razón, tokens y
   costo para auditoría y afinación del presupuesto.

## Fronteras de conocimiento

Cada respuesta debe atribuir internamente su evidencia a una de estas fuentes:
conversación actual, memoria recuperada, PAY0, ASSETS, TTT, herramienta
determinística, Brain Model o conocimiento general. Una futura consulta de
información externa actual —por ejemplo la temperatura de Monterrey— necesita
un conector explícito de datos actuales con allowlist, autorización, citas,
timeouts, cuotas y trazabilidad; no debe resolverse como PAY0, memoria ni acceso
web arbitrario.

## Evidencia y límite

La evidencia procede de Cloud Logging y de la configuración de Cloud Run leída
sin mutaciones. No se fabricó una nueva sesión, no se ejecutó una llamada de voz
facturable y no se desplegó el cambio. La equivalencia humana sólo puede quedar
demostrada operacionalmente después de desplegar frontend con la URL del
gateway y realizar una canary humana aprobada; este candidato sí elimina en
código la ruta divergente que causó el fallo observado.
