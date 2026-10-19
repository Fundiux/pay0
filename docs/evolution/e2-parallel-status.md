# E2 — ejecución paralela e integración permanente

Continuación del 2026-10-19, sin repetir E0. La rama acumulativa parte de
`bf64cde`; los worktrees anteriores se conservan. El Lote 1 mantiene sus tres
archivos modificados y no se escribe sobre ellos.

## Responsabilidad y estado global

| Frente | Trabajo concreto | Estado y próxima verificación |
| --- | --- | --- |
| A | Diagnóstico del INTERNAL 500 y seguimiento del reporte de María | R1.4 publicado, chat 00021-koz. Usuario llegó a tarjeta PDF; al cambiar de cliente repite el anterior o pide folio. Reproducido en emulador con dos clientes sintéticos; R1.5 en reparación, sin detener D |
| B | Voz | Delegación R1.1 publicada, sin verificación real de voz. R2 gateway mantiene sus pruebas, pendiente de imagen y publicación independiente |
| C | Selección de cliente y reportes canónicos | UI PDF/XLSX conservada; tarjeta PDF confirmada por usuario, descarga y saludo no confirmados. Cambio de cliente incorrecto en R1.4: corrección R1.5 y prueba real pendientes. No se declara COMPLETED |
| D | Regla supervisada persistida y enlazada al Core | D1 sobre R2 probado; composición sobre R1.4 en validación para preservar el nuevo diálogo. Gate OFF. D2 diagnostics tiene overlay aislado d148d084, siete pruebas de emulador y regresión sin fallos nuevos; controlador exclusivo probado. UI D2 aislada con build PASS. Falta publicar endpoint de revisión, diagnósticos e interfaz; no hay aprendizaje activado |
| E | Revisión administrativa previa y ajustes concurrentes de proveedores | Backend de proveedores 00008-des conservado. Administración/MAT a335e195 publicado con autorización: listOperationRecoveryReviews 00001-yut, acknowledgeOperationRecoveryReview 00001-meq, SSR 00604-hov y Hosting a340678f44840641. Fuente/IAM y cinco rutas HTTP200 comprobados; interacción autenticada pendiente |
| F | Guardas de recuperación sin reiniciar presupuesto ni reactivar terminales | Publicados; trigger y agenda ejecutándose con 20 HTTP204 y cinco HTTP200 observados, sin ERROR/5xx. Resultado de negocio aún sin certificar |
| G | Registro canónico y protección acumulativa; accesibilidad recuperada | 4 componentes de interfaz integrados con pruebas de navegador, preservando acciones existentes |
| H | Sentinel | Receptor productivo reconciliado: 22 archivos idénticos, sin rebuild. Ingesta deshabilitada, trust vacío; metadata KMS del productor pendiente por 403. No hay activación end-to-end |
| I | MAT reutiliza formularios y dominio existente | Guardas y UI a335e195 publicadas con autorización; conserva R1.3 y proveedores. Formularios requieren sesión Firebase coincidente; no hay puente sólo Telegram. Flujo autenticado real pendiente |
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
| E/I administración y MAT | Fuente a335e195; SSR ZIP f0e47ff8, Functions ZIP 6624acac | DEPLOYED_NOT_VERIFIED: autorización recibida y publicación exitosa de dos Functions y UI. Revisiones 00001-yut/00001-meq, SSR 00604-hov, Hosting a340678f44840641. Fuente, configuración, IAM, rechazo anónimo y cinco rutas comprobados; falta interacción autorizada. Conserva PDF/XLSX R1.3 y proveedores |
| F: workers de recuperación | Guarda `5b0db91`; queue 00007-dov, reconcile 00008-xim | DEPLOYED_NOT_VERIFIED; artefactos, runtime, trigger, agenda e IAM verificados; sin prueba financiera fabricada |
| MAT: aislamiento y sesión | User 00016-bel, client 00016-cew, session 00017-fur | DEPLOYED_NOT_VERIFIED; publicación autorizada, configuración e INVALID_ARGUMENT sin scope comprobados; flujo autenticado pendiente |
| R2 gateway | Fuente `0a783d0`, ZIP `049e1ab1417551dfa52b0f01c37f2994768e3fe322698dd90b344dd66983be9c` | Fuente probada; no hay imagen ni autorización productiva |
| R2 reportes | Commit 9204e90 / ZIP 83baf34e | Publicado como 00020-faf, ahora sustituido y conservado por R1.4. Comparaciones y descarga requieren verificación autenticada |
| R1.4 lenguaje natural | Commit 2b10b0e; ZIP 21922d59, revisión 00021-koz | Publicado, verificación funcional parcial: usuario llegó a tarjeta PDF; cambio de cliente falló y se reprodujo en emulador. Descarga/saludo pendientes. No completado; R1.5 en desarrollo sin autorización productiva |
| D1 sobre R2 | Commit 21eba53 / ZIP 55c5c45a | Candidato anterior conservado como procedencia del endpoint de revisión; para actualizar chat lo sustituye D1 sobre R1.4, evitando perder el diálogo natural |
| D1 sobre R1.4 | Commit f7ec59d / ZIP a6f29085 | LOCAL_CANDIDATE_TESTED_NOT_DEPLOY_READY. Conserva R1.4/R2; 21 escenarios de emulador, 74 pruebas seleccionadas, arranque y typecheck PASS, revisión independiente sin bloqueos. R1.4 ya publicado y baseline 3e9d6b42 disponible; input D1 en preparación, sin autorización ni publicación. Gate OFF |
| D2 revisión humana | Diagnóstico base 00002-pin / ZIP c50f0d7a; candidato d148d084 | Plan local preparado: input f58c9ef8, plan 351714d6, revisión independiente PASS. Startup 341 exports, siete casos de emulador y comparación base/candidato 25/26 sin fallos nuevos. UI a2cf5d1: ZIP58a69d09, runtime/cinco rutas/componentes PASS, proof c0dbca56 con override QA explícito. Sin autorización ni publicación. Con gate OFF no se habilitan revisión ni aprendizaje |

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
