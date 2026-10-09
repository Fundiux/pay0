# Sentinel: lote de observación implementado

Estado: código local y pruebas sintéticas; sin export en index, conexión de publisher, despliegue, IAM nuevo o activación. No existe autoridad de contención ni financiera en este lote.

## Archivos y contrato

- `functions/src/modules/sentinel/schema.ts`: whitelist del evento `PAY0-SECURITY-EVENT@1`, scope ligado a contexto de transporte verificado, timestamps con antigüedad máxima24h/skew futuro60s, campos/identificadores/tamaño acotados. No acepta getters, objetos con prototipo especial, decisiones/verified/status del emisor ni texto arbitrario. Event/intention/attempt/effect/publisher se persisten como hashes. UID/root son los del contexto autenticado y deben coincidir con el evento.
- `policy.ts`: política pura `PAY0-SENTINEL-SHADOW@1`; todas las decisiones son `OBSERVE_ONLY`, autoridad `NONE`, recuperación `HUMAN_REVIEW_ONLY`. Señales servidor no equivalen a prueba de ataque. Eventos cliente solo pueden ser `CLIENT_ROUTE_REPORTED`/`CLIENT_REPORTED`; no pueden convertirse en señal servidor.
- `detector.ts`: deduplicación por política/origen/publisher/actor/event dentro del root, incidentes por actor/tipo/intención, timeline resistente a eventos fuera de orden. Cada evento aceptado mantiene receipt append-only con evidencia sanitizada. Todo incidente permanece `OPEN_OBSERVATION`; estado previamente corrupto/promovido se rechaza, no se acepta como autoridad.
- `store.ts`: capacidades explícitas de persistencia: quotas, receipts e incidents. Sin acceso a usuarios, pagos, reglas, secretos o rutas arbitrarias.
- `transactionalStore.ts`: adaptador `NamespacedObservationStore` inyectado. Todas las rutas se construyen exclusivamente bajo `sentinelObservationRoots/{rootDigest}/{quotas|receipts|incidents}/{sha256}`; traversal y otros namespaces se rechazan. No importa Admin SDK ni descubre credenciales.
- `ingress.ts`: factory de entrada independiente de framework que verifica transporte **antes** de leer el cuerpo. Contexto `VerifiedIngress` debe producirlo el verificador confiable; no puede construirse desde los campos enviados por navegador.

## Controles de recursos y fallo

Por minuto:180 eventos servidor/root,30 cliente/root y6 cliente/actor; son techos de ingesta, no umbrales calibrados de ataques. Cuotas servidor y cliente están separadas. Duplicados no consumen nuevamente cuota. Dos réplicas requieren transacciones reales con conflicto/reintento; la interfaz obliga ese contrato, que debe verificarse con el adapter remoto antes de conectar producción.

Receipts retención48h e incidentes7d, con expiración indicada como epoch milliseconds. La política rechaza eventos de más24h, por lo que limpiar un receipt de48h no permite reaceptar su evento viejo. Ningún job TTL es necesario para enforcement de cuotas/antigüedad. **El adapter de almacenamiento aún debe convertir expiraciones a TTL de la plataforma o conectarlas a una limpieza acotada**; el código por sí solo no activa retención automática. No indexar evidencia/campos hash innecesariamente.

Un circuito local abre tras3 fallos del store durante30s; después permite una sola prueba concurrente. Es por instancia, no una promesa de límite global ante caída del store. Cuotas válidas sí son globales por la transacción. Los errores devuelven códigos fijos, sin texto/stack/URL del proveedor. Una caída de telemetría nunca activa una restricción ni genera un efecto financiero. El integrador debe contar estos resultados como pérdida/indisponibilidad de observación, sin omitirlos como éxito.

Anti-loop: enum cerrado de eventos excluye incidentes de Sentinel y el emisor Sentinel es rechazado; además el publisher/topic deberá excluir salidas del detector. No permitir que una función financiera espere una confirmación de Sentinel para completar un efecto ya admitido. Reintentar observación con eventId estable; nunca reejecutar un pago para recrear su telemetría.

## Verificación ejecutada

`node --test qa/scripts/remediation-sentinel.test.cjs`:10/10 pasan. Tests cubren identidad cliente falsa, root/actor ajenos, promociones arbitrarias, payload/token/getter, scopes hash, anti-loop, concurrencia/reentrega con un solo débito, eventos fuera de orden, quotas cliente/root/servidor, fallo atómico, circuito y recuperación con prueba única, storage corrupto, expiración, orden del verificador de transporte y confinamiento de rutas del adaptador.

El fake implementa conflictos optimistas y rollback de transacción; no es una prueba del servicio remoto. No se hicieron invocaciones Cloud Functions, consultas financieras o llamadas a proveedores. Build central pendiente del responsable de integración.

## Conexión concreta del siguiente lote

1. Seleccionar almacenamiento de incidentes con aislamiento IAM comprobable. El detector no puede recibir Firestore Admin amplio sobre la base financiera. Una interfaz estrecha en TypeScript no reemplaza aislamiento de credenciales frente a compromiso del proceso. Opciones: writer/collector privado de capacidad acotada o base de incidentes separada con IAM validado. No se creó una Cloud Function aparentemente aislada con cuenta Compute/default.
2. Proveer `IncidentPersistence.runTransaction` real con lecturas antes de writes, retries de conflictos, create-if-absent de receipts y commit atómico; probar namespace, IAM denegando usuarios/pagos y colisiones con emulador/entorno aislado. Convertir los `expiresAtMs` a campos TTL sin preservar tokens ni payloads brutos. La transacción callback de este adapter no es serializable a RPC: un collector remoto debe exponer ingesta declarativa y ejecutar el core/adapter dentro de su frontera, no aceptar código o rutas del detector.
3. Crear identidad dedicada propuesta `pay0-sentinel-observer`. Verificar que solo consume el topic de eventos y publica métricas/logs/ingesta autorizada; no permisos IQ/Storage/secretos/usuarios. El writer deberá tener su propio alcance y autenticación. Revisar identidad efectiva en staging; no conceder rol Editor para hacerlo funcionar.
4. Conectar un publisher servidor de eventos sanitizados con IDs estables tras decisiones/efectos existentes. El topic autoritativo acepta solo publishers backend autorizados. Reportes cliente entran por collector autenticado que resuelve root/UID del perfil y fija source CLIENT; nunca por el topic servidor con origin declarado por browser.
5. Implementar verificador de envelope: identidad del publisher/transport, mapping de publisherId simbólico (no correo libre), root/actor procedentes de fuente autenticada. `VerifiedIngress` es un contrato de integración, no prueba criptográfica por su tipo. Ligar eventId al evento del productor y excluir eventos/logs del detector del input.
6. Solo entonces agregar export/trigger a index con cuenta dedicada, concurrency/maxInstances/timeout/rate límites explícitos y política de reentrega/DLQ. Un STORE_UNAVAILABLE requiere retry de la misma observación o registro de pérdida, no acknowledge silencioso; INVALID_* se rechaza sin tormenta de reintentos. CIRCUIT_OPEN tiene espera acotada por infraestructura, nunca busy loop.
7. Verificar fin a fin con datos sintéticos: publicación duplicada, fuera de orden, otros roots, pérdida del writer, fallo de autenticación, cuotas, clasificación cliente, ausencia de cualquier escritura financiera/restricción. Después desplegar únicamente observación y medir volumen/errores. No inventar una ventana completada ni métricas de falsos positivos.

El ejecutor de restricciones y cualquier política automática permanecen desconectados. Este lote no cierra enforcement transversal S-01 ni activa Sentinel en producción.
