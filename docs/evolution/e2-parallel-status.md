# E2 — ejecución paralela e integración permanente

Continuación del 2026-10-19, sin repetir E0. La rama acumulativa parte de
`bf64cde`; los worktrees anteriores se conservan. El Lote 1 mantiene sus tres
archivos modificados y no se escribe sobre ellos.

## Responsabilidad y estado global

| Frente | Trabajo concreto | Estado y próxima verificación |
| --- | --- | --- |
| A | Diagnóstico del INTERNAL 500 y seguimiento del reporte de María | R1.5 publicado, chat 00022-nev, ZIP45e8233d; fuente/configuración/IAM verificados. Usuario confirmó cambio de cliente, PDF y saludo: COMPLETED para ese recorrido. D sigue independiente |
| B | Voz | Delegación R1.1 publicada, sin verificación real de voz. R2 gateway mantiene sus pruebas, pendiente de imagen y publicación independiente |
| C | Selección de cliente y reportes canónicos | R1.5 conserva los reportes canónicos y corrige continuidad del cliente; usuario confirmó cambio, descarga PDF y saludo en producción. Recorrido verificado COMPLETED; comparaciones/Excel y cobertura general no se certifican por esa prueba |
| D | Aprendizaje supervisado e interacción | Consulta/revocación publicada: review00001-sil, diagnostics00003-god, SSR00606-pep/Hosting4d9ffe161d463f87. Usuario confirmó carga del panel, pero interacción insuficiente. D1chat903e031/ZIP763134cf publicado en 00023-gaz; fuente/configuración/IAM y rechazo anónimo verificados: DEPLOYED_NOT_VERIFIED funcionalmente. Aprobación/aplicación OFF. Equipos de texto, comprobantes y voz desarrollan corrección interactiva sobre capacidades existentes |
| E | Revisión administrativa previa y ajustes concurrentes de proveedores | Proveedores backend00008-des y administración00001-yut/00001-meq conservados en UI D2 actual SSR00606-pep/Hosting4d9ffe161d463f87. Fuente/IAM y cinco rutas HTTP200 comprobados; interacción autenticada de proveedores pendiente |
| F | Guardas de recuperación sin reiniciar presupuesto ni reactivar terminales | Publicados; trigger y agenda ejecutándose con 20 HTTP204 y cinco HTTP200 observados, sin ERROR/5xx. Resultado de negocio aún sin certificar |
| G | Registro canónico y protección acumulativa; accesibilidad recuperada | 4 componentes de interfaz integrados con pruebas de navegador, preservando acciones existentes |
| H | Sentinel | Receptor productivo reconciliado: 22 archivos idénticos, sin rebuild. Ingesta deshabilitada, trust vacío; metadata KMS del productor pendiente por 403. No hay activación end-to-end |
| I | MAT reutiliza formularios y dominio existente | Guardas publicadas y formularios a335e195 preservados por UI D2 a2cf5d1/SSR00606-pep. Requieren sesión Firebase coincidente; no hay puente sólo Telegram. Flujo autenticado real pendiente |
| J | Transporte Telegram, sesiones MAT y consumidor WhatsApp | HMAC probado con claves sintéticas, sin envíos reales. Consumidor QR recuperado en cuarentena: tres fallos de aislamiento reproducidos offline; requiere vínculo autorizado sesión→root antes de reactivación |
| K | Homologación de artefactos y evaluación Next 16 aislada | Cierre transitivo y aislamiento real de módulos integrados; 28 pruebas del nuevo control PASS. Next 16 sigue aislado; producción permanece en Next 15 |

## Paquetes y estados de entrega

