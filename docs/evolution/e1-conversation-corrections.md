# Correcciones personales dentro de la conversación

Estado: implementación local validada; composición del artefacto de publicación pendiente. Sin despliegue ni activación productiva.

La respuesta conserva su texto original. «Corregir respuesta» permite escribir una respuesta esperada, confirmar su alcance y verla inmediatamente como declaración del usuario después del acuse persistido. No se presenta como hecho verificado, regla global ni cambio financiero.

El alcance elegido es privado por usuario y raíz: un cliente identificado por el reporte canónico de origen, o un tema escrito y confirmado expresamente. Los recuerdos personales no vencen silenciosamente; pueden editarse o retirarse. El selector de tema actual controla su reutilización: no se busca por similitud ni se deduce un tema del modelo. Para clientes, la consulta actual debe devolver el mismo identificador canónico. Una fuente ambigua exige confirmar un tema.

CLIENT tiene un efecto concreto y acotado: al consultar un reporte del mismo cliente verificado, la respuesta y su historial incluyen `personalNotes`, que la UI muestra como indicación personal recuperada y permite retirar. El texto financiero y el archivo canónico permanecen idénticos. Esa ruta determinista no afirma haber aplicado la corrección mediante un modelo. TOPIC sí entrega la declaración al contexto del modelo cuando el usuario selecciona explícitamente ese tema.

La memoria canónica existente almacena `USER_STATEMENT`, con referencia al mensaje, versión, autor y procedencia. Un documento determinista `agent007ConversationCorrectionBindings` vincula raíz, usuario y tema/cliente; conserva las tres últimas correcciones de ese ámbito. La lectura revalida identidad y estado dentro de una transacción y queda excluida de búsquedas genéricas. La confirmación, sustitución y retiro mantienen controles de actor, raíz, versión e idempotencia; la memoria de otro usuario no puede invalidarse mediante la revisión genérica.

Editar la misma fuente sustituye su versión anterior. Varias declaraciones distintas para el mismo ámbito no se eligen automáticamente: la respuesta muestra cuáles requieren revisión y permite retirarlas. Esto no bloquea la consulta de hechos o reportes canónicos. Las políticas, permisos, herramientas y datos actuales conservan prioridad sobre cualquier declaración humana.

La opción temporal conserva el contrato inicial: sólo conversación, hasta treinta minutos/cuatro turnos y tres últimas correcciones. La integración de voz mantiene su propio ámbito de sesión y no convierte esa limitación en recuerdo durable.

## Dependencias de entrega

- Backend TEXT: `sendAgent007Message`, `createAgent007MemoryCandidate`, `listAgent007MemoryDiagnostics` y `reviewAgent007MemoryCandidate`. Actualizar únicamente chat/create dejaría accesible el lector anterior de memoria; los cuatro destinos forman el límite de privacidad.
- Antes de permitir nuevas correcciones, actualizar el lector de diagnósticos, la revisión protegida y chat; el productor `createAgent007MemoryCandidate` va al final. La UI anterior/nueva no debe habilitar el flujo mientras falte ese cierre. Cada destino necesita su propia evidencia de fuente/configuración y reversión; este documento no autoriza publicarlos.
- La misma dependencia protege cualquier productor VOICE que use el helper común. Después de crear datos privados, no se revierte a diagnostics/review c50 antiguos: se retienen los lectores protegidos mientras se revierten productor/chat/UI. [Plan de compatibilidad de reversión](e1-conversation-memory-rollback-compatibility.md).
- `listAgent007Messages` ya devuelve los campos persistidos mediante el método existente; no requiere un quinto destino.
- Componer chat sobre su fuente productiva D1, y los otros destinos sobre sus propias capturas. Trasplantar sólo los handlers y métodos auditados; no copiar íntegro `callables.ts` ni arrastrar integraciones ajenas.
- La UI requiere los tipos/wrapper, `HugoResponseCorrection` y sus montajes en `/hugo` y la burbuja. El montaje documental se coordina como capacidad independiente con sus dos destinos existentes.

## Evidencia

La base temporal pasó Functions NORMAL, frontend Next.js, ocho pruebas de persistencia real con emulador aislado (incluye voz y aislamiento de texto), ocho grupos de UI y 69 regresiones compiladas. Esa evidencia no certifica todavía el alcance durable añadido después.

La extensión durable pasó Functions NORMAL final, comparación exacta de los emisores revisados y build frontend final (Next.js 15.5.27, 47 rutas). Evidencia sobre `functions/lib` integrado:

- `conversation-corrections-emulator.test.cjs`, alcance ALL: nueve pruebas TAP, exit 0 y cierre del emulador. Callable real y Firestore aislado: original intacto, acuse persistido, historial, idempotencia/TTL de la opción temporal, separación de actor/raíz, supersede genérico denegado, voz sin parent, exclusión VOICE→TEXT, contexto de siguiente respuesta, prioridad de hechos/permisos y conflicto→retiro→reutilización. También prueba bindings malformados sin `INTERNAL` ni cambios parciales, orden de las tres últimas correcciones durables y ausencia de conflicto entre contenidos idénticos. Reporte real de cliente Alfa→nota recuperada/persistida; Beta no la recibe; retiro→siguiente consulta sin nota; texto y export idénticos antes/después.
- `conversation-correction-scope-emulator.test.cjs`: diez pruebas TAP independientes en la base durable, exit 0. Normalización exacta/NFC, permanencia tras cambio de conversación, ausencia de coincidencias por similitud, cliente derivado del reporte canónico, export ambiguo/desconocido rechazado, bindings malformados, revocación y retiro privado. Cero operaciones financieras; se repetirá contra el artefacto exacto con notas.
- Las siete suites compiladas de contexto phase4, aprendizaje phase5, hardening phase6, reportes, contrato de consultas, tokenUsage y continuidad: 69/69 PASS, exit 0. Esta evidencia corresponde a la integración local; no se atribuye a un ZIP todavía no construido.
- UI: quince grupos con componente y wrapper reales y transporte Firebase sintético. Confirmación, respuesta corregida visible, alcance durable, selector/chip de tema, retiro, resolución de declaraciones múltiples, rechazo/legacy y descarte por cambio de identidad. Guardar TOPIC con acuse válido activa el chip y el siguiente envío real del wrapper lleva ese tema; un acuse inválido no lo selecciona y quitarlo elimina el campo del siguiente envío. La nota CLIENT aparece sin cambiar el reporte. Un `ok:true,changed:false` de un backend antiguo no se presenta como retiro confirmado.
- Verificador de política de autorización: PASS; no se modificaron roles ni reglas.

El alcance ALL de la primera suite depende del adaptador VOICE desarrollado en una unidad separada y se selecciona expresamente con `PAY0_CORRECTIONS_SCOPE=ALL`. El valor por defecto es TEXT, reproducible sin el adaptador; `PAY0_CORRECTIONS_LIB` permite apuntar al runtime privado dentro del workspace. La suite informa el alcance elegido y no usa skips. La prueba de siguiente respuesta usa un modelo sintético; no certifica el comportamiento de un proveedor generativo real.

Registros finales de notas: `tmp/conversation-corrections-notes-emulator.log`, `tmp/conversation-corrections-notes-regressions.log`. La base de alcance mantiene `tmp/conversation-correction-scope-emulator.log`. Queda pendiente comprobar el artefacto exacto antes de solicitar publicación. No se usaron proveedores reales ni datos financieros productivos.
