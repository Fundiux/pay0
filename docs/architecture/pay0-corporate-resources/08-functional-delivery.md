# Recursos corporativos: entrega funcional acotada

Fecha: 2026-09-28. Estado: implementación local y pruebas de emulador; este documento no acredita despliegue ni migración de producción.

La pantalla `/administracion/recursos-corporativos` permite administrar plantillas, imágenes y documentos de empresas propias dentro del mismo `rootId`. La gestión corresponde a superadministración. Administradores y operadores conservan los permisos actuales de sus solicitudes para generar documentos; no requieren acceso al centro corporativo.

## Contrato realmente implementado

- Se reutilizan `pay0CanonicalResources`, `pay0CanonicalResourceVersions`, `pay0CanonicalAuditLog` y el prefijo `pay0-canonical`. Las sesiones temporales usan `pay0CanonicalUploadSessions`; no se crea un segundo centro `pay0Corporate*`.
- El inventario de migración es de sólo lectura. Importar un paquete existente crea una versión en revisión; aprobarla y activarla son acciones separadas. Ninguna importación masiva o activación de producción es automática.
- El helper interno de mantenimiento admite el plan autorizado de paquetes Git con digest previamente revisado. Registra actor SYSTEM, activa sólo ese contenido, conserva recursos ya administrados y retoma una interrupción propia en DRAFT/REVIEW sin crear otra versión. No se exporta como callable ni elimina decisiones operativas existentes.
- Cada recurso tiene una clave estable por empresa, historial, versión activa y artefactos con SHA-256. Activar retira la versión anterior en una transacción; restaurar crea otra versión y conserva los objetos anteriores.
- Las cargas PDF/PNG/JPEG se preparan en backend, llegan a una ruta de staging autorizada y se validan antes de copiarse a un objeto inmutable. La descarga usa autorización server-side y URL de cinco minutos. Firestore y los objetos canónicos no tienen acceso directo desde clientes.
- Una plantilla activa alimenta las nuevas cotizaciones o constancias. Una imagen activa con clave `LOGO` sustituye el logo para esa empresa y se registra en el snapshot. Los demás documentos e imágenes están disponibles para consulta; no se atribuye una integración automática que no existe.
- Si nunca hubo una versión activa, el generador conserva el paquete canónico publicado incluido en el backend. Si se retira una plantilla o LOGO previamente activo, la generación exige activar otra versión; no hay un cambio de fuente silencioso.

## Documentos y firma

Los 21 paquetes empresariales existentes siguen siendo la fuente de identidad. Las cotizaciones usan su HTML/CSS y el color del manifiesto corporativo correspondiente. Las constancias se proyectan de v1.1 a v1.2 sin editar las referencias históricas: un bloque de firma de la persona receptora, lugar y dirección declarados y aceptación explícita. El hash del paquete renderizado y el hash del PDF de referencia son diferentes y se guardan como tales.

El enlace público y la captura dentro de Documentos usan la misma validación del servidor. Nombre, cargo, lugar, dirección y aceptación son obligatorios; observaciones son opcionales. El domicilio fiscal no sustituye la dirección declarada y no se captura GPS. La solicitud, cliente, empresa, creador del enlace y permisos se comprueban antes de sellar. El token se reserva transaccionalmente para impedir dos firmas concurrentes; una reserva abandonada sin evidencia sellada puede recuperarse después de dos minutos.

Una firma sellada no se vuelve a pedir si falla la generación del PDF. La interfaz comunica el pendiente y el responsable puede usar `Generar constancia`. La recuperación reutiliza la constancia activa cuando ya corresponde a esa firma.

## Evidencia local

- `qa/scripts/canonical-documents-pdf-smoke.cjs`: carga los 63 paquetes (21 empresas por tres tipos); genera nueve PDFs sintéticos de tres empresas y verifica identidad, placeholders, paginación, ubicación, aceptación y firma única. Los PDFs y PNG de inspección son artefactos ignorados bajo `tmp/pdfs/corporate-resources`.
- `qa/scripts/corporate-resources-emulator.cjs`: prueba gestión y consumo de versiones, permisos del backend, reglas de Firestore/Storage, reintentos, concurrencia y firma con datos sintéticos. Exige Firestore y Storage locales y proyecto `demo-*`; prohíbe HTTP externo. El resultado final debe registrarse en el cierre del ciclo.
- `qa/scripts/materiality-oc-automatic-smoke.mjs` incorpora los campos obligatorios de recepción. La actualización específica de referencias REP y actor SYSTEM se verifica en el frente de Materialidad del mismo ciclo.
- Ejecución local 2026-09-28: PDF `247 PASS` y nueve PDFs revisados visualmente; emulador `72 PASS`, incluidos nombre fiscal, migración autorizada y recuperación DRAFT/REVIEW. Un décimo PDF generado por el flujo real de firma también fue inspeccionado. Functions build y comprobación completa de tipos del frontend pasaron; el build final integrado corresponde al cierre del ciclo.
- `qa/scripts/verify-firebase-storage-framing.cjs`: ocho casos de fragmentación UTF-8 y respuestas múltiples. El lanzador activa su adaptador sólo cuando se solicita Storage Emulator explícitamente; corrige el framing del proceso Java, sin editar Firebase CLI global ni suavizar reglas.

## Límites explícitos

No se implementan aquí editores de CFDI, SAT, integraciones, parámetros globales ni rotación de secretos. Sus nombres siguen reservados. Tampoco se migra la historia financiera ni se modifican documentos ya emitidos. La lista administrativa está limitada a 500 recursos y el detalle a 200 versiones/eventos por recurso. La aprobación de contenido y activación son decisiones operativas de la persona autorizada; no son una compuerta adicional para integrar el código ya solicitado.

El paquete de arquitectura 00–07 fue copiado a esta rama sin alterar ni desplazar los originales del workspace principal.
