# Corrección de consultas operativas y confirmación documental

Estado: backend O1 DEPLOYED_NOT_VERIFIED; interfaz documental DEPLOYMENT_PENDING en paquete independiente. O1 se publicó con la autorización específica del usuario y pasó la verificación técnica independiente. Falta repetir el recorrido funcional con su sesión. «Parece que sí» no acredita guardado y relectura documental.

## Fallos reproducidos

- «Último cliente en hacer una solicitud» no coincidía con la expresión contigua «última solicitud». Un pago activo podía contaminar la respuesta a una pregunta explícita sobre solicitudes.
- El contexto descartaba el nombre de cliente resuelto por el conector. La respuesta podía usar un pagador o remitente OCR para contestar una pregunta sobre clientes.
- La lectura OCR del remitente se elevaba a pagador confirmado. El nombre del cliente no siempre se consultaba por su identificador canónico y su raíz.
- La solicitud no exponía su método PPD/PUE al contexto. Importes ausentes podían convertirse en cero.
- La respuesta generativa no indicaba el panel real para leer comprobantes.
- La pantalla documental no comprobaba suficientemente la versión y evidencia del acuse ni distinguía guardado de relectura verificada.

## Cambio implementado

El enrutamiento prioriza el dominio explícito del turno y resuelve la solicitud ordenada como entidad activa. Las preguntas posteriores sobre el nombre consultan la misma operación; un cambio explícito a solicitud no reutiliza el pago anterior. Las objeciones sobre banco/remitente consultan el pago activo y distinguen esas identidades del cliente sin delegar esa afirmación al modelo.

El conector conserva el aislamiento superadmin/root existente. Resuelve el cliente por ID dentro de la raíz; un ID ajeno, inválido o inexistente no permite rescatar un nombre de snapshot que podría ser engañoso. Sin ID puede usar el nombre registrado en la propia operación, con procedencia explícita. Pagador confirmado, remitente detectado y banco permanecen separados. PPD/PUE procede sólo del campo canónico `tipoFactura`; no se infiere del estado. Cero sigue siendo cero; un importe ausente o inválido queda desconocido.

La respuesta de solicitud presenta cliente, método e importe verificados juntos. Una consulta sobre nombres de clientes no enumera bancos o pagadores como clientes. La respuesta de ubicación apunta a `/hugo` → «Revisar un comprobante con María», con los formatos/límite vigentes y acceso sujeto a la sesión autorizada.

Se preservan los nodos `semanticReceipt` y `comprobante` exclusivos de la fuente productiva del conector. El emisor del parche verifica la diferencia AST específica frente a la rama y no sustituye el módulo perdiendo esos campos. No se reconstruyen reportes ni se cambian cálculos, fechas/cursor de pagos, permisos, reglas globales o voz.

La UI documental exige acuse real del análisis, ID de corrección, siguiente versión y campo `HUMAN_CORRECTION`. Muestra campo/valor/versión confirmados y separa ese estado de la comprobación al volver a analizar. Una relectura que pierde la corrección muestra una alerta, no «verificado».

## Validación y entrega

- Fuente: nueve escenarios de routing/Core, siete de frontera de datos y cinco de presentación/procedencia; fixtures sintéticas, sin proveedores ni datos productivos.
- UI documental: doce pruebas de transporte/componente y build Next de 47 rutas PASS; fuente `65accf31e98992939e8e51e4951377749e547251`.
- Política de autorización: PASS, sin cambios de roles ni reglas.
- Build NORMAL final de `6ab526d` PASS y comparación exacta de los seis emisores con la fuente cerrada PASS. El build anterior con un emisor desactualizado fue rechazado, sin usarlo para acreditar el paquete final.
- Receta de overlay sobre ZIP productivo chat `22cbdbd9`: seis módulos permitidos, resto preservado; artefacto final O1 probado y pendiente de autorización.
- UI aislada de confirmación: fuente privada `28924fb` sobre `3b6602d`, sólo un componente. El primer intento se canceló para serializar carga, con logs/archivos parciales preservados; no se contó como aprobado. El build y runtime posteriores terminaron PASS, documentados en el paquete UI independiente.

La publicación requerirá paquete exacto, pruebas del ZIP, bases productivas frescas, identidad y reversión. Las aprobaciones anteriores de aprendizaje personal no cubren estos artefactos. El backend y la UI pueden prepararse como paquetes independientes; ninguno se declara COMPLETED sin publicación y comprobación real.

La UI ya tiene artefacto aislado validado: [paquete documental independiente](e1-document-confirmation-ui-package.md), input `4f6a110d`, ZIP `39e00880`, fuente `28924fbb`; root cotejó hashes y ejecutó `assertRuntimeProof` sobre el recibo `292cf193`: PASS. Aún no se ha autorizado ni publicado esa interfaz. No se confundirá el backend O1 publicado con esa entrega de Hosting/SSR.

## Identidad y pruebas del paquete O1 de backend

