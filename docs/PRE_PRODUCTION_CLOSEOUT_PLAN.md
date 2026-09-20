# Plan de cierre preproducción PAY0

Fuente: auditorías `audit/2026-09-20-preproduction-*.md` y Estado Maestro. Este plan está ordenado por dependencias y riesgo, no por la numeración del cuestionario.

## Puerta 0 — bloquear riesgos de acceso

1. Mantener el endurecimiento de `upsertUser`: identidad sin perfil debe recibir denegación explícita; superadmin autorizado conserva las rutas de alta existentes.
2. Añadir pruebas Auth Emulator: identidad sin perfil no puede obtener rol, módulos ni root privilegiado; superadmin autorizado sí puede crear el perfil previsto.
3. Definir ciclo de vida de tokens públicos: campos publicados, expiración, revocación, sustitución y comportamiento de descarga/verificación. La revocación por `active` ya fue corregida; falta certificarla.

Criterio de salida: pruebas negativas y positivas repetibles; sin P0 abierto.

## Puerta 1 — integridad financiera y recuperación

1. Construir fixtures desechables con dos roots, empresas, clientes, solicitud, pago, aplicación, adelanto, dispersión y documentos.
2. Probar concurrencia, timeout y recuperación para IQ creación/conciliación, depósito, aplicación y dispersión. Ningún timeout puede producir duplicado, saldo incorrecto o compensación doble.
3. Probar Facturama con adaptador/simulador: doble solicitud, timeout posterior al envío, descarga fallida, reintento, reemplazo y cancelación.
4. Probar PPD desde aplicación hasta REP: seguimiento diario, documento asociado, no reemisión ante estado incierto y alerta conforme al SLA aprobado.
5. Confirmar adelantos liquidados: desaparecen de la vista operativa sin borrar ledger ni histórico.

Criterio de salida: cada prueba comprueba resultado terminal, posting/ledger, auditoría e idempotencia.

## Puerta 2 — Materialidad y documentos

1. Definir a Materialidad como proyección referencial y la lista exacta de eventos fuente.
2. Implementar/revisar sincronización idempotente para factura, pago, complemento, firma, comprobante y nuevo documento; tratar reintentos y eventos fuera de orden.
3. Probar expediente creado antes y después de cada evento. Verificar referencias, hashes, tipos faltantes y ausencia de copias de Storage innecesarias.
4. Verificar PDF/constancia/cotización: versión de plantilla, snapshot mínimo, folio visible, UUID fiscal cuando aplique y ningún Firestore ID.

Criterio de salida: matriz de eventos con prueba automática y expediente actualizado sin pulsar sincronización manual.

## Puerta 3 — autorización y superficies públicas

1. Ejecutar Rules Emulator por dos roots para Solicitudes, Pagos, Wallet, Dispersiones, Beneficiarios, Materialidad, Docs, Facturama, Reportes y Activity Log.
2. Probar payload/URL/document ID/companyId/clientId manipulados contra cada callable sensible.
3. Revisar endpoints HTTP, webhooks, tokens de Telegram, enlaces de firma y MAT por autenticación, expiración, replay y scope.
4. Convertir la matriz crítica a tests que limpien procesos y fixtures en `finally`, SIGINT y SIGTERM.

Criterio de salida: suite reproducible sin emuladores huérfanos y con denegación demostrada para cada acceso cruzado.

## Puerta 4 — operaciones, observabilidad y costo

1. Inventariar Functions, triggers, schedulers, queues, switches y configuración de secretos contra `firebase functions:list` de producción en modo lectura.
2. Determinar frecuencia, scans, cardinalidad, edad, terminalidad, retry y retención. Reducir scans globales sólo con métricas que demuestren necesidad.
3. Formalizar Master Switch: qué automatizaciones pausa y cuáles acciones manuales quedan permitidas.
4. Definir alertas deduplicadas, dueño, SLA y ciclo incidente activo/recuperado/histórico.
5. Documentar runbook único de despliegue: artefactos, targets, índices/reglas, secrets referenciados, smoke, rollback y verificación de funciones legacy.

Criterio de salida: operaciones críticas observables, con responsable y recuperación verificable; ninguna función/scheduler desplegado queda sin dueño.

## Puerta 5 — UX, datos y release controlado

1. Hacer barrido visual autenticado de Solicitudes/Pagos (referencia), Materialidad, Wallet, Adelantos, Facturación, Hugo y móvil; conservar sólo evidencia de defectos.
2. Revisar exposición de IDs, errores técnicos, densidad, estados vacíos/carga y rutas no navegadas.
3. Ejecutar scans de producción de sólo lectura para índices, datos grandes, referencias rotas, duplicados/huérfanos de Storage y costos.
4. Revisar diff y manifiesto de release; desplegar targets mínimos con autorización explícita.
5. Hacer smoke post-deploy en modo seguro, registrar versiones/resultado y verificar rollback sin ejecutarlo salvo incidente.

Criterio de salida: checklist de release completado con evidencia. Sólo entonces se presenta una decisión Production Ready.
