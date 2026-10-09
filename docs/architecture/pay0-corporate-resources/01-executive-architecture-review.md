# Executive Architecture Review

| Metadato | Valor |
| --- | --- |
| Título | Recursos Corporativos PAY0 — Executive Architecture Review |
| Versión | 0.1.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Primera propuesta integral posterior a la auditoría BASE860115-04. Sustituye el concepto limitado “PAY0 Canonical” por “Recursos Corporativos PAY0”. |

## 1. Objetivo

Diseñar el sistema de gobierno para todos los recursos corporativos reutilizables propiedad de PAY0: documentos fiscales y corporativos, plantillas, formatos, catálogos, configuraciones no secretas, logos, imágenes y archivos ofimáticos. El módulo debe conservar contexto, versiones, vigencia, dependencias, consumidores, validaciones, auditoría y autorización durante todo el ciclo de vida.

## 2. Alcance

- Recursos globales de PAY0 y recursos pertenecientes a cualquiera de sus empresas propias.
- Identidad lógica del recurso separada de sus versiones inmutables.
- Binarios y recursos estructurados; un recurso puede no tener archivo.
- Carga, validación, revisión, aprobación, activación, programación, sustitución y retiro.
- Registro de consumidores, dependencias, automatizaciones y productos generados.
- Descarga y resolución de versiones mediante servicios server-side autorizados.
- Convivencia y transición gradual desde las fuentes actuales.
- Preparación para validadores automáticos futuros.

Quedan fuera de alcance: canónicos de Assets o TTT; secretos y credenciales; expedientes operativos de clientes, solicitudes o pagos; implementación de validadores específicos; migración masiva; acceso directo de Hugo; edición colaborativa de archivos; y cualquier cambio de código durante esta fase.

## 3. Problema que resuelve

Los recursos corporativos actuales están repartidos entre Git, Firestore, Storage, código, manifests y carpetas locales. No existe una fuente administrable que responda de manera confiable qué recurso está vigente, quién lo aprobó, qué empresa lo posee, qué módulos lo consumen, qué versión produjo un documento o cuál sería el impacto de sustituirlo.

## 4. Principios arquitectónicos

1. PAY0 es propietario; Hugo y otros módulos son consumidores autorizados.
2. Separación por sistema: infraestructura compartida no implica datos compartidos.
3. Autorización server-side, fail-closed y basada en el helper canónico.
4. Identidad lógica mutable mínima; contenido y versiones siempre inmutables.
5. Una sola versión activa por recurso, ámbito y ambiente.
6. Restauración forward-only: restaurar crea una versión nueva.
7. Dependencias explícitas y análisis de impacto antes de activar.
8. Binarios en Storage; metadatos, relaciones y estado en Firestore; secretos fuera de ambos.
9. Migración incremental con shadow reads, comparación y rollback.
10. Ninguna fuente anterior se elimina hasta certificar al consumidor correspondiente.

## 5. Resumen ejecutivo

La unidad principal será el **Recurso Corporativo**, una identidad estable dentro de PAY0. Su propiedad podrá ser `PAY0_GLOBAL` o una empresa propia concreta. Cada cambio de contenido o configuración generará una **Versión de Recurso** inmutable. Los binarios serán artefactos asociados a la versión; los recursos estructurados podrán usar payload validado sin archivo.

La activación se realizará mediante una operación transaccional que retira la versión activa anterior y activa una versión aprobada, conservando todo el histórico. Una activación programada será una intención persistida y ejecutada idempotentemente por un job futuro. Los consumidores resolverán una versión activa o una versión fijada; todo producto generado registrará la versión exacta utilizada.

Un **Grafo de Dependencias** conectará recursos con módulos, procesos, automatizaciones, otros recursos y tipos de salida. Este grafo permitirá responder quién consume un recurso y advertir el impacto de modificarlo. Las dependencias declaradas por código y las observadas en ejecución se distinguirán para no confundir configuración con evidencia.

La seguridad se concentrará en Functions. El frontend nunca escribirá directamente Firestore o Storage. La carga utilizará el patrón init/upload/finalize existente: el backend autoriza y crea una sesión; el cliente sube a una ubicación temporal; el backend verifica integridad, tipo y alcance y promueve el artefacto a una ruta inmutable. Las descargas usarán el helper canónico y URLs firmadas de corta duración.

La auditoría tendrá dos niveles: un historial específico e inmutable para decisiones de gobierno del recurso, y eventos sanitizados `PAY0_CORPORATE_RESOURCE_*` en `pay0ActivityLog`. No se creará una bitácora global `canonicalActivityLog`.

La transición será por adaptadores: las fuentes actuales continúan siendo autoritativas mientras el nuevo módulo ejecuta shadow reads. Tras comparación funcional y validación humana, cada consumidor se cambia individualmente. El rollback consiste en devolver el consumidor a su fuente anterior o activar una nueva versión que reproduzca la última versión certificada; nunca se reescribe el histórico.

La primera implementación debe soportar todas las empresas propias, aunque el rollout se pruebe con una empresa y una clase de recurso de bajo riesgo. El diseño no queda limitado al piloto.

## 6. Decisiones de diseño

| ID | Decisión propuesta |
| --- | --- |
| D-01 | Módulo visible “Recursos Corporativos” bajo Administración. |
| D-02 | Agregado `CorporateResource` con versiones inmutables separadas. |
| D-03 | Ownership `PAY0_GLOBAL` o `OWN_COMPANY`; no se permite ownership Hugo/Assets/TTT. |
| D-04 | Estado de versión: Draft, In Review, Approved, Scheduled, Active, Retired, Obsolete o Rejected. |
| D-05 | Activación única y transaccional por recurso/ámbito/ambiente. |
| D-06 | Dependencias modeladas como aristas de un grafo, separando declaradas y observadas. |
| D-07 | Upload init/finalize y descargas firmadas; sin escrituras directas del navegador. |
| D-08 | Auditoría específica más Activity PAY0; sin bitácora canónica global. |
| D-09 | Migración por consumidor con shadow reads; no big-bang. |
| D-10 | Hugo consume sólo mediante herramientas server-side con autorización del usuario. |

## 7. Riesgos principales

- Activar una versión incompatible con consumidores no inventariados.
- Confundir recursos globales con recursos de una empresa propia.
- Duplicar fuentes y producir divergencia durante la transición.
- Exponer documentos fiscales, bancarios o corporativos mediante permisos demasiado amplios.
- Crecimiento excesivo de auditoría, dependencias observadas o versiones binarias.
- Intentar migrar configuración secreta al módulo.
- Acoplar consumidores al esquema interno en vez de usar contratos de resolución.

## 8. Decisiones pendientes de aprobación

- Nombre visible y ubicación definitiva en navegación.
- Roles/capacidades para crear, revisar, aprobar, activar y retirar.
- Requisito de separación de funciones o doble aprobación por clase de riesgo.
- Taxonomía inicial de clases de recurso.
- Política de vigencia, retención y eliminación legal de binarios.
- Estrategia exacta para recursos PAY0 globales frente a empresa propia.
- Primer dominio de rollout y empresa de validación.
- Tratamiento de dependencias críticas y bloqueo de activaciones incompatibles.
- Fuente de verdad cuando Git, Excel, Firestore y archivos operativos discrepen.
