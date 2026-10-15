# Cierre de etapa — 15 de octubre de 2026

Etapa cerrada por instrucción del usuario. La remediación integral no se declara terminada. Este documento fija el alcance pendiente y prevalece sobre notas históricas de trabajo en curso.

## Terminado

- Lectores de notas y autorización previa a leer padres: commit 5a9fa95, 165 pruebas focalizadas aprobadas (1 omisión histórica), 58 casos SDK aprobados, política y build Functions aprobados. Frontend sin cambios desde su build aprobado; descubrimiento de 352 endpoints aprobado. Código aislado, aún no integrado ni desplegado.
- Escritura atómica de nota de Pago y marcador de no leído: commit 68c3972, 77 pruebas y 11 casos SDK aprobados, política y build Functions aprobados. Código aislado, aún no desplegado. No resuelve duplicados entre peticiones HTTP independientes.
- Candidato de Rules eafd6075 probado y creado como ruleset c026f71f-0542-4a23-a170-99b012b1e835; todavía no activo.
- Preparación local de infraestructura y controles de publicación del notificador. Exportador de evidencia remota: 15 pruebas aprobadas (99f548); enlace de evidencias: 32 aprobadas (35b36e). Esto no acredita infraestructura creada ni activación.
- Colector de metadatos de addPagoNota revisado, 32 pruebas aprobadas (4c2935); su lectura real sigue pendiente.
- Renovación autorizada completada: 3 lecturas del finalizador (7a1bb4), recibo 4ba5b70795d901250cc0ae64d915bb36e902648f798e4053ca0519134601af23; 19 lecturas de infraestructura (0470ff/67c061), recibo 597f9afba8c22a85795313711ec243ae07fbe653ea79bd592511d56e62b60ed1. Observaciones a las 16:12:16 y 16:12:56 UTC. Cero mutaciones; cierres confirmados y sin locks retenidos. Cinco cuentas, dos colas y dos roles siguen ausentes. Misma revisión del finalizador; V3 ausente en el código revisado y ruta heredada activa. No equivale a notificaciones globalmente apagadas.

## Lista finita pendiente para finalizar este alcance

1. Obtener la versión y el código publicados de addPagoNota, preparar el cambio selectivo y validar únicamente el artefacto resultante y sus diferencias. Avance posterior al cierre: revisión activa addpagonota-00032-vin, generación 1790583721270714; ZIP recuperado y comparado. Candidato selectivo preparado con diez módulos de dependencia iguales al candidato probado; falta validación del artefacto con sus dependencias publicadas y configuración de build antes de desplegar.
2. Integrar los commits de notas revisados en una base estable, desplegar los componentes afectados y verificar lectura/escritura autorizadas sin efectos financieros reales. No integrar en bloque la rama experimental de Rules.
3. Activar exclusivamente el ruleset ya probado y verificar la versión activa y que Storage no cambió.
4. Completar el lote de infraestructura del notificador: enlazar la evidencia remota al postflight, aplicar el plan revisado de 19 altas, verificar recursos, subir el artefacto y crear/verificar las tres Functions previstas con colas pausadas. Entregarlo apagado; activación y envíos quedan fuera de esta etapa.
5. Publicar la rama de artefacto IQ revisada en el remoto confirmado y consolidar commits, recibos y estado final de estos cinco puntos.

Cada punto termina con evidencia de aceptación o con un bloqueo explícito. No se añaden puntos por hallazgos adicionales. Los metadatos caducados se renuevan solamente cuando una acción concreta necesite evidencia vigente; no mediante sondeo recurrente.

## Bloqueos por autorización

- APPLY del plan de 19 altas: revisión automática rechazó la ejecución porque la autorización específica cubría lecturas y excluía aplicar Terraform. La nueva autorización vuelve a cubrir únicamente lecturas y recibos.
- PATCH de activación de Rules: revisión automática rechazó el cambio persistente de acceso en producción. Falta autorización específica de activación.
- Push de la rama de artefacto IQ: revisión automática rechazó la publicación por falta de confirmación del remoto confiable https://github.com/Fundiux/pay0.git y de su publicación.

No se reintentaron estas tres acciones. Los pendientes técnicos de los puntos 1, 2 y 4 no se presentan como resueltos por una autorización.

## Fuera de alcance y criterio de pruebas

Hallazgos adicionales, ampliación de auditorías, duplicados entre peticiones HTTP, concurrencia global del marcador de no leído, brechas históricas de Storage, recuperación/PITR y otros frentes IQ quedan para otra etapa. No se consideran corregidos.

No repetir pruebas aprobadas salvo cambio de código o evidencia nueva que invalide su resultado. Para cambios nuevos, ejecutar únicamente las verificaciones afectadas y los builds requeridos por AGENTS.md. Este cierre documental no repite suites ni builds. No hubo mensajes de prueba, operaciones financieras, APPLY, activación de Rules ni nuevas Functions en este cierre.
