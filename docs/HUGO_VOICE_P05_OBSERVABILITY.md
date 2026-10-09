# Hugo Voice P0.5 — observabilidad y auditoría

## Alcance

Este cambio se limita a Hugo Voice, su historial y sus diagnósticos. No modifica herramientas operativas, PAY0, IQ, Wallet, Assets, TTT, Materialidad, Facturama, Reportes, Pagos, permisos, Firestore Rules, Storage Rules ni índices.

## Diagnóstico

- La última llamada auditada usó la revisión productiva anterior, por lo que no valida la ventana candidata de 300 ms.
- El cliente ya escuchaba el evento nativo de transcripción, pero la sesión no lo habilitaba y los turnos del usuario quedaban vacíos.
- Cada guardado reenviaba toda la sesión y el backend conservaba sólo los primeros 40 turnos y 80 eventos.
- La identidad documental era `turnId + speaker`; dos respuestas de Hugo dentro del mismo turno podían sobrescribirse.
- El identificador de llamada `rtc_*`, utilizado por tools y ledger, se sustituía después por el identificador Realtime `sess_*`, sin conservar ambos para correlación.
- Actividad consultaba únicamente `agent007Traces`; las sesiones de voz y `agent007CostLedger` quedaban fuera de esa vista.
- Memoria y Aprendizaje podían estar correctamente vacíos, pero la interfaz no explicaba fuente, rango ni que la voz estaba excluida.

## Arquitectura de persistencia

1. El gateway entrega metadatos sanitizados de runtime: servicio, revisión, commit, rama, versión, VAD, ventana de confirmación y transcripción. En Cloud Run, una revisión sin commit o rama falla cerrada antes de crear Realtime.
2. Se conservan por separado `gatewayCallId` (`rtc_*`) y `sessionId` (`sess_*`). El primero correlaciona tools/ledger; el segundo identifica el documento conversacional.
3. Realtime produce transcripción de entrada con `gpt-4o-mini-transcribe`, idioma `es` y logprobs cuando estén disponibles. No existe una segunda inferencia de transcripción.
4. El navegador mantiene mapas completos sólo para la vista viva y colas `pendingTurns`/`pendingEvents`. Cada confirmación de turno, transcripción, respuesta o cierre envía únicamente el delta pendiente, serializado para evitar carreras.
5. Functions rechaza lotes anormalmente grandes en vez de truncarlos silenciosamente. Los documentos se escriben idempotentemente.
6. La identidad de turno es el hash de `turnId + speaker + responseId|input`; una respuesta de tool y una respuesta hablada ya no colisionan.
7. La lectura de detalle pagina turnos y eventos de forma independiente, sin un techo total fijo.
8. Actividad agrega sesiones, respuestas, interrupciones, errores, tools y ledger. Historial conserva conversación; Memoria sólo hechos verificados; Aprendizaje sólo experiencias con resultado medido.

## Telemetría por turno

Se persisten eventos de inicio/fin de voz, transcripción terminada o fallida, creación/cierre/cancelación de respuesta, primer audio, duración de audio, candidato/rechazo/confirmación de interrupción y ciclo de tools. Los eventos del gateway contienen sólo identificadores técnicos y latencias sanitizadas.

## Semántica y seguridad

- La autorización continúa usando exclusivamente `assertAuthorized` y el helper canónico existente.
- `SIN_RESULTADOS` no se presenta como `PERMISSION_DENIED`. Sólo el backend autorizado puede producir una denegación.
- Los mensajes de voz siguen una estructura breve: resultado, limitación sólo si aplica y pregunta de continuidad.
- No se registra audio, token Firebase, cookies ni credenciales.

## Capacidades detectadas y no implementadas

- Autor de solicitud.
- Filtros por fecha.
- Resolución inequívoca de cliente.
- Mayor detalle de pagos.

Estas brechas quedan documentadas; no se agregó ninguna herramienta ni capacidad.

## Riesgos y pendientes

- La transcripción de entrada es una señal ASR independiente y puede diferir de lo que interpretó el modelo; debe mostrarse como transcripción, no como verdad absoluta.
- El costo de transcripción queda `null` hasta contar con una tarifa observada atribuible; no se reporta falsamente como cero.
- Las sesiones históricas anteriores a P0.5 no tienen `gatewayCallId` ni metadatos completos y no siempre podrán correlacionarse con ledger.
- La vista Actividad hace agregaciones por sesión. Antes de ampliar el rollout se debe medir su latencia con conversaciones largas.
- Falta una prueba humana contra una revisión candidata identificada, seguida de la matriz de ruido/interrupción de 300 ms.

## Casos de prueba

- Gateway: suite completa de seguridad, una sola creación Realtime, tools, continuidad, interrupción confirmada, ruido corto y telemetría por respuesta.
- Contrato estático: gateway server-side, 11 tools, autorización canónica, persistencia incremental, transcripción nativa e identidad con `responseId`.
- Compilación TypeScript de Functions y frontend.
- Pendientes humanos: teclado, silla, tos, palmada, TV, otra persona, conversación lateral, oficina, voz corta/normal e interrupción inmediata/a 1 s.

## Plan de liberación

No se despliega en esta fase. Al crear la única revisión candidata se deben fijar `HUGO_BUILD_COMMIT`, `HUGO_BUILD_BRANCH` y `HUGO_BUILD_VERSION`; verificar en una sesión que la revisión y commit persistidos coinciden; después avanzar sólo con aprobación humana: Eliut, superadmin, admins seleccionados, operadores, clientes piloto y finalmente disponibilidad general. Cada etapa conserva rollback inmediato y no altera otros componentes.

## Prioridad 11: salvaguardas de datos sensibles

- La autorización de sesión y de cada callable permanece en `assertAuthorized`; Realtime no decide permisos.
- Un `PERMISSION_DENIED` se convierte antes de llegar al modelo en una respuesta opaca: no confirma existencia ni contiene nombres, montos, folios, RFC, cuentas, documentos, rutas o identificadores.
- `ENTITY_NOT_FOUND` mantiene un estado y mensaje diferentes de una denegación.
- Los resultados ambiguos no exponen la lista de candidatos en voz y requieren nombre completo o correo.
- El callable dejó de devolver `sourceTrace`; el ledger conserva sólo tool, sistema, latencia, completitud y resultado, sin `evidenceIds`.
- Los bloqueos se registran en `agent007VoiceSecurityAudit` con actor seudonimizado, tipo de restricción, tool y motivo estable. No se almacena la consulta ni información del recurso protegido.
- La allowlist desconocida falla cerrada y también genera auditoría sanitizada.

La matriz automática incluye solicitudes indirectas sobre pagos, existencia, comparaciones, último cliente, autor de consultas, empresa/cuenta, CLABE, archivos ocultos, UUID y rutas de Storage. La validación de roles distintos de superadmin permanece pendiente: la candidata actual los rechaza por diseño y no se ampliaron permisos en esta fase.
