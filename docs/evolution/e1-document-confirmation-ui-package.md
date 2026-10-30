# Confirmación documental: paquete UI independiente

Estado: **COMPLETED**, limitado al ciclo documental guardar corrección → volver a analizar → recuperar la corrección. La publicación fue específicamente autorizada, verificada técnicamente y después confirmada por el usuario con su sesión.

## Cambio y preservación

La confirmación de guardado exige acuse con identificador de corrección, versión anterior más uno, resultado humano del campo solicitado y procedencia HUMAN_CORRECTION. La tarjeta muestra el valor y la versión confirmados por el servidor. «Volver a analizar» verifica por separado que ese valor reaparece con su versión/procedencia; una relectura inconsistente muestra alerta y no afirma que fue verificada. La copia local indica cómo usar el panel de comprobantes de `/hugo`.

Fuente aislada `28924fbb31675a09ac5be35662f28731a163e146`, árbol `6a6d836b5f17334aa0ade1b211af5e17e595b36a`, rama privada `fix/document-confirmation-ui-20261020`. Parte directamente de la UI publicada `3b6602d5b24e52f84f6f867d1048925272c41705`; cambia únicamente `src/components/hugo/HugoReceiptLearning.tsx`, idéntico al componente del commit integrado `65accf31e98992939e8e51e4951377749e547251`. Todas las demás fuentes se conservan, incluidos reportes, correcciones personales, E/G, administración/MAT y backend. No incluye las reparaciones backend posteriores.

## Identidades exactas

- Build canonical PASS `f264d7689711f72b86dfa6ffa6ef8f161e2e2cad8dd4db049ac075be53fca977`.
- Input `4f6a110df11f7b16d689309721070f27ac8cf43096df860e043db17435f87f2f`.
- ZIP SSR `39e008804f66f1a01fb580102c898b146a8d55c403f84775cceb32af9f7ec218`, 170 archivos Hosting.
- Baseline publicada `8ed93cfab18882f367f6aaef24fcc6081fe2a4817e47568db4bf81832562ef01`.
- ZIP anterior/reversión `9522406cbb25db5651b4d0132eb89be99c468560e4ba872e21a5a34e2bc46a7d`, fuente `3b6602d`.
- Provenance original `6b52949598a0b778c33d90ceb8e79683336d72d83cd108105a4fdaee96b7405a`, conservada intacta. Su estado PUBLICADO_VERIFICADO_TECNICO_AUTH_PENDING requirió una copia privada con vocabulario FRONTEND_ARTIFACTS_PREPARED para el helper. La copia preserva estado/hash originales y fuente/ZIP/baseline sin cambio; no se modificó el helper ni se sustituyó la evidencia de publicación.

Input privado: `.firebase/modular-release/hosting-28924fbb3167-ee7d414c-7b9c-4b22-a344-a41c779c8d96/input.json`. El primer intento de instalación fue cancelado por instrucción de raíz para serializar I/O, después de verificar la ascendencia propia del único PID detenido. Logs y candidato parcial se conservaron. El segundo build canonical terminó con exit 0; el intento cancelado no se cuenta como PASS.

## Evidencia

Build aislado Next.js 15.5.27 PASS, 47 rutas. Sobre esa copia exacta, componentes/wrappers reales con transporte Firebase sintético: doce casos documentales y quince de correcciones personales. Incluye ACK obsoleto, falta de procedencia humana, pérdida de corrección al reanalizar, recuperación posterior, legacy sin versión, errores y descarte de respuestas tras cambio de identidad. No se atribuye esta simulación al backend productivo.

Runtime nuevo extraído del ZIP exacto. Sólo se copiaron node_modules de un runtime anterior después de comprobar package/lock idénticos; rutas físicas y cierre de módulos se volvieron a validar. El árbol Git Functions y manifiestos de la copia coinciden con la fuente anterior antes de enlazar dependencias exclusivamente para QA.

Verificador SSR canonical bajo Firestore demo aislado: PASS, exit 0 y emulador cerrado. Validó 485 archivos de fuente, rutas físicas, cierre de dependencias, cinco rutas HTTP 200, Chromium en 390/1440, redirección anónima a login y cinco pruebas de componentes. Conserva dos overrides QA acotados por hash: fixture autenticada de ingeniería y prueba documental actual que abre Detalles y verifica edición/historial. No se cambió producto para satisfacer fixtures antiguas.

Recibo canonical `e44d60a9093efe321d79b94d76617c4ff4a6c5f8b3fdde46d439e2c8f4a71cb6`. Recibo ampliado con ambos overrides, preservación de fuente y hashes de QA: `292cf193190ce32ea35a3dafc0b60c56a46153a48cb942d19bfd6a8017ada64e`; assertRuntimeProof PASS. Archivo privado: `runtime-daee88c9-107e-4dd2-af9f-8f7e510a17c5/proof-with-qa-override.json` dentro del directorio de input anterior.

