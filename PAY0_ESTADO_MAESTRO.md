# PAY0 — Estado maestro vivo

### Separación PAY0 PLATFORM / ASSETS validada localmente (2026-09-20)

ASSETS quedó corregido como sistema hermano de PAY0 y no como opción de su navegación funcional. El `RootLayout` conserva autenticación, mantenimiento y autorización comunes, pero selecciona un `AssetsShell` independiente para `/assets/**`; `/systems` es el launcher de plataforma y deja TTT únicamente como incorporación futura. PAY0 conserva su navegación y Hugo; ambos shells ofrecen cambio de sistema también en móvil.

El dashboard ASSETS ahora es informativo y las capturas se movieron a `/assets/positions/new` y al detalle `/assets/positions/[id]`. Se añadieron listados de posiciones, movimientos y documentos con lenguaje humano. La importación documental continúa sólo preparada: no convierte extracción en verdad financiera ni crea movimientos sin confirmación.

La lectura del portafolio separa datos confirmados de pruebas. Registros marcados `TEST`, excluidos o vehículos heredados sin clasificación se conservan pero no participan en métricas; U-PRO confirmado, préstamos y altas revisadas sí participan. Los nombres canónicos son Duster Intens TM 2025, Kwid Iconic TM 2025 y Arkana Esprit Alpine 2025. No se alteró el modelo de Position/AssetMovement, proyección, centavos, interés, capital/utilidad, idempotencia o enlace PAY0.

Autorización independiente: frontend y backend exigen Superadmin o `systemAccess.assets`; ocultar navegación no concede acceso. Verificación local: build frontend PASS con 42 rutas, build Functions PASS, política de autorización PASS, smoke de dominio PASS y Firestore Emulator PASS para permisos, propietario, interés, pagos, seed, revisión documental y exclusión de datos no confirmados.

Despliegue productivo autorizado y completado el 2026-09-20: las ocho Functions de ASSETS y `ssrpay0system` se verificaron `ACTIVE`; la revisión SSR es `ssrpay0system-00481-mey`. Hosting publicó `/systems`, `/assets`, `/assets/positions`, `/assets/movements` y `/assets/documents`, todas con HTTP 200. Este corte no desplegó reglas ni índices, no ejecutó el seed U-PRO y no realizó escrituras financieras o documentales en producción.

### Hugo 2.0 + ASSETS V1 desplegados (2026-09-20)

Se abrió `feature/hugo-assets-platform-v1` para no mezclar esta línea con Control Center. La implementación ya está desplegada en producción, pero la rama no está fusionada ni publicada al remoto. El renderer de cotización usa A4 y reconstruye el encabezado TROSTRE desde HTML/CSS canónico; la referencia PDF permanece inmutable. La vista previa confirmó datos, tabla, bancos, entrega y QR alineados, sin imprimir IDs técnicos.

Hugo reconcilia sus propuestas con Solicitudes/Pagos antes de mostrarlas. Una revisión de OC anterior al timbrado se conserva como aprendizaje, pero deja de ser accionable cuando ya existe UUID/CFDI. Las tarjetas usan título, explicación y pregunta humana en lugar de códigos internos. Sólo una excepción concreta genera confirmación; la mera carga de OC queda como observación.

La capacidad `REQUEST_IQ_PAYMENT_COMPLEMENT` se activa únicamente mediante una orden explícita del Superadmin en la conversación. Selecciona un único seguimiento por folio, reutiliza la automatización existente y bloquea duplicados, estados inciertos o selecciones ambiguas. Los REP recibidos se versionan en documentos del Pago correspondiente, manteniendo referencias de aplicación/Solicitud para trazabilidad.

ASSETS V1 es aditivo y privado por usuario. El ledger es la verdad financiera; las posiciones son proyecciones. Soporta vehículos, préstamos, interés, capitalización, capital/utilidad separados, pagos externos/efectivo/PAY0, evidencia documental preparada para extracción futura con confirmación humana y el conjunto U-PRO confirmado.

Validación final: builds Functions/frontend PASS con 37 rutas; política de autorización PASS; smokes de Hugo, complementos y ASSETS PASS en Emulator. Se comprobaron reconciliación de propuestas, protección contra duplicados IQ, almacenamiento de REP en el Pago, aislamiento por propietario, interés idempotente, asignación capital/interés y bloqueo del doble enlace PAY0. Se desplegaron dos índices Firestore y ambos quedaron `READY`; 16 Functions dirigidas y la función SSR quedaron `ACTIVE`. Hosting fue liberado en `https://pay-0-system.web.app`; `/assets`, `/hugo` y `/facturacion` respondieron HTTP 200. No se emitió CFDI ni se solicitó un complemento real a IQ durante las pruebas.

### Cierre de despliegue fiscal y documental acumulado (2026-09-20)

Quedaron publicados los cambios acumulados que conectan la OC activa con su metadata fiscal y partidas, reproceso, Facturama, catálogos SAT, documentos canónicos, firma, verificación pública y Materialidad. El despliegue dirigido terminó con 39 Functions exitosas, cero errores y cero abortos. Los índices de Firestore y las reglas de Storage también se publicaron; el ruleset de Storage es `37362831-a91f-44a4-a2dc-ac2bfc7aced6`.

