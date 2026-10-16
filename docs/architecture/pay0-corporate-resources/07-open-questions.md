# Open Questions

| Metadato | Valor |
| --- | --- |
| Título | Recursos Corporativos PAY0 — Open Questions |
| Versión | 0.1.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Primera lista de decisiones bloqueantes; no se asumen respuestas. |

1. ¿El nombre visible definitivo será **Recursos Corporativos**, **Recursos Corporativos PAY0** u otro?
2. ¿En qué sección exacta de Administración deberá aparecer el módulo?
3. ¿Cuál es la fuente autorizada de identidad para las empresas propias?
4. ¿Qué recursos deben ser `PAY0_GLOBAL` y cuáles deben pertenecer obligatoriamente a una empresa propia?
5. ¿Cuál será la taxonomía inicial de clases de recurso?
6. ¿Se permitirán clases personalizadas o sólo un catálogo administrado por release?
7. ¿Qué roles actuales recibirán cada capacidad del módulo?
8. ¿Crear, revisar, aprobar y activar deberán pertenecer siempre a actores diferentes?
9. ¿Qué clases exigirán doble aprobación?
10. ¿Superadmin podrá aprobar recursos de todos los roots o sólo del ámbito EBASOR autorizado?
11. ¿Admin podrá administrar recursos corporativos o sólo consultarlos?
12. ¿Operadores podrán descargar alguna clase de recurso?
13. ¿Qué reglas determinan si un recurso puede ser enviado a un cliente?
14. ¿Qué diferencia contractual habrá entre “Approved” y “Active” para el negocio?
15. ¿Se permite programar vigencias solapadas o deben rechazarse siempre?
16. ¿Qué sucede al expirar una versión activa sin sustituta aprobada?
17. ¿Qué clases requieren vigencia obligatoria?
18. ¿Cuál es la política de retención de versiones, auditoría, usos y artefactos retirados?
19. ¿Existe algún requisito legal que impida eliminación física incluso después de la retención?
20. ¿Qué tamaños máximos y tipos MIME se admitirán por clase?
21. ¿Qué política antivirus o de contenido se exigirá antes de promover un artefacto?
22. ¿Se permitirán múltiples artefactos dentro de una misma versión?
23. ¿Cómo se representarán recursos estructurados que no tengan archivo?
24. ¿Qué dependencias deben bloquear una activación y cuáles sólo advertir?
25. ¿Quién es responsable de confirmar y mantener cada dependencia?
26. ¿Cuánto tiempo se conservarán observaciones de uso de alto volumen?
27. ¿Qué outputs deben registrar obligatoriamente la versión exacta utilizada?
28. ¿Qué nivel de detalle de dependencias puede ver cada rol sin filtrar información sensible?
29. ¿Qué validadores automáticos son prioritarios después de la primera implementación?
30. ¿Los validadores externos podrán recibir bytes o deberán operar dentro de infraestructura PAY0?
31. ¿Cuál será el primer tipo de recurso para el rollout controlado?
32. ¿Qué empresa propia participará primero en la validación, sin limitar el diseño a ella?
33. ¿Quién decide la fuente de verdad cuando Git, Excel, Firestore y el archivo físico discrepan?
34. ¿Qué periodo y umbral de shadow reads se exigirá antes de cada corte?
35. ¿Qué consumidores requieren fallback y durante cuánto tiempo?
36. ¿Qué aprobación se requiere para retirar definitivamente una fuente heredada?
37. ¿Se conservarán rutas/nombres históricos como aliases o sólo migration links internos?
38. ¿Qué eventos se mostrarán en Activity PAY0 y cuáles quedarán únicamente en auditoría específica?
39. ¿Qué política de alertas aplica a validaciones fallidas, expiraciones y activaciones programadas?
40. ¿La tool futura de Hugo será sólo de consulta o podrá solicitar acciones separadas como adjuntar o enviar?
41. ¿Qué clases de recurso estarán explícitamente prohibidas para Hugo aunque el usuario tenga acceso administrativo?
42. ¿Qué base de integración será aprobada para una futura implementación sin perder BASE8601-04, Hugo P0/P0.5, IQ y otros ciclos paralelos?

Las decisiones 3, 4, 7–10, 14–18, 24, 31–34 y 42 bloquean el inicio de implementación. Las demás pueden resolverse antes de la fase específica que afecten, siempre que no se introduzcan defaults implícitos.
