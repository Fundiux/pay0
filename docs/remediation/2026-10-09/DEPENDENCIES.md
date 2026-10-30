# Dependencias — remediación 2026-10-09

## Candidato y alcance

Cambios focales en ambos manifiestos y lockfiles; sin `npm audit fix --force`, sin actualización global de majors ni scripts postinstall. Se preservan Firebase, React, TypeScript y ESLint existentes. Node local 22.23.2 cumple los engines consultados. Las consultas y paquetes proceden del registro npm y las referencias de seguridad de los mantenedores.

Audit completo inicial, incluyendo dev: raíz 40 entradas (3 críticas, 24 altas, 10 moderadas, 3 bajas); Functions 31 (3 críticas, 18 altas, 10 moderadas). Son entradas propagadas del grafo, no 71 vulnerabilidades independientes ni demostración de explotabilidad en PAY0. El resultado producción comunicado al inicio del frente fue raíz 35/Functions 15; la verificación de cierre se ejecuta nuevamente sobre los locks finales.

## Cambios seleccionados

| Paquete | Antes | Candidato | Justificación |
|---|---|---|---|
| Next | 15.5.25 | 15.5.27 | Parche en la misma línea; avisos cache poisoning SSG/ISR |
| proxy-addr | 2.0.7 | 2.0.8 ambos paquetes | Corrige confianza de subred IPv4-mapped IPv6 |
| @fastify/busboy | 3.2.0 | 3.2.2 ambos | Parches multipart DoS/CRLF |
| sharp | 0.35.4 | 0.35.5 raíz | Corrige librsvg transitivo; incluye binarios/plataformas correspondientes |
| @grpc/grpc-js | raíz 1.9.16 y 1.14.5 | raíz 1.14.6 | Unifica versión corregida sin degradar la rama ya instalada; Functions conserva 1.14.5 |
| source-map-js | 1.2.1 | 1.2.2 raíz | Valida offsets de source maps |
| DOMPurify | 3.4.14 | 3.4.16 raíz | Corrige casos IN_PLACE |
| brace-expansion | 1.1.18 / 2.1.4 | 1.1.21 / 2.1.7 según rango padre | Conserva contratos de majors de consumidores existentes |
| uuid | 8.3.2 / 9.0.1 | 11.1.1 ambos | Primer parche mantenido con export CommonJS; revisión explícita de consumidores abajo |
| @typescript-eslint/parser | 7.18.0 | 8.71.1 Functions dev | Elimina cadena globby→micromatch→braces y admite TS5.9/ESLint8.57 existentes |

Los overrides fijan parches de transitivas sin esperar un nuevo release de cada padre. Retirarlos requiere que todos los padres resuelvan versiones corregidas por su propio contrato y un nuevo audit/build. No se añadieron permisos, credenciales ni configuración productiva.

## Compatibilidad y alternativas investigadas

UUID11.1.1 cruza major de sus padres: se revisaron todos los consumidores en ambos locks, que son ExcelJS, gaxios, google-gax y teeny-request. El código instalado utiliza exclusivamente `require('uuid').v4` o destructuración/import equivalente; no se encontraron imports profundos o APIs eliminadas en esos consumidores. La versión11.1.1 mantiene export CommonJS y v4; la actualización no depende de `require()` de ESM. Los smokes deben probar generación, carga de consumidores y XLSX antes de cerrar el candidato.

Un override condicional inicial de grpc (`<1.13.6`) podía seleccionar1.13.6 también para un rango padre que antes resolvía1.14.5; se sustituyó por1.14.6 antes de instalar. El override condicional de UUID dejaba copias9 anidadas en el primer lock; el override explícito elimina esas copias. Ambas situaciones fueron detectadas por comparar todos los nodos del lock, no solo por versión top-level.

Braces3.0.3 no tiene versión corregida publicada al consultar: `npm view braces@3.0.4` devuelve404 y el issue del mantenedor sigue abierto. No se dejó ese bloqueo aislado como final del frente: parser8.71.1 usa tinyglobby y elimina la dependencia. Su peer range admite ESLint `^8.57.0` y TypeScript `>=4.8.4 <6.1.0`; `functions/.eslintrc` solo usa el parser y `no-debugger`, sin plugin/presets que requieran migración de reglas. El grafo nuevo usa brace-expansion5.0.12 corregido para su minimatch10, conservando overrides1/2 para padres anteriores.

## Fuentes primarias consultadas

- [Next: aviso SSG/ISR](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676). La publicación original muestra versión parche pendiente; el registro npm audit actualizado y la existencia de15.5.27 determinan el patch concreto. No se afirma reproducción en App Router PAY0.
- [proxy-addr](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h).
- [Busboy](https://github.com/fastify/busboy/security/advisories/GHSA-gxm5-99cw-xjw9).
- [gRPC](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j).
- [sharp/librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w).
- [UUID](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).
- [brace-expansion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr).
- [source-map-js1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2).
- [DOMPurify](https://github.com/cure53/DOMPurify/security/advisories/GHSA-6688-9rhm-gjv2).
- [Braces: reporte original abierto](https://github.com/micromatch/braces/issues/70).
- [Migración oficial typescript-eslint8](https://typescript-eslint.io/blog/announcing-typescript-eslint-v8/).

## Validación y publicación

Locks regenerados con `npm install --package-lock-only --ignore-scripts --no-fund --no-audit`. Instalación de node_modules con `npm install --ignore-scripts --no-fund --no-audit` coordinada con el responsable central, ya finalizada en ambos paquetes. No se ejecutaron builds globales desde esta subtarea.

| Comprobación del candidato | Resultado |
|---|---|
| Raíz npm audit completo | 0 vulnerabilidades |
| Raíz npm audit --omit=dev | 0 vulnerabilidades |
| Functions npm audit completo | 0 vulnerabilidades |
| Functions npm audit --omit=dev | 0 vulnerabilidades |
| Functions npm run lint | Pasa con parser8 y configuración existente |
| Ambos manifiestos frente a sección raíz de lock | Dependencias/devDependencies coinciden |
| git diff --check de ambos manifiestos/locks | Pasa |
| UUID resuelto desde gaxios/google-gax/teeny-request y ExcelJS |11.1.1; carga CJS y100 UUIDv4 por consumidor con formato/versión/variante válidos |
| gRPC1.14.6 raíz y1.14.5 Functions | Unary echo en127.0.0.1, puerto efímero, dato sintético, respuesta exacta; canales/servidores cerrados |
| ExcelJS | XLSX en memoria con formato condicional que usa UUIDv4; write/read conserva celda123.45 |
| Sharp0.35.5 Windows | PNG sintético2×2 generado en memoria y metadatos releídos |

`npm ls --all` no informa problemas en Functions. En raíz informa como extraneous dos dependencias opcionales de plataformas no Windows (`@img/sharp-wasm32@0.35.5`, `@emnapi/runtime@1.11.3`). Ambas figuran en el lock como optional y proceden del conjunto multiplataforma de sharp; no son dependencias de producción añadidas manualmente ni invalidan los smokes del binario Windows. No se borraron archivos mientras otros agentes reanudaban pruebas. Un `npm ci` limpio del candidato en CI debe confirmar el grafo de la plataforma de publicación.

Las pruebas fueron locales/sintéticas: ninguna petición de negocio Firebase, IQ, Vision o mensajería. Los builds y pruebas integradas del candidato final corresponden al responsable central. Estado: implementado y probado en este alcance; integración, compilación de release, despliegue y verificación efectiva pendientes, sin commit propio ni despliegue. Audit cero es el resultado del registro consultado en esta fecha, no una garantía de ausencia universal de vulnerabilidades.
