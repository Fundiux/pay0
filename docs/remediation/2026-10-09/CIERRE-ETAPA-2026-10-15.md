# Cierre de etapa — 15 de octubre de 2026

Etapa cerrada por instrucción del usuario. La remediación integral no se declara terminada. Este documento fija el alcance pendiente y prevalece sobre notas históricas de trabajo en curso.

## Terminado

- Lectores de notas y autorización previa a leer padres: commit 5a9fa95, 165 pruebas focalizadas aprobadas (1 omisión histórica), 58 casos SDK aprobados, política y build Functions aprobados; descubrimiento de 352 endpoints aprobado. Integrados en main ee2a7d0 y posteriormente desplegados con autorización específica. Los tres están Ready/100%, ZIP exacto verificado y rechazo HTTP401 sin autenticación. Falta UI autenticada; detalle en NOTES-READERS-SELECTIVE-RELEASE.md.
- Escritura atómica de nota de Pago y marcador de no leído: commit 68c3972, 77 pruebas y 11 casos SDK aprobados, política y build Functions aprobados. Integrado en main ee2a7d0 y desplegado selectivamente; ver punto 1. No resuelve duplicados entre peticiones HTTP independientes.
- Candidato de Rules eafd6075 probado y creado como ruleset c026f71f-0542-4a23-a170-99b012b1e835; todavía no activo.
- Preparación local de infraestructura y controles de publicación del notificador. Exportador de evidencia remota: 15 pruebas aprobadas (99f548); enlace de evidencias: 32 aprobadas (35b36e). Esto no acredita infraestructura creada ni activación.
- Colector de metadatos de addPagoNota revisado, 32 pruebas aprobadas (4c2935); lectura real y recuperación del artefacto completadas; despliegue verificado en el punto 1.
- Renovación autorizada completada: 3 lecturas del finalizador (7a1bb4), recibo 4ba5b70795d901250cc0ae64d915bb36e902648f798e4053ca0519134601af23; 19 lecturas de infraestructura (0470ff/67c061), recibo 597f9afba8c22a85795313711ec243ae07fbe653ea79bd592511d56e62b60ed1. Observaciones a las 16:12:16 y 16:12:56 UTC. Cero mutaciones; cierres confirmados y sin locks retenidos. Cinco cuentas, dos colas y dos roles siguen ausentes. Misma revisión del finalizador; V3 ausente en el código revisado y ruta heredada activa. No equivale a notificaciones globalmente apagadas.

## Lista finita pendiente para finalizar este alcance

1. **Terminado:** recuperar, comparar, preparar y validar el artefacto selectivo de addPagoNota. Tras autorización específica adicional, se desplegó exclusivamente ese endpoint: addpagonota-00033-zup Ready/100%, configuración e IAM conservados, ZIP publicado idéntico al validado y rechazo HTTP401 sin autenticación. Detalle en PAGO-NOTE-SELECTIVE-ARTIFACT.md. Sin transacciones financieras de prueba.
2. **Integración, lectores y frontend publicados:** main en e215e58, con notas, dependencias revisadas y la ruta /descarga/documento ya publicada conservada. Tres lectores verificados con autorización específica. SSR ssrpay0system-00592-yis y Hosting 74c7e28d86fe69ff (release 1792112583214000) publicados y comprobados públicamente. Falta únicamente la verificación autenticada de UI: no hay sesión QA disponible; se solicitó al usuario habilitarla o comprobar manualmente. No se hizo push.
3. Activar exclusivamente el ruleset ya probado y verificar la versión activa y que Storage no cambió.
4. Completar el lote de infraestructura del notificador: enlazar la evidencia remota al postflight, aplicar el plan revisado de 19 altas, verificar recursos, subir el artefacto y crear/verificar las tres Functions previstas con colas pausadas. Entregarlo apagado; activación y envíos quedan fuera de esta etapa.
5. Publicar la rama de artefacto IQ revisada en el remoto confirmado y consolidar commits, recibos y estado final de estos cinco puntos.

