# S05: App Check web en observación

Estado2026-10-09: fuente implementada, sin llave creada, API habilitada, config App Check escrita ni enforcement. El responsable reportó aplicación WEB `1:751158244178:web:55bd61f902cd257b22408b` y reCAPTCHA API SERVICE_DISABLED. No se hizo nueva consulta remota de payloads ni se modificaron recursos.

## Implementación

`src/lib/firebaseAppCheck.ts` inicializa únicamente en navegador, con modo explícito `OBSERVE_ONLY`, sitekey pública válida y emuladores apagados. `src/lib/firebaseClient.ts` inicia el bootstrap antes de construir los servicios y exporta `appCheckInitialization`. Variables nuevas de build:

```text
NEXT_PUBLIC_FIREBASE_APP_CHECK_MODE=OBSERVE_ONLY
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=<sitekey pública Enterprise aprobada>
```

Sin modo/llave no se importa el SDK App Check. SSR/emuladores no inicializan reCAPTCHA. Singleton por app en el documento evita doble inicialización concurrente/HMR. Una propiedad `FIREBASE_APPCHECK_DEBUG_TOKEN`, incluso getter o heredada, bloquea bootstrap sin leer valor: este flujo no genera ni imprime debug tokens, tampoco en desarrollo. Fallos regresan estado fijo, no mensajes/URLs/stack del proveedor. No solicita tokens para mostrarlos ni los guarda en logs.

Exclusión previa al import para `/descarga/documento` exacta y segmentos `/firma`, `/firma/*`, `/verificar`, `/verificar/*`; contempla trailing slash, prefijos codificados y normalización conservadora. Solo lee pathname, nunca hash/search/href. Una vez detectado documento público queda excluido durante toda esa carga, incluso después de borrar bearer o cambiar ruta. Se revalida ruta/debug después del import asíncrono antes de construir provider.

La importación diferida puede permitir primeras solicitudes sin App Check. El SDK Functions instalado espera el provider mediante `appCheckProvider.get()`; llamadas posteriores lo reciben, pero no se certifica la primera llamada por esa lectura de código. No se cambian servicios para esperar attestation ni se activa enforcement. `INITIALIZED_OBSERVE_ONLY` significa inicialización del SDK, no token válido ni garantía de ausencia de abuso.

**Límite de privacidad que debe resolverse antes del canario:** si reCAPTCHA ya se cargó en un documento autenticado y luego se navega por SPA a una ruta bearer, omitir otra inicialización no descarga el script anterior. El helper informa `PUBLIC_DOCUMENT_WITH_EXISTING_PROVIDER` si se invoca en ese estado; no observa todas las navegaciones ni promete impedir esa transición. No se encontraron links/router literales hacia esas rutas en la revisión; DocsModal muestra/copia el link de firma. La garantía de entrada directa sí está probada sintéticamente. Antes de activar modo/llave, probar navegación real y conservar transición de documento completo o aislar el origen público; no introducir Next Link/router.push hacia rutas bearer dentro del documento instrumentado.

## Lote remoto propuesto, todavía sin ejecutar

1. Confirmar dominios reales de producción/canario y la app WEB exacta. Revisar service usage, cuotas y responsable de costes. Habilitar reCAPTCHA Enterprise API solo en el lote central autorizado.
2. Crear key web SCORE, sin checkbox, sin allowAllDomains, con dominios aprobados. No añadir localhost a llave productiva. Ejemplo de cuerpo revisable para creación, con dominio por resolver:

```json
{
  "displayName": "PAY0 web App Check observation",
  "webSettings": {
    "integrationType": "SCORE",
    "allowAllDomains": false,
    "allowedDomains": ["DOMINIO_REAL_APROBADO"]
  }
}
```

No enviar ese placeholder. [Crear claves web](https://docs.cloud.google.com/recaptcha/docs/create-key-website), [contrato de key](https://docs.cloud.google.com/recaptcha/docs/reference/rest/v1/projects.keys).

3. Registrar la app WEB con provider reCAPTCHA Enterprise y esa sitekey, sin siteSecret v3. Proponer TTL inicial1h y umbral estándar0.5, conservando servicios sin enforcement. Refresh automático está habilitado en cliente; su frecuencia y usuarios activos afectan assessments/coste. [Guía oficial Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider?hl=en).
4. Resolver el límite de navegación pública anterior y construir frontend canario con las dos variables públicas. No introducir llaves privadas ni credenciales de servicio en NEXT_PUBLIC. Next incorpora estas variables al build; cambiarlas solo en runtime no actualiza el bundle ya publicado.
5. En navegador real y dominio registrado, probar attestation inicial/refresh, red lenta/bloqueada, sesión nueva y HMR únicamente en pruebas locales. Usar usuarios/objetos sintéticos y una llamada de lectura autorizada previamente revisada; no disparar OCR, pagos, IQ, Telegram o WhatsApp para fabricar una métrica. Confirmar header App Check presente sin copiar su valor a logs/HAR/reportes. No guardar HAR con authorization/bearers.
6. Cargar directamente `/descarga/documento#token=SINTETICO`, firma y verificaciones con tokens sintéticos: ninguna petición reCAPTCHA ni App Check; verificar hash retirado por la página download. Probar también transición autenticada→pública y pública→autenticada, ventana nueva, refresh y navegación back. No afirmar que quitar un script elimina código ya ejecutado.

## Métricas y decisión posterior

Usar conteos agregados de verificación callable: etiqueta `firebase-log-type=callable-request-verification` y `jsonPayload.verifications.app` VALID/INVALID/MISSING, separados por callable/revisión y ventana temporal. Confirmar resource.type real de gen2 antes de crear filtro; no copiar automáticamente un filtro gen1. No añadir UID/root/token como etiquetas. MISSING esperado incluye rutas públicas, clientes antiguos, inicio asíncrono y emuladores; INVALID tampoco prueba ataque. Comparar tasa de errores legítimos/latencia y assessments con baseline y volumen, con alerta de coste acordada. [Métricas Functions](https://firebase.google.com/docs/app-check/monitor-functions-metrics), [métricas Firebase](https://firebase.google.com/docs/app-check/monitor-metrics).

Solo un lote posterior puede añadir `enforceAppCheck: true` por callable tras cobertura real de clientes y excepciones. Las APIs bearer públicas quedan fuera de esa migración automática. App Check complementa autenticación/autorización; no sustituye root/rol/delegación/cuotas/idempotencia. [Enforcement Functions](https://firebase.google.com/docs/app-check/cloud-functions).

Rollback de observación: retirar modo del build y redeploy frontend; pestañas abiertas conservan su bundle hasta recarga. No cambiar roles/reglas ni bloquear operación financiera por fallo de telemetría.

## Verificación local

`node --test qa/scripts/remediation-app-check.test.cjs`:8/8 PASS. Cubre SSR/config/emuladores, límites de rutas sin leer bearer, exclusión sticky, HMR/concurrencia, carrera al navegar durante import, debug accessor/tardío, errores sanitizados y estado honesto de provider ya cargado. Typecheck enfocado de ambos archivos PASS. No browser real/reCAPTCHA network, API enable, llave/config remota ni enforcement ejecutados. Build frontend central pendiente después de incorporar estos archivos; Functions no cambió.
