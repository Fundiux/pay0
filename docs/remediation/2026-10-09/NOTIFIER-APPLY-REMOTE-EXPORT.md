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

Revisar y conectar el consumo de este export por el launcher de CREATE, con sus hashes de confianza y comprobación de frescura. Después de autorización específica: renovar prerrequisitos, aplicar el plan guardado, verificar recursos y crear/verificar las tres Functions previstas, manteniendo entrega desactivada y colas pausadas. No activar ni enviar mensajes.
