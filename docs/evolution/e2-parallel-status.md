# E2 — ejecución paralela e integración permanente

Continuación del 2026-10-19, sin repetir E0. La rama acumulativa parte de
`bf64cde`; los worktrees anteriores se conservan. El Lote 1 mantiene sus tres
archivos modificados y no se escribe sobre ellos.

## Responsabilidad y estado global

| Frente | Trabajo concreto | Estado y próxima verificación |
| --- | --- | --- |
| A | Diagnóstico del INTERNAL 500 y seguimiento del reporte de María | R1.2 devuelve reporte real con nombre simple; usuario detectó bucle ante saludos y puntuación. R1.3 asignado sin detener otros frentes |
| B | Chat/voz y entrega de resultados | XLSX en paquete UI; R1.3 añade selección de formato y PDF solicitados por el usuario. Voz y gateway conservan paquetes independientes |
| C | Selección de cliente y reportes canónicos | R1.2 backend publicado; resuelve cliente autorizado antes del recorte, ambigüedad y ausencia no generan archivo. XLSX pendiente de interfaz |
| D | Regla supervisada persistida y enlazada al Core, commit `5d07dc0` | 7 pruebas de emulador + 50 regresiones; aprobación/revocación y gate apagado; no publicado |
| E | Revisión administrativa previa y ajustes concurrentes de proveedores | Paquete independiente de proveedores a334817: build, runtime, cinco rutas y componentes PASS, autorización solicitada. Revisión administrativa endurecida y compilada, aún sin publicar |
| F | Guardas de recuperación sin reiniciar presupuesto ni reactivar terminales | Publicados; trigger y agenda ejecutándose con 20 HTTP204 y cinco HTTP200 observados, sin ERROR/5xx. Resultado de negocio aún sin certificar |
| G | Registro canónico y protección acumulativa; accesibilidad recuperada | 4 componentes de interfaz integrados con pruebas de navegador, preservando acciones existentes |
| H | Descargas autorizadas ligadas a generación Storage exacta | GHK1 publicado; usuario confirma descargas en solicitudes y pagos, sin certificar otros módulos |
| I | MAT reutiliza formularios y dominio existente | Guardas publicadas; fix del provider integrado y compilado con cinco pruebas UI. Formularios requieren sesión Firebase coincidente; no hay puente sólo Telegram |
| J | Transporte Telegram y sesiones MAT | Autenticación HMAC real probada con claves sintéticas; sin envíos reales. Consumidor QR sigue sin localizar |
| K | Homologación de artefactos y evaluación Next 16 aislada | Cierre transitivo y aislamiento real de módulos integrados; 28 pruebas del nuevo control PASS. Next 16 sigue aislado; producción permanece en Next 15 |

## Paquetes y estados de entrega

| Paquete | Identidad | Estado |
| --- | --- | --- |
| R1 | Revisiones chat 00016-zop y voz 00009-mez | Sustituido por R1.1 para corregir la incidencia reportada |
| R1.1 | Parche `ac002ad`; chat 00017-nup, voz 00010-caj | Publicado; conversación aportada sin 500. R1 funcionalmente incompleto; voz no verificada |
| R1.2 | Commit f1ee85b; chat 00018-sav | Reporte en texto confirmado con nombre simple; flujo completo incompleto y XLSX aún sin publicar. R1.3 corrige conversación/puntuación y añade formato PDF |
| GHK1 | Parche `eae9d01`; revisión 00007-yah | Publicado y confirmado por usuario para solicitudes/pagos; verificación limitada a esos flujos |
| UI preservada | Integración `327bf1b`; copia de entrega `9e6b823` sobre fuente anterior `6309830` | Build acumulativo aprobado; candidato aislado excluido de publicación al detectar nueva versión productiva concurrente |
| E: proveedores concurrentes | Backend `8e9487b`; UI `a334817` | Paquete exacto y preflight fresco PASS; autorización específica solicitada, independiente de R1.3 |
| E/F/I mínimo | Revisión administrativa y MAT de `a280e72` | Contrato preparado; no equivale a ZIP desplegable ni a publicación |
| F: workers de recuperación | Guarda `5b0db91`; queue 00007-dov, reconcile 00008-xim | DEPLOYED_NOT_VERIFIED; artefactos, runtime, trigger, agenda e IAM verificados; sin prueba financiera fabricada |
| MAT: aislamiento y sesión | User 00016-bel, client 00016-cew, session 00017-fur | DEPLOYED_NOT_VERIFIED; publicación autorizada, configuración e INVALID_ARGUMENT sin scope comprobados; flujo autenticado pendiente |
| R2 gateway | Fuente `0a783d0`, ZIP `049e1ab1417551dfa52b0f01c37f2994768e3fe322698dd90b344dd66983be9c` | Fuente probada; no hay imagen ni autorización productiva |

## Integración de interfaz sin pérdida funcional

Se reutilizaron los cambios revisados de Modal, UiSelect y DateScopeBar del
Lote 1. Para Clientes se recuperó la confirmación de `5d1f21d`, anterior a la
retirada del control de reparación. Se conservaron ese control, los servicios
actuales, callbacks y comprobaciones de acceso.

El paquete previamente preparado `c1738b4` no se trató como equivalente:
elimina un control presente en la fuente productiva anterior. La copia
aislada de entrega parte de la fuente identificada `6309830` y sólo
cambia cuatro archivos UI. Su referencia local `main` es ese anclaje de
producción, no la rama main del repositorio acumulativo. No se hizo merge ni
reescritura de historia del repositorio acumulativo.

Una consulta posterior detectó que otra línea publicó `c1738b4`: Hosting
`3beebe572c91f420`, SSR `ssrpay0system-00598-vuq`, el 2026-10-19 a las
12:09:39 de Ciudad de México. El ZIP leído del Storage productivo coincide con
`fe97daf3df3f395d3812125fc8d4b0906c55a513cc68c80f2f9a4f05bce74a2f`.
Los tres componentes compartidos ya están en esa publicación; su uso real
autenticado no fue verificado por esta operación. No se debe publicar el
candidato anterior ni revertir la retirada del control desde esta línea sin
reconciliar esa decisión. Se conserva el trabajo local, sin sobrescribir la
publicación externa ni su worktree.

## Límites de las pruebas

Los builds de frontend y Functions pasan. Las pruebas en emulador usan datos
sintéticos, sin proveedores ni operaciones financieras reales. Las pruebas
de persistencia R1.1 utilizan el validador real de Firestore y un commit
sustituido para impedir RPC. Las de descarga utilizan firma criptográfica y
SDK reales con datos sintéticos.

Una capacidad integrada o un ZIP probado no se declara COMPLETED. Cada
publicación exige aprobación de su alcance y hashes, preflight fresco,
verificación de configuración y prueba funcional real posterior. Un bloqueo
de autorización, sesión o proveedor se registra por paquete y no paraliza
las demás líneas.
