# Vision and Operating Model

| Metadato | Valor |
| --- | --- |
| Título | Recursos Corporativos PAY0 — Vision and Operating Model |
| Versión | 1.0.0 |
| Fecha | 2026-09-27 |
| Autor | Codex / PAY0 Architecture |
| Estado | Review |
| Cambios | Documento fundacional inicial. Define la visión funcional y los principios permanentes del módulo. |

## 1. ¿Por qué existe este módulo?

PAY0 utiliza recursos corporativos que representan identidad, autoridad, reglas y conocimiento reutilizable de sus empresas: documentos fiscales, logos, plantillas, formatos, catálogos, configuraciones y otros activos de operación. Actualmente estos recursos pueden estar distribuidos entre archivos locales, repositorios, configuraciones, Storage, Firestore y módulos especializados.

Esa dispersión crea un problema de negocio: PAY0 no siempre puede responder de manera inmediata y confiable cuál es el recurso vigente, quién lo aprobó, a qué empresa pertenece, qué procesos lo utilizan, qué documentos se produjeron con él o qué impacto tendría sustituirlo.

El módulo existe para dar gobierno y continuidad a esos recursos. Su propósito es convertirlos en activos corporativos identificables, confiables, versionados, auditables y reutilizables, sin depender de la memoria de una persona ni de la ubicación accidental de un archivo.

El resultado buscado no es “tener todos los archivos juntos”. Es que PAY0 pueda operar durante años con una fuente gobernada para sus recursos corporativos, conocer su contexto y utilizar siempre la versión correcta.

## 2. ¿Qué no es?

Recursos Corporativos PAY0 no es:

- **Un explorador de archivos.** La estructura no se organiza como carpetas para navegar libremente. Cada recurso existe por su propósito, ownership y uso.
- **Una carpeta compartida.** No es un espacio donde cualquier usuario pueda cargar, reemplazar o descargar archivos sin workflow y autorización.
- **Un gestor documental genérico.** No pretende administrar cualquier documento producido por PAY0. Sólo gobierna recursos corporativos reutilizables.
- **Un repositorio Git.** Git puede continuar almacenando código o fuentes técnicas, pero no sustituye vigencia, aprobación, ownership, dependencias y consumo operativo.
- **Un almacenamiento de secretos.** Contraseñas, tokens, API keys, CSD, e.firma, llaves privadas y credenciales nunca deben vivir aquí.
- **Un expediente de clientes.** Los documentos de clientes, solicitudes, pagos, dispersiones y otros casos operativos conservan sus módulos y flujos actuales.
- **Un reemplazo de Materialidad.** Materialidad mantiene sus expedientes, evidencias y procesos. Puede consumir recursos corporativos, pero no es sustituida por este módulo.
- **Un centro global del ecosistema.** No mezcla recursos de PAY0, Assets, TTT y Hugo en un dominio único.

## 3. ¿Qué sí es?

Es el sistema de gobierno para los **Recursos Corporativos reutilizables de PAY0**.

Gobernar significa que PAY0 puede conocer y controlar:

- qué es cada recurso;
- quién es su propietario;
- si pertenece globalmente a PAY0 o a una empresa propia;
- cuál versión está vigente;
- quién la creó, revisó y aprobó;
- durante qué periodo debe utilizarse;
- qué módulos, procesos y automatizaciones dependen de ella;
- qué productos fueron generados con una versión concreta;
- qué validaciones ha superado;
- cómo se reemplaza o retira sin perder el histórico.

Un recurso puede ser un archivo, un conjunto de archivos, información estructurada o una configuración reutilizable. Su valor no depende de su formato, sino de que represente un activo corporativo administrado y consumible de forma controlada.

## 4. ¿Quién es el propietario?

### Propietario funcional

PAY0 es el propietario funcional absoluto del módulo y de los recursos que gobierna. Cada recurso deberá tener además un responsable funcional identificable dentro de PAY0 o de la empresa propia correspondiente. Ese responsable define propósito, vigencia, uso aceptado y autoridad de negocio.

### Propietario técnico

La plataforma PAY0 es propietaria de la arquitectura, persistencia, seguridad, contratos, disponibilidad e integridad técnica. El equipo técnico mantiene el sistema, pero no decide por sí mismo la validez empresarial de un recurso.

