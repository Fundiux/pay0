# E2 — ejecución paralela e integración permanente

Continuación del 2026-10-19 y 2026-10-20, sin repetir E0. La rama acumulativa parte de
`bf64cde`; los worktrees anteriores se conservan. El Lote 1 mantiene sus tres
archivos modificados y no se escribe sobre ellos.

## Responsabilidad y estado global

Entrega posterior de registro documental: DEPLOYMENT_PENDING; fuente final `898ce34`, receta/QA `2de7c45`. ZIP `6e0dffaa8af33582f09c7caa0f1a071f751cf1529e616f56e1dbd795c49224d0`, input `4f4a803363069833a5c33f7eaa828aad699c3daebf20bd079d1972b03076318b`, sólo parse/correct. NORMAL final y 63 pruebas fuente PASS; otras 63 de módulos archivados con fakes se declaran suplementarias. Entrada real del ZIP con Firestore real emulado: 33 comprobaciones documentales y ocho casos monetarios PASS, migración V2→V3 conservando correcciones privadas/versiones por actor y caché siguiente, sin proveedores ni pagos creados. Arranque y verificador canónico literal PASS: 354 endpoints, 352 referencias preservadas y dos rechazos anónimos; npm ci real ejecutado. Comparación independiente conserva 951 archivos y sólo cambia tres JS. El ZIP anterior `fb6519a8` quedó SUPERSEDED antes de publicar. [Paquete y reversión](e1-receipt-registration-package.md); aún sin autorización productiva ni publicación.

Actualización documental: el usuario confirmó expresamente las señales de guardado por el servidor y recuperación al reanalizar. Ese ciclo de corrección queda COMPLETED; no certifica toda la memoria conversacional ni voz. Nueva petición independiente: eliminar las barreras de registro previas a conciliación por confianza del importe y ejecución bancaria sin confirmar. Fuente integrada `ad0cbcb` y `7bb385f`, aún no publicada. Conserva la evidencia sin convertir flags a true, la creación pendiente de conciliación, autorización, duplicados y validación de datos; no usa saldo/comisiones ni escoge un importe contradictorio. La caché anterior se relee bajo la misma identidad documental y conserva correcciones/versiones por actor. Build NORMAL final y 61 pruebas de lectura/caché PASS. Emulador final: 93 comprobaciones de identificación, 49 de correcciones y 33 de creación canónica PASS; script final exit0, cero acciones externas. Preparación del artefacto exacto en curso. El flujo existente de IQ tras adjuntar no se modifica ni se ejerce con proveedores reales.

