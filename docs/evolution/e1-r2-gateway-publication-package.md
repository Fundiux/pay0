# R2 — paquete fuente del gateway de reportes y comparación

Estado: **SOURCE_PREPARED_IMAGE_NOT_BUILT**. El paquete está preparado y probado con Node local. No hay imagen construida, digest nuevo ni autorización de despliegue. Docker no está disponible en este entorno. No se hicieron escrituras cloud ni llamadas a proveedores.

## Contenido e identidad

Directorio privado: `.firebase/modular-release/r2-gateway-package/`.

- Fuente exacta: commit `0a783d038393113b955029df7c940f54da203d3a`, subdirectorio `services/hugo-voice-gateway`.
- Archivo: `gateway-source.zip`, 18 archivos versionados, SHA256 `049e1ab1417551dfa52b0f01c37f2994768e3fe322698dd90b344dd66983be9c`.
- Base productiva documentada: commit `7dfcd8aa039aafbe7345a17155d3db2c2fc3fd8a`; revisión `hugo-voice-gateway-canary-astra-7dfcd8a`; imagen `sha256:ae8aea1811185a409a7150fd82fe46aeddc605bd20d0ec2d6ecea3757d27c9b7`.
- `manifest.json` incluye hashes individuales, identidad productiva previa, comprobaciones locales y requisitos de backend.

El diff completo contra la base productiva contiene cuatro archivos: manifest y lockfile del paquete, `src/realtimeTools.mjs` y su test. Conserva exactamente las 13 herramientas anteriores y añade `get_earnings_by_client_report`, con fechas comparativas opcionales. El total candidato es 14 herramientas. El servidor, autenticación, transporte, cancelación y contrato de voz conservan los bytes del commit productivo. UUID queda fijado en 11.1.1 conforme al lockfile ya integrado.

## Pruebas locales

El archivo fuente extraído pasó las 49 pruebas existentes: 49 aprobadas, cero fallos, cero omisiones. Se reutilizó la instalación verificada del gateway; no se instalaron dependencias nuevas.

La comparación de contratos confirmó que las 13 definiciones productivas siguen iguales. La herramienta adicional transporta ambos intervalos y no permite inyectar `uid` ni `rootId`.

El servidor real del paquete arrancó con Node `v22.23.2`: `/healthz` devolvió 200 y un WebSocket sin token recibió `UNAUTHENTICATED`. El proceso tenía bloqueadas todas las conexiones salientes. Las pruebas de sesión autorizada existentes usan servicios simulados; no constituyen validación de voz productiva.

## Construcción pendiente

El paquete conserva el `Dockerfile` original y añade, fuera del archivo fuente, `cloudbuild.build-only.yaml`. Ese config solamente construye una imagen local al entorno de build; no la publica en un registry ni despliega servicios. No se ejecutó.

El Dockerfile original usa `node:22-slim` y `npm install --omit=dev`. Por ello, el SHA256 del ZIP no equivale a un digest de imagen. La construcción autorizada deberá registrar la imagen/base efectiva, verificar las dependencias instaladas contra el lockfile, repetir las pruebas y fijar el digest resultante antes de preparar un despliegue revisable.

La configuración futura debe declarar el commit exacto en `HUGO_BUILD_COMMIT`, conservar las restricciones de canary y las URLs canónicas de autorización/delegación. No asignar a este paquete metadata de R1.1 ni de otro commit.

## Dependencia de backend y orden

Este gateway necesita el backend R2 de comparación publicado antes de promover tráfico. R1.1 sólo corrige persistencia de métricas; no habilita comparaciones. El gateway nuevo no debe anunciarse como operativo sobre R1.1 únicamente.

El manifest deja una propuesta **NOT_DEPLOY_READY** para un overlay backend: partir de los ZIP R1.1 realmente publicados y sus revisiones verificadas, conservar los dos adaptadores corregidos y aplicar únicamente los cinco módulos R2 de reportes/contexto. Faltan construir ese overlay, probarlo, registrar sus hashes y pedir autorización independiente.

Orden posterior: comprobar R1.1 publicado; preparar y autorizar el backend R2; construir y validar la imagen gateway con digest inmutable; capturar configuración/IAM/tráfico actuales; solicitar autorización del despliegue; verificar una sesión autenticada y comparaciones. Hasta entonces este documento describe preparación local, no publicación.
