# Reversión compatible de correcciones privadas

Estado: validación local; ninguna operación productiva autorizada por esta nota. La reversión conserva datos y lectores compatibles, sin convertir una corrección personal en hecho financiero o regla global.

## Identidades y alcance

- Chat anterior admitido: ZIP `763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62`, D1 sobre R15 con gate OFF. Conserva cambio de cliente, PDF y saludo.
- Base MEMORY anterior: ZIP `c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f`.
- Productor MEMORY compatible limpio: ZIP `586b4a3a7140e289049aa9c2f3ce65f68ae6d794b962a16043002082b4200eb5`, sólo `createAgent007MemoryCandidate`. Sustituye al candidato `aaeef8f8b328800cc33f009791da6ba17fe73c366640608bea9873c5cd78c076` por retirar un `.env` heredado; la evidencia anterior se conserva como histórica.
- Lectores compatibles: ZIP `e3b3ac2be82975f115bedc011fc84ccbf4d45171ce1f55c5b110d5df155b72cc`, sólo `listAgent007MemoryDiagnostics` y `reviewAgent007MemoryCandidate`.
- Fuente de los overlays MEMORY: `0382fcc97a42ed6064e3528c8d99faaca9f753f3`; paquetes privados identificados por hash, no por HEAD posterior.

## Por qué conservar los lectores

Una corrección nueva es `USER_STATEMENT/CONFIRMED`, vinculada al autor y a `HUGO:CONVERSATION:<conversationId>`, con ámbito ENTITY. El lector C50 anterior no filtra estas filas por propietario; su revisión también permite alcanzar una memoria confirmada mediante un candidato genérico con `supersedesId`. Por tanto, una vez habilitado un productor compatible se debe asumir que existen registros nuevos y conservar los lectores/review compatibles. No hace falta inspeccionar documentos productivos para adoptar esta decisión conservadora.

El chat 763 genera consultas de memoria para referencias PAY0 SOLICITUD/PAGO y clave nula. No consulta claves HUGO CONVERSATION en el flujo admitido. Aunque el historial interno puede conservar metadatos de corrección, el adaptador de prompt anterior serializa rol/texto; no se afirma que el objeto interno carezca de esos metadatos.

## Precondición de publicación

La integración `40bf096` añade notas personales CLIENT al chat/UI; no sustituye la procedencia `0382fcc97a42ed6064e3528c8d99faaca9f753f3` de los overlays MEMORY citados. Su inclusión en un artefacto final requiere evidencia propia: los hashes anteriores no certifican automáticamente un nuevo ZIP de chat o UI.

Publicar y verificar primero ambos lectores protegidos, antes de habilitar cualquier productor de correcciones privadas, incluido VOZ si forma parte de la entrega. Después verificar el chat compatible y publicar el productor TEXT al final; habilitar el flujo de UI sólo cuando todos sus destinos estén verificados. Ocultar el botón no sustituye esta dependencia de servidor. Cada recurso conserva su propia base, configuración/IAM y recibo. Si ya se publicó un productor o su resultado es incierto, asumir que hay datos privados y retener los lectores, aunque después se revierta ese productor.

Las notas CLIENT son declaraciones privadas recuperadas para el mismo cliente canónico; no alteran texto financiero ni archivo. Su retirada y presentación en UI requieren el contrato nuevo de acuse, no basta `ok:true,changed:false` de un endpoint antiguo. La reversión de chat/UI puede retirar esa presentación sin retirar físicamente el recuerdo; no debe anunciar que se borró ni degradar privacidad para recuperarlo.

## Orden de reversión

1. Revertir sólo `createAgent007MemoryCandidate` a su fuente/configuración/IAM anteriores preservados por su recibo exacto. Detener primero la producción de nuevos registros.
2. Si VOZ nueva también fue publicada, revertir su productor y gateway exclusivamente contra sus propios recibos/baselines. Revertir TEXTO no detiene por sí solo `persistVoiceConversationCorrection`. Si VOZ no se publicó, este paso no aplica.
3. Revertir `sendAgent007Message` al ZIP 763 preservado, verificando origen, configuración, IAM y revisión del recurso. No usar una base de reportes anterior a R15.
4. Revertir UI a su versión inmediatamente anterior preservada, manteniendo cambios independientes de E/G, admin/MAT, DOC y reportes. No fijar una base UI histórica por conveniencia.
5. Mantener desplegados los dos lectores compatibles. No revertirlos a C50 mientras puedan existir correcciones nuevas.