Hosting/SSR quedó liberado en `https://pay-0-system.web.app`. `/login` y la ruta pública de verificación de cotización respondieron HTTP 200 después de la publicación. Evidencia previa al deploy: frontend con 36 rutas y Functions compilaron; política de autorización sincronizada; parser fiscal, reproceso de OC, conversación Hugo y enlace fiscal Control Center pasaron en emuladores. PAC y Storage fueron simulados en el smoke fiscal; no hubo timbrado, solicitud IQ, dispersión ni cancelación real.

Se preservó `debugPagoIqDepositHttpShadow`, función diagnóstica existente en producción pero ausente del código local. El deploy global pretendía eliminarla y se reemplazó por despliegues dirigidos; no debe borrarse sin una decisión explícita. Las advertencias del compilador de reglas Storage sobre consultas Firestore requieren una prueba específica de reglas/emulador, aunque el ruleset compiló y quedó publicado.

Rama vigente: `feature/control-center-interconnection`. Este cierre no hizo merge, rebase, push ni borrado de ramas.

### Complementos automáticos (2026-09-20)

Transferencias fiscales ajustadas: PAY0 conserva la fecha del comprobante y su hora; usa `12:00:00` únicamente cuando ésta no viene y la deja visible/editable. Forma SAT `03`, referencia, banco y cuentas viajan al REP cuando existen. Se valida que el RFC del pagador corresponda al receptor de la factura y el beneficiario al emisor, manteniendo separado el RFC de la institución bancaria.

Corrección publicada en producción: creación de pago, parser de comprobantes, ejecutor automático de REP y Hosting actualizados correctamente. Builds y smoke aislado PASS, sin emitir CFDI ni solicitar complementos reales durante la prueba.

Cola nueva para PPD posteriores a activación: IQ confirmado → petición por depósito/perfil; Facturama → CFDI P desde XML original y datos reales del pago. Scheduler 19:00 Ciudad de México y alerta después de diez días; sin WhatsApp ni histórico automáticos. Idempotencia y resultados inciertos protegidos; distintos REP se conservan en documentos. Facturama inicial: MXN sin impuestos/IVA 16 % uniforme; otros esquemas requieren revisión y forma SAT faltante se confirma en Reportes. Builds, autorización y cuatro suites de emulador PASS, sin emisiones reales de prueba. Doce funciones ACTIVE y Hosting publicados; ambos proveedores activados prospectivamente, cero jobs históricos y scheduler ENABLED verificado. Detalles en `src/canonicos/COMPLEMENTOS-AUTOMATICOS-2026-09-20.md`.

### Continuación IQ / Hugo / complementos (2026-09-20)

Revisado el flujo productivo en lectura: 411 solicitudes, 154 pagos, 60 aplicaciones, tres facturas emitidas y nueve expedientes. Sin diferencias en padres de aplicaciones, abonos y UUID entre factura/solicitud/expediente dentro de estas comprobaciones.

Beneficiarios locales admiten razones sociales con cifras y respetan delegación operativa; las altas simultáneas no sobrescriben una cuenta. La dispersión revalida destino, root y tramos. Hugo consulta mensajes recientes realmente ordenados, encuentra folios antiguos y avisa sobre aplicaciones/beneficiarios/dispersiones/complementos sólo al Superadmin. Se registraron 16 seguimientos de complemento desde 60 aplicaciones históricas: 12 pendientes de solicitud al proveedor y cuatro esperando confirmación de aplicación IQ.

El usuario confirmó que aún no tiene el recorrido de alta de beneficiarios/solicitud de complementos en IQ y lo compartirá al regresar. Esas acciones externas y la descarga posterior no están implementadas ni se simulan como exitosas. El seguimiento local no equivale a solicitud enviada. Builds, autorización, integración/UI de emulador y regresión fiscal PASS; índices publicados y consultas comprobadas. Backend publicado y verificado: 21/21 funciones ACTIVE. Hosting publicado correctamente; no se desplegaron reglas. Detalle: `src/canonicos/IQ-HUGO-SEGUIMIENTO-2026-09-20.md`.

### Entrega actual: interconexión Control Center (2026-09-19)

Implementación en `feature/control-center-interconnection`: 20 adaptadores de fuente, contribuciones idempotentes, eventos auditables, agregados y consolidación histórica reanudable. Sin Proyectos. Lecturas consolidadas restringidas a Superadmin y root del perfil.

Separamos dinero registrado, aplicaciones, comisiones, Wallet y gastos con evidencia; utilidad/impuestos permanecen no disponibles sin cobertura contable. La interfaz usa el rango canónico y una dimensión a la vez, con límites visibles. Las colas de IQ/WhatsApp/Telegram indican trabajos, no disponibilidad externa.