| Frente | Trabajo concreto | Estado y próxima verificación |
| --- | --- | --- |
| A | Diagnóstico del INTERNAL 500 y seguimiento del reporte de María | R1.5 conserva su verificación acotada de cambio de cliente/PDF/saludo. O1 publicado en chat00025-gok/ZIP9f95197e: usuario confirmó última solicitud con cliente/método/importe → último pago → cliente asociado. COMPLETED sólo esa secuencia; otros casos siguen pendientes |
| B | Voz | Delegación R1.1 publicada, sin verificación real de voz. R2 gateway pendiente de imagen/publicación. Correcciones de sesión f328eea integradas localmente, 62/62 pruebas; no publicadas ni presentadas como memoria durable |
| C | Selección de cliente y reportes canónicos | R1.5 conserva los reportes canónicos y corrige continuidad del cliente; usuario confirmó cambio, descarga PDF y saludo en producción. Recorrido verificado COMPLETED; comparaciones/Excel y cobertura general no se certifican por esa prueba |
| D | Aprendizaje supervisado e interacción | DOC parse00016-qoc/correct00005-qej y UI SSR00612-yuq publicados: usuario confirmó guardar y recuperar al reanalizar, COMPLETED sólo ese ciclo. Memoria conversacional personal pendiente funcional; reglas globales OFF, voz local. Ajuste de registro previo a conciliación integrado en 898ce34, artefacto en preparación, aún no publicado |
| E | Revisión administrativa previa y ajustes concurrentes de proveedores | Backend00008-des y administración00001-yut/00001-meq conservados por UI actual SSR00612-yuq. Usuario confirmó acceso desde Solicitudes al panel IQ/Facturama: COMPLETED sólo navegación/visibilidad. Automatización y concurrencia productiva de proveedores no certificadas |
| F | Guardas de recuperación sin reiniciar presupuesto ni reactivar terminales | Publicados; trigger y agenda ejecutándose con 20 HTTP204 y cinco HTTP200 observados, sin ERROR/5xx. Resultado de negocio aún sin certificar |
| G | Registro canónico y protección acumulativa; accesibilidad recuperada | Cuatro componentes de interfaz preservados. Navegación E/G verificada por usuario y preservada por nueva UI Hosting18cb9743dfc01c50/SSR00612-yuq; no se reconstruye ni sacrifica la capacidad anterior |
| H | Sentinel | Receptor productivo reconciliado: 22 archivos idénticos, sin rebuild. Ingesta deshabilitada, trust vacío; metadata KMS del productor pendiente por 403. No hay activación end-to-end |
| I | MAT reutiliza formularios y dominio existente | Guardas publicadas y formularios a335e195 preservados por UI actual SSR00612-yuq. Requieren sesión Firebase coincidente; no hay puente sólo Telegram. Flujo autenticado real pendiente |
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
| D1 sobre R1.5 | Commit903e031 / ZIP763134cf | DEPLOYED_NOT_VERIFIED funcionalmente: autorización específica recibida, chat00023-gaz publicado. Fuente descargada exacta, configuración/IAM y HTTP401 anónimo comprobados; baseline7aa7eb13 preservada. Gate OFF. Preserva R1.5/revocaciónOFF; typecheck/startup/21 escenarios de emulador/94 pruebas seleccionadas PASS. No completa el ciclo de aprendizaje interactivo |
| D2 revisión humana | Diagnostics00003-god / ZIPd148d084; UI00606-pep / ZIP58a69d09 | Usuario confirmó carga autenticada, pero reportó botones y alcance insuficientes. No es cierre de aprendizaje interactivo; no se probaron mutaciones reales. Fuente/configuración/IAM/HTTP y navegador anónimo PASS. BaselineUI establefd0f05e4, 171 archivos/4090726 bytes. Regresión25/26 base=candidato y límites heredados preservados. APPROVE y aplicación OFF |

## Integración de interfaz sin pérdida funcional

Continuación de aprendizaje interactivo: el usuario pidió corregir comprobantes y respuestas por texto/voz, con memoria privada para el mismo cliente o tema. TEXTO `0382fcc` y extensión `40bf096` quedaron integrados y publicados en el paquete exacto de aprendizaje personal. El guard documental `0b20ab0` mantiene lectura sin edición si el backend no aporta versión. Voz permanece integrada sólo localmente. La evidencia final y las identidades productivas están en el dossier enlazado más abajo.

Comprobantes: backend publicado con autorización exacta, input `c6fce02d`, fuente `1cad290`, ZIP `f88b88d7`. Conserva el bundle anterior y modifica sólo sus dos entradas públicas; 33 comprobaciones desde package.main y verificador canónico PASS. Verificación productiva técnica independiente `33f2ecf1`: parse00016-qoc/correct00005-qej, fuentes exactas, Run/IAM/configuración preservados y dos rechazos anónimos. Nueva UI publicada ahora en SSR00610-xed; recorrido autenticado pendiente. El candidato anterior de módulos sin entrada activa quedó SUPERSEDED.

Navegación E/G publicada: fuente `b14c4900`, input `fc45defd`, ZIP `b273a696`, Hosting `b830ace6f78b96f9`, SSR `00608-tag`; identidad/runtime y acceso anónimo verificados. Usuario confirmó que el enlace abre el panel y muestra ambos controles: COMPLETED sólo para ese recorrido. Baseline estable `83388428`, procedencia `437ffda7`; fuente previa preservada para reversión. Voz conserva pruebas locales de gateway57/57 y adaptador5/5, sin activación ni verificación de audio productivo.

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

## Estado de la entrega documental y límites de las pruebas