| Paquete | Identidad | Estado |
| --- | --- | --- |
| R1 | Revisiones chat 00016-zop y voz 00009-mez | Sustituido por R1.1 para corregir la incidencia reportada |
| R1.1 | Parche `ac002ad`; chat 00017-nup, voz 00010-caj | Publicado; conversación aportada sin 500. R1 funcionalmente incompleto; voz no verificada |
| R1.2 | Commit f1ee85b; chat 00018-sav | Sustituido por R1.3; fuente anterior preservada para reversión |
| R1.3 | Backend 0b17cfc / ZIP a33ed9ba; UI 13620b7 / ZIP 12fcc181 | Backend sustituido por R2; capacidades UI conservadas por admin/MAT. La prueba del usuario reveló una solicitud sin «cliente» que no genera PDF; no se declara cierre funcional |
| GHK1 | Parche `eae9d01`; revisión 00007-yah | Publicado y confirmado por usuario para solicitudes/pagos; verificación limitada a esos flujos |
| UI preservada | Integración `327bf1b`; copia de entrega `9e6b823` sobre fuente anterior `6309830` | Build acumulativo aprobado; candidato aislado excluido de publicación al detectar nueva versión productiva concurrente |
| E: proveedores concurrentes | Backend `8e9487b`; UI `a334817` | DEPLOYED_NOT_VERIFIED; publicación original 00008-des / 00600-hak / 9f48281b2df63e67, conservada por la UI admin/MAT actual. Interacción autenticada pendiente |
| E/I administración y MAT | Fuente a335e195; SSR ZIP f0e47ff8, Functions ZIP 6624acac | DEPLOYED_NOT_VERIFIED: Functions00001-yut/00001-meq conservadas; UI original00604-hov/a340678f44840641 sustituida y preservada funcionalmente por D2 actual00606-pep/4d9ffe161d463f87. Fuentes/configuración/IAM y rutas comprobados; falta interacción autorizada. Conserva PDF/XLSX y proveedores |
| F: workers de recuperación | Guarda `5b0db91`; queue 00007-dov, reconcile 00008-xim | DEPLOYED_NOT_VERIFIED; artefactos, runtime, trigger, agenda e IAM verificados; sin prueba financiera fabricada |
| MAT: aislamiento y sesión | User 00016-bel, client 00016-cew, session 00017-fur | DEPLOYED_NOT_VERIFIED; publicación autorizada, configuración e INVALID_ARGUMENT sin scope comprobados; flujo autenticado pendiente |
| R2 gateway | Fuente `0a783d0`, ZIP `049e1ab1417551dfa52b0f01c37f2994768e3fe322698dd90b344dd66983be9c` | Fuente probada; no hay imagen ni autorización productiva |
| R2 reportes | Commit 9204e90 / ZIP 83baf34e | Publicado como 00020-faf, ahora sustituido y conservado por R1.4. Comparaciones y descarga requieren verificación autenticada |
| R1.4 lenguaje natural | Commit 2b10b0e; ZIP 21922d59, revisión 00021-koz | SUPERSEDED por R1.5 tras detectar el cambio de cliente incorrecto. Fuente y configuración preservadas para reversión; cierre del recorrido acreditado por R1.5 |
| R1.5 cambio de cliente | Commit 397035c / ZIP 45e8233d, revisión00022-nev | COMPLETED para cambio de cliente, descarga PDF y saludo, confirmado por usuario tras publicación autorizada. Identidad/configuración/IAM y rechazo anónimo verificados, sin reversión. Typecheck/startup/emulador PASS; 97/97 integración y artefacto76/78 con dos fallos previos sin uso en esta ruta |
| D1 sobre R2 | Commit 21eba53 / ZIP 55c5c45a | SUPERSEDED; fuente y pruebas preservadas. El creador actual de review lo rechaza; no usarlo para actualizar chat |
| D1 sobre R1.4 | Commit f7ec59d / ZIP a6f29085 | SUPERSEDED por d26d856/ZIPc9a64571, que incorpora revocación autorizada con gate OFF. Fuente y pruebas anteriores preservadas |
| D1 revocación OFF | Commit d26d856 / ZIP c9a64571 | DEPLOYED_NOT_VERIFIED: review00001-sil, sourcec9/gatefalse, configuración/IAM y HTTP401 anónimo verificados; sin revocaciones reales de prueba. Una consulta401 durante polling se reconcilió por operación conocida y resume propio exit0, sin repetir CREATE. No habilita APPROVE ni aplicación |
| D1 sobre R1.5 | Commit903e031 / ZIP763134cf | DEPLOYMENT_PENDING: inputdb486712 contra baselinec2a4b6cd, preflightGET sin deriva. Preserva R1.5/revocaciónOFF, typecheck/startup/21 emuladores/94 pruebas seleccionadas PASS. Autorización separada solicitada; no incluido en la entrega de consulta/revocación, sin publicación ni activación |
| D2 revisión humana | Diagnostics00003-god / ZIPd148d084; UI00606-pep / ZIP58a69d09 | DEPLOYED_NOT_VERIFIED para consulta: tres ejecutores completados, fuente/configuración/IAM/HTTP y navegador anónimo PASS, cero operaciones activas. BaselineUI establefd0f05e4, 171 archivos/4090726 bytes. Panel autenticado pendiente; no se probaron mutaciones reales. Regresión25/26 base=candidato y límites heredados preservados. APPROVE y aplicación OFF |

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
