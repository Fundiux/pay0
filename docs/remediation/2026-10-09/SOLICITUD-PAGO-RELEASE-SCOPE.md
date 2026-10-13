# Solicitud/Pago: alcance propuesto del lote 4d20b12

Estado: preparacion local, sin orden de despliegue ejecutada. Fuente de producto4d20b12a83fedc8a13c27e3bd68371df77e4cb18; HEAD documental0b50559530d334120076c2ec371bd2b8030b93ea, baseline NORMAL5704770997b7a6c59dee758f7efdba5bc8b9dc54bb4712ff674f248d4f9f3f11. Bundle nuevoae84134de00971f5d5ec6174f78f32c23fb21e7648406b95ed6b99202d9b7547; QA e instalacion local verificadas. Comparacion CLI instalada verificada; baseline remoto leido, comparacion de configuracion y guards pendientes. No incluye guard manual0eee4cf ni DELIVERY inerte.

QA del artefacto: igualdad funcional del manifiesto348 (6417b7), contexto23, artefacto619, runtime155, WASM2 y gates de lineage/deferred (1ca3d4), financiero17 en emulador (5ad758). Instalador38 PASS de1064; instalacion7357/6591b3 y verifyInstalled0cb2a3 comprobaron935 outputs y sourceSnapshot igual al baseline. Provenance instalada9cd7fa9b233c8acfac6cfddb9fc07edb10320d57fde8c68249e4ea71977882b2; journal353799f0-64b4-407c-a4fc-3d4238fec36e conserva respaldo NORMAL. Ninguna prueba financiera uso proveedor real.

Comparacion instalada52558/0e3dfd PASS:2413ms,348 endpoints, build completo d21e5d0b16393156ffe815b5f81ef2fd8465f1300acb90f6b618bc40285dbe45 identico a baseline. Root leyo resultado0d73ef; limites7s/CLI10s sin cambios. Log privado SHA93b93e678ee4b03bc60b1c0cce5e2d53f2e24b40fa7d1be98f30c366fd560bcc. Verificacion posteriorf83d8a conserva935outputs/provenance/sourceSnapshot; no llamada remota. Sustituye el pendiente CLI inicial, no la revision remota.

## Entradas que incorporan comportamiento cambiado

El diff a52959b..e79f582 (b01789) delimita once archivos backend y cinco frontend. La trazabilidad de llamadas (a71b06/32b5dc/a8183b/60e58e) y el baseline aceptado (209b1e) identifican quince entradas, todas us-central1. Es un inventario de codigo candidato, no comparacion con todas las revisiones remotas actuales.

| Grupo | Entradas | Cambio que deben recibir |
| --- | --- | --- |
| Notas y creacion | listSolicitudNotes; listClientDispersionNotes; addSolicitudNota; createSolicitud; createPago | Nuevo lector, paginacion compartida y autorizacion/escrituras atomicas de creacion |
| Aplicacion financiera manual | reservePagoApplicationBatch; applyPagoToSolicitudesAtomic; applyPagoToSolicitud | Autorizacion y contexto financiero dentro de la transaccion canonica |
| Aplicacion financiera automatica | applyPaymentAutomaticallyOnReconciliation; applyPaymentAutomaticallyOnReceipt; applyPaymentsAutomaticallyOnInvoice | Mismo servicio canonico; no basta actualizar solo sus callers manuales |
| Despacho/resultado IQ | executePagoApplicationIqPlan; processPagoApplicationIqPlanOnDemandTask; enqueuePaymentApplicationImmediately; processIqPaymentApplicationExecution | Fences de generation/hash/requester/root, resultado canonico y dispatch compartido entre manual/trigger/scheduler |

La lista contiene nueve callables, cuatro eventos Firestore, una Task y un scheduler. El consumidor Task requiere540s, scheduler300s, eventos120s y callables60s segun baseline; el resto de configuracion debe compararse completo, no inferirse de estos campos. Las funciones compartidas IQ y folio reciben un parametro transaccional opcional; sus otros callers sin ese parametro conservan la rama anterior. Revision independiente51e196 confirmo el selector y las dependencias locales, sin necesidad identificada de ampliarlo por esa adicion aislada. Esto no acredita compatibilidad de las revisiones live.

## Secuencia y condiciones de publicacion

