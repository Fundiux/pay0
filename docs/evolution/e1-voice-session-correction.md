# Corrección conversacional en la misma sesión de voz

Estado: implementación local validada; sin paquete productivo ni publicación, cambio de gateway, activación de reglas o llamadas a proveedores. La validación local no acredita sonido real ni una sesión productiva.

El gateway conserva por socket autenticado las referencias de respuestas completas y transcripciones observadas en su sideband. La nueva herramienta `correct_current_voice_response` no recibe identificadores ni texto del modelo: utiliza la respuesta anterior observada y la transcripción del usuario en el turno actual. Mantiene las catorce herramientas anteriores.

La sesión nativa de Realtime y el identificador de llamada del gateway son distintos. El adaptador valida ambos contra la historia persistida, además del dueño, raíz, turno HUGO completo y no interrumpido, turno USER con transcripción nativa y orden temporal. La historia procede del cliente: su procedencia se registra como `CLIENT_TRANSCRIPT_NOT_FACT`, no como evidencia independiente de una operación financiera.

`delegateHugoVoiceTurn` reutiliza `persistConversationCorrection`: vuelve a autorizar al usuario dentro de la transacción y guarda una memoria canónica `USER_STATEMENT`, limitada a conversación/sesión. No crea un hecho, experiencia verificada, regla global ni aprobación de aprendizaje. Las correcciones de voz no se recuperan como contexto de texto ni de otro socket. El primer uso sólo por audio puede crear el padre de conversación propio después de validar la sesión en la misma transacción; no adopta padres ajenos.

El gateway exige ACK de persistencia con los mismos identificadores, versión exactamente anterior más uno y contenido idéntico. Un ACK ausente, intercambiado o de versión distinta no produce confirmación de guardado. El resultado se devuelve al diálogo como indicación del usuario, con autoridad `USER_STATEMENT_NOT_FACT`, y se solicita la continuación audible mediante el mecanismo existente. El modelo recibe instrucciones para confirmar y reformular en la misma sesión, conservando herramientas, permisos y evidencia financiera autorizada. El contenido de la corrección nunca pasa a instrucciones de sistema.

El límite es de 1.000 caracteres, sin truncamiento silencioso. Si la transcripción todavía no está persistida, la corrección falla de forma explícita; no confirma una escritura que no ocurrió. No se conserva audio ni se incluyen transcripciones en los logs del gateway.

Verificación local: suite completa del gateway **57/57 PASS**, incluyendo continuación simulada antes/después del ACK y rechazo de ACK obsoleto; adaptador con Firestore falso **5/5 PASS**, con rechazo de raíz/dueño/sesión/llamada ajenos, turnos inexistentes o interrumpidos, transcripción alterada y versiones inválidas. Esta prueba del adaptador sustituye deliberadamente el helper común para aislar el resolver; no acredita su autorización real. La evidencia integrada del helper y el adaptador se registra por separado de esta suite aislada. La continuación con sideband simulado no acredita sonido real, calidad de transcripción ni operación productiva.

Archivos propios: `voiceConversationCorrections.ts`, `voiceSessionCorrection.mjs`, integración mínima en `voiceDelegation.ts`, `gatewayConnection.mjs`, `realtimeTools.mjs`, `server.mjs` y sus pruebas. El helper canónico `conversationCorrections.ts` y la integración de texto se mantienen bajo responsabilidad del frente de Texto.

## Dependencias de publicación y reversión

Antes de habilitar este productor, deben estar publicados y verificados los lectores protegidos `listAgent007MemoryDiagnostics` y `reviewAgent007MemoryCandidate`, además del helper canónico compatible en el destino `delegateHugoVoiceTurn`. Su presencia en la fuente local no significa que estén desplegados. El gateway y el callable requieren sus propias capturas, artefactos, configuración/IAM, autorización y pruebas exactas; este commit local no las reemplaza.

Una vez que pueda haber correcciones privadas, conservar los lectores protegidos aunque se reviertan callable y gateway. Revertir sólo el productor TEXT no detiene VOICE. Revertir VOICE contra sus recibos propios, sin borrar recuerdos ni convertir sus claves a ámbito global. [Guía de reversión compatible](e1-conversation-memory-rollback-compatibility.md).

Esta implementación limita la corrección a la sesión de voz; no ofrece reutilización durable USER_TOPIC/CLIENT entre sesiones ni hereda automáticamente el contrato durable de TEXTO. Las catorce herramientas públicas anteriores, incluida la ruta de reportes R2, permanecen; la herramienta de corrección se añade sin reemplazarlas.

Revisión final local: `node --test services/hugo-voice-gateway/test/*.test.mjs qa/scripts/voice-conversation-corrections.test.cjs`, **62/62 PASS**, cero skips y exit 0; log privado `tmp/voice-local-commit-regression.log`. Corresponde a 57 pruebas gateway y cinco del adaptador con helper sustituido. El build Functions NORMAL integrado actual pasó según la coordinación de raíz; no se atribuye ese build a un artefacto VOICE aislado. La suite del adaptador no certifica por sí sola autorización del helper común.
