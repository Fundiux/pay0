# R1 — reporte canónico de utilidades en Hugo

Estado: **DEPLOYED_NOT_VERIFIED**. Publicación expresamente autorizada y ejecutada el 2026-10-19. Configuración, fuentes e IAM verificados; falta la prueba funcional con sesión autorizada.

## Resultado de publicación

| Function | Revisión activa | Comprobación productiva |
| --- | --- | --- |
| `sendAgent007Message` | `sendagent007message-00016-zop` | Archivo SHA256 aprobado, runtime/IAM conservados; petición sin autenticar devuelve 401 `UNAUTHENTICATED` |
| `delegateHugoVoiceTurn` | `delegatehugovoiceturn-00009-mez` | Archivo SHA256 aprobado, runtime/IAM conservados; petición sin autenticar devuelve 401 `UNAUTHENTICATED` |

No se necesitó reversión. El verificador detuvo inicialmente el cierre de chat porque no contemplaba las tres etiquetas nuevas de procedencia. Se confirmó que las diferencias eran exclusivamente esas etiquetas y metadatos esperados de revisión; se corrigió el comparador para exigir sus valores exactos. Pasaron 18 pruebas, incluidas alteración de etiquetas y deriva de configuración. La reanudación verificó la revisión existente sin volver a publicar chat. Este ajuste local no cambió ninguno de los dos artefactos autorizados.

La lectura posterior confirmó que gateway y endpoint público de reportes coinciden con la captura original. No se publicó Hosting, reglas ni otras Functions. Los recibos y pruebas de denegación están en el directorio privado de cada artefacto.

El usuario indicó que abriría una sesión PAY0 conectada. Hasta disponer de ella no se afirma haber comprobado los importes reales ni el flujo autenticado completo. No se registró `COMPLETED`.

## Alcance exacto

Actualizar únicamente dos Functions de `pay-0-system`, región `us-central1`, en secuencia: `sendAgent007Message` y `delegateHugoVoiceTurn`. Añade acceso al reporte canónico de utilidades por cliente con fechas explícitas, alcance del usuario, permiso de reportes, filtro de compensadas y aviso de truncamiento. Conserva las herramientas existentes.

El endpoint público `getEarningsByClientReport` conserva el mismo cálculo y no se actualiza. No incluye comparaciones de periodos, imagen gateway, frontend, reglas, índices ni otras Functions. La herramienta directa del gateway requiere otra entrega; no se presenta como publicada mediante R1.

## Identidad revisable

Directorio privado de los artefactos y sus pruebas:
`.firebase/modular-release/e1-2026-10-19T15-47-39-867Z/r1-report-overlay/`.

| Identidad | Chat | Delegación de voz |
| --- | --- | --- |
| Revisión de origen | `sendagent007message-00015-dah` | `delegatehugovoiceturn-00008-luy` |
| SHA256 archivo productivo base | `329b31f7f23c0b87556a38034cc5ae6e0f9e64f8b5a2d0d51ec6cd8eda723a98` | `30be69726976041af2d85f2fce2816dd87101d249573a425011bbada71b2bb0e` |
| SHA256 archivo compilado final | `ac5c096af6ec091922a73bc97b7646f63c2b3500cf1457821f4a967218b32456` | `e619cb6d27ec65bfd4980dc4d0259eb3d658cf3253bad2f66f164326df8cb03e` |
| SHA256 input.json | `aa425feacdc19f7240aa4a4226bab5527407629d0d4fb02deffd5f43acac309c` | `60206afc34311636ad3445811cb04de3c54cc73dbd2a8038949bb7c2829f536f` |
| Grupo | `hugo-chat-overlay` | `hugo-voice-overlay` |

Identidad compuesta `PRODUCTION_OVERLAY_V1`, `sourceTree: null`. Commit de origen del parche: `bf0d3c75ed9a7d854356052e02a361e05bf467de`. SHA256 del parche revisado: `be1e3021710d34d4a03f27f6c6c57c8e84094eabd5fc2643ee5879279383e212`. No equivale a publicar el checkout de ese commit. Se conservaron manifiestos, lockfiles, configuración de TypeScript y fuentes auxiliares de cada versión productiva.

## Pruebas y dependencias

Las dos fuentes compilaron con su configuración original. Cada archivo final pasó cinco pruebas de comportamiento extraídas del commit del parche: cálculo canónico con datos sintéticos, exclusión de root ajeno, compensadas incluidas/excluidas, permisos y usuario deshabilitado, fechas inválidas, inyección de identidad y truncamiento. El mismo resultado llega a chat y delegación: 37.45 sin compensadas y 136.45 incluyéndolas, según el fixture. No son importes productivos.

Se verificó además igualdad del conjunto de herramientas anteriores, validación de entradas y hash del archivo exacto. Las pruebas de arranque aislado pasaron: 342 endpoints cargados en chat y 341 en delegación; el endpoint seleccionado deniega invocaciones sin autenticar en cada uno. Los procesos terminaron con código 0. El primer intento superó el límite de 30 segundos; la repetición del mismo probe utilizó la instalación ya verificada, con límite local de 120 segundos. Se comprobó igualdad byte a byte de los 796 y 788 archivos contra los ZIP finales. `artifact-verification.json` registra explícitamente esa reutilización, el hash del probe y la identidad. El ejecutor rechaza una prueba ausente o distinta.

Depende de las credenciales y configuración ya presentes en las Functions. No crea secretos, cambia IAM ni habilita acceso directo a datos. No se ejercitaron proveedores, voz real ni registros financieros productivos.

## Riesgos y reversión

La actualización crea nuevas revisiones con tráfico conforme a la configuración existente; puede introducir latencia de arranque o un error en el nuevo camino de reportes. El resto del código parte de la fuente realmente desplegada. El ejecutor vuelve a comparar fuente, runtime, IAM y configuración antes de cada actualización y detiene la operación ante divergencias.

Si falla un paso, no continuar con el siguiente. La reversión restaura por Function el archivo y etiquetas originales preservados, comprueba hash, estado ACTIVE y configuración. No revierte datos ni elimina auditoría. Las dos actualizaciones son independientes; registrar cualquier publicación parcial.

## Ejecución y verificación, sólo después de autorización

Usar `scripts/deploy-scoped-functions.mjs --execute` con cada `release-<Function>/input.json` y su SHA256 exacto de la tabla. No usar `firebase deploy` general. Conservar el expediente privado que produce el ejecutor.

Después de cada paso: confirmar operación terminada, estado ACTIVE, nueva revisión, hash de fuente y runtime/IAM preservados. Registrar `DEPLOYED_NOT_VERIFIED`. Luego, con una sesión autorizada, consultar en chat un intervalo explícito conocido, comparar sus importes y compensadas con el reporte existente y comprobar denegación sin permisos. Para voz, comprobar el camino de delegación disponible sin asumir que el gateway ya expone la herramienta nueva. Sólo declarar `COMPLETED` para los flujos comprobados realmente. Si no existe una sesión adecuada, mantener `DEPLOYED_NOT_VERIFIED` y solicitar únicamente esa verificación pendiente.
