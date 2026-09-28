# Recursos Corporativos PAY0 — Architecture Package

> Actualización de implementación, 2026-09-28: el mandato posterior ASTRA autorizó una primera entrega funcional. El alcance y las verificaciones actuales están en [08 — Entrega funcional acotada](./08-functional-delivery.md). Los documentos 00–07 se conservan como diseño histórico; sus propuestas y preguntas no equivalen a funciones ya entregadas.

| Metadato | Valor |
| --- | --- |
| Versión | 1.0.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Índice inicial del paquete; incorpora el documento fundacional 00. |

## Orden obligatorio de lectura

| Orden | Documento | Propósito |
| --- | --- | --- |
| 00 | [Vision and Operating Model](./00-vision-and-operating-model.md) | Visión funcional, límites, ownership y principios permanentes. Debe leerse primero. |
| 01 | [Executive Architecture Review](./01-executive-architecture-review.md) | Alcance, decisiones, riesgos y aprobaciones ejecutivas. |
| 02 | [Architecture Specification](./02-architecture-specification.md) | Especificación integral, modelos, diagramas, seguridad y roadmap. |
| 03 | [API & Contracts](./03-api-and-contracts.md) | Callables, contratos, DTO, eventos e interfaces propuestas. |
| 04 | [Data Model](./04-data-model.md) | Colecciones lógicas, ownership, relaciones y crecimiento previsto. |
| 05 | [Migration Strategy](./05-migration-strategy.md) | Convivencia, shadow reads, corte, validación humana y rollback. |
| 06 | [Decision Log](./06-decision-log.md) | Registro histórico de decisiones arquitectónicas y consecuencias. |
| 07 | [Open Questions](./07-open-questions.md) | Decisiones pendientes que condicionan la implementación. |

## Estado del paquete

La fase de diseño está completa para revisión. Ningún documento en estado `Review` autoriza implementación, creación de colecciones, cambios de reglas, navegación, backend, frontend, merge o despliegue.

La implementación sólo podrá planificarse después de la aprobación explícita del paquete y de resolver las preguntas identificadas como bloqueantes.
