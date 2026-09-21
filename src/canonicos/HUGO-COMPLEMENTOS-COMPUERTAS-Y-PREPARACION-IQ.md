# Complementos de Hugo: compuertas y preparación de consulta IQ

Estado: parte 3 implementada y parte 4 preparada hasta la frontera de consulta externa. Sin despliegue ni llamadas reales a IQ. Lectura local: 2026-09-21.

## Capacidades separadas

| Capacidad | Política | Efecto |
| --- | --- | --- |
| A. Detectar e inventariar | Autorización de lectura y ámbito root del inventario | Lee y clasifica aun si B o C están pausadas. No reserva cuota ni crea un job. |
| B. Consultar o recuperar REP existente | Master IQ activo, `iqLookupEnabled`, root, actor, acceso de cliente, acceso y perfil IQ vigentes; cuota `iqLookupDailyLimit` por root/perfil/día | Permite sesión, consulta y descarga. Cada solicitud de red vuelve a comprobar la compuerta. Por defecto, 25 reservas diarias; 0 bloquea. |
| C. Solicitar generación de REP | Todo lo exigido por B, más `iqEnabled`, `iqRequestEnabled`, flujo `automation.aplicacionPagos` activo, permiso IQ `create` y cuota `iqRequestDailyLimit` independiente | Permite POST sólo tras preflight que no encuentre REP y después de reservar cuota. Por defecto, 5 reservas diarias; 0 bloquea. |

La configuración por root vive en `paymentComplementConfigs/{rootId}`; el Master en `iqIntegrationConfigs/{rootId}`. Ausencia de configuración, Master apagado, pérdida de acceso, perfil cambiado o desactivado, root ajeno y cuota agotada bloquean una nueva acción externa. Las reservas son transaccionales y las decisiones se registran en el job y en `activityLog` con acción y motivo. Los jobs prospectivos pueden quedar `PAUSED` y el scheduler los reevalúa; un envío incierto sigue sin repetirse. La autenticación IQ también cuenta como acción externa: la reserva de cuota ocurre antes de abrir sesión.

El inventario histórico conserva lectura cuando B o C están cerradas y muestra `GATE_BLOCKED` con el motivo. Apagar C deja habilitada B. El control existente de seguimiento representa nuevas solicitudes IQ; no se añadió un control manual para recuperar REP. La configuración del callable conserva los campos independientes de consulta y cuota al cambiar ese control.

## Cinco casos pendientes: evidencia estrictamente local

El planificador `assessLocalIqRecovery` comprueba aplicación PPD, padres, seguimiento, UUID, parcialidad, importes y saldos, plan, intento, depósito, perfil, actor y compuerta B. No escribe, no reserva cuota y no abre sesión IQ. La lectura de 2026-09-21 clasificó:

| Aplicación / solicitud / pago | Resultado local | Próximo paso permitido |
| --- | --- | --- |
| AP2C4U1E6 / S42C4U1E6 / P14C4U1E6 | `READY_FOR_IQ_LOOKUP` | Candidata a B |
| AP4C4U1E6 / S40C4U1E6 / P12C4U1E6 | `READY_FOR_IQ_LOOKUP` | Candidata a B |
| AP3C4U1E6 / S41C4U1E6 / P13C4U1E6 | `READY_FOR_IQ_LOOKUP` | Candidata a B |
| AP1C4U1E6 / S39C4U1E6 / P15C4U1E6 | `READY_FOR_IQ_LOOKUP` | Candidata a B |
| AP1C6U1E2 / S8C6U1E2 / P5C6U1E2 | `WAITING_IQ_APPLICATION` | Bloqueada hasta evidencia local suficiente de aplicación IQ |

La clasificación es una foto local, no afirma que IQ ya tenga o no tenga un REP. Debe recalcularse antes de actuar porque las compuertas y expedientes pueden cambiar.

## Frontera de la parte 4

Para cada uno de los cuatro candidatos, Hugo releerá evidencia y compuertas, reservará cuota B por root/perfil/día y abrirá sesión con IQ. La **primera llamada externa** será la autenticación `POST /users/sessions` de IQ; después hará el GET de consulta del depósito para comprobar si existe un REP, y sólo si IQ devuelve una ubicación válida procederá a la consulta/descarga del ZIP, validación XML/PDF y vinculación por parcialidad. Si IQ no ofrece REP, registrará pendiente y siguiente revisión, sin afirmar que está emitido. Ninguno de estos cuatro autoriza por sí solo el POST de generación C.

Antes de esa primera llamada real faltan autorización explícita para desplegar el código y ejecutar un canario de lectura IQ en producción, selección de cohorte y límites, y una nueva comprobación local de evidencia, perfil, permisos, Master y cuota. La generación histórica C requiere decisión y autorización separadas. El caso `WAITING_IQ_APPLICATION` no entra en el canario hasta que una aplicación IQ confirmada y su evidencia coherente permitan reclasificarlo.

## Verificación

El emulador cubre Master, interruptores B/C, flujo de aplicaciones, actor, permisos, root, perfil ausente/cambiado, cuota cero y concurrente, pausa durante sesión, inventario durante pausa y B habilitada con C apagada. Todos los proveedores son simulados y la prueba prohíbe red externa. La prueba de automatización existente comprueba idempotencia, incertidumbre, parcialidades y recepción documental. Builds y verificador de autorización acompañan el cambio. No se realizaron llamadas reales a IQ ni despliegue.
