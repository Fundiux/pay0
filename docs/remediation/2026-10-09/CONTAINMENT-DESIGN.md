# Contención confiable y Sentinel: diseño ejecutable

Fecha: 2026-10-09. Alcance: investigación del checkout en remediación; ningún código, configuración o despliegue modificado en esta subtarea. Las referencias son símbolos/archivos estables; otros agentes están corrigiendo el mismo árbol y deben validar el candidato final.

## Decisión principal

No reutilizar `securityLock` como autoridad. El reporte de rutas ya escribe `securityClientReports` como `CLIENT_REPORTED`, `verified:false`, `OBSERVE_ONLY`; una observación declarada por navegador nunca autoriza bloqueo. Introducir un contrato nuevo, explícito y servidor-only de restricción, aplicar su comprobación antes del bypass superadmin y separar la recuperación de la autorización operativa.

Una restricción por usuario **dentro de su root** puede aplicarse inmediatamente con un campo autoritativo en `users/{uid}` y una vista compacta de concesiones en ese mismo documento. La propuesta consume dos documentos en Storage: usuario y operación. No resuelve por sí sola revocación de abuelos en delegaciones encadenadas ni bloqueo global de todo un root. Declarar lo contrario deja un bypass temporal. Para esas dos capacidades se necesita resolver la cadena en backend en cada consumo, o cambiar la autoridad canónica con límites demostrados. No activar una política global que todavía tenga rutas directas sin esa comprobación.

## Evidencia y bypasses concretos

| Superficie | Evidencia actual | Integración necesaria |
|---|---|---|
| Autorización común | `users/authorization.ts::decideUserAuthorization` comprueba ciclo de vida y luego tiene bypass superadmin. `utils/authGuard.ts::assertAuthorized` delega allí | Agregar decisión determinista de restricción **antes** de roles/bypass; jamás basarse en claims para restricción actual |
| Helpers incompletos | `sharedCallables/helpers.ts::requireAuth` solo UID; `requireRole` solo rol; `getMyUser` puede cargar `usuarios` legacy | Nueva resolución de principal vigente con procedencia y política; auditar consumidores de solo `requireRole`. Legacy no puede convertirse en fallback que eluda una restricción en `users` |
| HTTP IQ | `iq/pagoDepositCallables.ts::getHttpAuthContextH4D50F` valida ID token y solo `user.active`; omite `isActive`, `disabled`, `isDeleted` y no llama al guard común | Componer guard común tras verificación de token, antes de resolver operación. Applies a `manualLinkPagoIqDepositHttp` y `omitPagoIqDepositAutomationHttp` |
| Identidad IQ manual | `getAuthContext` en pagoDeposit y solicitudCreateQueue, y `dispersionCreationCallables::requireAuth`, priorizan role/root de token sobre perfil | Role/root de autorización deben salir del perfil vigente. Origen económico IQ persistido sigue separado; no cambiar credencial/origen al resolver actor actual |
| Pago Task | `processIqPagoDepositOnDemandTask` conserva requestedBy en payload pero construye autorización desde `buildPagoIqSystemAuthH4D44(pago)`; `historicalIqOrigin` permite continuar sin usuario o despacho actuales | Revalidar solicitante y permiso actual de la intención, independiente del origen IQ; limitar compatibilidad histórica a identidad/reconciliación, nunca permiso para nuevo efecto |
| Solicitud Task/scheduler | `processIqCreateOnDemandTask` carga job; `processProfileJobs` descifra credenciales, marca PROCESSING, descarga OC y ejecuta lote usando datos encolados | Revalidar actor/root/cliente/delegación antes de coste y otra vez antes del envío. Guardar motivo AUTH_STOPPED sin cambiar resultados externos desconocidos |
| Pago application Task | `paymentApplications/callables::processPagoApplicationIqPlanOnDemandTask` vuelve a leer user y root pero su predicado `inactive` no incluye todas las variantes y requiere revisión de permisos actuales | Sustituir predicado parcial por guard común; validar permiso concreto y scope del plan, no actorRole del payload |
| Dispersión scheduler | `dispersionCreationCallables::buildDispersionSchedulerAuth` comprueba varios flags y root, pero no `disabled`, restricción ni todos los permisos actuales | Guard único más autorización wallet/dispersiones y grants actuales antes del efecto |
| Firestore directo | `firestore.rules::signedIn` ya comprueba perfil/ciclo de vida; `users` no permite writes del browser. Subsisten writes superadmin en varias colecciones | Agregar restricción temporal a `signedIn` y revisar rutas que no lo usan. Excepción separada de lectura del estado propio para recuperación |
| Storage | `canAccessSolicitudDocument`, `canAccessPagoDocument` y dispersión normal permiten owner/root o grant sin leer perfil, expresamente por presupuesto2 | Migración compacta descrita abajo; no añadir ingenuamente una tercera lectura |
| Grants derivados | `clientDelegations/service::setUserClientAccessService` restringe permisos/expiry del grantor al emitir. `access::resolveClientOperationalAccess` no valida posteriormente al grantor ni cadena. `assertTargetAllowed` permite admin delegar a admin | Al revocar abuelo puede sobrevivir nieto; `grantedBy` solo no es contrato de autoridad histórica suficiente. Requerir origen DIRECT/DELEGATED y parentGrant/version explícitos |
| Usuarios | `active.ts`, `access.ts`, `modules.ts`, createAdmin/createOperador en index escriben perfil. `upsertUser` solo email/updatedAt pero solo exige UID/perfil | Reservar namespaces nuevos y versionar autorización en todos los cambios relevantes. El campo restriction no lo acepta un update de permisos genérico |
| Recuperación antigua | `activityLog/callables::redeemMySecurityUnlockCode` opera únicamente sobre `securityLock` | Puede limpiar estado histórico visual; no debe levantar restricciones nuevas ni tener bypass genérico de perfil inactivo |
| URLs de objetos | `EntityDocumentsPanel`, `assets/documents/page`, `uploadSolicitudDoc`, `uploadEntityDocument`, `uploadDispersionDoc` usan `getDownloadURL` | Inventariar consumidores/URLs persistidas; autorización al emitir una URL bearer no implica revocación al consumirla |
| Descarga Telegram | `telegram/actionTokens::telegramDownloadAction` ya tiene lease, objeto/generación y `assertCurrentAccess` dentro de transacción | Integrar restricción común y validación completa de grants antes de adquirir lease; no imprimir token/URL |

