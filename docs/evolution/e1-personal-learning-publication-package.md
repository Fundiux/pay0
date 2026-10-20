# Aprendizaje personal y comprobantes — paquete de publicación

Estado: DEPLOYMENT_PENDING. Paquete probado y preparado para autorización específica; este documento no autoriza producción. Sin despliegues de estas nuevas capacidades.

## Capacidades

La interfaz permite revisar y corregir la interpretación de un comprobante usando los dos endpoints documentales ya publicados. La conversación permite corregir una respuesta como declaración privada del usuario, conservarla para el mismo cliente canónico o un tema seleccionado expresamente y retirarla después.

CLIENT muestra una nota personal en el reporte del cliente coincidente. No modifica importes, texto financiero ni PDF/XLSX. TOPIC incorpora la declaración al contexto del modelo sólo cuando se selecciona ese tema. No hay búsqueda difusa, regla global, aprobación automática ni cambio de permisos. La voz permanece fuera de esta entrega.

## Orden e identidades

1. Actualizar sólo `listAgent007MemoryDiagnostics` y `reviewAgent007MemoryCandidate`: lectores privados y revisión protegida antes de cualquier productor. Fuente `0382fcc97a42ed6064e3528c8d99faaca9f753f3`, ZIP limpio `f0787837136d9a279321810f8195a8c5d31ccc9eea0d99190fea6a41c4a3fcb6`, input `6ec9e17b458d701f1b4c81c3d31d0eced0a6be9a242f3b79bcb2787f36aae8b3`. Input privado: `.firebase/modular-release/personal-learning-readers-clean-release/input.json`.
2. Actualizar sólo `sendAgent007Message`: fuente `40bf096fcdd81c0a40e33c5574444a8f8c672e1e`, ZIP `22cbdbd9ca1426afb654b0830934b3e491b4dbbc7b909050ebe616811caa5588`, input `656d484399e22b1416765748fb2eb0dc2fb4c2a63655c7f90bc3d3dc85491d4d`. Base productiva D1 `763134cf`; preserva R1.5 y reportes. Input privado: `.firebase/modular-release/personal-learning-chat-release/input.json`.
3. Actualizar sólo `createAgent007MemoryCandidate`: productor de correcciones personales. Fuente `0382fcc97a42ed6064e3528c8d99faaca9f753f3`, ZIP limpio `586b4a3a7140e289049aa9c2f3ce65f68ae6d794b962a16043002082b4200eb5`, input `e0ce31e6acc69a26a9d49387337664dc07f43aad5556e5c8dd3e2484044dd580`. Input privado: `.firebase/modular-release/personal-learning-producer-clean-release/input.json`.
4. Publicar Hosting/SSR después de verificar los cuatro destinos anteriores: fuente aislada `3b6602d5b24e52f84f6f867d1048925272c41705`, ZIP `9522406cbb25db5651b4d0132eb89be99c468560e4ba872e21a5a34e2bc46a7d`, input `fe96465fcd05be2db396432810bdfd08386c3baed0778a15fc1284b0e7af245d`. Input privado: `.firebase/modular-release/hosting-3b6602d5b24e-0249d286-e045-4c59-aacd-53f4426ca156/input.json`. Conserva E/G, administración/MAT y exportaciones anteriores.

Cada destino conserva su base y recibo propios. No usar el ZIP del chat como base de los recursos MEMORY. Los inputs anteriores MEMORY `08548c74`/`dc26130c` y `d7001522`/`139e7350` quedan SUPERSEDED_NOT_FOR_RELEASE; el verificador canónico rechazó primero la etiqueta BUNDLED_V1 incorrecta y después un archivo de entorno heredado. No se alteran los controles para aceptar esos ZIP.

## Pruebas y dependencias

La integración pasó builds Functions y Next (47 rutas), 69 regresiones, nueve pruebas de persistencia real, diez de aislamiento y quince grupos UI. El ZIP exacto del chat pasó 66 regresiones, ocho pruebas TEXT, diez de ámbito, arranque y rechazo anónimo. El verificador canónico instaló dependencias productivas en un runtime nuevo y cargó 343 endpoints; sólo probó el destino autorizado y rechazó la llamada sin sesión. Preflight de sólo lectura confirma revisión `sendagent007message-00023-gaz`, configuración e IAM sin deriva; debe repetirse antes de publicar.

Dependencias documentales publicadas: `parsePagoReceiptPdf` revisión `00016-qoc` y `correctPagoReceiptSemanticField` revisión `00005-qej`, ZIP `f88b88d7`. La UI no inventa una versión de corrección si una respuesta antigua no la proporciona.