Interfaz documental publicada con autorización específica: Hosting `18cb9743dfc01c50`, SSR `00612-yuq`, ZIP `39e00880`. Verificación independiente PASS: recibo `690dd7f48d7ae9cac78f67b4663dcdd9dc78beb16b0f508e64acbaca96dddda7`, baseline `b51bf266e584499f417fa368792a1904a4dfc78c2a393807991d91fe37cdfdb4`. Fuente exacta, configuración/IAM conservados, cinco rutas HTTP200 y cero operaciones pendientes. Dos contadores se conciliaron sólo localmente con aprobación de raíz, sin cambios cloud. Reversión preservada y no aplicada. D sigue DEPLOYED_NOT_VERIFIED hasta confirmar guardado y relectura reales; comprobación ya solicitada al usuario.

O1: el usuario confirmó última solicitud con cliente/método/importe → último pago → cliente asociado. COMPLETED sólo para esa secuencia. No se certifican por extensión el retorno posterior a solicitud, los demás casos bancarios ni la ubicación del lector. Las notas siguientes conservan el historial de preparación; sus estados anteriores quedan sustituidos por esta entrega y esta confirmación.

O1 recibió autorización específica y ya está publicado como chat `00025-gok`, ZIP `9f95197e`: fuente/configuración/Run/IAM y HTTP401 sin sesión verificados independientemente, gate supervisado OFF. Recibo `0dec3529`, baseline `d3ac299f`; DEPLOYED_NOT_VERIFIED hasta prueba real de solicitud/pago/cliente/PPD-PUE/ubicación de comprobantes. La UI de confirmación documental terminó su paquete exacto separado `28924fbb`/ZIP `39e00880`/input `4f6a110d`, root revisó su proof `292cf193`; DEPLOYMENT_PENDING, aún sin autorización ni publicación. La nota de preparación O1 siguiente conserva el historial previo y queda sustituida por estas revisiones publicadas.

Nueva evidencia funcional del usuario: confusión de solicitudes/pagos, bancos presentados al pedir clientes y confirmación documental incierta. No verifica aprendizaje ni se considera resuelto en producción. [Reparación O1](e1-operational-identity-repair.md): backend `6ab526d`/ZIP `9f95197e`/input `0e95643a`, DEPLOYMENT_PENDING; 14 pruebas de diálogo/formato, 66 regresiones seleccionadas y ocho de persistencia real del ZIP PASS. Build NORMAL final, seis emisores exactos y siete pruebas de frontera PASS; verificador canónico y preflight sin deriva PASS. Conserva 792 archivos y el resumen de comprobante exclusivo de producción. Dos fallos heredados universales fuera del flujo siguen declarados. UI documental `65accf` (12 pruebas y Next47 PASS) se prepara en paquete independiente; su build aislado `28924fb` sigue en curso, sin publicación. A/C requieren esta corrección adicional; D continúa DEPLOYED_NOT_VERIFIED; B local, E/G navegación verificada, F/H/I pendientes funcionales, J sin envíos y K con control de artefactos.

Paquete de aprendizaje personal publicado con autorización específica, DEPLOYED_NOT_VERIFIED: [identidades, pruebas y reversión](e1-personal-learning-publication-package.md). Lectores/review `00003-faq`/`00003-jur`, chat `00024-noh`, productor `00003-miz`: fuentes exactas, configuración/Run/IAM y anónimos 401 verificados independientemente; gate supervisado OFF. Hosting `22d8f9eff1f18abe`/SSR `00610-xed`, ejecutor RELEASE_VERIFIED y comprobación independiente de interfaz PASS. Falta el ciclo autenticado de corrección/recuerdo/retiro y comprobante/relectura. Tres ZIP Functions y UI exacta probados antes de publicar, dos overrides QA declarados. ZIP MEMORY sin archivo de entorno heredado, candidatos anteriores SUPERSEDED. VOICE `f328eea` conserva 62/62 pruebas locales y queda fuera de producción.

La extensión `40bf096` añade notas personales CLIENT sin modificar texto financiero ni archivo canónico. Pasaron nueve pruebas de emulador, diez de ámbito, 69 regresiones, quince grupos UI y builds Functions/Next (47 rutas). Los artefactos exactos se certificaron separadamente, recibieron autorización específica y ya están publicados; la prueba funcional real sigue pendiente.

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
