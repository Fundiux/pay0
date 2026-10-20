# Enlace de evidencia remota al APPLY

Avance local dentro del punto 4 de la lista finita. No acredita infraestructura creada ni autorización para aplicar Terraform.

El controlador privado `.firebase/notifier-infra-apply-20261015/apply-only.cjs` incorpora el exportador revisado en el postflight de la misma ejecución propietaria del APPLY. Guarda las 16 respuestas originales y sus tiempos reales en `remote-export.json`, el resumen exacto en `remote-postflight.json` y sus hashes enlazados al estado y controlador en `remote-export-binding.json`. Conserva el contrato `APPLY_COMPLETE@1` que consume el binder de CREATE.

Antes de liberar el lock, reconstruye y valida el resumen desde las respuestas originales, comprueba las cinco identidades de cuentas contra el estado y coteja el enlace con el controlador. Un fallo de captura o cierre conserva el diagnóstico privado y no emite el comprobante de finalización. Los recibos originales permanecen ignorados por Git y no se imprimen en logs.

La ejecución queda expresamente deshabilitada con `LIVE=false`. Las evidencias de prerrequisitos siguen caducadas; no se renovaron. Se preservó la versión anterior de los dos archivos modificados en el directorio privado `versions/before-remote-export`.

## Evidencia local

- Controlador SHA256: `16036f7d4c10bbc1de1a33b9f9b46f39ba55433687ed00bdcf659699943a94ba`.
- Exportador fijado por SHA256: `633f8a57feb40132cea5d0c1e58eff41f4eb386c02437c63ffbd721b336a6470`.
- Suite afectada: 48/49 aprobadas inicialmente (`e263c0`); la prueba restante falló por EPERM al resolver la ruta del usuario. Reejecución exclusiva de esa prueba fuera del sandbox: aprobada (`17a752`). Las ocho pruebas nuevas incluyen manipulación de cuerpo, orden, resumen, cierre, reloj, estado HTTP, identidad de cuenta y bytes del resumen.
- `--offline-validate`: aprobado (`e88b9a`), plan de 19 recursos y hashes intactos, `executeReady=false`, cero autenticaciones, llamadas Cloud y comandos Terraform.
- No se repitieron suites de frontend, Functions, exporter o binder sin cambios. No se ejecutó el recorrido real de APPLY ni se generaron recibos de infraestructura real.

## Pendiente del mismo punto

El modo Prepare del launcher de CREATE ya consume selecciones revisadas de los nueve paquetes mediante `evidence-loader.cjs`. El manifiesto externo fija los hashes y la clausura de módulos del binder antes de cargarlos. El lector confina archivos al directorio privado `evidence`, rechaza enlaces, rutas fuera del ámbito, archivos grandes, cambios de hash y destinos distintos; vuelve a evaluar la frescura en cada lectura. No calcula hashes de confianza a partir de los archivos recibidos.

Diez pruebas nuevas de integración aprobadas (`b4045b`): paquete sintético completo con el verificador real, caducidad, destino diferente, modificación del archivo, rutas inválidas, getters y rechazo semántico pese a hashes coincidentes. No se repitieron las suites sin cambios. Prepare real aprobado (`337d21`): tres destinos PENDING, `live=false`, `inputReady=false`, `infrastructureBindingReady=false`, cero autenticaciones y llamadas Cloud. El intento anterior (`83d2cc`) se detuvo por `DEBUG`; se quitó únicamente esa variable del proceso de comprobación y se restauró después.

Hashes privados revisados:

- `evidence-loader.cjs`: `db486ba0e8a8b7a02a4aed240cadab4ea05b7068ec257ae6c758b4ba2d1741e1`.
- `owned.cjs`: `b7b9523a4dc0b3d03ff85c9676697925d1185297388fbe5854896578287b64aa`.
- `owned-pins.json`: `7007fa3ab9e57b76cbfc6f6be429a271bd830cf0cc0f14ef6389dc58d109689a`.