La superficie remota tiene entradas recuperadas fuera de la rama histórica. Por ejemplo el inventario remoto contiene `getAuthorizedDocumentDownloadUrl`; la búsqueda exacta del checkout inspeccionado no localizó implementación/export. Recuperar su fuente desplegada antes de diseñar un adaptador alrededor de una función local supuesta.

## Contrato propuesto, autoridad y recuperación

Campo servidor-only `users/{uid}.trustedRestrictionV1`:

```text
schemaVersion: 1
restrictionId: UUID generado servidor
rootId: root del perfil servidor en el momento de decisión
subjectUid: uid del documento
state: ACTIVE | REVOKED
scope: ACCOUNT_OPERATIONS
issuedAt: Timestamp
expiresAt: Timestamp obligatorio
authority: HUMAN_SECURITY_ADMIN | DETERMINISTIC_POLICY
authorityUid/service: principal verificado, nunca payload libre
policyVersion: PAY0-CONTAINMENT@1
reasonCode: enum acotado
incidentId: referencia a evidencia no sensible
authorizationVersion: entero monotónico
revokedAt/revokedBy/revocationReason: solo en revocación
```

Validez: ausente → no restricción nueva; formato presente inválido → denegar operaciones y ofrecer soporte. Un ACTIVE válido restringe mientras `issuedAt <= now < expiresAt`; igualdad al expiry libera sin scheduler. root/uid deben corresponder al perfil actual; cambio de root requiere migración/revocación explícita en la misma transacción, no ignorar automáticamente un registro desalineado. Una restricción no cambia rol, saldo, estatus financiero ni grants. TTL máximo inicial propuesto15min por emisión, techo24h para administrador de seguridad con motivo y revisión explícitos; son límites de ingeniería propuestos, no calibración ni resultado observado. No habilitar renovación automática indefinida.