También se incorporan cola de recuperación limitada, publicación fiscal local atómica, reutilización de XML/PDF en reintentos, conservación de fecha de Materialidad y aprobación idempotente de recomendaciones de Hugo. Las regeneraciones documentales requieren revisión; no hay emisión/cancelación automática.

Estado: entrega desplegada. Completados 30 despliegues de Functions del Control Center/recuperación/gastos, 10 de interconexión y Hosting/SSR; el inicializador recibió además la optimización de lotes de cinco ya verificada. Histórico productivo completo: 2,070 contribuciones, snapshot versión 2, 37 métricas cotejadas sin diferencias. El mantenimiento no ejecutó operaciones financieras ni envíos externos.

Evidencia final: builds frontend y Functions, política de autorización y seis smokes PASS (contrato, eventos, snapshot, conexiones, enlace fiscal y UI). Pruebas en Firestore Emulator con Admin SDK; no son pruebas de reglas. PAC/Storage simulados: falla atómica, reintento sin otro CFDI ni documentos duplicados, importe XML, root y auditoría Hugo. La aprobación simultánea de una recomendación incrementa una sola vez. Producción: 30 Functions de Control Center `ACTIVE`, `/reportes` HTTP 200, API analítica anónima HTTP 401. No se desplegaron reglas/índices ni se probó timbrado real. No hubo navegador autenticado disponible: el recorrido UI es local, no producción.

Cierre de alcance: interconexión 3B sin Proyectos, no implementación total del catálogo futuro 3.0. Rentabilidad/impuestos no disponibles sin cobertura contable; una dimensión por periodo, límite 366 días. Tracker actualizado junto con esta bitácora. Commit acotado del Control Center; cambios fiscales/Hugo superpuestos y trabajo previo permanecen preservados en el workspace, sin merge ni push.

> Fuente de continuidad. El código es la fuente de verdad de lo implementado;
> este archivo registra decisiones, evidencia, riesgos y el siguiente punto de
> trabajo. Si hay contradicción, investigar y corregir este archivo, no adaptar
> el código silenciosamente.

## 1. Estado general

**Actualizacion 2026-09-18.** Se corrigio la cadena OC activa → metadata fiscal/partidas → borrador Facturama → cotizacion/constancia. El lector de OC ya no depende de un encabezado unico y conserva las partidas para documentos. La constancia incluye UUID cuando existe en Solicitud/CFDI y un QR tokenizado de verificacion publica; su validacion visual en produccion sigue pendiente. Hugo conserva el aislamiento por `rootId` y crea una propuesta supervisada al entrar una OC. El rediseño del modal de documentos permanece deliberadamente sin cambios.

**Disciplina de continuidad.** Al cierre de cada bloque funcional, actualizar este Estado Maestro y `PAY0-TRACKER.md` con cambio, deploy, prueba y pendiente. No existe aun un mecanismo tecnico que pueda inferir y redactar correctamente estos hitos desde el codigo; hasta implementarlo, esta actualizacion es una responsabilidad obligatoria del cierre de cada sesion.

**Arquitectura.** Frontend Next.js 14 App Router (`src/app`, `src/components`,
`src/services`), Firebase Auth/Firestore/Storage y Cloud Functions v2
(`functions/src`). No hay API REST independiente. El proyecto Firebase es
`pay-0-system`, región `us-central1`.

**Módulos localizados en código.** Solicitudes, Pagos, Wallet/financiamiento,
Dispersiones, Empresas/clientes/despachos, Usuarios/accesos, IQ, Facturación
Facturama, Materialidad, documentos, Telegram, WhatsApp/CAOB, Reportes y Hugo
(Agente 007 observador).

**Estado de producción verificable en esta sesión (2026-09-16/17).** Se
desplegó el bloque acotado de Functions de Solicitudes/Materialidad/Firma/
Facturama-SAT, las reglas de Storage y Hosting. Las 17 Functions objetivo se
consultaron en estado `ACTIVE` y `https://pay-0-system.web.app/facturacion`
respondió HTTP 200. Esto no sustituye un smoke autenticado del ciclo.

**Implementado localmente y compilado.** Materialidad central, subida segura de
documentos de Solicitudes, OC como detonador, cotización automática,
firma presencial/enlace y constancia posterior, borradores Facturama, catálogo
autorizado por empresa y lector del catálogo SAT `.db.bz2`.

**Incompleto.** Timbrado real, CSD y llamadas reales a Facturama; retorno de
XML/PDF/UUID; REP para PPD; control ingreso→gasto con proveedor IQ seleccionado
por humano; importación normalizada de catálogo IQ; conciliación bancaria; y
validación productiva integral del ciclo.

## 2. Decisiones canónicas — no reinterpretar

1. **Materialidad 2.0 es el expediente central**, no otro repositorio de
   archivos. Referencia Solicitud, documentos, CFDI, pagos y trazabilidad.
2. No se duplican archivos: documentos físicos viven en Storage bajo la ruta
   autorizada de su entidad; Materialidad conserva referencias, hashes y estado.
