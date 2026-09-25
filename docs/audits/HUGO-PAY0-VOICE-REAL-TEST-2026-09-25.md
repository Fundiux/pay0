# Auditoría Hugo/PAY0 posterior a prueba real de voz

Fecha: 2026-09-25 (America/Mexico_City)

Base acumulativa: `c30c92e7854b7616a1678b12a570f853c9f82819`

Rama local: `fix/hugo-deterministic-pay0-reads`

Estado: corrección local validada; no desplegada.

## Causas raíz

1. Realtime sólo registraba tres lecturas directas; pagos y seguimientos caían al camino generativo/delegado.
2. El gateway convertía cualquier fallo de herramienta en `HUGO_CORE_UNAVAILABLE`, perdiendo autorización, timeout y disponibilidad.
3. `searchPagos` representaba una muestra reciente por registro, no la semántica de pago recibido.
4. La referencia al usuario autenticado y el contexto seguro tras reconexión no tenían herramientas directas.
5. El conteo recorría clientes inactivos antes de descartarlos; el resolutor fail-closed abortaba el agregado.
6. Las instrucciones Realtime no fijaban de forma suficiente idioma, nombre canónico PAY0, continuidad ni prohibición de scopes inventados.

## Corrección

- Se reutilizaron `Pay0Connector`, `PlatformReadConnector`, `HugoToolRouter` y `delegateHugoVoiceTurn`.
- Se agregó consulta de pagos recibidos ordenada por `reportDateAt DESC`, límite 1–5 y cursor opaco para “anterior”.
- Se agregaron detalle de pago, usuario actual, contexto reciente y diagnóstico sanitizado.
- Los seguimientos conservan sólo ID opaco/folio, sistema, intención e idioma; caducan a los 30 minutos.
- Los errores se clasifican como autorización, capacidad, consulta ambigua, vacío, timeout, conector o interno. Las lecturas transitorias admiten un único reintento.
- El gateway registra diez herramientas canónicas, conserva español de México y normaliza variantes habladas de PAY0.
- El conteo excluye clientes `active=false` antes de evaluar acceso; la política canónica sigue intacta.

## Matriz antes/después

| Capacidad | Antes | Después local |
|---|---|---|
| Sistemas | Herramienta directa | Herramienta directa; catálogo y acceso separados |
| Capacidades | Módulos generales | Capacidad registrada, autorizada, disponibilidad y salud separadas |
| Clientes de otro usuario | Directa, frases limitadas | Variantes naturales y ámbito jerárquico canónico |
| Clientes del usuario actual | Búsqueda nominal implícita | Identidad autenticada directa |
| Último/cinco pagos recibidos | Sin herramienta determinista | `reportDateAt DESC`, ventana 1–5 |
| Pago anterior y seguimientos | Sin continuidad directa | Cursor opaco y contexto reciente |
| Fallos | `HUGO_CORE_UNAVAILABLE` genérico | Taxonomía operacional sanitizada |
| Reconexión | Contexto de voz perdido | Recuperación segura con expiración |
| Idioma/nombre | Podía derivar | es-MX persistente y PAY0 canónico |

## Validación

- Functions build y ESLint: aprobados.
- Frontend production build: 43/43 páginas, con el wrapper protegido reproducible.
- Política de autorización: aprobada.
- Release baseline: aprobado.
- Guardas críticas: 20/20.
- Gateway: 40/40; cero acciones externas y cero llamadas Realtime en pruebas negativas.
- Regresiones enfocadas de voz/autorización: aprobadas.
- Producción, sólo lectura: identidad y root canónicos; PAY0, Assets y Hugo conectados; TTT no conectado; conteos de usuario actual y usuario objetivo resueltos; último pago coincide con el primero de los cinco recientes y el orden descendente es correcto.

La validación productiva no escribió datos, no ejecutó pagos o dispersiones y no inició voz/audio. Identificadores y datos financieros no se almacenaron en este registro.

## Límites y riesgos

- Los cambios no están desplegados; producción conserva el comportamiento anterior.
- Falta una conversación humana completa posterior a un eventual despliegue para validar STT, prosodia, barge-in y continuidad real con audio.
- La suite histórica completa conserva fallos preexistentes en una guarda de arquitectura y un digest congelado; no corresponden al cambio de voz y requieren mantenimiento separado.
- No se conectó TTT ni se modificó Assets.
