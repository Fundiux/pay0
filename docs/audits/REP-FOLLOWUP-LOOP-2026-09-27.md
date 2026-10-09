# REP: bucle de seguimiento y consultas SAT

**Cierre del hotfix inicial: correcciones publicadas y disparador REP suspendido por la orden de paro.** Rama original `fix/rep-followup-and-sat-readiness`. Las horas operativas son UTC del **28 de septiembre de 2026**; corresponden a la sesión local del día 27. No se reanudó la entrega automática; la elección de restablecerla quedó sin respuesta. La integración posterior se registra en [ASTRA — publicación y reconciliación del ciclo](ASTRA-PUBLICATION-2026-09-28.md).

## Actualización: adopción documental de cuatro REP históricos

A las **08:46:47.478 UTC** se aplicó el plan acotado de cuatro aplicaciones históricas, con digest `b8f8976b4c2559f6f6e9962223f56af973d5451ef3d79b9c286437e010d66eaa`. La validación previa, a las 08:45:46.994, confirmó las 25 revisiones originales sin cambios y los hashes reales de los ocho archivos en Storage. No se regeneró el plan.

El migrador confirmó cuatro adopciones, **ocho documentos canónicos activos y cero documentos legacy activos** en esa cohorte. Conservó los archivos y su evidencia; retirar la vista legacy no implica borrar los objetos. El estado financiero de las fuentes permaneció igual, exceptuando los campos de proyección documental expresamente permitidos por el verificador. Se comprobaron la pausa antes, durante y después de la migración y cero acciones del proveedor; no se solicitó ni timbró un REP nuevo.

El informe agregado quedó en el archivo ignorado `__untracked_archive/rep-historical-migration-20260928/after-b8f8976b4c2559f6f6e9962223f56af973d5451ef3d79b9c286437e010d66eaa.json`. El respaldo original y los checkpoints permanecen fuera de Git. Esta adopción no reactiva Eventarc ni demuestra ausencia de recurrencia bajo entrega activa. La ventana posterior, 08:46:47–09:12:13 UTC, registró un seguimiento canónico y una ejecución al borde de la migración, sin repeticiones posteriores ni errores HTTP 5xx. El postflight del Hosting final volvió a confirmar la pausa a las 09:21:16 UTC; ambas comprobaciones constan en el informe ASTRA enlazado arriba.

Antes de la migración, la lectura de las 08:17–08:19 confirmó cero eventos REP repetidos en ambas bitácoras y cero peticiones en los tres servicios REP desde las 07:47. Esa ventana corresponde a la contención con la entrega pausada, no a una prueba del trigger activo.

## Causa y corrección

El evento «Complemento Pago Seguimiento» se generaba en el servidor. Una aplicación con `iqComplementStatus=IMPORTED` volvía a adoptar su REP incluso después de completar la reconciliación: actualizaba timestamps de la aplicación y añadía otra actividad. Esa escritura volvía a disparar `enqueueAutomaticPaymentComplement`. La adopción ocurría antes de la compuerta de envío IQ, por lo que desactivar REP C no detenía el ciclo. El scheduler diario también podía repetir la adopción.

- `659bc40`: la adopción completa es una salida sin escrituras, logs ni descargas. Relee aplicación, solicitud de complemento, job, fuentes y documentos en transacción; repite la comprobación antes de finalizar para resolver concurrencia. Permite reparar vínculos parciales, rechaza metadatos canónicos incompletos y conserva la revisión de un job compartido cuando otra aplicación se revierte.
- `b982fbe`: limita la consulta SAT automática a seguimientos reales de cancelación de facturas emitidas en producción con datos suficientes. Excluye borradores y sandbox; conserva resultados terminales válidos y descarta respuestas obsoletas tras navegación. No cambia la autorización del callable ni inicia cancelaciones.

No se ocultaron los eventos históricos del Dashboard ni se modificaron importes, saldos o folios para resolver el incidente.

## Validación local

| Comprobación | Resultado |
| --- | --- |
| `payment-complement-adoption-idempotency.cjs` | 16 comprobaciones PASS en Firestore Emulator; Storage en memoria y fixtures sintéticos; cero acciones externas |
| Reintentos y concurrencia REP | Snapshots de datos y timestamps exactos sin cambios; una transición por primera adopción; replay del handler real; dos parcialidades con job compartido |
| Reparación y protección REP | Reparación parcial, rechazo de metadatos incompletos, pago cancelado, reversión durante descarga y conservación de revisión compartida |
| `solicitud-cancellation-followup.test.cjs` | Ocho grupos PASS con callable simulado; cero acciones externas |
| Política de autorización | PASS |
| Build frontend | PASS; 44 páginas estáticas |
| Build Functions | PASS |
| Descubrimiento Functions | PASS; 309 endpoints en 2.037 ms dentro del despliegue final, límite de 7.000 ms intacto |
| Hooks de publicación | PASS: 22 controles críticos, altas CSF de tres roles, 96 comprobaciones de reglas, 42 descargas con firmante simulado y ocho denegaciones |

Estas pruebas no equivalen a una consulta SAT/IQ real ni a una validación funcional autenticada en producción.

## Producción y contención

En la ventana 04:29–04:39 se observaron 1.151 peticiones por servicio en `enqueueAutomaticPaymentComplement` y `executeAutomaticPaymentComplement`. El contador corresponde a invocaciones, no a solicitudes externas de emisión REP.

