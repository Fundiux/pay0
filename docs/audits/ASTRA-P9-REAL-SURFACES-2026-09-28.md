# P9 — Hover en superficies reales

Fecha: 2026-09-28. Validación local; la publicación y el postflight los coordina el cierre ASTRA.

## Cambio y alcance

El selector HTML común ya cubría las tablas. El recorrido con componentes reales encontró dos superficies que no lo heredaban: Clientes y Wallet / Beneficiarios, construidas con `div`. Se añadió un solo selector en `src/styles/globals.css` para filas `pay0-row-even/odd` dentro de `pay0-table-card`. Despachos y Tipos de operación reutilizan esas mismas clases. No se editaron páginas, manejadores, permisos ni datos.

El token sigue siendo `rgba(254, 240, 138, 0.055)`. La capa de fondo conserva el color base; se excluyen `aria-selected="true"` y `data-state="selected"`. La regla sólo existe dentro de `@media (hover: hover)`.

La búsqueda de tablas y clases compartidas abarcó `src/app` y `src/components`: Solicitudes, Pagos, Clientes, Usuarios, Empresas/documentos, Despachos, catálogos, Wallet, Materialidad/documentos, IQ, Facturación, aplicaciones, reportes/comisiones, diagnósticos María y ASSETS. Las tablas HTML heredan el selector común; los cuatro listados con filas `div` identificados heredan ahora el segundo selector. La búsqueda no equivale a una prueba interactiva de cada ruta.

## Prueba reproducible

`node qa/scripts/row-hover-real-surfaces-smoke.cjs`

Requiere dependencias instaladas, Chromium de Playwright y un build frontend previo para las utilidades Tailwind de `.next/static/css`. El harness compila el código fuente actual de las páginas y sus componentes hijos con esbuild, añade el CSS compartido actual y sustituye sólo los límites Auth, servicios, lecturas Firebase y navegación Next por fixtures en memoria. No fabrica tablas de demostración. La red del navegador está bloqueada y cualquier API de escritura falla explícitamente.

Resultado: **117 comprobaciones PASS, nueve superficies**.

| Superficie | Componente real |
| --- | --- |
| Solicitudes, 35 filas | `src/app/solicitudes/page.tsx` |
| Pagos | `src/app/pagos/page.tsx` |
| Clientes, grid | `src/app/clientes/page.tsx` |
| Usuarios | `src/app/usuarios/page.tsx` |
| Documentos de Solicitud, modal | `src/components/DocsModal.tsx` |
| Wallet / Clientes | `src/app/wallet/clientes/page.tsx` |
| Reportes / Ganancias por cliente | `src/app/reportes/page.tsx` |
| Documentos de Pago, modal distinto | `src/components/PagoDocsModal.tsx` |
| Wallet / Beneficiarios, grid | `src/app/wallet/beneficiarios/page.tsx` |

En cada superficie se verificaron entrada y salida del hover, texto/color preservados, las dos exclusiones de selección, foco de un control cuando existe, visibilidad móvil, scroll horizontal existente y ausencia de errores del navegador. Solicitudes además recorre la última de 35 filas. Cada superficie se vuelve a montar en un contexto táctil real de Chromium (`isMobile`, `hasTouch`, 390 × 844), se toca una zona no interactiva de la fila y se comprueba que no aparece el gradiente de hover. Desktop usa 1440 × 1000. La selección se comprueba modificando temporalmente el atributo de la fila real; no se simula una operación financiera ni se modifica estado React mediante el hover.

Se revisaron capturas de Beneficiarios desktop y documentos de Pago touch: la fila mantiene texto/iconos legibles y el badge documental conserva su color. Capturas y JSON completos quedan en `tmp/p9-real-surfaces/`, ignorado por Git.

## Límites y cierre local

Es una prueba de componentes reales con fronteras simuladas, no un E2E de autenticación, autorización de servidor, descarga, navegación entre rutas ni de todas las acciones de una fila. No certifica producción. El scroll existente se ejercitó sin modificar el layout; el harness reporta el ancho del documento y no convierte desbordamientos previos en una promesa de diseño móvil completo. No se añadieron cambios funcionales para corregirlos.

`git diff --check`: PASS. Cero llamadas productivas, cero acciones financieras y cero emuladores iniciados. El navegador se cerró en `finally` y el proceso terminó con código 0. No hubo procesos ajenos detenidos. EMULADORES: no iniciados por esta prueba. El build/frontend y Hosting definitivo siguen a cargo del cierre integrado.
