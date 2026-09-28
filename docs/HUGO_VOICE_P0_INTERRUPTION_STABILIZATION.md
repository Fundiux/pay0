# Hugo Voice P0: estabilizacion de interrupciones

## Alcance

Esta correccion se limita al gateway Realtime y al componente de voz de Hugo.
No modifica voz, modelo, prompt de personalidad, tools, autorizacion, Functions,
reglas, Hosting ni dominios operativos de PAY0.

## Diagnostico del flujo anterior

```text
microfono WebRTC
  -> Realtime semantic_vad
  -> input_audio_buffer.speech_started
       |-> Realtime: interrupt_response=true cancelaba la respuesta
       |-> frontend: audio.muted=true inmediatamente
       |-> frontend: turno Hugo = INTERRUPTED inmediatamente
       `-> sideband gateway: registry.interrupt(turno anterior)
             |-> abortaba solamente tools PENDING
             `-> conservaba RUNNING/COMPLETED
  -> response.done/cancelled
  -> frontend persistia INTERRUPTED
```

Un solo `speech_started` era suficiente para cortar audio y estado. No habia
ventana de confirmacion. El gateway llamaba `gateway.interruption` aun cuando no
cancelaba audio; la cancelacion real la efectuaban Realtime y el frontend.

La telemetria `gateway.first_audio` tambien usaba el inicio de la conexion y un
unico marcador por sesion. Por ello solo media el primer audio de toda la
llamada, no el primer audio de cada turno.

## Flujo corregido

```text
microfono WebRTC
  -> Realtime semantic_vad (interrupt_response=false)
  -> speech_started
  -> gateway.interruption_candidate
  -> ventana de confirmacion de 300 ms
       |-> speech_stopped antes de 300 ms
       |     -> gateway.interruption_rejected
       |     `-> audio y respuesta continúan
       `-> actividad sostenida >= 300 ms
             -> response.cancel
             -> output_audio_buffer.clear
             -> registry.interrupt(turno anterior)
             -> gateway.interruption_confirmed
             `-> frontend marca INTERRUPTED
```

El gateway es la autoridad unica de confirmacion. El frontend ya no silencia ni
marca una respuesta al recibir solamente `speech_started`.

## Tools y transiciones

- Una tool `PENDING` del turno interrumpido se marca `CANCELLED` y se aborta.
- Una tool `RUNNING` o `COMPLETED` se conserva; no se afirma que una operacion
  ya iniciada fue cancelada.
- El resultado tardio sigue sujeto a la vinculacion de sesion y turno existente.
- Cerrar socket, sideband o sesion cancela timers y controladores como antes.

## Telemetria por turno

Se agregan o corrigen eventos sanitizados:

- `gateway.user_speech_stopped`: fin de voz del usuario.
- `gateway.response_created`: creacion y latencia desde fin de voz.
- `gateway.first_audio`: primer audio por `responseId`, desde creacion y fin de voz.
- `gateway.output_audio_done`: duracion aproximada de emision de audio.
- `gateway.interruption_candidate`: posible interrupcion.
- `gateway.interruption_rejected`: falsa interrupcion corta.
- `gateway.interruption_confirmed`: interrupcion sostenida y confirmada.
- `gateway.response_done`: estado final, uso y correlacion de turno/respuesta.
- `gateway.tool_started` / `gateway.tool_completed`: tiempo real de herramientas.

## Matriz de validacion

| Escenario | Resultado esperado | Estado |
| --- | --- | --- |
| Silencio absoluto | Sin candidatos ni cancelaciones | Pendiente humana |
| Oficina normal | Ruidos breves rechazados; voz directa confirmada | Pendiente humana |
| Television | No garantizar identidad de hablante; medir falsos positivos | Pendiente humana |
| Musica | Transitorios breves no cancelan; voz sostenida puede activar VAD | Pendiente humana |
| Otra persona hablando | Puede confirmar: VAD no identifica hablante | Pendiente humana |
| Ruido de silla | Menor a 300 ms: respuesta continua | Cubierto por simulacion temporal |
| Teclado | Activacion breve: respuesta continua | Cubierto por simulacion temporal |
| Tos | Tos breve: respuesta continua; tos larga puede confirmar | Pendiente humana |
| Palmada | Menor a 300 ms: respuesta continua | Cubierto por simulacion temporal |
| Conversacion lateral | Riesgo conocido de confirmacion | Pendiente humana |
| Interrupcion real sostenida | Cancela respuesta y limpia buffer tras 300 ms | Cubierto por prueba de gateway |
| Dos respuestas consecutivas | First-audio independiente por respuesta | Cubierto por prueba de gateway |

## Riesgos y limites

- VAD detecta actividad vocal, no biometria ni direccion del hablante. Television
  y conversaciones laterales sostenidas pueden confirmar una interrupcion.
- La ventana agrega hasta 300 ms antes de detener a Hugo durante un barge-in real.
- Una expresion real extremadamente corta durante la salida de Hugo puede ser
  rechazada; debe calibrarse con prueba humana antes de produccion.
- `create_response` permanece automatico. Con una falsa activacion mientras hay
  una respuesta activa, Realtime conserva la respuesta actual; se debe observar
  en prueba humana si el fragmento de ruido afecta el contexto posterior.

## Fluidez: prompt frente a sistema

- Cortes, repeticiones y respuestas parciales observados se explican
  principalmente por cancelaciones VAD/barge-in, no por el timbre Marin.
- Respuestas largas, cierres repetitivos y frases de relleno pertenecen al
  comportamiento/instrucciones del modelo y quedan fuera de esta correccion P0.
- Tiempos muertos deben separarse con las nuevas metricas: fin de voz a
  `response.created`, tiempo de tool y `response.created` a primer audio.

## Criterio antes de desplegar

Ejecutar la matriz en un entorno candidato, revisar logs por `sessionId`,
`turnId` y `responseId`, y obtener aprobacion humana. Esta rama no despliega.