3. Empresas propias y empresas/despachos IQ son catálogos distintos. Solo una
   empresa propia puede emitir CFDI con Facturama. Hoy Trostre se identifica por
   RFC `TRO230717L64`; futuras propias requieren bandera explícita.
4. Catálogo global SAT Producto/Servicio y catálogo global SAT Unidades son
   fuentes separadas del catálogo autorizado de cada emisora. Las claves SAT
   autorizadas por empresa no se alteran; las descripciones comerciales pueden
   adaptarse dentro de las reglas aprobadas.
5. Orden canónico: **OC/OS → Solicitud → Materialidad → Facturama/borrador →
   CFDI → entrega/prestación/evidencia → constancia/firma → pagos/REP → cierre**.
   El código actual sólo automatiza las etapas marcadas abajo; no prometer las
   demás hasta validarlas.
6. El gasto relacionado no se inventa ni se selecciona automáticamente. Tras un
   ingreso, una persona autorizada deberá escoger posteriormente empresa IQ,
   oferta real, concepto fiscal y monto; todo queda como relación del mismo
   expediente.
7. No romper IQ operativo existente al integrar Facturama/Materialidad.
8. Un formato canónico publicado es inmutable; una corrección crea versión nueva
   y no cambia documentos históricos.

## 3. Arquitectura y datos

### Implementado en código

| Estructura | Rol y relación |
|---|---|
| `solicitudes/{id}` | Operación base, aislada por `rootId`; sus documentos usan `uploads`. |
| `uploads/{id}` | Metadatos de documento, `storagePath`, tipo, estado, hash, Solicitud/Pago relacionado. |
| `materialityOperations/{solicitudId}` | Expediente central por Solicitud; no duplica el archivo. |
| `materialityClientCompanies/{id}` | Carpeta lógica cliente/empresa para expedientes. |
| `facturamaInvoices/{id}` | Borradores PAY0 con `rootId`, emisor, receptor, conceptos e idempotencia. No equivale a CFDI timbrado. |
| `companyInvoiceCatalogs/{companyId}` | Catálogo canónico de una empresa propia, hash, versión, conceptos y estatus. |
| `companyInvoiceCatalogImports/{companyId}__{hash}` | Historial de importaciones del catálogo emisor. |
| `satCatalogImports/{id}` | Importación administrativa del paquete SAT; archivo fuente, hash, estado y fecha efectiva. |
| `satProductServiceCatalog/{ClaveProdServ}` | Claves globales CFDI 4.0 importadas. |
| `satUnitCatalog/{ClaveUnidad}` | Unidades globales CFDI 4.0 importadas. |
| `satCatalogState/current` | Versión global activa; impide validar claves heredadas de una versión vieja. |

### Diseñado / pendiente, no implementado como flujo completo

- `incomeExpenseControls/{incomeCfdiId}` y `relatedExpenses`: control
  ingreso→gasto con relaciones, UUID, pago, evidencia y estados.
- `iqProviderOperationCatalogs/{providerId}`: ofertas reales de proveedores IQ,
  separado de catálogos emisores propios y de SAT global.
- Flujo de CFDI timbrado, almacenamiento de XML/PDF, UUID, PPD/REP y cierre
  fiscal/financiero del expediente.

## 4. Integraciones

| Integración | Estado actual | Evidencia / pendiente |
|---|---|---|
| Firebase | Implementada | Auth, Firestore, Storage y Functions v2. Reglas restrictivas. El deploy de la regla SAT actual está pendiente. |
| IQ | Existente | OC sigue encolando la creación IQ desde documentos de Solicitud. No fue alterado en el bloque Facturama/SAT. |
| Facturama | Implementado / bloqueado por credenciales | Borrador fiscal validado y API Multiemisor sandbox conectada. La emisión, descarga de XML/PDF y liga al mismo expediente están desplegadas con idempotencia. Las credenciales guardadas responden HTTP 401 tanto en sandbox como en producción; falta reemplazarlas y ejecutar la primera emisión. |
| SAT | En desarrollo local | Paquete `catalogs.db.bz2` validado: 52,513 Producto/Servicio y 2,418 Unidades CFDI 4.0. Falta deploy e importación administrativa productiva. |
| Materialidad | En desarrollo local | Expediente y referencias operativas existen; falta ciclo fiscal/financiero completo y prueba productiva. |
| Telegram/MAT | Existente, no auditado ahora | Mantener separado de esta fase. |
| WhatsApp/CAOB | Existente con pendientes | No tocar sin tarea específica; conexión/operación debe validarse por separado. |

## 5. Materialidad 2.0

**Arquitectura actual.** `functions/src/modules/materiality/` enlaza Solicitud
con `materialityOperations` y clasifica documentos canónicos. El manifiesto
cliente es `src/canonicos/materialidad.ts`; la guía técnica es
`src/canonicos/MATERIALIDAD-EXPEDIENTE-CENTRAL.md`.

**Documentos/trazabilidad.** OC, cotización, cotización firmada, CFDI XML/PDF,
comprobantes, firma autorizada y constancia son tipos de documentos de Solicitud
y referencias del expediente. La cotización generada conserva hashes y versión
de plantilla; la firma se guarda como `FIRMA_AUTORIZADA_CLIENTE`; la constancia
es `CONSTANCIA_RECEPCION_SATISFACCION`.

