# Auditoría Hugo/PAY0 posterior a prueba real de voz

Fecha: 2026-09-25 (America/Mexico_City)

Base acumulativa previa: `c30c92e7854b7616a1678b12a570f853c9f82819`

Rama integrada: `integration/pay0-final-candidate-20260924`

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
- El conteo exige literalmente `active=true` antes de evaluar acceso; la política canónica sigue intacta.

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
- Producción, sólo lectura: identidad y root canónicos; conteos de usuario actual y usuario objetivo resueltos; último pago coincide con el primero de los cinco recientes y el orden descendente es correcto.
- La primera sonda local informó incorrectamente ASSETS como conectado porque consumía un catálogo estático. La revisión acumulativa deriva ahora `CONNECTED` de capacidades Hugo realmente registradas: PAY0 y Hugo conectados; ASSETS y TTT no conectados.

### Aclaración BETELL 17 frente a 20

- El usuario objetivo de ambas comprobaciones fue BETELL; la resolución actual fue única y su rol canónico es `admin`.
- La evidencia anterior conservó el total 17, pero no una instantánea nominativa de los 17 miembros. Por ello no es posible reconstruir honestamente una lista completa de altas y bajas contra aquella fotografía.
- Desde el inicio de la prueba anterior (`2026-09-24T16:24:42Z`), la lectura agregada encontró tres clientes visibles actuales creados, un cliente directo desactivado, cero activaciones y cero cambios de delegación. Cuatro registros visibles actuales cambiaron en total.
- El total actual de 20 se recalculó desde Firestore y no se derivó aritméticamente del 17. Los 20 cumplen `active=true`, pertenecen al mismo `rootId`, tienen permiso efectivo de vista y en esta fotografía los 20 proceden de acceso directo; ninguno depende de una delegación vigente.
- La diferencia residual entre los eventos retenidos y el salto neto no permite atribuir con certeza un cuarto movimiento: no se inventa una alta, reactivación o reasignación que la evidencia histórica no conservó.

La validación productiva no escribió datos, no ejecutó pagos o dispersiones y no inició voz/audio. Identificadores y datos financieros no se almacenaron en este registro.

## Límites y riesgos

- Los cambios no están desplegados; producción conserva el comportamiento anterior.
- Falta una conversación humana completa posterior a un eventual despliegue para validar STT, prosodia, barge-in y continuidad real con audio.
- La suite histórica completa conserva fallos preexistentes en una guarda de arquitectura y un digest congelado; no corresponden al cambio de voz y requieren mantenimiento separado.
- No se conectó TTT ni se añadieron capacidades Hugo para ASSETS.