Actualiza únicamente `sendAgent007Message`. No incluye Hosting/SSR, voz, otros endpoints, permisos, reglas, activación de aprendizaje ni operaciones financieras. Corrige la selección de solicitud/pago, nombres de clientes y método/importe; conserva el aprendizaje privado y orienta al panel documental ya existente. La confirmación visual documental nueva permanece fuera de este paquete.

| Identidad | Valor |
| --- | --- |
| Fuente | `6ab526d8d1f4445014a260787d73ff123dfc5ba0` |
| ZIP | `9f95197e7eae30dc5a7bd3ccb8c7afa2e215c4cb2811c0fd3922135c04b93207` |
| Patch fuente | `38ad03c51d8d616535e56facfb094b34df4305d6cbff43ef789ca3e87758a0c0` |
| Input | `0e95643a49093d7c4f85a9d330448fc7e7337555972b6693ccb2f2bedd22d914` |
| Base y reversión | ZIP `22cbdbd9ca1426afb654b0830934b3e491b4dbbc7b909050ebe616811caa5588`, revisión `sendagent007message-00024-noh` |
| Input privado | `.firebase/modular-release/operational-identity-repair-release/input.json` |

Pruebas del ZIP exacto: 14/14 diálogo/presentación, 66/66 regresiones seleccionadas, ocho pruebas TEXT con Firestore emulado (notas CLIENT/TOPIC, propietario, retiro y persistencia), typecheck dirigido sin errores, arranque con 343 exports y rechazos anónimos. Reproducción independiente de ZIP y patch idéntica. Verificador canónico con instalación nueva de dependencias productivas PASS: 343 exports, destino único y rechazo sin sesión (`unauthenticated`) mediante la entrada real; no se atribuye una prueba HTTP a ese proceso local.

Root comparó independientemente seis archivos JavaScript del ZIP contra el build final y comprobó los otros 792 archivos byte a byte frente a la fuente productiva: cero entradas añadidas o eliminadas. La frontera de datos compilada pasó siete escenarios, incluida conservación del comprobante, cero real, importe desconocido y aislamiento de raíz. Política de autorización PASS.

Límite heredado explícito: los tres tests de `universalQueryContract` tienen una evidencia histórica de un PASS y dos FAIL. Ese módulo coincide byte a byte entre la base productiva y O1 y no tiene consumidores en esta ruta; no se vuelve a etiquetar como aprobado ni se afirma que 69 tests del ZIP pasaron. Prueba de compatibilidad privada `4d3b66c0484c1e703f115f803fe44801d1c8db782f8a88594493023959f21311`. La selección exacta de 66 tests excluye esos tres. Behavior proof final `9801e2bbedcabadc9ccdb8ec2f93f23ad6fcf39ca1865cc90497d9bf467da8c3`; manifiesto `31729273587f2caed9fd89969bf755187839a94964ee30856399d8679ef3e068`.

Preflight GET PASS: revisión productiva `00024-noh`, configuración/Run/IAM sin deriva, recibo `c5264fb7248b5cc6005c343b6958a07958694ed896406de2791503a2253902a6`. Debe repetirse antes de publicar. Riesgos: la resolución añade una lectura por cliente distinto dentro del conector, con caché por instancia; un cliente sin vínculo legible seguirá figurando como nombre no disponible. No se garantiza rellenar datos inexistentes ni se infieren nombres desde bancos o folios.

Reversión autorizable: preservar fuente y configuración anteriores, revertir sólo `sendAgent007Message` al ZIP `22cbdbd9` si falla. No revertir lectores/review ni productor de recuerdos privados; no borrar recuerdos. La UI actual y el backend documental siguen intactos. No cambiar el input ni repetir una operación incierta sin reconciliar su recibo.

Verificación productiva: fuente descargada exacta, ACTIVE/revisión, configuración/Run/IAM, gate supervisado OFF y rechazo anónimo. Después, con sesión propia, repetir la consulta de última solicitud (nombre, PPD/PUE y monto), consultar último pago y preguntar de qué cliente, volver a solicitud y preguntar dónde leer un comprobante. No compartir importes ni documentos. Estado posterior a despliegue: DEPLOYED_NOT_VERIFIED hasta confirmar el recorrido real.

## Publicación autorizada O1 — 20 de octubre de 2026

Ejecutor scoped exit 0; revisión `sendagent007message-00025-gok` ACTIVE sobre base `00024-noh`. Verificación independiente PASS: ZIP descargado exacto `9f95197e`, configuración/Run/IAM preservados, gate supervisado OFF y HTTP 401 UNAUTHENTICATED para llamada sin sesión. No se consultaron datos de negocio, proveedores ni sesiones autenticadas. Fuente previa `22cbdbd9` preservada, sin reversión aplicada.

Recibo independiente SHA `0dec35291d1c52d187b20935c1a506785e39fb0781ff0f46ce78b0575ffd152e`; baseline publicada SHA `d3ac299fb8b8129c727ef8562455a0e3d68908d436a824739138d75bb9ac223b`. Archivos privados dentro de `operational-identity-repair-release/independent-post-publication-44e09fb3-2237-4499-b828-b2116cc0fd9c`. Se pidió al usuario repetir el cambio de dominio y los nombres; respuesta pendiente. No se declara COMPLETED.