**Automatización codificada (pendiente de validación productiva).** Al finalizar
una `ORDEN_COMPRA`, `finalizeSolicitudDocumentUploadCore` intenta encolar IQ,
crear borrador Facturama, generar cotización y enlazar Materialidad. Al guardar
una firma, intenta generar constancia. Los errores quedan en campos de estado de
la Solicitud; revisar esos campos en el smoke.

**Lo que falta para Materialidad completa.** CFDI timbrado/XML/PDF/UUID,
ingreso-gasto, selección manual de proveedor IQ, cuenta por pagar, transferencia,
conciliación, PPD/REP y reglas de cierre con evidencia fiscal verificable.

## 6. Estado por módulo

### Materialidad
**ESTADO:** En desarrollo local.  
**ÚLTIMO CAMBIO:** Enlace de Facturama y documento/constancia al mismo expediente.  
**ARCHIVOS:** `functions/src/modules/materiality/{domain,service,callables}.ts`.  
**FUNCIONA:** Operación central y vistas/callables de lectura.  
**FALTA:** Flujo fiscal-financiero completo y smoke productivo.  
**SIGUIENTE PASO:** Desplegar bloque acotado y probar una OC propia de Trostre.

### Solicitudes
**ESTADO:** En desarrollo local.  
**ÚLTIMO CAMBIO:** Paginación por periodo y disparadores OC/firma.  
**ARCHIVOS:** `functions/src/index.ts`, `functions/src/modules/solicitudDocuments/`, `src/app/solicitudes/page.tsx`.  
**FUNCIONA:** Carga con rango en backend y documentos autorizados.  
**FALTA:** Smoke real de OC y revisión de errores por Solicitud.

### Facturación / Facturama
**ESTADO:** Conector sandbox desplegado; prueba externa bloqueada por credenciales HTTP 401.  
**ÚLTIMO CAMBIO:** Emisión Multiemisor, descarga XML/PDF, guardado en Solicitud/Materialidad y recuperación idempotente por ID de Facturama.  
**ARCHIVOS:** `functions/src/modules/facturama/`, `src/app/facturacion/page.tsx`.  
**FUNCIONA:** Borrador fiscal validado, catálogo Trostre atestado, receptor desde CSF/KYC y conector de emisión sandbox con bloqueo de doble envío.  
**FALTA:** Sustituir secretos sandbox rechazados, ejecutar una emisión aceptada, verificar XML/PDF/UUID en el expediente y después implementar cancelación y PPD/REP.

### Catálogos SAT
**ESTADO:** Codificado/compilado, no desplegado/importado en producción.  
**ARCHIVOS:** `satGlobalCatalog.ts`, `companyCatalog.ts`, `src/lib/uploadSatCatalog.ts`.  
**FUNCIONA:** Lectura BZip2+SQLite, hash, vigencia y versión activa; Functions/Storage/Hosting desplegados.  
**FALTA:** Carga administrativa y prueba con Trostre.

### Firma, cotizaciones y constancias
**ESTADO:** Codificado/compilado, pendiente smoke productivo.  
**ARCHIVOS:** `functions/src/modules/{cotizaciones,constancias,signatureLinks}/`, `src/app/firma/`, `src/components/DocsModal.tsx`.  
**FUNCIONA:** Enlace público de firma, captura móvil/presencial, evidencia y disparo de constancia.  
**FALTA:** Verificar plantilla final, política de no reclamos, persona/cargo autorizado y ruta completa en producción.

### Pagos / Wallet / Dispersiones
**ESTADO:** Existentes; fuera del deploy acotado de esta sesión.  
**FALTA:** Conciliación, comprobantes, complementos/UUID y pendientes específicos previamente registrados.  
**REGLA:** No tocar por arrastre de Materialidad.

### IQ, Usuarios, Empresas, Telegram, WhatsApp/CAOB, Reportes/Finanzas
**ESTADO:** Existentes; no auditados integralmente en esta sesión.  
**SIGUIENTE PASO:** Auditar por módulo con pruebas reales, no inferir estado por el historial conversacional.

## 7. Pruebas y evidencia

| Fecha | Funcionalidad | Resultado | Nivel | Nota |
|---|---|---|---|---|
| 2026-09-16 | Lectura de `catalogs.db.bz2` | PASS | Codificado/probado local | SHA-256 `394e8b...7f245`; SQLite válida; 52,513 productos y 2,418 unidades. |
| 2026-09-16 | `72141702`, `E48`, `H87`, `SET` | PASS | Probado local | Existen en los catálogos CFDI 4.0 importables. |
| 2026-09-16 | Functions TypeScript | PASS | Compila | `functions/npm run build`. |
| 2026-09-16 | Frontend Next.js | PASS | Compila | `npm run build`; compilación y type-check iniciados sin error reportado. |
| 2026-09-16/17 | Deploy acotado OC/firma/constancias/Facturama-SAT | PASS | Desplegado | 17 Functions `ACTIVE`, Storage Rules publicadas y `/facturacion` HTTP 200. |
| Pendiente | OC→cotización→firma→constancia | PENDIENTE | Desplegado/no probado | Smoke autenticado requerido. |
| 2026-09-17 | Conector Facturama sandbox | PASS parcial | Desplegado / externo bloqueado | Functions activas y flujo XML/PDF implementado; autenticación directa a Facturama responde HTTP 401 con los secretos actuales. |

