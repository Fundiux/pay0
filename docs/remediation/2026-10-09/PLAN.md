# Ejecución integral PAY0 — 2026-10-09

Autorización: encargo integral adjunto del usuario. Incluye integración y despliegues delimitados; excluye efectos financieros reales de prueba y mensajes a destinatarios reales.

Base preservada: `1f694607`, rama inicial `fix/iq-latency-reactivity`. Rama de ejecución: `remediation/pay0-integral-20261009`. Main diverge 108/13 commits: reconciliar por capacidades antes de integrar, sin descartar avances vigentes. Archivos locales preexistentes y auditorías se conservan.

## Hitos y aceptación

1. Baseline: leer fuentes completas; inventariar artefactos remotos y recuperación; conservar versiones y dependencias explícitas.
2. Autorización: S-10 y S-01/S-02; pruebas negativas de expiración, revocación, rol, root, acceso directo y recuperación.
3. Documentos/integraciones: tokens sin secretos en logs, consumo concurrente con reintentos, OCR autorizado y limitado, validación de archivos por objeto.
4. Integridad: proveedores simulados, concurrencia y resultados inciertos, ausencia de efectos duplicados, paradas y recuperación.
5. Contratos/modularización: cambios incrementales justificados, compatibilidad y un productor lógico por efecto.
6. Regresión: inventario corregido, legacy sustentado, UI y dependencias, builds y reglas.
7. Sentinel: eventos confiables, política versionada, detector sin autoridad financiera, contención reversible y observación sin calibración inventada.
8. Publicación por lote: candidato exacto probado, integración protegida, recuperación, despliegue delimitado y versión efectiva verificada.
9. Cierre: cada hallazgo sustentado y ninguna tarea independiente abandonada.

Estados separados: pendiente → investigación → implementado → probado → integrado → desplegado → verificado. Un fallo bloquea solamente su lote dependiente.