1. Cerrar QA del artefacto exacto, instalarlo mediante el instalador revisado y verificar provenance, manifesto completo y arranque CLI del entry instalado. Una comparacion SDK funcional no sustituye este paso.
2. Crear inputs privados nuevos y guards del lote; no editar ni reutilizar como aceptado el lanzamiento Hosting61879 fallido. Leer baseline remoto actual de las quince entradas, IAM/runtime/env/secret fingerprints, colas y scheduler. Conservar pausas, limites y switches; ningun test debe ejecutar efectos financieros ni enviar mensajes reales.
3. Revisar selector exacto y plan de compatibilidad, incluyendo consumidores automaticos. Preparar recuperacion por componente que preserve correcciones de autorizacion. No reenviar operaciones de resultado incierto ni borrar endpoints/historia.
4. Desplegar componentes por lotes acotados y verificar revision, configuracion, source upload exacto e inalteracion de recursos fuera de alcance. Un endpoint nuevo requiere revisar IAM y su ausencia previa; no asumir que el estado historico prueba ausencia actual.
5. Hosting depende del backend compatible. El helper de exclusion de cache Webpack sigue inerte: antes de conectarlo exigir pruebas del empaque SSR real, igualdad del conjunto de archivos permitido y evidencia del runtime local. El ZIP remoto anterior sobrepaso limites; ni su subconjunto verificado ni el smoke publico equivalen a igualdad del artefacto completo.

Rules/indexes/Storage quedan fuera de este lote. S10, compatibilidad de lectores directos antiguos y cierre de A7B siguen abiertos. Este documento no convierte un estado preparado en integrado/desplegado/verificado.

## Baseline remoto leido y paquete local verificado

Collector privado revisado6eb03d/0322fe, root13fakes PASSabeb68. Execute24375/bb175e terminoea6328:75 lecturas,235223bytes de metadata,14funciones existentes ACTIVE/nodejs22,350 nombres regionales completos. Unico fallo esperado: listSolicitudNotes404NOT_FOUND; ausencia corroborada noatomica por GET e inventario, no garantia frente cambios posteriores. Roota8649e verifico hash y failure exacto. Evidencia privada SHAedaaa65e7ac1b4069ddb95d7ea46e1c6b2ad683b024a2872f17170d7641c773a, sin cuerpos/env/principales en logs. Cero cloudWrites/handlerCalls/taskPayloadReads. El unico POST fue getIamPolicy de la cola, lectura de metadata.

Las lecturas incluyen configuracion/IAM de Functions y Run, revision mapeada, cola y scheduler exactos. La cola esta RUNNING y scheduler ENABLED; no se presume que el sistema este pausado. Revision offline de equivalencia con el conversor/updateMask CLI en curso, incluyendo grupos de dotenv, secretos omitidos frente nulos, limites y consumidores automaticos. Ninguno de estos datos autoriza ampliar selector o modificar pausas/permisos por comodidad. Fresh preflight por componente sigue obligatorio antes de cualquier cambio.

Root reviso gate original de ZIP y contratoCLI b597c3/1e1597. Execute79791/5b1312 termino4ae75f PASS:1256 archivos esperados y1256 reales, CRC y SHA de cada archivo, exactFileSettrue. ZIP local SHA83dea13687df424802b68c292be57612f159244460d10558b6f672970b0ead93; cloudCalls0, actualUploadVerifiedfalse. Esta prueba usa dotenv local actual; un grupo de entorno distinto exigira verificar nuevamente sus bytes staged y el stream realmente enviado. No acredita un source remoto nuevo.

El guard de stream historico conserva un contrato347/singleton. Adaptacion348 explicita en revision separada, sin tocar el candidato instalado; no se reutiliza un contrato347 como si cubriera348. Hosting, reglas e indices siguen fuera del lote actual.

## Primer corte independiente: lectores de notas

El modelo offline CLI15.3.1 (6bae9c; root fuente1aba10) muestra masks reales con resets null en min/max/identidad/ingress/VPC; no se interpretan como omision. Memoria/timeouts/concurrencia resuelta y eventos coinciden, pero hace falta un contrato de preservacion para el request real. Secret omitido en executePlan no entra mask; version latest del secreto Task sigue sin verificarse. Cola maxDoublings tampoco debe perder su16 actual por conversionnull. El modelo no ejecuta prepare/deploy completo ni acredita compatibilidad financiera.

Se prepara primero un corte de dos lectores: listSolicitudNotes CREATE y listClientDispersionNotes UPDATE, cada uno singleton. No escribe operaciones financieras y permite avanzar sin presuponer que las revisiones financieras son compatibles. Contrato propuesto nuevo lector:256MiB/60s/CPU1/concurrency1/max20/minomitido, runtimeidentity e ingress equivalentes al lector existente, envGroup1 y binding callable publico limitado al recurso creado. UPDATE debe conservar exactamente configuracion/IAM actuales. Aun requiere guard puro/fakesCLI, preflight fresco, prueba de stream y launcher revisados; no orden de publicacion ejecutada.

Los otros13 endpoints quedan en el alcance general, con comparacion de fuentes vivas y contratos old/new pendiente. El orden consumidor-primero no se considera una prueba de compatibilidad por si solo. No se drena ni pausa la cola por inferencia; no se ejecutan operaciones reales de prueba.