Raíz cotejó independientemente proof, hashes de paquete/fuente/build/base/ZIP previo y assertRuntimeProof: PASS. Preflight canónico de sólo lectura: primer intento METADATA_HTTP_503, preservado sin concluir deriva; segundo intento PASS, sin alterar input ni guardas. Captura posterior 2026-10-20T16:12:58Z: fuente/configuración/Run/IAM/Hosting sin deriva y cero operaciones activas, cero documentos de negocio o mutaciones. Recibo `fresh-preflight-6e0d25be-ff19-4989-84a9-ac95e32dc477/verification.json`, SHA `bedeeebaf2f6e3fcd5e5ae9d9f231f7f8ab4737a25364b1db4479d0467607bfe`, dentro del directorio de input. Es evidencia de ese instante; el ejecutor revalida antes de publicar.

La auditoría de provenance confirmó que sólo cambian el vocabulario de status y cuatro campos de trazabilidad; todos los campos originales restantes son idénticos. Original 6b529… intacto; copia derivada SHA `2d51588b686f58320c5aea938949d5a2d9b7453119c65e6de5d685f338ac446c`. Ningún helper fue modificado.

Receta privada revisada antes de publicar: `output/document-confirmation-ui/deployment-recipe.md`, SHA `8ef9ddb38f9ac71c2913253cd86476d15eae20d7ddf179feb8d92bf9257f2847`. Verificador independiente posterior, sólo lectura y condicionado al cierre de raíz: `output/document-confirmation-ui/verify-published.mjs`, SHA `5fe16ed99e345caf90c4fd05299a4d258639d51e4eaf23c14b794d1f3db2225b`, sintaxis PASS. Ejecución y resultados posteriores se registran abajo.

## Dependencias y reversión

No requiere publicar backend nuevo. Reutiliza los dos destinos documentales ya publicados: parsePagoReceiptPdf `00016-qoc` y correctPagoReceiptSemanticField `00005-qej`, ZIP `f88b88d7`. Las respuestas antiguas sin versión permanecen de sólo lectura. No cambia permisos, reglas, almacenamiento, pagos ni solicitudes.

Si se autoriza y publica este paquete, revertir únicamente Hosting/SSR a su ZIP anterior 952… mediante el controlador y recibo propios, preservando configuración/IAM. No revertir los lectores protegidos MEMORY ni borrar correcciones: esta entrega no los modifica y la UI anterior ya es compatible con esos registros. No hay rollback de datos ni activación de reglas/VOZ.

El usuario confirmó explícitamente ambas señales en su sesión: guardado confirmado por el servidor con versión y recuperación de la corrección al volver a analizar. Esto completa el ciclo documental acotado; no certifica conciliación, movimientos financieros ni otros flujos. La validación independiente anterior no usó datos de negocio ni proveedores.

## Publicación y comprobación independiente

Raíz ejecutó la publicación específicamente autorizada en sesión 67943, exit 0 y RELEASE_VERIFIED: Hosting `18cb9743dfc01c50`, SSR `00612-yuq`, ZIP 39e008… exacto. La primera comprobación independiente se detuvo porque Hosting completó sus contadores derivados: fileCount ausente→172 y versionBytes ausente→4098861. Fuente, recurso, Run e IAM eran idénticos al recibo propio; el resto de Hosting también. Se preservaron original/propuesta y raíz confirmó independientemente que sólo cambiaban esos dos campos.

Únicamente tras aprobación de raíz se reconciliaron esos campos en el archivo own local, sin operación cloud. Original SHA `7991166b86a45eb4e1fe6ce978d799200700d8dab381a0b462e8b9810ecbb7b9`, propuesta aplicada `a77d79c0af17288e917889ead94701178bef3845704ec0bd18d2d442507e8584`; recibo local SHA `4f8d040bdec9393bcecdbaea5edd8319cd1c5c981b1177172bfe63bbbbc10d26`. No se borró ni sobrescribió el original preservado.

Repetición del verificador original, sólo GET: PASS el 2026-10-20T16:35:31Z, exit 0. Fuente descargada exacta, configuración/Run/IAM preservados, cero operaciones activas y cinco rutas HTTP 200. Recibo `690dd7f48d7ae9cac78f67b4663dcdd9dc78beb16b0f508e64acbaca96dddda7`, en `independent-post-publication-32ae41be-f4f4-43a5-85a3-d9182822da8f/verification.json` dentro del directorio del input. Su campo countersReconciledLocally=false indica que ya no había diferencia en esa repetición; la derivación previa queda en el recibo local separado.

Baseline privada estable `ui-document-confirmation-stable-baseline.json`, SHA `b51bf266e584499f417fa368792a1904a4dfc78c2a393807991d91fe37cdfdb4`; provenance nueva `ui-document-confirmation-published-provenance.json`, SHA `ff0bf26c576f2d728ce14879dc4dc8364645d36769252b1638a9dff2f988c24c`, ambas bajo `.firebase/modular-release`. Resumen independiente SHA `1bb7af2c0baed3d2b0e3645b31907ba3a0703b536b0e81094ad51b29c5869f5f`. Cero llamadas autenticadas de negocio, lecturas de documentos, proveedores o mutaciones cloud del verificador. Estos recibos técnicos se conservan intactos; la confirmación funcional posterior del usuario es evidencia adicional del ciclo acotado.

La nueva petición de retirar barreras de lectura previas a la conciliación se desarrolla por separado. No cambia el alcance ni invalida la certificación anterior de guardado y recuperación documental. Esta nota no reproduce nombres, importes, cuentas, identificadores de usuario ni contenido del comprobante.