Riesgos y límites: el tema exige selección explícita y coincidencia normalizada exacta; no se infiere automáticamente desde otra conversación. Se recuperan como máximo tres correcciones recientes del ámbito. Declaraciones distintas en conflicto exigen revisión en vez de aplicar una silenciosamente. El comprobante conserva correcciones del mismo documento por usuario; no activa patrones globales para documentos nuevos. La entrega afecta cuatro recursos Functions y la interfaz en fases, por lo que una interrupción exige reconciliar los recibos antes de continuar.

Los tres artefactos limpios combinados pasaron 12 pruebas de ámbito MEMORY y ocho TEXT desde sus entradas públicas, sin skips ni proveedores. Ambos ZIP MEMORY reprodujeron fuente/patch/archivo; cada arranque preservó 341 exports y rechazó las llamadas anónimas de sus destinos. El verificador canónico independiente instaló dependencias productivas para ambos y pasó. Preflights GET de los cuatro destinos confirman fuentes/configuración/IAM sin deriva: readers `553cf499`, chat `ee3c15e7`, producer `5936e97a`. La prueba de reversión exacta productor limpio→chat anterior pasó: control PAY0 disponible y cero recuerdos privados en contextos o prompts de dos usuarios; recibo `9cac279c548dcab33044f9ad4d571156be279ad95a97ce26e25261d980fe1f7a`.

Las pruebas usan Firestore emulado y sintéticos, sin proveedores, operaciones financieras ni documentos productivos. El modelo sintético no certifica la respuesta de un proveedor generativo real. La UI requiere dos overrides QA explícitos y acotados: fixture autenticada de ingeniería y prueba documental actual que verifica edición, detalles e historial. La prueba documental histórica esperaba campos secundarios visibles antes de abrir Detalles; el contrato nuevo los conserva dentro de ese panel. Se preserva el fallo inicial y no se cambia el producto para satisfacer esa prueba antigua.

Runtime UI final PASS: cierre de módulos y rutas físicas, cinco rutas HTTP 200, Chromium en 390/1440, redirección anónima y cinco pruebas de componentes. Recibo canónico `12d0b6c5ea9a9fe4cae595b2a521d1a6984a3f1bd0f0dddb7d0242c386d5b0a0`; recibo con dos overrides declarados `9f1aee919f4f7d6a4faf352042292644b96db3363d88d23f0e2a5e24efe0eb1d`. Root cotejó independientemente hashes de input/ZIP/recibo/build/base/reversión y ejecutó `assertRuntimeProof`: PASS. Recibo: `runtime-84680562-947a-4704-bf2a-feca2384af59/proof-with-qa-override.json` dentro del directorio privado de Hosting anterior.

## Reversión

Detener el productor TEXT volviendo a su fuente anterior preservada; revertir chat a D1 `763134cf` y Hosting/SSR a la publicación E/G `b273a696` inmediatamente anterior. Conservar ambos lectores/review nuevos si se publicó un productor o existe incertidumbre sobre datos privados. Nunca restaurar los lectores C50 antiguos después de habilitar correcciones: podrían exponer o sustituir recuerdos privados. No borrar ni convertir recuerdos en globales. Esta reversión retira la funcionalidad nueva y mantiene la protección de los datos.

La UI anterior puede dejar de mostrar o retirar esos recuerdos; no se anuncia que fueron borrados. No se publica VOICE, por lo que no existe otro productor de este paquete que detener. Aplicar únicamente los controladores guardados y recibos del destino correspondiente; reconciliar cualquier operación incierta antes de repetirla.

## Verificación productiva y cierre

Comprobar fuente descargada exacta, configuración, IAM, revisión activa, rechazo anónimo y Hosting/SSR. Después, el usuario debe comprobar con su propia sesión el ciclo comprobante→lectura→corrección→relectura y respuesta→corrección→mismo tema/cliente→retiro. Verificar que otro tema/cliente no reutiliza la nota y que reportes/PDF continúan funcionando. No pedir archivos ni importes para acreditar el resultado.

Mientras sólo esté preparado: DEPLOYMENT_PENDING. Publicado sin ese recorrido: DEPLOYED_NOT_VERIFIED. Declarar COMPLETED únicamente para las capacidades realmente verificadas.

Integración: rama `feature/pay0-global-evolution-20261019`; fuentes TEXT `0382fcc`/`40bf096`, guard documental `0b20ab0`, recetas reproducibles `7ea440f` y guía de reversión `5e93ada`. VOICE local `f328eea` (62 pruebas) queda fuera del paquete. No se fusionó ni publicó ninguna rama remota.
