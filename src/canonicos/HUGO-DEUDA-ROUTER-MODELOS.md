# Deuda prioritaria: desacoplar el motor cognitivo de Hugo

Estado: diseño propuesto, sin implementación ni cambio de proveedor. Auditoría del código: 2026-09-21. Esta deuda no bloquea la misión de complementos.

## Dependencias actuales comprobadas

- La única llamada a un LLM dentro de `functions/src/modules/agent007/` está en `callables.ts:vertexReply`: URL de Vertex AI en `us-central1` con `gemini-2.5-flash:generateContent`, credencial de la aplicación Firebase, temperatura 0.35 y salida máxima de 1200 tokens. El prompt y el parseo de respuesta están en la misma función.
- `sendAgent007Message` arma contexto desde Firestore, detecta un comando de complemento con reglas, llama a `vertexReply` para conversación libre y usa `fallbackReply` si el modelo no entrega una salida completa. En emuladores no llama a Vertex.
- `capabilities.ts` ejecuta la capacidad IQ por código; `observer.ts` crea observaciones y avisos por eventos; `reconciliation.ts` mantiene propuestas. Ninguno de estos tres archivos requiere LLM para su decisión actual.
- `agent007Messages.source` usa `VERTEX_AI`, `HUGO_ENGINE`, `USER` y `SYSTEM_EVENT`. `HUGO_ENGINE` mezcla comando de herramienta y respuesta determinística de contingencia. No se guarda el modelo exacto, propósito, latencia, razón de fallback, consumo ni costo por llamada.
- PAY0 usa Google Cloud Vision en `pagos/receiptPdfCallables.ts` para OCR de comprobantes. Es una dependencia cognitiva anterior a los datos que Hugo puede observar, pero no una llamada del chat de Hugo ni un proveedor intercambiable bajo el primer `HugoModelRouter`. Su procedencia y versión deberán quedar en la evidencia documental del flujo de pagos.
- La UI (`HugoFloatingBubble.tsx`) usa el callable y muestra el texto sin necesitar conocer el proveedor. El servicio tipado `src/services/agent007.ts` refleja las etiquetas actuales.

## Límite de propiedad

Hugo conserva identidad, memoria, contexto, reglas, permisos, herramientas, capacidades, planes, decisiones, evaluación y auditoría. El proveedor recibe una tarea cognitiva acotada y devuelve una propuesta o texto. No lee Firestore directamente, no concede autorización ni ejecuta capacidades. Cambiar de modelo no migra ni reinicia la memoria de Hugo.

## Abstracción mínima propuesta

Introducir en backend un contrato `HugoModelProvider.generate(input): Promise<output>` con `providerId`, `modelId`, `purpose`, `systemInstruction`, `context` acotado, `message`, presupuesto de tiempo/tokens y resultado estructurado (`text`, `finishReason`, `usage`, `rawCost` si existe). El primer adaptador envolvería exactamente la llamada Vertex/Gemini actual; el modelo seguiría siendo `gemini-2.5-flash`.

Un `HugoModelRouter` decide primero si la tarea requiere LLM. Consultas estructuradas, cómputo, validación fiscal/financiera, autorización y ejecución de herramientas devuelven `NO_MODEL_REQUIRED` y usan código o capacidades existentes. Para conversación abierta, selecciona el adaptador configurado por propósito y aplica límites y fallback. Inicialmente hay una sola ruta Vertex; el contrato permite incorporar otros proveedores después, con evaluación y autorización específicas, sin introducirlos ahora.

La respuesta visible conserva una procedencia precisa: `MODEL_RESPONSE`, `DETERMINISTIC_RESPONSE`, `TOOL_RESULT`, `MODEL_FALLBACK` o `SYSTEM_EVENT`. Los mensajes históricos con `VERTEX_AI` y `HUGO_ENGINE` siguen legibles; no se reescriben como si se conociera su origen exacto.

## Registro mínimo por ejecución

Un evento asociado a conversación/caso, `rootId` y correlación de solicitud registra proveedor, modelo exacto, propósito, inicio y latencia, resultado (`SUCCESS`, `ERROR`, `INCOMPLETE`, `SKIPPED`), motivo de fallback, tokens de entrada/salida y costo cuando el proveedor los entregue. Ausencia de costo se guarda como `null`, nunca como cero estimado. Registrar versión de política y hash de entrada si se necesita reproducibilidad; no duplicar prompts, secretos, documentos fiscales ni tokens de acceso en la bitácora. Una decisión `NO_MODEL_REQUIRED` también se registra como ruta determinística, sin simular una llamada de modelo.

## Orden y criterios de adopción

1. Fijar con pruebas el comportamiento actual de `vertexReply`, comando IQ y fallback, incluidos timeout, `MAX_TOKENS` y emulador.
2. Extraer el adaptador Vertex sin cambiar endpoint, prompt, parámetros ni respuesta visible. Introducir router con una única ruta LLM y rutas determinísticas actuales.
3. Separar procedencia de mensajes y registrar ejecución de modelo con métricas. Verificar aislamiento por `rootId`, ausencia de datos sensibles en logs y compatibilidad de lectura histórica.
4. Sólo después evaluar modelos alternativos con un conjunto de casos de Hugo y una política explícita por propósito, costo y riesgo.

La misión de complementos continúa con reglas, consultas y validadores determinísticos; su inventario y sus métricas no llaman a ningún modelo.
