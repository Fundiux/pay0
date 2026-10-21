# E1 — reconciliación y entregas progresivas

Fecha de actualización: 2026-10-19. R1 sigue funcionalmente incompleto: el usuario ya no reportó INTERNAL, pero María no generó ni entregó el reporte. R1.2 está en preparación con continuidad y descarga real.

Continuación E2: R1.1 sustituyó chat por `sendagent007message-00017-nup` y voz
por `delegatehugovoiceturn-00010-caj` tras el error de persistencia reportado.
GHK1 publicó descarga por generación en `getauthorizeddocumentdownloadurl-00007-yah`.
GHK1 tiene confirmación del usuario para descargas de solicitudes y pagos, limitada a esos flujos. F y los tres parches de aislamiento MAT también están publicados y `DEPLOYED_NOT_VERIFIED`: configuración y controles previos comprobados; faltan flujos operativos reales. El estado global
y las entregas adicionales se mantienen en [e2-parallel-status.md](e2-parallel-status.md).

## Referencia productiva observada

La consulta inicial encontró Hosting `d446c05b06cc4941`. Una publicación concurrente posterior lo sustituyó por `3beebe572c91f420`, SSR `ssrpay0system-00598-vuq`, fuente `c1738b4`. Las entregas nuevas de interfaz parten de esa fuente. El gateway mantiene 100 % de tráfico en `hugo-voice-gateway-canary-astra-7dfcd8a`. No se infiere que un commit local esté publicado por pertenecer a main.

| Capacidad | Evidencia y estado |
| --- | --- |
| Reporte público de utilidades | El cuerpo del cálculo desplegado coincide con el que reutiliza R1. Se conserva; no se vuelve a publicar ese endpoint. |
| Reporte de utilidades en chat y delegación Hugo | R1 publicado en `sendagent007message-00016-zop` y `delegatehugovoiceturn-00009-mez`, con hashes e IAM verificados y denegación sin autenticar comprobada en producción. `DEPLOYED_NOT_VERIFIED`: falta sesión autorizada para contrastar el reporte real. |
| Protección de root en cotizaciones | Confirmada en fuente productiva de `generateSolicitudQuotation`, revisión `generatesolicitudquotation-00021-vuq`. Recuperada en la línea local, con tres pruebas. No requiere otra publicación por este cambio. No se declara verificado el flujo funcional completo. |
| Herramienta directa de reporte en gateway | Pendiente de construir y aprobar imagen específica. La revisión actual conserva las 13 herramientas anteriores. |
| Comparaciones de periodos y contexto | Integradas localmente en `0a783d0`; 56 pruebas backend y 49 gateway aprobadas. Requieren paquete posterior sobre la base productiva vigente. `DEPLOYMENT_PENDING`. |
| Revisión administrativa de recuperaciones y formularios MAT | Integradas localmente en `a280e72`; emulador real verifica concurrencia, auditoría, paginación y permisos. Pruebas de navegador con fixtures; sin operaciones financieras reales. `DEPLOYMENT_PENDING`. |
| Transporte Telegram | Transporte en main y notificación de prueba `00016-mix` preservada. Webhook publicado por separado en `telegramwebhook-00037-ged`, con recuperación compatible `00034-rul` y drenaje probado; ver `telegram-webhook-safe-transition-20261021.md`. Los demás consumidores del inventario transitivo siguen requiriendo validación propia. No se enviaron mensajes reales. |
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