Primer release manual: superadmin vigente de **mismo root**, reautenticación reciente y política de no autodesbloqueo/nadie actuando sobre una restricción propia; no dar este poder a cualquier admin por herencia. Si solo existe un superadmin, recuperación mediante operador de soporte con IAM autorizado y herramienta servidor auditable; no bootstrap público ni claim aportado por navegador. Demostrar este camino con datos sintéticos antes de activar enforcement. No convertir una cuenta totalmente deshabilitada/eliminada en cuenta operativa por recuperación: son controles distintos.

Escribir restricción, incrementar authorizationVersion y registrar auditoría en una transacción. Recuperar con compare-and-set de `restrictionId` y versión evita que un desbloqueo antiguo retire una restricción nueva. El código antiguo jamás valida la nueva autoridad. Endpoints excepcionales estrechos: consultar estado/motivo/expiración propios y enviar solicitud de revisión con cuota. El endpoint de estado devuelve campos mínimos, no concede lecturas generales de users ni operaciones. Endpoint de revisión no puede cambiar el estado.

Restricción root-wide es otro contrato (`securityRootPolicies/{rootId}`), no el significado implícito de rootId en una restricción individual. Backend/Firestore pueden consultarlo, pero Storage usuario+operación ya agota2. Mantener ese alcance en observación hasta mediar todas sus descargas; no replicarlo silenciosamente a usuarios mediante triggers.

## Storage con dos documentos: opción mínima y límites reales