Niveles obligatorios: **CODIFICADO**, **COMPILA**, **DEPLOYADO**, **PROBADO**,
**VALIDADO EN PRODUCCIÓN**. Compilar no equivale a validar.

## 8. Problemas abiertos

1. Falta evidencia de deploy/smoke del ciclo automático OC, cotización, firma y constancia.
2. Facturama no puede completar la primera emisión porque los secretos sandbox actuales son rechazados con HTTP 401; el conector y el retorno XML/PDF ya están desplegados.
3. PPD no conserva aún el flujo completo de pago/REP.
4. No existe aún la selección humana de proveedor/costo IQ ni el control ingreso→gasto.
5. Catálogo IQ fuente requiere adaptador de revisión: su formato no es contrato fiscal canónico.
6. El tracker histórico no contiene cierres/evidencia consistente; este archivo lo sustituye como bitácora técnica viva, pero el tracker visual debe alinearse después.
7. Hosting/Functions productivos requieren confirmar versión efectiva tras cada deploy.

## 9. Pendientes priorizados

### P0 — bloqueante para prueba de hoy
- Reemplazar `FACTURAMA_SANDBOX_USERNAME` y `FACTURAMA_SANDBOX_PASSWORD` por credenciales válidas de la cuenta sandbox independiente.
- Ejecutar la emisión controlada del borrador `AUTO_DRAFT_FISCAL_VALIDATED` y verificar XML/PDF/UUID en la misma Solicitud y Materialidad.

### P1 — Materialidad 2.0
- Facturama real: emisor/CSD, timbrado, XML/PDF/UUID y manejo idempotente.
- PPD → pago → REP en el mismo expediente.
- Control ingreso→gasto manual con catálogo IQ separado y evidencia fiscal.
- Confirmar persona autorizada, vigencia/revocación y texto de no reclamos de firma.

### P2 — operativos posteriores
- Conciliación bancaria BBVA/archivos y comprobantes.
- Pendientes Wallet/Dispersiones, UUID y complementos IQ.
- Reportes de congruencia fiscal/financiera y visualizaciones Materialidad.

### P3 — evolución
- Importador gobernado de catálogos IQ.
- Automatización avanzada de Hugo con aprendizaje observable, reglas y aprobación humana.

## 10. Última sesión

**FECHA/HORA:** 2026-09-16 17:55 America/Mexico_City.  
**OBJETIVO:** Validar catálogo SAT `.db.bz2`, integrarlo de forma controlada y preparar prueba del ciclo documental.  
**QUÉ SE HIZO:** Se verificó el paquete SQLite/BZip2; se codificó importación global SAT por Storage, validación de catálogo emisor, UI de importación y control de versión activa. Se auditó el disparo automático desde OC y firma.  
**ARCHIVOS MODIFICADOS:** Ver `git status`; especialmente Facturama/SAT, Solicitudes, Materialidad, DocsModal, firma, Storage Rules y formatos canónicos.  
**FUNCTIONS MODIFICADAS:** `solicitudDocuments`, `materiality`, `facturama`, `cotizaciones`, `constancias`, `signatureLinks`; exportaciones en `functions/src/index.ts`.  
**DEPLOYS REALIZADOS:** 2026-09-16/17: 17 Functions acotadas de Solicitudes,
Materialidad, Firma y Facturama/SAT; `storage.rules`; Hosting `pay-0-system`.  
**PRUEBAS:** Builds frontend/functions y lectura local del catálogo SAT pasaron.  
**RESULTADO:** Bloque publicado; falta smoke productivo.  
**ERRORES/PENDIENTES:** El timbrado real, XML/PDF/UUID, REP e ingreso→gasto siguen fuera del alcance de este deploy.  
**PUNTO EXACTO:** Producción responde; catálogo SAT global aún no fue cargado desde la interfaz y no se ha probado OC autenticada.  
**SIGUIENTE ACCIÓN:** Importar catálogos SAT/Trostre y ejecutar prueba controlada de una OC Trostre.

## 11. Historial de cambios

### 2026-09-16 17:55
- Se creó esta bitácora maestra basada en inspección de código y estado local.
- Se registró que Materialidad es el expediente central y que Facturama real aún no está implementado.
- Se registró el importador SAT `.db.bz2` como codificado/compilado, no desplegado.

### 2026-09-16
- Se verificó el catálogo SAT local: 52,513 claves de Producto/Servicio y 2,418 Unidades CFDI 4.0.
- Se agregó trazabilidad hash/versionada para catálogo emisor y SAT global en el árbol local.

