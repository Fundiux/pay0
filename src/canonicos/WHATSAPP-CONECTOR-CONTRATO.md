# Contrato de alcance — conector WhatsApp

Cada documento de `whatsappQrChats` pertenece a una sola raíz operativa. El
conector debe guardar estos campos al procesar un comando `SYNC_CHATS`:

| Campo | Regla |
| --- | --- |
| `rootId` | Copia exacta del `rootId` del documento `whatsappQrConnectorCommands`. Obligatorio. |
| `connectorId` | `default` mientras exista un solo conector autorizado. |
| `chatId` | Identificador original del chat en el conector. |
| `safeDocId` | Identificador estable usado por PAY0 para rutas y entregas. |
| `lastSyncedAt` | Marca de tiempo de la sincronización. |
| `active` | `true` sólo si el destino se puede seleccionar. |

## Reglas de seguridad

- PAY0 nunca muestra ni acepta un chat cuyo `rootId` difiera de la raíz del
  usuario autorizado.
- Un chat histórico sin `rootId` queda oculto; no se infiere su propietario.
- Una sincronización para una raíz no puede sobrescribir el documento de un
  chat que ya esté asignado a otra raíz. Debe crear una colisión visible para
  revisión de superadmin.
- Las rutas y los jobs ya incluyen `rootId`; el conector no decide permisos ni
  puede cambiar el alcance de una ruta existente.

## Resultado esperado

Después de sincronizar, el superadmin de la raíz solicitante ve únicamente sus
contactos/grupos y puede asignarlos a clientes de esa misma raíz. Si no hay
chats con alcance asignado, PAY0 debe indicar que se requiere una sincronización
del conector, sin exponer los chats globales históricos.