Firebase limita a dos documentos las llamadas Firestore desde una evaluación Storage. Fuente: [condiciones de reglas Storage](https://firebase.google.com/docs/storage/security/rules-conditions). Repetir get al mismo path puede reutilizar lectura, pero usuario, operación y grant son tres paths distintos.

### Opción A recomendada para actor y grants directos

`users/{uid}.documentAccessV1 = { schemaVersion:1, generation:N, grants:{clientId:{rootId, permissionsMask, startsAtMs, expiresAtMs, origin, grantVersion}} }`.

- Copiar solo autorización: no nombres, RFC, correos, motivos largos o payloads. El endpoint actual limita200 items; aprovechar ese límite existente. Comprobar tamaño serializado del **perfil completo**, incluyendo margen operativo e índices, antes del commit; nunca truncar silenciosamente concesiones para ajustarlo.
- Tratarlo como vista de autoridad mantenida **sincrónicamente** con los documentos históricos `userClientAccess`, no como proyección por trigger. Cambiar setter a transacción que lea caller/target, clientes/grants fuente y versión de autorización. Escrituras: cambios efectivos, nuevo mapa completo, incremento versión, auditoría. Evitar reescribir todos los grants históricos ya inactivos: el setter actual lo hace y puede exceder límites al acumular historia.
- Validar permisos/expiry contra grant fuente **en la misma transacción**, solucionando también carrera otorgante-revocación que el batch actual deja abierta tras comprobaciones previas al commit.
- Regla Storage lee usuario una vez y operación una vez: lifecycle+restricción+rol/root/permisos del usuario, ownership o mapa de delegación, y scope/lifecycle de operación vigente. La consulta documental actual se conserva: no depender de metadata antigua para demostrar propiedad actual.
- `schemaVersion` solo se activa tras verificar mapa completo frente a fuentes en transacción. Una ruta migrada nunca hace fallback a grant antiguo ante mapa faltante/inválido. Usuarios aún no migrados siguen flujo servidor equivalente; desplegar ese fallback funcional antes de cerrar la ruta SDK.
- Los create/upload usan igualmente usuario+sesión preparada cuando esa sesión contiene scope validado. Revisar `preparedUploadMatchesById` y los init/finalize para que no acepten tipo/path/UID arbitrarios; no agregar operación como tercera lectura. Revalidar finalize y costo externo aunque upload ya hubiera empezado.

Migración por usuario: dry-run sin PII (cuentas, tamaños, diferencias), snapshot recuperable privado, transacción lee perfil+grants actuales, comprueba versión, escribe mapa+schema. Repetir es idempotente. Si cambian grants mientras se migra, reintentar. Sin intervalo de grant nuevo sin mapa o revocación pendiente por trigger. Restituir una snapshot antigua de permisos no es rollback válido; rollback debe conservar el mapa/guard o usar mediación backend.

### Lo que A no resuelve: S10-DERIVED y root-wide

Un mapa en el hijo con copia del permiso del padre no permite comprobar revocación posterior del padre, abuelo o cambio de dueño del cliente. Un fan-out asíncrono no satisface revocación inmediata. Tampoco existe límite demostrado al número de hijos:200 clientes por usuario no limita200 descendientes por grant. No aprobar un algoritmo que promete transacción de tamaño arbitrario.

Alternativa concreta para derivadas: conservar delegación funcional por backend y marcar esas entradas `origin:DELEGATED_CHAIN`, no autorizables directamente por Storage. Endpoint descargador autenticado recibe referencia de documento, resuelve cadena con visited-set y detección de ciclo, valida cada autoridad/grant/perfil/root y permiso actual, y transmite el objeto/generación autorizado. Un límite técnico de recorrido debe generar error visible y soporte, no promover la cadena a acceso directo. Roles admin→admin actualmente permitidos exigen medir/modelar esa cadena; no inventar profundidad1 como regla de negocio. Solo marcar una entrada como DIRECT si su autoridad de cliente puede demostrarse, no porque el grantor sea admin.

Frontend usa ese descargador como fallback funcional cuando no hay autoridad compacta suficiente; no se elimina la capacidad ni se espera al saneamiento de todos los datos para descargar legítimamente. Backend es también la vía general si se necesita contención root-wide inmediata. Mantener flujo init/upload/finalize existente para uploads, con autorización al finalizar; añadir proxy upload solo para casos en los que no se pueda demostrar autorización con dos docs.

La alternativa de quitar operación del cálculo usando metadata immutable libera una lectura, pero pierde revocación por eliminación/cambio de owner/client/status de operación. Requiere un nuevo contrato completo de inmutabilidad/promoción de objetos y migración de cada objeto. No se recomienda para el primer lote.

### URL bearer y streams

No basta actualizar reglas si hay URLs de descarga permanentes ya compartidas. Inventariar metadata `firebaseStorageDownloadTokens`, URLs persistidas y emisores de URLs firmadas; no registrar valores. Migrar consumidores primero; para objetos afectados, remover/rotar únicamente tokens confirmados y preservar recuperación/auditoría sin reactivar tokens comprometidos. Las URLs GCS firmadas conceden acceso a cualquier portador hasta su expiración o revocación de clave: [documentación oficial](https://docs.cloud.google.com/storage/docs/access-control/signed-urls). No devolver una URL firmada nueva desde el proxy si se pretende comprobar restricción en cada consumo.

Endpoint autenticado: ID token verificado, perfil/grants actuales, referencia en whitelist de tipos, objeto/generación servidor, límites tamaño/tiempo, `no-store`, sin redirects a bearers. Para navegador usar fetch autenticado/blob; para Telegram conservar token con revalidación/lease. Especificar frontera de revocación: nuevos consumos y nuevos efectos se deniegan; bytes ya enviados no se pueden recuperar. No prometer atomicidad Firestore↔red. En streams prolongados, comprobaciones periódicas y corte acotado pueden reducir exposición, pero no convierten datos ya entregados en revocables.

## Trabajos diferidos y efectos externos

Persistir `requestedByUid`, `authorizedRootId`, `requestedAction`, `authorizationVersion`, `intentId`, `originActorUid`, `originIqProfileId`, `originType`, `createdByService`, `jobGeneration` y `policyVersion` desde servidor. Solo job ID/generation en payload cuando sea posible; el worker carga identidad del job autoritativo. El actor de solicitud y el dueño económico/origen IQ son identidades distintas.

En cada entrada scheduler/task/manual, usar la misma función `authorizeIntentExecution`: usuario vigente, restricción no vigente, rol/acción actuales, scope de operación/grants e identidad IQ. Leer y comprobar versiones dentro de la transacción que admite el intento, después revalidar justo antes del primer efecto. Conservar contadores de intento, leases y fencing de `automationSafety/runtime`; ninguna restricción borra o reinicia idempotencia. `OUTCOME_UNKNOWN` permite investigación/reconciliación de solo lectura por servicio específico, no repetir CREATE. Cancelación/reverso financiero no es un efecto automático de una restricción de seguridad.

Una operación iniciada antes de la restricción puede completar su efecto externo después: registrar la frontera de autorización y el estado desconocido. Para afirmar paro fuerte hay que integrar el fence en el punto de envío de cada adaptador; chequear solo al encolar o antes de un batch de540s deja una ventana considerable. Renovación/reanudar un job exige autorización actual y conserva intención, sin duplicar efecto.

## Sentinel inicial: observación implementable sin calibración inventada

Contrato de evento `PAY0-SECURITY-EVENT@1`: eventId/intentionId/attemptId/effectId, timestamp servidor, rootId y actorUid resueltos servidor, originClass (`SERVER_AUTH_DECISION`, `SERVER_EXECUTION`, `CLIENT_REPORTED`), emitter, schemaVersion, enum eventType/reasonCode y evidencia por digest/referencia. Sin tokens, URLs, secretos, documentos bancarios o texto arbitrario del cliente. Un fallo de autorización emitido por servidor es un evento confiable; no demuestra por sí solo ataque ni intención maliciosa.

Política pura `PAY0-SENTINEL-SHADOW@1`: entrada validada y reloj inyectable; salida `OBSERVE`, `REVIEW`, `IGNORE_DUPLICATE` con códigos de motivo. `CLIENT_REPORTED` siempre OBSERVE. Señales servidor de efecto repetido para mismo intent, OUTCOME_UNKNOWN seguido de nueva admisión, scope inconsistente o intento con autorización vencida producen REVIEW. No usar umbrales de frecuencia como detector calibrado; si se ensayan límites, etiquetarlos hipótesis y no habilitar contención. IA puede explicar eventos permitidos, nunca elevar confiabilidad, escribir autorizaciones o ejecutar pagos.

Detector sin acceso financiero: cuenta dedicada recibe topic de eventos sanitizados vía Pub/Sub, puede escribir incidentes estructurados en Cloud Logging y métricas; no Firestore Admin/Storage/IQ ni secretos de proveedor. El publisher servidor tiene permiso publicar a ese topic; cliente no. No reutilizar la cuenta Compute/Admin por conveniencia. IAM Firestore habitual no proporciona una barrera por colección para un SDK Admin con permisos de base: un detector con acceso Admin al mismo DB no es una identidad de solo incidentes. Si se requiere vista Firestore para UI, un colector separado valida salida declarativa y solo su código escribe incidentes; documentar el alcance IAM real, o mantener Logging como evidencia inicial.

Deduplicación: eventId estable y fingerprint `(policyVersion, rootId, intentId, reasonCode)`; entrega al menos una vez no genera múltiples ejecuciones. Observación no llama al ejecutor. Limitar tamaño por evento, concurrencia, lote, retención y métricas de mensajes descartados/errores. Excluir propios incidentes/logs del topic fuente para impedir bucle. Evidencia original no se borra para cambiar clasificación; nuevas revisiones son append-only.

Ejecutor defensivo futuro separado: recibe una propuesta determinista versionada, revalida evento/origen/root/sujeto/TTL/allowlist y escribe solo contrato de restricción mediante API estrecha. Inicialmente **no desplegar autoridad de mutación conectada al detector**. Interruptor de emergencia separa detener detector de levantar restricciones válidas. Fallo del detector no concede permisos; fallo del colector se observa sin bloquear pagos legítimos por una inferencia ausente. Recuperación del ejecutor requiere dos controles auditados: política y acceso operador, sin IA decisoria.

## Lotes de implementación y pruebas de cierre

1. Contrato puro de restricción + tests reloj/expiry/malformed/root/user/superadmin; resolver principal común. Mantener todos los reportes browser en observación. Ninguna restricción activa todavía.
2. Integrar callables comunes, helpers bypass y HTTP manual IQ; instrumentar decisiones servidor sanitizadas. Pruebas directas con token válido y perfil restringido, cada variante de lifecycle, root cambiado y perfil legacy.
3. Workers: solicitud, pago depósito, aplicación y dispersión usan guard común en admisión/envío. Proveedores fake cuentan efectos: encolar→revocar→ejecutar produce0, y OUTCOME_UNKNOWN→restricción→reintento no produce segundo efecto; reconciliación de solo lectura sigue siendo posible.
4. Implementar autoridad documental compacta y setter transaccional; migración usuario a usuario con pruebas de carrera, payload de root falso,200 grants/tamaño máximo, grants históricos y dos-doc budget real en emulador. Implementar fallback descargador para chains antes de modificar rutas directas.
5. Completar revocación derivada en backend y proxy, preservar parentGrant histórico y detectar ciclos. No cerrar S10-DERIVED hasta probar abuelo→padre→hijo, cambio de permisos/expiry/root y revocación durante descarga/admisión.
6. Reglas Firestore/Storage y UI de recuperación junto con autoridad compacta. Pruebas positivas de usuarios legítimos en rutas actuales/históricas; negativas direct SDK/REST, tokens viejos, perfil eliminado y esquema no migrado. Inventario/mitigación de URLs bearer queda como gate propio explícito.
7. Publicar `Sentinel shadow` con política pura, publisher y detector de identidad restringida. Pruebas de reentrega, falso reporte cliente, separación roots, exceso de eventos, bucles y caída de logging. Verificar rol IAM efectivo y0 permisos financieros; no declarar ventana de observación completada con datos sintéticos.
8. Activar primero restricción manual USER_IN_ROOT con recuperación probada y todos sus caminos cerrados. Root-wide y políticas automáticas solo después de demostrar sus controles/consumidores; la falta de calibración bloquea esa activación, no los parches ni observación.

Responsable de integración debe convertir esta lista en commits/lotes pequeños y verificar fuente desplegada exacta antes de tocar consumidores recuperados. Este diseño no constituye implementación ni cierre de S-01.

## Avance implementado: guard común, sin activar contención

`users/restrictions.ts` valida el campo servidor `trustedRestrictionV1`. Contrato concreto: `schemaVersion:1`, `writer:PAY0_TRUSTED_RESTRICTION_WRITER@1`, `policyVersion:PAY0-CONTAINMENT@1`, `restrictionId`, `rootId`, `subjectUid`, `state:ACTIVE|REVOKED`, `scope:ACCOUNT_OPERATIONS`, `authority:HUMAN_SECURITY_ADMIN`, `authorityUid`, `reasonCode`, `incidentId`, `issuedAtMs`, `expiresAtMs` y `authorizationVersion` entero positivo. Los tiempos son milisegundos epoch enteros seguros; TTL máximo exacto24h, constante recomendada futura15min. Razones admitidas: SECURITY_REVIEW, CREDENTIAL_COMPROMISE_CONFIRMED, SUPPORT_CONTAINMENT. Emisor distinto del sujeto; root y sujeto deben coincidir con perfil y autenticación servidor.

REVOKED exige también `revokedAtMs`, `revokedBy` distinto del sujeto y `revocationReason` (REVIEW_CLEARED, CREDENTIALS_RECOVERED, SUPPORT_RECOVERY), además de validez de TODO el registro. Campos desconocidos, marcador, autoridad, scope, timestamps o estructura inválidos deniegan incluso si declaran caducidad/revocación. Registro ACTIVE válido deja de restringir exactamente en expiresAtMs sin esperar limpieza. Campo ausente preserva autorización normal; securityLock heredado no activa ni elimina este contrato. El marcador es identificación de esquema, NO prueba criptográfica: su confianza depende de impedir escrituras cliente y de un writer autenticado futuro.

`decideUserAuthorization` evalúa el registro antes de cualquier bypass de rol; superadmin tampoco lo elude. `assertAuthorized` publica solo ACCOUNT_RESTRICTED / CONTACT_SUPPORT, sin IDs de incidente ni autoridad. No existe parámetro de bypass de recuperación. Desbloquear no concede permisos previamente revocados ni rehabilita un perfil inactivo.

Verificación local: restricciones6 + OCR11 + Sentinel10 =27 pruebas PASS, y verificador de política PASS. Cubren TTL exacto, registro malformado, superadmin, revocación estructural e independiente, lifecycle, contrato público seguro y legacy ignorado. Loader OCR actualizado; loader entity coordinado con su responsable. Builds centralizados pendientes de integración. Este lote NO crea writer, endpoint de soporte, restricciones activas ni reglas; HTTP/manual, workers, reglas/Storage y recuperación auditada siguen siendo gates de cobertura y activación de S-01. Sentinel implementado se documenta en SENTINEL.md: decisión OBSERVE_ONLY constante, sin promoción ni autoridad financiera, todavía sin conexión remota.