| Componente | Evidencia final | Alcance de validación |
| --- | --- | --- |
| `enqueueAutomaticPaymentComplement` | Microdeploy: revisión `enqueueautomaticpaymentcomplement-00006-yus`; source generation `1790571400870578` | Confirmar ejecución posterior sin recurrencia cuando se restaure la entrega |
| `checkPaymentComplementsDaily` | `ACTIVE`, revisión `checkpaymentcomplementsdaily-00011-sej`, source generation `1790571498854563`; ZIP verificado | No se invocó manualmente el scheduler |
| Frontend Hosting/SSR | Live `c1eeaac789c780f4`, release `05:21:11.031Z`; pin `fh-c1eeaac789c780f4` a `ssrpay0system-00568-qep`, Ready, tráfico 100% | Seis rutas HTTP 200, cinco cabeceras protectoras, 22 bundles idénticos al build y tres navegaciones anónimas a login sin errores ni consultas SAT |

Cada artefacto parte de su propia fuente productiva exacta de 840 archivos: cambiaron únicamente `complementAutomation.ts`, su JavaScript compilado y su source map; 837 archivos permanecieron intactos. Se verificaron ambos ZIP publicados, incluidas las compuertas preservadas. `executeAutomaticPaymentComplement-00007-mid` y `runHugoIqRepRequestCanary-00004-yol` conservan sus revisiones y árboles completos. Esta operación no publica todo el backend del worktree ni atribuye a este frente el trabajo REP C concurrente.

Entre 04:54:20 y 05:00:11 se comprobaron cero peticiones y cero errores en esas cuatro funciones. Los únicos registros nuevos fueron 12 mensajes INFO/NOTICE del despliegue. La configuración consultada mantiene `iqRequestEnabled=false` explícito.

La auditoría final cubrió 05:07:26–05:21:42.956: cero logs y cero peticiones en las cuatro funciones. A las 05:21:56 la suscripción seguía pausada, con retención y ack intactos. La verificación HTTP/bundles/Chromium terminó a las 05:23:10.645. El preview `base8601-02-canary` conserva la versión `2495099408004b59` y la revisión SSR `00562-yiw`.

La lectura del cierre inicial encontró cinco aplicaciones `IMPORTED`: una canónica completa, cuyo último timestamp coincide con el drenaje del bucle, y cuatro históricas con documentos legacy READY. En esa lectura las cuatro carecían de ownership canónico de pago y se conservaron para una migración acotada posterior, aplicada a las 08:46 según la actualización anterior. No se observaron estados de revisión por reversión en ese conjunto.

Por solicitud de contención se suspendió la entrega push de la suscripción asociada mediante `pushConfig={}` a las 04:54:08.368. La última petición observada fue a las 04:54:14.5. No se eliminó la suscripción; se conservó su retención de mensajes de 24 horas. La ausencia de peticiones durante esta suspensión demuestra contención, no demuestra todavía que el parche haya detenido el bucle bajo entrega activa.

**Entrega final: suspendida.** Una futura reanudación debe restaurar la configuración guardada y comprobar el drenaje y la ausencia de recurrencia bajo entrega activa. No se interpretó la falta de respuesta a la pregunta de preferencia como autorización para reactivar. La cola conserva su retención previa de 24 horas; la pausa no elimina solicitudes, pagos ni documentos persistidos.

La configuración original y el restaurador con validación previa se conservan fuera de Git en `__untracked_archive/rep-followup-20260927/`. El restaurador es de sólo lectura por defecto; `--apply` exige las revisiones y hashes exactos reparados, verifica que la suscripción sigue suspendida y restaura únicamente el `pushConfig` guardado. No confirma ni elimina mensajes.

## Entorno y límites

Un build falló cuando el disco quedó sin espacio. Se limpiaron cachés `.next/cache` y artefactos `.firebase` propios, recuperando aproximadamente 1,7 GB; los builds posteriores pasaron. El primer intento de Hosting también se detuvo antes de publicar por un descubrimiento de 7.350 ms, superior al límite inalterado de 7.000 ms; la repetición aislada pasó en 2.782 ms. Los worktrees de los frentes paralelos se conservaron sin modificaciones.

En el cierre inicial del hotfix se verificó la ausencia de procesos Node/Java propios, de listeners de emuladores y del lock global. El servidor paralelo de visual-canary en 3010 se conservó. Los temporales de CLI propios quedaron eliminados; el respaldo operativo y su restaurador se preservan intencionalmente en el archivo ignorado. Esa validación inicial no incluyó merge, push, despliegue de reglas/índices ni operaciones reales de pago, timbrado, SAT, IQ o mensajería. Las publicaciones posteriores corresponden al informe ASTRA enlazado arriba. Este informe cubre el bucle REP y el seguimiento SAT descritos; no declara completados el backlog general ni los frentes Hugo/IQ.

La limpieza final retiró `.firebase`, `tmp/rep-followup-hotfix` y `firestore-debug.log` de este worktree, después de separar los dos enlaces a dependencias. Se comprobaron nuevamente las dependencias y el respaldo preservados; el volumen terminó con aproximadamente 4.035 MB libres. Los manifiestos compactos de fuentes y del parche quedaron junto al restaurador en el archivo ignorado. El árbol principal conserva su estado previo y sus archivos no seguidos.
