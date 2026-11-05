# Conector de WhatsApp enrolado por servidor: procedimiento

Estado: **escrito, no ejecutado ni probado contra WhatsApp ni contra producción.** Nada de lo de abajo se
corre solo; lo ejecuta el dueño, presente, y la ejecución sobre producción la coordina la sesión
coordinadora. No hay tareas programadas registradas ni secretos en el repositorio.

## Qué es y qué no es

- Es el conector que enlaza una cuenta de WhatsApp (un QR) con PAY0 mediante un vínculo (*binding*)
  controlado por el servidor: `enrolledConnector.cjs` + `workerEnrollment.cjs`. Uno por agente
  (María, Sofía, Sentinel, etc.) o el vínculo heredado `pay0` del dueño.
- **No** es el conector heredado `connector.cjs` (el que respondía `@Hugo`). Ese **no puede reanudar**:
  faltan `%LOCALAPPDATA%\PAY0\WhatsAppConnector\auth\` y `control\session-config.json`, y su estado es
  `STARTUP_ERROR / PRESERVED_SESSION_CONFIG_REQUIRED` desde el 2026-10-31. Cualquier cuenta
  requiere un **escaneo de QR nuevo**. El conector enrolado descarta los mensajes entrantes salvo que se
  active `captureGroups` (ver más abajo); no responde `@Hugo`.
- **La cuenta/QR de cada agente la decide el dueño antes del primer arranque.** No se enrola nada hasta
  que lo indique.

## Prerrequisitos (verificar en la PC antes de empezar)

1. Windows con el usuario del dueño (la bóveda usa DPAPI del usuario actual: otro usuario o equipo no
   puede leer la llave).
2. Node 22 (`C:\nvm4w\nodejs\node.exe`) y **Python 3.12 o superior** (`privateVault.py` usa `Path.is_junction`).
   Anotar la ruta absoluta de `python.exe`.
3. Chrome o Chromium instalado; anotar la ruta absoluta (`C:\Program Files\Google\Chrome\Application\chrome.exe`).
4. **Dependencias de WhatsApp: hoy no están instaladas en esta PC.** `whatsapp-web.js` no aparece en el
   `package.json` raíz ni en `node_modules`; `qrcode` solo existe en `functions/node_modules` (1.5.4). Hay
   que instalarlas en una carpeta propia del conector, por ejemplo
   `%LOCALAPPDATA%\PAY0\WhatsAppConnector\deps`, y hacer que `require` las encuentre (p. ej. `NODE_PATH`).
   La versión de `whatsapp-web.js` que se usaba antes **no está registrada**: elegir y fijar una versión
   probada antes de producción.
5. Build de Functions (`cd functions; npm ci; npm run build`): el lanzador carga la política de firma desde
   `functions/lib/modules/documentDelivery/whatsappConnectorPolicy.js` (o la ruta `policyModule` del config).
6. `baseUrl`: URL HTTPS tal que `POST <baseUrl>/<nombreDeFunción>` con cuerpo `{ "data": ... }` llegue a los
   callables `consumeWhatsAppConnectorEnrollment` y `operateWhatsAppConnector`. **No verificada**: confirmar la
   URL real de las Functions con la sesión coordinadora antes del primer uso.
7. Para `consumeWhatsAppConnectorEnrollment`/`operateWhatsAppConnector` desplegadas en producción: ya lo están
   según la sesión coordinadora; `listWhatsAppAgentConnectors` y la captura de grupos **no** (siguen pendientes).

## Archivos y rutas

Todo fuera del repositorio, bajo `%LOCALAPPDATA%\PAY0\WhatsAppConnector`:

| Qué | Ruta |
| --- | --- |
| Config (sin secretos) | `agents\<agente>\config.json` |
| Bóveda DPAPI (llave privada + vínculo) | `agents\<agente>\pay0-wa-worker-vault\worker.dpapi` (nombres obligatorios) |
| Sesión de WhatsApp | `agents\<agente>\auth\session-<bindingId>` |
| Señal de parada | `control\<agente>\stop.request` |
| Logs rotados (5 MB, 2 copias) | `logs\<agente>.stdout.log` / `.stderr.log` |

Ejemplo de `config.json` (rutas absolutas obligatorias; ningún secreto):

```json
{
  "baseUrl": "https://<url-https-de-las-functions>",
  "pythonPath": "C:\\Users\\<usuario>\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
  "vaultPath": "C:\\Users\\<usuario>\\AppData\\Local\\PAY0\\WhatsAppConnector\\agents\\maria\\pay0-wa-worker-vault\\worker.dpapi",
  "sessionRoot": "C:\\Users\\<usuario>\\AppData\\Local\\PAY0\\WhatsAppConnector\\agents\\maria\\auth",
  "executablePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "captureGroups": false
}
```

`captureGroups` es por agente y **debe seguir en `false`** hasta que `INBOUND_GROUP` esté desplegado y los
grupos observados estén configurados en `/whatsapp` (el dueño ya aprobó 30 días de retención y que los
clientes ya fueron avisados).

## Procedimiento (con el dueño presente)

Todos los comandos desde `tools\whatsapp-qr-connector`, con `$cfg` = ruta del `config.json`.

1. **Decidir cuenta y agente.** Una cuenta de WhatsApp (un QR) por agente.
2. **Generar la llave del conector** (crea la bóveda; falla si ya existe una):
   `node enrolledLauncher.cjs keygen --config $cfg`
   Imprime solo la llave **pública** (`{"protocol":"pay0-wa-worker-public-v1","publicKeyPem":"..."}`).
3. **Crear el enrolamiento** en PAY0: `/whatsapp` → «Conexión de WhatsApp por agente» → pegar la llave pública del
   agente → «Crear enrolamiento». El JSON resultante vale **10 minutos**.
4. **Consumirlo** (por stdin, nunca como argumento):
   `Get-Content -Raw transfer.json | node enrolledLauncher.cjs enroll --config $cfg`
   Resultado esperado: `{"ok":true,"bindingId":"..."}`. Borrar `transfer.json` después.
5. **Primer arranque en primer plano**, con el dueño frente a la PC y el teléfono de la cuenta a la mano:
   `node enrolledLauncher.cjs run --config $cfg`
   El QR aparece en `/whatsapp` (tarjeta del agente). Escanearlo desde WhatsApp → Dispositivos vinculados.
6. **Verificar**: la tarjeta del agente muestra estado conectado y «Última señal» reciente; la lista de contactos y
   grupos sincronizados se llena; enviar un mensaje de prueba desde otro teléfono solo si `captureGroups` está activo
   y el grupo está configurado. No tocar clientes reales en esta prueba.
7. **Arranque automático** (solo después de que el paso 6 funcione). Comando para registrar la tarea al iniciar
   sesión (documentado, **NO ejecutado**; el dueño lo corre en PowerShell, ajustando `<usuario>` y rutas):

```powershell
$script = 'C:\Users\<usuario>\Desktop\pay0-system\tools\whatsapp-qr-connector\run-pay0-whatsapp-enrolled.ps1'
$cfg = 'C:\Users\<usuario>\AppData\Local\PAY0\WhatsAppConnector\agents\maria\config.json'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Agent maria -ConfigFile `"$cfg`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'PAY0 WhatsApp maria' -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME
```

   Una tarea por agente, con su propio `-Agent` y `-ConfigFile`. Solo corre mientras el usuario tenga sesión
   iniciada: la PC debe quedar encendida, con internet y sin suspensión.

## Rollback

1. Parar: crear el archivo vacío `control\<agente>\stop.request` (el supervisor sale y no relanza).
2. Revocar el vínculo: `/whatsapp` → «Revocar conexión» (callable `revokeWhatsAppConnectorBinding`).
3. Quitar la tarea: `Unregister-ScheduledTask -TaskName 'PAY0 WhatsApp maria' -Confirm:$false`.
4. Borrar la sesión: eliminar `agents\<agente>\auth` (la cuenta se desvincula también desde el teléfono).
5. Borrar la bóveda solo si no se reutilizará la llave: carpeta `agents\<agente>\pay0-wa-worker-vault`.

## Límites conocidos

- No hay cifrado de la sesión de WhatsApp (`LocalAuth` guarda el perfil de Chrome en disco); quien tenga acceso a
  esa carpeta puede usar la sesión. Proteger la PC.
- `consume`/`operate` envían un solo intento por operación; un corte de red entre pasos puede requerir repetir el
  paso 3 (enrolamiento nuevo).
- Esta guía no sustituye una prueba real: el primer arranque debe hacerse con el dueño y con la coordinadora al tanto.