### 2026-09-16/17
- Deploy acotado completado: Functions de Solicitudes/Materialidad/Firma/Facturama-SAT en estado `ACTIVE`, reglas Storage y Hosting publicados.
- Se verificó respuesta HTTP 200 de `/facturacion`; queda pendiente prueba autenticada de negocio.
- `PAY0-TRACKER.md` se actualizó con el release como `IMPLEMENTADO / VALIDACIÓN`; no se cerraron IDs sin smoke.

### 2026-09-17 — smoke local del ciclo automático
- **PASS (Emulator, datos efímeros):** una OC de Trostre generó automáticamente una cotización, exactamente un borrador Facturama con estado `AUTO_DRAFT_FISCAL_VALIDATED` y el mismo expediente de Materialidad.
- **PASS (Emulator, datos efímeros):** la firma generó evidencia canónica y la constancia de recepción/satisfacción dentro de la misma solicitud y expediente.
- Se verificaron los IDs de solicitud, cotización, borrador, firma, constancia y expediente; los emuladores temporales se detuvieron al terminar.
- Esto habilita una prueba controlada autenticada en producción. No equivale a timbrado real, XML/PDF/UUID, PPD/REP ni al control ingreso→gasto.

### 2026-09-17 — catálogo fiscal operativo de Trostre
- Se atestó el archivo canónico exacto de Trostre (`SHA-256 ba1d8241…340315`) contra la fuente SAT verificada (`SHA-256 394e8b1e…7f245`).
- Para ese archivo inmutable, PAY0 valida las OCs contra el catálogo autorizado de Trostre sin requerir cargar ni consultar las 55 mil claves SAT en producción.
- Un archivo distinto, un RFC distinto o una nueva fuente SAT no heredan la confianza: quedan en revisión o requieren la importación global SAT.
- Deploy acotado confirmado `ACTIVE`: `finalizeSolicitudDocumentUpload` revisión `00032-kip`, `saveFacturamaDraft` `00006-nex` e `importCompanyInvoiceCatalog` `00002-nah`.

### 2026-09-17 — visibilidad de expediente
- Materialidad ahora reconstruye referencias de documentos desde la Solicitud al usar **Actualizar expediente** y expone descargas directas de OC, cotización, firma y constancia.
- La cotización automática satisface el requisito documental; ya no debe quedar un falso faltante separado de “Presupuesto / Cotización”.
- Deploy acotado confirmado: `linkSolicitudToMaterialityOperation` revisión `00011-nos` y Hosting respondió HTTP 200. La generación visual canónica de PDF sigue pendiente: los generadores actuales usan `PAY0_SIMPLE_PDF_V1` y no deben presentarse como plantilla final.

### 2026-09-17 — conector Facturama sandbox
- Se implementó y desplegó la emisión CFDI 4.0 por API Multiemisor sandbox para borradores fiscales validados de empresas propias.
- La respuesta aceptada conserva inmediatamente el ID de Facturama; si falla la descarga, el reintento recupera XML/PDF sin volver a emitir. Una transacción impide dos emisiones concurrentes del mismo borrador.
- XML y PDF se registran como documentos versionados de la misma Solicitud y se referencian desde `materialityOperations`; no se crea un expediente paralelo.
- `getFacturamaSandboxStatus`, `saveFacturamaIssuerConfig` e `issueFacturamaSandboxInvoice` están `ACTIVE`; la revisión idempotente de emisión es `issuefacturamasandboxinvoice-00002-kah`.
- Bloqueo externo verificado: los secretos actuales producen HTTP 401 contra sandbox y producción. No se realizó timbrado ni se expusieron credenciales.

### 2026-09-17 — API Facturama Multiemisor en producción
- Se verificó de forma segura que las credenciales ya almacenadas en Secret Manager son aceptadas por `https://api.facturama.mx/api/Account/UserInfo` (HTTP 200). No se imprimieron ni expusieron valores.
- Se desplegaron `getFacturamaProductionStatus` (`getfacturamaproductionstatus-00001-mop`) e `issueFacturamaProductionInvoice` (`issuefacturamaproductioninvoice-00001-qub`), ambos `ACTIVE` en `us-central1`.
- La interfaz de Facturación fue publicada en Hosting/SSR `ssrpay0system-00418-xor`. La emisión usa el endpoint Multiemisor de producción, requiere confirmación humana explícita `EMITIR_CFDI_REAL`, conserva el identificador externo antes de descargar XML/PDF y no permite cambiar de ambiente un CFDI ya asociado.
- Pendiente deliberado: primera emisión real confirmada desde PAY0 y verificación de UUID, XML y PDF en la misma Solicitud/expediente. Hasta entonces FAC-01 permanece en validación; no se emitió CFDI durante esta verificación.