### Administradores

Los administradores son usuarios autorizados para realizar capacidades concretas, como registrar, revisar, aprobar, activar, retirar o consultar. Ser administrador de PAY0 no implica automáticamente tener todas las capacidades. Las responsabilidades deberán asignarse explícitamente y podrán exigir separación entre quien prepara y quien aprueba.

### Consumidores

Los consumidores son módulos, procesos, automatizaciones o herramientas autorizadas que utilizan un recurso para cumplir una función. Un consumidor no adquiere ownership sobre el recurso y no puede modificarlo por consumirlo.

## 5. ¿Qué pertenece aquí?

Pertenece un elemento cuando es propiedad de PAY0 o de una empresa propia, es reutilizable, necesita una versión autorizada y puede ser consumido por uno o varios procesos.

Ejemplos:

- actas constitutivas y documentos corporativos maestros;
- constancias fiscales y opiniones de cumplimiento de empresas propias;
- información bancaria corporativa autorizada para usos permitidos;
- logos, firmas gráficas, papelería e identidad visual;
- plantillas de cotizaciones, constancias, reportes y documentos;
- formatos Word, Excel, PowerPoint, PDF, SVG, HTML o equivalentes;
- catálogos SAT o catálogos autorizados por empresa;
- configuraciones reutilizables que no contengan secretos;
- textos, cláusulas o bloques institucionales aprobados;
- parámetros corporativos cuya vigencia y consumo deban gobernarse;
- recursos estructurados utilizados por automatizaciones;
- materiales de referencia autorizados para generar nuevos documentos.

El mismo tipo de archivo puede pertenecer o no al módulo según su función. Un PDF corporativo maestro puede pertenecer; un comprobante generado para una operación concreta normalmente pertenece al expediente operativo correspondiente.

## 6. ¿Qué nunca debe vivir aquí?

Nunca deben almacenarse como Recursos Corporativos:

- contraseñas, tokens, cookies, API keys o credenciales;
- CSD, e.firma, llaves privadas o secretos bancarios;
- documentos personales o corporativos sin autorización y ownership comprobable;
- expedientes completos de clientes;
- comprobantes, facturas, pagos o dispersiones de una operación individual;
- conversaciones, memoria, trazas o configuración interna de Hugo;
- recursos cuyo propietario real sea Assets o TTT;
- archivos temporales sin propósito corporativo definido;
- duplicados cargados “por si acaso” sin procedencia ni vigencia;
- datos que deban permanecer exclusivamente en Secret Manager u otro almacén especializado;
- contenido ilegal, malicioso o incompatible con las políticas de PAY0.

El módulo tampoco debe convertirse en destino automático de cualquier archivo generado por el sistema. Los outputs operativos permanecen en el dominio que los creó; sólo registran qué recurso corporativo utilizaron cuando sea relevante.

## 7. ¿Cómo interactúa con el resto de PAY0?

Recursos Corporativos es un proveedor gobernado. Los demás módulos conservan sus responsabilidades y solicitan recursos cuando los necesitan.

### Facturación

Puede consumir catálogos autorizados, identidad de la empresa, configuraciones no secretas y plantillas. Facturación continúa siendo responsable de emitir, cancelar y administrar CFDI. El módulo no sustituye su lógica ni almacena sus secretos.

### Materialidad

Puede utilizar plantillas, logos, textos aprobados o documentos corporativos de referencia. Materialidad conserva expedientes, evidencias, validaciones y flujo operativo propios.

### Cotizaciones

Puede resolver la plantilla, papelería, logo, textos y catálogos vigentes para una empresa. La cotización generada pertenece al flujo de Cotizaciones; registra las versiones corporativas utilizadas.

### Reportes

Puede consumir identidad visual, plantillas, parámetros o catálogos aprobados. Los reportes y sus datos siguen perteneciendo al módulo de Reportes.

### Firma

Puede utilizar imágenes o referencias corporativas autorizadas. Los tokens, actos de firma y evidencias criptográficas continúan en el dominio de Firma.

### Automatizaciones

Pueden resolver recursos mediante contratos controlados y registrar la versión utilizada. Ninguna automatización puede elegir arbitrariamente una versión, eludir una aprobación o acceder directamente al almacenamiento.