Avance del punto 2: tras el rechazo inicial y la autorización específica posterior, se actualizaron los dos lectores existentes y se creó listPagoNotes con su invocación HTTP. Configuración y políticas existentes conservadas; ZIP exacto comprobado en los tres y tres rechazos HTTP401 aprobados. La adición de version=1 en la respuesta IAM nueva se revisó y reconcilió sin repetir la escritura. Detalle: NOTES-READERS-SELECTIVE-RELEASE.md. No repetir las validaciones aprobadas del mismo ZIP.

Cada punto termina con evidencia de aceptación o con un bloqueo explícito. No se añaden puntos por hallazgos adicionales. Los metadatos caducados se renuevan solamente cuando una acción concreta necesite evidencia vigente; no mediante sondeo recurrente.

Avance local del punto 4: exportador conectado al postflight de APPLY, con respuestas originales, tiempos de observación y hashes enlazados al estado/controlador; se vuelven a verificar antes de liberar el lock. Ocho pruebas nuevas aprobadas y suite afectada validada; control offline aprobado con cero llamadas Cloud. `LIVE=false`; no hubo APPLY. Sigue pendiente conectar el consumo en CREATE y obtener autorización. Evidencia: [NOTIFIER-APPLY-REMOTE-EXPORT.md](NOTIFIER-APPLY-REMOTE-EXPORT.md).

## Build frontend y pendiente técnico del punto 2

El primer build de integración usó Next 15.5.27 compartido aunque su lockfile fijaba 15.5.25. El build aislado de diagnóstico con 15.5.25 también pasó (35e319). La discrepancia se corrigió en a5eed7e, ya integrado en main: manifest/lock alineados con el cambio revisado d66555b, dependencias propias instaladas offline y outputFileTracingRoot explícito. Build nuevo con Next 15.5.27 aprobado (ad854b), tipos y 46 páginas; 829 rutas de 61 manifiestos presentes dentro del worktree (05aa2f). No se repitieron suites financieras ni SDK.

El primer empaquetado f401f8/7c2760 queda como diagnóstico por denegación del sandbox y fallback de esbuild. El bundle se corrigió y verificó en 16afc0. La comparación con Hosting detectó /descarga/documento ausente: se integró la implementación existente en e215e58; ocho pruebas, política y nuevo build aprobados con 47 páginas. El artefacto anterior a2abc33c se descartó para publicación.

Artefacto final b5fca72c68e2365bc063c7443a9b4b25bacbe6406f33536a93addff3c22a85ec: 529 archivos SSR y 158 propios Hosting, sin dotenv ni node_modules. Runtime local y de producción aprobados. La versión live conserva cabeceras, configuración y etiquetas previas; se comprobó el build en tres páginas y un recurso estático exacto. Las diferencias de nombres API, fileCount/reservados e HSTS se investigaron y reconciliaron sin repetir mutaciones. Detalle y límites en NOTES-FRONTEND-RELEASE.md. Solo queda UI autenticada dentro de este punto.

## Bloqueos por autorización

- APPLY del plan de 19 altas: revisión automática rechazó la ejecución porque la autorización específica cubría lecturas y excluía aplicar Terraform. La nueva autorización vuelve a cubrir únicamente lecturas y recibos.
- PATCH de activación de Rules: revisión automática rechazó el cambio persistente de acceso en producción. Falta autorización específica de activación.
- Push de la rama de artefacto IQ: revisión automática rechazó la publicación por falta de confirmación del remoto confiable https://github.com/Fundiux/pay0.git y de su publicación.

No se reintentaron estas tres acciones pendientes. addPagoNota y el lote de lectores ya fueron autorizados y verificados. Los pendientes técnicos de los puntos 2 y 4 no se presentan como resueltos por una autorización.

## Fuera de alcance y criterio de pruebas

Hallazgos adicionales, ampliación de auditorías, duplicados entre peticiones HTTP, concurrencia global del marcador de no leído, brechas históricas de Storage, recuperación/PITR y otros frentes IQ quedan para otra etapa. No se consideran corregidos.

No repetir pruebas aprobadas salvo cambio de código o evidencia nueva que invalide su resultado. Para cambios nuevos, ejecutar únicamente las verificaciones afectadas y los builds requeridos por AGENTS.md. No hubo mensajes de prueba, operaciones financieras, APPLY ni activación de Rules. La creación autorizada de listPagoNotes está registrada expresamente; no implica activación del notificador.
