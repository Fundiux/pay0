# Auditoría READ de superadmin para Hugo

Estado: corrección local; no desplegada. `00016-kih` permanece sin tráfico general y `00014-lur` conserva 100%.

## Evidencia de la conversación

Cloud Logging identificó la sesión `rtc_u1_ES7fip3oMlbeD7EQCAxDM0J4qIhxn8Xg` en `00014-lur`. El ledger conserva `turnId`, `responseId`, `toolCallId/delegationId`, tool, root, rol y resultado, pero esa sesión no persistió transcript. Por ello la reconstrucción textual sólo puede ser temática, usando las preguntas suministradas por Eliut, y no una cita literal.

Todas las delegaciones registraron `role=superadmin`, el root EBASOR, `result=OK` y ruta `DETERMINISTIC_TOOL`. No hubo `PERMISSION_DENIED`. Los casos negativos observados fueron: intención ambigua para “último movimiento”; usuario no resuelto para la referencia fonética; resultado vacío; ASSETS no conectado; y ausencia de tools para última solicitud/pago por usuario subordinado. Ninguno demostraba falta de permiso.

## Arquitectura de root

La lectura agregada de producción encontró un solo root en las colecciones pobladas auditadas: 13 usuarios, 67 clientes, 475 solicitudes, 188 pagos, 73 expedientes de materialidad, 17 solicitudes de complemento y 78 aplicaciones de pago. De los 67 clientes, 66 tienen `active === true`, uno tiene `active === false` y ninguno carece del campo. La prueba anterior había observado 65 activos; desde entonces existe un alta activa y dos actualizaciones, por lo que el conteo activo vigente es 66, sin incluir el inactivo. No se abre acceso cross-root ni se introduce `globalSuperadmin`.

## Política efectiva

| Rol | Root | Módulos | Asignación/delegación para READ | WRITE/EXECUTE |
| --- | --- | --- | --- | --- |
| superadmin | obligatorio, mismo root | política canónica; todos los view activos | no requerida para PAY0 dentro del root | conserva gates específicos |
| admin | obligatorio | obligatorio | requerida según cliente/jerarquía/delegación | conserva gates |
| operador | obligatorio | obligatorio | requerida según scope operativo/delegación | conserva gates |

`resolveClientOperationalAccess` ya concede al superadmin el cliente activo del mismo root antes de revisar ownership o delegación. `Pay0Connector` lee solicitudes, pagos y complementos por `rootId`, no por asignación personal. `PlatformReadConnector.isUserVisibleToCaller` permite al superadmin cualquier usuario del mismo root. Estos filtros son correctos: rootId, estado activo cuando aplica y conectividad/capability. Los filtros de ownership, adminId, operadorId, managedByUserId y delegación sólo deben limitar admin/operador.

Hugo aún no tiene tools READ para todas las entidades PAY0. Beneficiarios, dispersiones, documentos/materialidad, instrumentos, reportes y actividad requieren conectores explícitos antes de poder consultarse por voz. Esa ausencia debe expresarse como capacidad no conectada, nunca como denegación.

## Corrección local

Se añaden tools READ para la última solicitud y el último pago del scope operativo de un usuario visible. La identidad objetivo se resuelve sólo entre usuarios del mismo root visibles al actor; después se calcula el scope del usuario objetivo sin reducir el scope de lectura del superadmin. También se explica explícitamente que READ completo dentro del root no concede escrituras, operaciones financieras ni acceso a ASSETS/TTT.

No se modificaron reglas, índices, Materialidad, documentos, descargas autorizadas, IAM ni Hosting/SSR. Admin y operador no reciben capacidades nuevas ni ampliación de scope.