Usar los controladores y SHA de input/recibo de cada entrega; esta nota no concede autorización ni proporciona un ejecutor alternativo. Ante operación incierta, reconciliar antes de continuar y no repetir PATCH. Una reversión parcial no es atómica y nunca se compensa degradando privacidad de los lectores.

No borrar recuerdos, retirar sus marcas de privacidad, cambiar claves a global/null ni degradar estados para hacerlos legibles al código anterior. La retirada individual debe conservar autorización/propiedad y usar el endpoint compatible; no se promete que una UI anterior ofrezca ese control.

## Prueba reproducible

`qa/scripts/e1-operations-memory-rollback-legacy-chat.cjs` usa Firestore emulado y sintéticos: dos autores del mismo root, dos correcciones durables creadas mediante callable real y una memoria PAY0 positiva. Ejecuta DataStore, contextBuilder, Core y generador de prompt reales del ZIP 763; registra las claves realmente consultadas. Exige que la memoria PAY0 continúe disponible y que ninguna corrección privada llegue al contexto, salida ni prompt de ambos actores. Bloquea proveedores/red externa y compara los bytes de runtime con el archivo antes y después.

Sin overrides prueba el productor compilado local, no un ZIP nuevo. Esa ejecución pasó con root Functions build 41043: dos registros privados, dos contextos y dos llamadas Core, cero filas privadas recuperadas y cero proveedores. Evidencia privada original: `tmp/memory-rollback-legacy-chat-proof.json` y su log de emulador.

La repetición sobre `package.main` del productor exacto `aaeef8f8…` también pasó, exit 0 y cierre del emulador: dos registros privados reales, dos contextos y dos llamadas Core; control PAY0 preservado, cero filas privadas devueltas, cero correcciones en prompts y cero proveedores. Recibo privado `tmp/memory-rollback-exact-c50-proof.json`, SHA `211d9f6342b0ad56f55fe4bc9bcd0cc40c6f63799c57d97cceffebd35c3a16ae`; log SHA `44f1d92b2734c1229ab45e0019899b290e36f786d4e524e84da24921bcaac3d9`. Se verificaron todos los bytes de ambos archivos contra sus runtimes antes y después. Esta evidencia sí vincula el productor C50 adaptado, y no sustituye las pruebas independientes de lectores.

Tras retirar el `.env` heredado se repitió el mismo harness sin cambios sobre `package.main` del ZIP limpio `586b4a3a…` y chat 763: **PASS, exit 0 y emulador cerrado**. Dos autores/registros privados/contextos/Core; control PAY0 preservado y cero filas privadas devueltas, correcciones en prompts, proveedores o escrituras productivas. Ambos runtimes se cotejaron íntegramente contra sus ZIP antes y después. Nuevo recibo privado `tmp/memory-rollback-clean-c50-proof.json`, SHA `9cac279c548dcab33044f9ad4d571156be279ad95a97ce26e25261d980fe1f7a`; log SHA `c71cc595cdc1c736f92cef3e0f71e71b9d322053ff9e6b1af91ab88b5b5aa841`. No se sobrescribieron los recibos anteriores. Es la evidencia vigente del productor limpio; no cambia el alcance ni valida lectores nuevos por extensión.

Para un productor empaquetado se requieren `PAY0_MEMORY_ROLLBACK_PRODUCER_RUNTIME`, `PAY0_MEMORY_ROLLBACK_PRODUCER_ARCHIVE` y `PAY0_MEMORY_ROLLBACK_PRODUCER_SHA`. Se carga `package.main` real y se cotejan todas las entradas del ZIP. `PAY0_MEMORY_ROLLBACK_PROOF` permite elegir un recibo nuevo; nunca sobrescribe evidencia. Ejecutar mediante `node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-operations-memory-rollback-legacy-chat.cjs` en el entorno demo aislado. No usar `retrieveMemory` con una clave HUGO arbitraria para representar al chat antiguo: ese no es el llamador admitido.

La prueba no valida UI autenticada productiva, proveedores reales ni autorización de despliegue. Los tests de lectores/review y su rechazo de supersedes ajeno pertenecen a la suite MEMORY exacta independiente.
