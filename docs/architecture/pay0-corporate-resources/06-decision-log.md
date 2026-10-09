# Decision Log

| Metadato | Valor |
| --- | --- |
| Título | Recursos Corporativos PAY0 — Decision Log |
| Versión | 0.1.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Registro inicial de decisiones heredadas y propuestas. Las propuestas requieren aprobación del paquete. |

## ADR-001 — Dominio Recursos Corporativos PAY0

- Problema: “PAY0 Canonical” sugiere un repositorio técnico o de documentos.
- Alternativas: explorador de archivos; Canonical Center global; sistema de gobierno de recursos.
- Decisión: diseñar un sistema de gobierno denominado Recursos Corporativos PAY0.
- Justificación: incluye archivos, datos estructurados, dependencias, lifecycle y consumo.
- Consecuencias: la UI y contratos hablan de recursos; “canonical” queda como cualidad interna.

## ADR-002 — Separación por sistema

- Problema: riesgo de mezclar PAY0, Assets, TTT y Hugo.
- Alternativas: almacén global; namespaces en almacén global; dominios independientes.
- Decisión: dominios independientes; PAY0 sólo administra recursos PAY0.
- Justificación: ownership, autorización y evolución separados.
- Consecuencias: Assets/TTT requerirán soluciones propias; compartirán patrones, no datos.

## ADR-003 — Identidad y versión separadas

- Problema: sobrescritura impide reproducibilidad y auditoría.
- Alternativas: documento mutable; copia completa por versión; agregado con puntero y versiones.
- Decisión: identidad estable más versiones inmutables y puntero activo.
- Justificación: permite historial, rollback forward-only y referencias estables.
- Consecuencias: más entidades y transacciones; consumidores deben resolver versiones.

## ADR-004 — Ownership dual controlado

- Problema: existen recursos globales PAY0 y recursos de empresas propias.
- Alternativas: exigir empresa siempre; tratar todo como global; scope explícito.
- Decisión: `PAY0_GLOBAL` o `OWN_COMPANY`, mutuamente excluyentes.
- Justificación: evita empresas ficticias y ambigüedad.
- Consecuencias: autorización y unicidad incluyen ownership scope.

## ADR-005 — Una versión activa

- Problema: dos versiones vigentes generan resultados no deterministas.
- Alternativas: múltiples activas con prioridad; fechas solapadas; activa única.
- Decisión: una activa por recurso/scope/ambiente, modificada transaccionalmente.
- Justificación: resolución determinista.
- Consecuencias: activaciones programadas deben detectar carreras y solapamientos.

## ADR-006 — Restauración forward-only

- Problema: restaurar una versión histórica podría alterar auditoría.
- Alternativas: reactivar registro viejo; editar activo; copiar a versión nueva.
- Decisión: copiar el contenido histórico a una versión nueva con procedencia.
- Justificación: conserva secuencia temporal y nueva aprobación.
- Consecuencias: aumenta número de versiones, pero mantiene integridad.

## ADR-007 — Grafo de dependencias

- Problema: no se conoce impacto de cambiar un logo, catálogo o plantilla.
- Alternativas: texto libre; lista embebida; aristas normalizadas.
- Decisión: dependencias como entidades, distinguiendo declaradas y observadas.
- Justificación: consultas de impacto, criticidad y procedencia.
- Consecuencias: requiere reconciliación y responsables por consumidor.

## ADR-008 — Binarios en Storage

- Problema: Firestore no es almacén de archivos y las rutas directas filtran detalles.
- Alternativas: blobs Firestore; archivos Git; Storage con manifest.
- Decisión: Storage inmutable más manifest Firestore y upload init/finalize.
- Justificación: integridad, escala y autorización server-side.
- Consecuencias: staging, promoción, cuarentena y lifecycle deben administrarse.

## ADR-009 — Doble plano de auditoría

- Problema: Activity general no contiene suficiente detalle y una bitácora global rompe fronteras.
- Alternativas: sólo Activity; `canonicalActivityLog` global; audit específico + Activity PAY0.
- Decisión: `pay0CorporateAuditLog` más eventos sanitizados en `pay0ActivityLog`.
- Justificación: detalle de gobierno sin mezclar sistemas.
- Consecuencias: se debe evitar doble conteo y definir retención.

## ADR-010 — Autorización server-side

- Problema: UI/Firestore directo no protege operaciones sensibles.
- Alternativas: reglas cliente; roles en frontend; helper canónico en Functions.
- Decisión: todas las operaciones mediante backend y helper canónico fail-closed.
- Justificación: scope, ownership y separación de funciones verificables.
- Consecuencias: UI sólo recibe capacidades efectivas; reglas bloquean escrituras directas.

## ADR-011 — Transición incremental

- Problema: migración masiva arriesga módulos financieros y documentos.
- Alternativas: big-bang; duplicación indefinida; shadow reads por consumidor.
- Decisión: adaptación gradual con shadow compare, validación humana y rollback.
- Justificación: limita blast radius.
- Consecuencias: convivencia temporal y telemetría obligatoria.

## ADR-012 — Hugo como consumidor, nunca propietario

- Problema: permitir ownership/acceso directo rompería autorización y fronteras.
- Alternativas: acceso Firestore; APIs administrativas; tool server-side autorizada.
- Decisión: tool server-side futura mediante Resolver y permisos del usuario.
- Justificación: mínimo privilegio y trazabilidad.
- Consecuencias: cada acción de Hugo requiere capacidad explícita; no hay acceso genérico.

## ADR-013 — Validaciones desacopladas

- Problema: reglas específicas cambian por clase y proveedor.
- Alternativas: lógica embebida; validadores mutables; perfiles/adaptadores versionados.
- Decisión: perfiles versionados y runs inmutables mediante adaptadores.
- Justificación: extensibilidad sin modificar versiones.
- Consecuencias: validación puede repetirse; resultado no altera contenido.