En todos los casos, el consumidor utiliza el recurso; no lo administra ni se convierte en su propietario.

## 8. Relación con Hugo

PAY0 continúa siendo el propietario absoluto de los Recursos Corporativos.

Hugo nunca será propietario de un recurso, una versión, un archivo, una aprobación o una política de acceso. Tampoco tendrá acceso directo a Firestore, Storage ni a las superficies administrativas del módulo.

Hugo únicamente podrá consumir recursos mediante herramientas server-side autorizadas. Cada herramienta deberá:

- actuar con la identidad y el alcance autorizado del usuario;
- utilizar el helper canónico de autorización;
- solicitar una capacidad explícita para la acción concreta;
- respetar ownership, empresa, root y clasificación;
- registrar el uso de la versión resuelta;
- evitar revelar existencia o contenido cuando la solicitud no esté autorizada.

Consultar, resumir, validar, incluir en un expediente, adjuntar o enviar son acciones diferentes. La autorización para una no concede las demás.

## 9. Evolución futura

El módulo debe crecer como una plataforma de gobierno, no como una acumulación de pantallas y archivos.

Durante los próximos años podrá incorporar:

- nuevas clases de documentos corporativos;
- recursos gráficos y sistemas de identidad visual;
- plantillas multiformato y sus componentes reutilizables;
- catálogos y recursos estructurados;
- configuraciones corporativas no secretas;
- validaciones de vigencia, integridad, formato y compatibilidad;
- análisis de impacto antes de activar versiones;
- automatizaciones de revisión, expiración y sustitución;
- generación de documentos con trazabilidad de insumos;
- consumo controlado por nuevos módulos o herramientas;
- métricas sobre uso, dependencia, riesgo y obsolescencia;
- integración con validadores especializados sin transferirles ownership.

La evolución debe realizarse por capacidades y clases de recurso, conservando contratos estables. Ninguna ampliación justifica debilitar autorización, inmutabilidad, auditoría o separación entre sistemas.

## 10. Principios permanentes

Estos principios constituyen límites del dominio y no deben romperse en implementaciones futuras:

1. **PAY0 conserva el ownership.** Consumir un recurso no transfiere su propiedad.
2. **Cada sistema conserva su dominio.** PAY0, Assets, TTT y Hugo no mezclan recursos ni auditoría.
3. **Toda versión publicada es inmutable.** Un cambio produce una versión nueva.
4. **Nunca se sobrescribe el histórico.** Restaurar es avanzar mediante una versión nueva.
5. **Existe una única versión activa por ámbito aplicable.** La resolución debe ser determinista.
6. **Toda acción sensible se autoriza server-side.** La interfaz nunca constituye autorización.
7. **La seguridad es fail-closed.** Ante identidad, alcance, ownership o capacidad inciertos, la operación se bloquea.
8. **La auditoría es obligatoria y sanitizada.** Debe explicar decisiones sin filtrar información protegida.
9. **Los secretos permanecen fuera.** El módulo sólo puede conservar referencias opacas cuando sea indispensable.
10. **Las dependencias son explícitas.** Activar un recurso exige comprender su impacto.
11. **Los consumidores registran la versión usada.** Un output importante debe poder reproducirse o explicarse.
12. **No se confunden recursos con outputs operativos.** Cada módulo conserva sus expedientes y resultados.
13. **No hay migraciones masivas implícitas.** La transición se valida por fuente, recurso y consumidor.
14. **No se elimina una fuente anterior sin evidencia y aprobación.** La reversibilidad forma parte del cambio.
15. **Hugo nunca obtiene acceso privilegiado por personalidad o conveniencia.** Se somete al mismo modelo de autorización.

## Modelo operativo resumido

El responsable funcional define qué recurso necesita PAY0 y cuál es su propósito. Un administrador autorizado prepara una nueva versión. Las validaciones comprueban su integridad y compatibilidad. Un actor con capacidad suficiente la revisa y aprueba. La activación controlada establece cuál versión deben resolver los consumidores. Cada uso relevante queda asociado a esa versión. Cuando el recurso cambia, se crea otra versión; la anterior se retira, pero permanece como evidencia histórica.

Esta disciplina convierte recursos dispersos en activos corporativos confiables sin invadir los dominios que los consumen.
