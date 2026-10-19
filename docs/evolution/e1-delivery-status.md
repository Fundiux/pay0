# E1 — reconciliación y entregas progresivas

Fecha de actualización: 2026-10-19. R1 publicado con autorización explícita; pendiente de verificación funcional autenticada.

## Referencia productiva observada

La consulta autenticada de metadatos encontró Hosting `d446c05b06cc4941` y el gateway con 100 % de tráfico en `hugo-voice-gateway-canary-astra-7dfcd8a`. No se infiere que un commit local esté publicado por pertenecer a main.

| Capacidad | Evidencia y estado |
| --- | --- |
| Reporte público de utilidades | El cuerpo del cálculo desplegado coincide con el que reutiliza R1. Se conserva; no se vuelve a publicar ese endpoint. |
| Reporte de utilidades en chat y delegación Hugo | R1 publicado en `sendagent007message-00016-zop` y `delegatehugovoiceturn-00009-mez`, con hashes e IAM verificados y denegación sin autenticar comprobada en producción. `DEPLOYED_NOT_VERIFIED`: falta sesión autorizada para contrastar el reporte real. |
| Protección de root en cotizaciones | Confirmada en fuente productiva de `generateSolicitudQuotation`, revisión `generatesolicitudquotation-00021-vuq`. Recuperada en la línea local, con tres pruebas. No requiere otra publicación por este cambio. No se declara verificado el flujo funcional completo. |
| Herramienta directa de reporte en gateway | Pendiente de construir y aprobar imagen específica. La revisión actual conserva las 13 herramientas anteriores. |
| Comparaciones de periodos y contexto | Integradas localmente en `0a783d0`; 56 pruebas backend y 49 gateway aprobadas. Requieren paquete posterior sobre la base productiva vigente. `DEPLOYMENT_PENDING`. |
| Revisión administrativa de recuperaciones y formularios MAT | Integradas localmente en `a280e72`; emulador real verifica concurrencia, auditoría, paginación y permisos. Pruebas de navegador con fixtures; sin operaciones financieras reales. `DEPLOYMENT_PENDING`. |
| Transporte Telegram | Integrado localmente en `afe9ad2`; 23 pruebas de transporte aprobadas. Debe revisar 46 exportaciones transitivas antes de seleccionar el paquete. No se enviaron mensajes reales. |
| Control de capacidades canónicas | Integrado en `d6f9d42`, conectado a CI y preparación de candidatos. Verificación local aprobada; CI remoto no ejecutado. |
| Consumidor QR WhatsApp | Productor, wrapper e interfaz presentes. No se ha localizado el consumidor ejecutable de comandos. Incompleto. |

## Separación de entregas

R1 sólo actualiza `sendAgent007Message` y `delegateHugoVoiceTurn`. No despliega el checkout completo: arrastraría diferencias de autorización y automatización ajenas al reporte. Su identidad es fuente productiva original + parche revisado + archivo compilado final. El commit `bf0d3c75ed9a7d854356052e02a361e05bf467de` identifica el origen del parche, no todo el código de la Function.

R2 añade comparaciones y contexto. R3 requiere dos nuevas Functions (`listOperationRecoveryReviews`, `acknowledgeOperationRecoveryReview`) antes del frontend que las usa. MAT reutiliza la autenticación y los dominios existentes. La consulta de revisión usa root, estado e ID; su disponibilidad de índices productivos debe comprobarse antes de publicar. No se presupone un índice faltante por el resultado del emulador. No requiere abrir reglas de acceso directo.

Telegram es una entrega independiente: una falla después del despacho sigue siendo entrega incierta y no añade reintentos. El cambio conserva el contrato no excepcional para respuestas 2xx malformadas, retirando su contenido remoto.

## Verificación y reversión

Functions compila con Node 22 en modo NORMAL y el frontend pasa su build de producción Next.js 15.5.27 (47 páginas estáticas). El entorno aislado terminaba procesos largos sin diagnóstico; la compilación local elevada terminó satisfactoriamente con las mismas fuentes y configuración. La política de autorización y los registros canónicos pasan. Los artefactos R1 se verifican por separado; las pruebas generales no sustituyen sus pruebas exactas.

Cada actualización debe detenerse si cambian fuente, runtime o IAM frente a su captura. Conservar archivos previos y metadatos privados para reversión; no borrar auditoría ni datos. El estado después de desplegar será `DEPLOYED_NOT_VERIFIED` hasta comprobar el flujo autenticado real. Ninguna capacidad nueva se declara `COMPLETED` sólo por estar en Git.

Los worktrees anteriores, incluidos los cambios locales del Lote 1, permanecen intactos. No se hizo merge, rebase ni push. Se publicaron exclusivamente las dos Functions de R1 autorizadas.