### 2026-09-19 — corrección de reproceso fiscal y cotización
- Se confirmó en producción que `S1C35U1E28` tenía dos borradores Facturama: uno obsoleto bloqueado y otro fiscalmente validado. La selección sin prioridad hacía visible el registro incorrecto.
- Se corrigió la idempotencia para preferir el borrador enlazado a la Solicitud y la cola ahora prioriza `AUTO_DRAFT_FISCAL_VALIDATED` sobre estados antiguos.
- El parser de OC ya distingue `Clave Concepto` de la columna real `Concepto`; la descripción validada es `SERVICIO DE REPARACION DE SISTEMAS DE PLOMERIA`, no `E48`.
- La cotización toma el domicilio de la OC como lugar de prestación cuando no existe una etiqueta separada y admite banco, cuenta y CLABE activos de la empresa emisora.
- PASS en Firestore Emulator con la OC real y dos borradores conflictivos; PASS del reproceso productivo de `S1C35U1E28`. El borrador enlazado `9YYutut1OJUS20LTzclY` quedó `AUTO_DRAFT_FISCAL_VALIDATED` con descripción correcta, y la cotización activa v6 quedó en una página con domicilio, BBVA, cuenta y CLABE.
- Deploy acotado confirmado `ACTIVE`: `reprocessActiveSolicitudOc` `00010-qaz`, `finalizeSolicitudDocumentUpload` `00055-doh`, `generateSolicitudQuotation` `00010-jop` y `listFacturamaInvoices` `00006-bel`.

### 2026-09-19 — Hugo Fase 2 conversacional
- La burbuja global de Hugo dejó de fabricar respuestas locales fijas: ahora usa conversaciones y mensajes persistentes, historial ordenado, no leídos, consultas operativas de solo lectura y dudas accionables en el mismo chat.
- Acceso restringido por backend y frontend a `superadmin`; Hugo no puede emitir, transferir, cancelar ni modificar operaciones financieras.
- PASS en Firestore Emulator: saludo personalizado, consulta contextual del folio `S1C35U1E28`, persistencia de cuatro mensajes y marcado de lectura.
- Producción activa: `sendAgent007Message`, `listAgent007Messages` y `markAgent007MessagesRead`; Hosting publicado. Vertex AI fue habilitado por autorización expresa del superadministrador y validado en producción con respuesta `source=VERTEX_AI`; revisión activa `sendagent007message-00003-bak`. El contexto operativo permanece limitado: excluye secretos, CSD y tokens, y no permite ejecutar acciones financieras.

### 2026-09-19 — PAY0 Control Center Fase 1

- `/reportes` inicia ahora en una vista ejecutiva con KPIs, atención inmediata, salud del sistema y pipeline navegable, conservando los reportes tabulares existentes como detalle.
- La lectura normal consume una sola proyección `controlCenterSnapshots/{rootId}`. El recálculo está separado, restringido a `superadmin` y respeta autorización del módulo `reportes`.
- Validación local: Functions build PASS, frontend build PASS y smoke Firestore Emulator PASS con aislamiento por `rootId`, monto pendiente, alerta fiscal y pipeline.
- Producción activa: `getControlCenterOverview`, `refreshControlCenterOverview` y Hosting de `/reportes`. Fotografía inicial generada y validada con `$30,281,736.09` registrados y `$20,904,447.04` pendientes. Siguiente paso: actualización incremental por eventos más reconciliación programada.

### 2026-09-19 — PAY0 Control Center Fase 2

- Se conectaron escuchadores por escritura para Solicitudes, Pagos, Facturama, Materialidad, Dispersiones y recomendaciones de Hugo. Cada evento conserva `rootId` y marca únicamente la fotografía correspondiente como pendiente.
- La reconciliación se ejecuta cada 15 minutos, procesa hasta 25 raíces pendientes por ciclo y no elimina una marca si ocurrió un evento más reciente durante el recálculo.
- PASS de compilación de Functions y smoke en Firestore Emulator: evento encolado, raíz aislada, fotografía reconstruida y marca eliminada después de confirmar el recálculo.
- Producción activa: seis triggers `queueControlCenter*` y `reconcileDirtyControlCenters` revisión `00001-huh`; despliegue de siete Functions completado con cero errores.

### 2026-09-19 — PAY0 Control Center 3.0 Fase 3A

- Se creó el contrato analítico v1 con 16 eventos permitidos, `rootId` obligatorio, versión de esquema, fecha de negocio y claves Día/Semana/Mes/Año en `America/Mexico_City`.
- Todos los importes analíticos se expresan en centavos enteros; se rechazan montos fraccionarios inseguros y monedas no soportadas.
- El catálogo inicial contiene 10 KPIs versionados y 5 widgets declarativos con filtros, roles, renderer, política de actualización y navegación a evidencia.
- Se fijaron definiciones distintas para facturación emitida, cobranza recibida, ingresos aplicados, gastos registrados y utilidad operativa; las estimaciones fiscales se etiquetan como tales.
- PASS de Functions build y pruebas locales. Firestore Emulator confirmó creación única, reintento idempotente y rechazo de reutilización del mismo `eventId` en otra raíz.
- No se desplegó código sin consumidor productivo. La siguiente fase es 3B: conectar publicadores operativos y construir agregados incrementales sin sustituir aún la reconciliación existente.
