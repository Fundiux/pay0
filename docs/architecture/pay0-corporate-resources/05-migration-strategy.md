# Migration Strategy

| Metadato | Valor |
| --- | --- |
| Título | Recursos Corporativos PAY0 — Migration Strategy |
| Versión | 0.1.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Estrategia incremental sin big-bang, con shadow reads, validación humana y rollback por consumidor. |

## 1. Qué permanece

- `entityDocuments` y flujos documentales de clientes/operaciones.
- Archivos y manifests actuales en Git durante la transición.
- Configuración operacional existente en Firestore.
- Módulos Facturama, Materialidad, Cotizaciones, Reportes y Firma.
- Autorización canónica actual y rutas productivas.
- Recursos de Assets y TTT fuera del nuevo dominio.
- Hugo sin acceso directo.

## 2. Qué cambia

- Se añade una fuente gobernada para recursos corporativos reutilizables.
- Los consumidores adoptan gradualmente el Resolver en lugar de leer ubicaciones concretas.
- Cada output registra la versión exacta consumida.
- Cambios dejan de sobrescribir archivos/configuración y pasan por workflow versionado.
- Dependencias e impacto se vuelven explícitos.

## 3. Qué se migra

Sólo recursos aprobados, uno por uno o por lotes homogéneos:

1. Identidad y ownership.
2. Metadatos y procedencia.
3. Contenido estructurado y/o copia binaria con digest.
4. Dependencias conocidas.
5. Versión inicial certificada.

Candidatos posteriores: logos/papelería, plantillas, documentos corporativos, catálogos autorizados y configuración no secreta.

## 4. Qué no se migra

- Secretos, CSD, e.firma, tokens o credenciales.
- Expedientes operativos de clientes, solicitudes, pagos o dispersiones.
- Historial sin procedencia suficiente como si fuera confiable.
- Duplicados cuya fuente autorizada no haya sido decidida.
- Recursos Assets/TTT.
- Auditoría histórica inferida sin evidencia.

## 5. Convivencia temporal

Cada consumidor tendrá un estado de transición:

`LEGACY_ONLY → SHADOW_COMPARE → CORPORATE_PRIMARY_WITH_FALLBACK → CORPORATE_ONLY`.

El fallback no será silencioso: se registra y alerta. No se elimina la fuente anterior al alcanzar `CORPORATE_ONLY`, completar un periodo de estabilidad y obtener aprobación separada.

## 6. Shadow reads

Requeridos para recursos que influyen en outputs o decisiones: plantillas, catálogos, configuración CFDI, identidad gráfica y parámetros. El adaptador obtiene la fuente productiva y la candidata, normaliza ambas y compara digest o semántica sin cambiar el resultado enviado al usuario.

Métricas mínimas:

- resoluciones comparadas;
- coincidencias exactas y semánticas;
- divergencias por tipo;
- fallos de resolución;
- latencia adicional;
- consumidores no inventariados.

## 7. Validación humana

Obligatoria cuando la equivalencia automática no sea suficiente:

- identidad visual y render de plantillas;
- documentos legales/fiscales;
- información bancaria autorizada;
- discrepancias entre Excel, código, Firestore y archivo físico;
- clasificación y ownership;
- impacto aceptado antes del corte.

## 8. Estrategia de corte

1. Congelar cambios brevemente en la fuente concreta, no en todo PAY0.
2. Importar/certificar versión candidata.
3. Completar shadow reads.
4. Aprobar impacto y rollback.
5. Cambiar un consumidor mediante configuración controlada.
6. Monitorear errores, outputs y usos.
7. Continuar consumidor por consumidor.

## 9. Rollback

- Antes de `CORPORATE_ONLY`: regresar el adaptador a la fuente heredada.
- Después del corte: activar forward-only una nueva versión equivalente a la última certificada.
- Nunca editar una versión activa o histórica.
- Conservar migration link, decisión, causa y evidencia.
- Rollback de un consumidor no obliga a revertir otros consumidores certificados.

## 10. Fases de migración

| Fase | Contenido | Gate de salida |
| --- | --- | --- |
| Inventario | Fuente, owner, consumidores, riesgo | Ownership y autoridad aprobados. |
| Importación seca | Metadatos/digest sin corte | Comparación reproducible. |
| Shadow | Resolución dual | Umbral de equivalencia aprobado. |
| Piloto | Un consumidor/recurso | Validación técnica y humana. |
| Expansión | Consumidores restantes | Sin regresiones por periodo acordado. |
| Retiro legado | Sólo fuente concreta | Aprobación explícita y rollback documentado. |
