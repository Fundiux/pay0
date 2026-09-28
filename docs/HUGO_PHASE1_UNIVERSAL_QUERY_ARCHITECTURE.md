# Hugo Phase 1 — Universal Query y exportaciones

Phase 1 define infraestructura y contratos; no agrega tools, conectores, reportes, descargas ni operaciones sobre PAY0, Assets o TTT.

```text
Conector autorizado -> UniversalQuery -> Snapshot inmutable -> Analítica -> Renderer -> Entrega
                                             |
                                             +-> Job para trabajo prolongado
```

## Límites

- Cada dominio aportará posteriormente su conector y autorización canónica.
- Un Snapshot queda ligado al actor, root, versión de política, capacidades y digest exacto de consulta.
- La reutilización exige coincidencia completa de esos valores y vigencia temporal. Nunca se comparte entre usuarios.
- PDF, XLSX, CSV, JSON y Dashboard consumen exclusivamente un Snapshot; ningún renderer consulta sistemas operativos.
- El motor analítico recibe un Snapshot y produce resultados tipados para comparativas, tendencias, KPIs, rankings, estadísticas, insights, anomalías o resúmenes; Phase 1 no implementa sus algoritmos.
- La entrega revalida propiedad y autorización. Email y WhatsApp son contratos futuros, no capacidades habilitadas.
- Los Jobs permiten progreso monotónico y estados terminales; completar exige Snapshot y 100%.
- La programación existe sólo como borrador tipado con `enabled: false` y `schedule: null`; no hay scheduler activo.

## Phase 2 pendiente

Persistencia transaccional de snapshots/jobs, un conector piloto autorizado, renderer JSON/CSV, política de expiración y limpieza, cuotas, auditoría de descarga y pruebas de carga. PDF/XLSX y programación se habilitarán sólo después del piloto.
