# R1.1 — corrección de persistencia de métricas de María

Estado: **PREPARED_NOT_DEPLOYED**. Requiere autorización nueva para los bytes indicados. No se ha ejecutado publicación ni escritura productiva.

## Causa y alcance

Cloud Logging confirmó tres errores en `sendagent007message-00016-zop` el 2026-10-19 a las 17:45:45, 17:45:51 y 17:46:28 UTC: Firestore rechazó `tokenUsage.cachedInput` con valor `undefined`, durante `FirestoreHugoDataStore.saveTurn`. No se copiaron conversaciones ni respuestas financieras.

La línea defectuosa era idéntica en los archivos productivos anteriores a R1. La corrección omite solamente métricas opcionales `undefined` al construir `tokenUsage` en los adaptadores OpenAI y Vertex; conserva ceros, `null` y los valores presentes. Incluye el retorno del reintento existente de Vertex. No cambia permisos, fórmulas financieras, configuración global de Firestore ni política de reintentos.

Publicar únicamente `sendAgent007Message` y `delegateHugoVoiceTurn`, en ese orden. Cada ZIP deriva del artefacto R1 publicado y cambia exactamente cuatro archivos: los dos adaptadores compilados y sus mapas. No incluye R2, frontend, gateway, reglas, índices ni otras Functions.

## Identidad exacta

Directorio privado: `.firebase/modular-release/r1-token-usage-hotfix/`.

Commit del parche: `ac002ade0cd37ad8ba7ce6f1bd228134076af3b3`.
SHA256 del parche fuente limitado a los dos adaptadores: `546374048b05a71447434b1cb1e4000652afc4b01d3a0e3d362231f316f71049`.
Identidad: `PRODUCTION_OVERLAY_V1`, `sourceTree: null`. El commit identifica el parche; no se publica su checkout completo.

| Identidad | Chat | Delegación de voz |
| --- | --- | --- |
| Revisión base vigente | `sendagent007message-00016-zop` | `delegatehugovoiceturn-00009-mez` |
| SHA256 ZIP base | `ac5c096af6ec091922a73bc97b7646f63c2b3500cf1457821f4a967218b32456` | `e619cb6d27ec65bfd4980dc4d0259eb3d658cf3253bad2f66f164326df8cb03e` |
| SHA256 ZIP correctivo | `8472bd111b323231b827e13e495fbfb137e17bbcb8ff6d823ad2d6d95b33413a` | `f7407ccfd1fcfb8ccca950b8b7a731a5df0fc80ea6c91560ac3e90edac2f8c88` |
| SHA256 input.json | `829cc8b239f66141ee40e98a0e8d8cde4d96fbfa736c4603f43d5deb84d7bed0` | `8b3de8a883bb7d4a26aa0df6adff1c2a91b428db3111e5034dc14368f7af61ed` |
| Grupo | `hugo-chat-overlay` | `hugo-voice-overlay` |
| Archivos del ZIP | 796 | 788 |

Los inputs y las pruebas están en `release-sendAgent007Message/` y `release-delegateHugoVoiceTurn/`. `manifest.json` registra hashes individuales y evidencia técnica saneada. La captura nueva `baseline.json` confirmó igualdad completa de recurso, servicio e IAM con los recibos finales de R1.

## Verificación

- Build NORMAL de Functions aprobado por el coordinador tras el commit. Suite de persistencia local del coordinador: 13/13.
- Ambos artefactos exactos: 13/13 pruebas de persistencia cada uno; métricas ausentes, ceros, `null`, respuesta inicial y reintento Vertex. El SDK real de Firestore valida `set/create`; solamente `commit` está sustituido para impedir RPC. Un control reproduce el rechazo original. No se utilizó emulador.
- Regresión del reporte R1: 5/5 por artefacto, con fixtures sintéticos y red bloqueada. Total de pruebas de los overlays: 36/36, sin omisiones.
- Arranque con el probe canónico original y dependencias verificadas reutilizadas: 342 endpoints en chat y 341 en voz; ambos endpoints seleccionados rechazan la petición sin autenticar. Los procesos terminaron con código 0. Los hashes del probe constan en cada `artifact-verification.json`.
- Se verificó igualdad de todos los archivos empaquetados con el runtime probado, y de los 792/784 archivos sin cambios con la base R1. Manifiestos y lockfiles no cambian.

## Ejecución y reversión

Después de autorización explícita nueva, usar `scripts/deploy-scoped-functions.mjs --execute` con cada input y su SHA256 exacto, primero chat y después voz. El ejecutor debe comprobar nuevamente baseline, IAM, runtime, identidad y fuente antes de actualizar. Detenerse si hay deriva o falla un paso. No usar despliegue general de Firebase.

Cada directorio de release conserva su ZIP R1 anterior para reversión. La reversión restaura ese archivo y las etiquetas previas, verifica el hash y el estado ACTIVE; no altera datos. Registra cualquier publicación parcial antes de continuar.

Tras publicar: comprobar configuración y hash de ambas revisiones, probar una conversación autenticada en María y verificar que se persista sin INTERNAL. Hasta esa comprobación mantener **DEPLOYED_NOT_VERIFIED**. Estas pruebas locales no demuestran funcionamiento productivo autenticado ni ejercicio de proveedores reales.