Sigue pendiente conectar la ejecución nativa supervisada: el worker deberá releer esos mismos paquetes fijados en cada comprobación fresh de createOnce, también después del registro de intención. Prepare no autoriza ni ejecuta CREATE. No hay recibos reales de APPLY/subida/prerrequisitos de creación y los tres inputs reales permanecen PENDING.

La composición `attemptBound` ya conecta el worker al lector de paquetes fijados: relee antes de autenticar, durante la comprobación del coordinador y después de la intención durable, inmediatamente antes de despachar HTTP. Vincula el upload y la versión numérica del secreto al request seleccionado. Si el archivo cambia después de la intención, conserva el owner y registra incertidumbre sin emitir POST. El punto pendiente se reduce al cableado nativo supervisado y sus comprobantes; la composición probada sigue siendo local y no habilita los gates.

Verificación del worker modificado: 33 pruebas aprobadas (`8bdca8`), incluidas tres nuevas de rechazo antes de autenticación, cambio posterior a intención y paquetes ausentes. Se añadieron después dos pruebas de integración (`bd1f05`), ambas aprobadas: recibos sintéticos completos consumidos por el binder real con un único POST simulado y modificación real del archivo posterior a intención con cero dispatch. No se repitieron las 33 aprobadas al añadir esos dos casos. No hubo red, autenticación real ni mensajes.

Hashes vigentes de esta composición: `owned.cjs` = `544fca77684d6cefaea0a191f1eacb8aa7c2162ff848d36a8ebfd037d9d05789`; `owned-pins.json` = `28a8aa1cb53ce782854fc0d4da4d3deacc7f8d72a0e41c9c6754cb82c24291b4`. Sustituyen únicamente los dos hashes anteriores; el loader permanece sin cambios. Versión anterior preservada privadamente en `versions/before-bound-attempt`.

Después de autorización específica: renovar prerrequisitos, aplicar el plan guardado, verificar recursos y crear/verificar las tres Functions previstas, manteniendo entrega desactivada y colas pausadas. No activar ni enviar mensajes.

## Launcher nativo conectado, ejecución deshabilitada

`native.cjs` conecta begin/worker/finish con el owner estable, bundles seleccionados por hash y `attemptBound`. `run-owned.ps1` usa el supervisor Windows Job ya fijado, con 240 segundos y 10 de cierre; guarda el comprobante del supervisor mediante escritura exclusiva y durable y solo finaliza con cierre y hashes válidos. ReadOperation restaura el owner y consulta la operación registrada: su preparación verifica el manifiesto sin exigir que sigan vigentes las observaciones de ausencia usadas para CREATE. No existe reintento automático de POST.

El manifiesto añade tres bundles reales, todos PENDING, además de los tres paquetes de evidencia PENDING. `LIVE=false` e `infrastructureBindingReady=false` permanecen intactos. No se adquirió ningún owner de producción ni se lanzó OAuth o CREATE.

Pruebas afectadas de preparación/manifiesto/PowerShell: 3 aprobadas (`0d011c`). Pruebas nuevas de entrada nativa: 7 aprobadas (`d9239a`), incluidos rechazo de los cuatro modos con efectos mientras el gate está apagado, manifiesto no revisado y bundle no seleccionado. Estas pruebas no acreditan la ejecución de un worker dentro del Job: queda por verificar esa composición con un proceso sintético sin autenticación ni red antes de habilitarla.

Hashes vigentes: native `33fbb16eaf9c66779210433c089f030f77f4cf31f2b7d40de600454af47cd1ce`; owned `b028d6545c412e90c51122b5535a1e8e7583e880bd4c35e94e289bd1fc2565df`; launcher `22637b145adc9397fbac0ab4a416823949effffe87c46c8184a7d8ecdf2f7ccb`; manifiesto `d523a2fead486111dc876f80533a35503808089c2c92e0cbed0213e38f46c584`. Versiones anteriores preservadas en `versions/before-native-launcher`.
