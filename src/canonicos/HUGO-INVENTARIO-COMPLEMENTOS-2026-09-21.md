# Inventario histórico de complementos: lectura del 2026-09-21

## Método

`inventoryPage` recorrió `pagoAplicaciones` del root operativo por cursor de ID en páginas de 25. Para cada aplicación PPD aplicada leyó solicitud, pago, seguimiento y metadatos de documentos vinculados. No ejecutó reconciliación, creó jobs, descargó archivos, invocó modelos ni llamó a IQ. El script `audit-operational-followup.cjs --hugo-inventory` sólo devolvió agregados sin folios ni datos personales.

`Detectados` incluye aplicaciones PPD aplicadas que requieren clasificación, incluso si faltan padres o la evidencia es inconsistente. `Procesados` exige seguimiento `RECEIVED` y XML/PDF activos con metadatos sellados, ligados al mismo pago, solicitud, aplicación, UUID, parcialidad, importe y saldos. `Pendientes` no implica que IQ haya recibido una solicitud. `Errores` son inconsistencias o bloqueos conocidos. `Excluidos` son PUE, aplicaciones no aplicadas o fuentes terminales.

## Resultado agregado de la lectura productiva

| Medida | Resultado |
| --- | ---: |
| Aplicaciones recorridas | 60 |
| Complementos detectados | 5 |
| Procesados con evidencia vinculada | 0 |
| Pendientes | 5 |
| Errores | 0 |
| Fuera de alcance | 55 |
| Proveedor de los detectados | IQ: 5; Facturama: 0; otros: 0 |
| Motivos pendientes | Esperando aplicación IQ: 1; pendiente del proveedor: 4 |

La auditoría paralela de consistencia leyó 412 solicitudes, 156 pagos, 60 aplicaciones, 4 CFDI productivos y 10 expedientes de materialidad; reportó cero padres faltantes, diferencias de abonos o discrepancias UUID en las comprobaciones existentes. Estos conteos describen una lectura puntual, no una garantía fiscal ni un snapshot transaccional. No se consultó IQ en vivo ni se inspeccionó el contenido binario de cada documento durante este inventario; la recuperación y validación externa pertenecen a las siguientes etapas.

## Verificación local

Prueba en emulador: varias páginas, aislamiento de root, PUE excluida, pendiente sin seguimiento, recibido con XML/PDF ligados, recibido sin evidencia, denegación sin autenticación y ausencia de nuevas escrituras. Builds de frontend y Functions completados. La UI `/hugo` calcula los totales recorriendo todas las páginas; indica cobertura parcial durante la lectura o ante error y cobertura completa al terminar. Ningún cambio se desplegó.
