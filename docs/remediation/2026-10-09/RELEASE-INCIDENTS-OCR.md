# Lote publicado: incidencias y OCR

Fuente desplegada: integración `b9e21df`, 2026-10-09. Los cuatro servicios están ACTIVE, Ready=True y con 100 % del tráfico en la revisión nueva. Ninguno tiene bindings de secretos.

| Función | Revisión efectiva | Actualización UTC |
|---|---|---|
| resolveClientDispersionIncident | resolveclientdispersionincident-00023-yoy | 19:41:41.628293662 |
| requestClientDispersionIncident | requestclientdispersionincident-00023-lix | 19:41:35.437804414 |
| parsePagoReceiptPdf | parsepagoreceiptpdf-00013-div | 19:41:37.785115208 |
| correctPagoReceiptSemanticField | correctpagoreceiptsemanticfield-00002-qet | 19:41:33.374011866 |

Los cuatro POST vacíos sin autenticación devolvieron HTTP401/UNAUTHENTICATED. No se probaron incidencias con efectos financieros ni documentos productivos. Las invariantes de raíz, concurrencia, replay y memoria por raíz se verificaron mediante pruebas sintéticas locales/emuladas.

El predeploy pasó compilación Functions, discovery estricto de 344 endpoints, compatibilidad IQ/CSF/documentos y regresión de reglas/descargas. El frontend integrado previo compiló 47 páginas. Esas verificaciones corresponden al lote congelado, no a cambios posteriores.

El primer comando abortó por un filtro --only sin comillas; no publicó. El segundo publicó los cuatro servicios, pero terminó exit1 por un error interno al consultar la operación de correctPagoReceiptSemanticField. La consulta posterior independiente de Functions y Cloud Run confirmó revisión nueva ACTIVE/Ready y tráfico100 %. No se repitió el despliegue porque el resultado ya estaba aplicado.

Recuperación: ZIP previos de incidencias SHA256 C50F0D7A95BB24CAF156022AE1145503D34F2110F9C39DF71921EE52A190DB1F; OCR/corrección SHA256 329B31F7F23C0B87556A38034CC5AE6E0F9E64F8B5A2D0D51EC6CD8EDA723A98. Conservados en TEMP privado. Reversiones previas en RELEASE.md. Revertir incidencias reintroduciría el fallo de raíz/carrera: preferir corrección hacia adelante o contención focalizada.

No se desplegaron Hosting, reglas, otros callables ni writers de restricciones en este lote.
