# WhatsApp: una conexión por agente (diseño, sin implementar)

Estado: propuesta para aprobación. Nada de esto está construido ni desplegado.

## Objetivo
Cada agente de PAY0 (Hugo, María, Sofía, Sentinel, etc.) tendrá su propio WhatsApp, enlazado con su propio QR, y observará los grupos que el superadmin autorice. Así se puede medir la efectividad de cada agente, y revocar a uno sin afectar a los demás.

## Cómo funciona hoy (código leído)
- El conector es un programa local (whatsapp-web.js) en `tools/whatsapp-qr-connector`. Se identifica ante Functions con una llave Ed25519 y firma cada operación.
- Existe **un solo vínculo por usuario superadmin**: el registro `whatsappQrConnectorOwners/{[rootId, uid]}` guarda un único `bindingId`, y crear un segundo vínculo falla mientras el primero esté ACTIVE (`whatsappConnectorAuthority.ts`, `create`).
- Los chats se guardan en `whatsappQrChats/{chatId}` con una sola clave por chat. Si otro vínculo ve el mismo grupo, el chat se **pone en cuarentena** y no se actualiza (`sync`, comprobación `old.bindingId !== binding.id`).
- El conector descarta todo mensaje entrante a propósito (`enrolledConnector.cjs:55`). Solo envía latidos (estado) y la lista de chats.
- Acciones permitidas hoy: `HEARTBEAT`, `SYNC_CHATS`, `NEW_QR`.

## Cambios propuestos

### Fase A — Un vínculo por agente (seguridad del conector)
1. Agregar `agentId` al vínculo y al registro de dueño: la clave pasa de `[rootId, uid]` a `[rootId, uid, agentId]`. Los vínculos existentes quedan con `agentId = "pay0"` (el conector actual no cambia).
2. `create/getOwned/revoke/enqueue` reciben `agentId` (validado contra `AGENTS` de `agentOperations/contract.ts`). Siguen siendo solo superadmin.
3. Los chats pasan a guardarse por `{bindingId}__{chatId}` para que varios agentes vean el mismo grupo sin cuarentena. Migración: los chats actuales se leen con ambas claves hasta la próxima sincronización.
4. Panel `/whatsapp`: una tarjeta por agente con su estado (conectado / QR requerido), botón de QR propio y botón de revocar.
5. Cada agente corre su propia instancia del conector (carpeta de sesión y llave distintas).

Riesgos: toca la autenticación firmada del conector; requiere pruebas con el emulador y una revisión de seguridad antes de desplegar. No se debe cambiar la política de envolvente (`assertWorkerEnvelope`) más que lo necesario.

### Fase B — Leer lo que pasa en los grupos autorizados (privacidad)
1. Nueva acción firmada `INBOUND_GROUP`, que se agrega en `WorkerAction`, `assertAction` y `operate()`. Hereda firma, generación, anti-repetición y alcance por `rootId`.
2. Solo se aceptan mensajes de grupos configurados en `whatsappAgentObservers` (ya existe) y donde ese agente esté listado como observador. Todo lo demás se descarta.
3. Idempotencia por `{bindingId}_{messageId}`, mensajes agrupados por llamada (máx. 100) y caducidad (`expiresAt`) con política TTL de Firestore.
4. Se guarda solo lo necesario para medir: grupo, autor (hash del número), hora, tipo y texto. Sin archivos adjuntos en esta primera versión.
5. El conector reemplaza el descarte actual por un manejador que filtra grupos (`@g.us`) y reintenta con cola local.

Riesgos: son conversaciones privadas. Requiere aviso a los participantes de los grupos, una retención definida (propuesta: 30 días) y la aprobación explícita del dueño antes de activarlo.

### Fase C — Medición por agente
Con Fase B activa se miden, por agente y por grupo: tiempo hasta la primera respuesta, mensajes atendidos, mensajes sin respuesta y tiempo entre un pedido y su cierre, enlazando con `operationalMetrics` (etapas FIRST_RESPONSE y RESOLVED, fuente AUTOMATION).

## Orden y esfuerzo estimado
1. Fase A (1 a 2 días de trabajo, más pruebas con emulador).
2. Fase B (2 a 3 días, más revisión de privacidad).
3. Fase C (1 día).

## Lo que necesito del dueño antes de construir
- Los WhatsApp de los agentes (uno por agente) y en qué computadora corre cada conector.
- Los grupos que cada agente puede observar.
- Aprobación explícita de la Fase B y de la retención de mensajes.
