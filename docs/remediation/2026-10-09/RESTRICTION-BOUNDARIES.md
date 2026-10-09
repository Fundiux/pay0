# S01: fronteras Firestore y Storage

Estado final: ambas reglas materializadas LOCALMENTE por integracion tras revision y aprobacion de herramienta. Mode actual325/325 PASS (sesion61094). NO desplegadas; writer NO activado. Persisten24 accesos Storage delegados pendientes del puente; securityClosure:false. Los apartados siguientes conservan decisiones y evidencia historica, no autorizan despliegue.

## Hashes locales y validacion final

- firestore.rules SHA256: 03cca1237bd47a9e5670c4c1411e114383788a56c7763d6e0779cd7602601dc3
- storage.rules SHA256: 9ad56b35121ab516a3083d5943b3a68f73595a27dc165c5fa892470226a5a39e
- Politica canonica y matriz2760+33120 PASS; candidato325 y fuente actual325 PASS.
- Sin despliegue de reglas, sin restricciones productivas emitidas ni writer activado.
- Builds de frontend/Functions no se repitieron para este lote de reglas/scripts; integracion gestiona sus builds.

La primera reescritura fue rechazada por revision automatica por amplitud y falta de evidencia emulada. Se respeto la negativa, se preparo candidato aislado y solo despues de325PASS y revision central se aprobo/materializo localmente. El diff con nombre historico NOT-VALIDATED se conserva como evidencia del cambio exacto; su encabezado aclara el estado final.

## Frontera mínima propuesta

Firestore: validacion completa de trustedRestrictionV1 al inicio de cada allow habilitado, antes de permisos de rol. El bloque generado se produce exclusivamente desde config mediante renderer canonico. Un registro presente invalido deniega, incluso falso REVOKED/EXPIRED; TTL maximo24h, identidad/root, autoridad/marcador/razon/version y revokedBy independiente conservan el contrato backend. Ausencia del registro o legacy securityLock no activa restricciones; tiempo evaluado mediante request.time, sin cron.

Excepción de recuperación: allow get de users/{uid} únicamente al propio UID autenticado y perfil lifecycle activo. No listas de otros usuarios, escrituras ni colecciones económicas. Conserva el acceso anterior de useUserProfile.ts (onSnapshot de documento propio), para evitar perfil null y UI atrapada. Firestore no redacta campos: propio usuario también verá incidentId, authorityUid y demás campos de trustedRestrictionV1. Si deben mantenerse privados, hace falta adaptar bootstrap a getMyRestrictionStatus redacted y publicar esa excepción callable antes de negar lectura del perfil; no afirmar que reglas filtran esos campos. Nunca usar esta lectura para autorizar operaciones.

Storage: evitar añadir users al signedIn global, porque rompe las rutas delegadas por tercera lectura. Introducir helper currentUserAllowed(rootId) que lee usuario actual y aplica lifecycle/root/restricción. Lectura propietario/root usa user+operation; carga preparada usa user+preparedUpload; entity/assets propio usa user, y su carga user+preparación; SAT/canonical usa user+session/import. Rama owner/root se evalúa con condicional, no OR que permitiera volver a la delegación si dueño restringido. Dispersión fondeada por USER mantiene sus controles y añade guard sin tercera lectura.

**Pendiente explícito:** operación delegada aún usa operation+grant. Mantener acceso actual hasta que puente y consumidores estén listos, como pidió integración; por tanto usuario restringido delegado todavía podría descargar directamente. Las pruebas registran esta frontera como knownDelegatedGaps y securityClosure:false, nunca como cierre de S01.

## Por qué no proyectar restricciones o grants ahora

Copiar la restricción a cada grant requiere sincronizar emisión/revocación, todos los setters y nuevos grants en la MISMA transacción. setUserClientAccessService fuente actual usa lecturas previas+batch; el límite200 aplica a payload activo, mientras grants históricos quedan inactivos en la subcolección, que puede crecer más. No hay límite comprobado de fanout/bytes ni CAS suficiente para certificar una réplica coherente. Un trigger asíncrono no cierra la ventana de restricción.

Mapa compacto de grants en users evitaría tercera lectura, pero exige cambiar autoridad, migración, límite1MiB y revocación transitiva: copiar padre no refleja revocación del ancestro. Metadatos del objeto tampoco resuelven lifecycle de operación borrada. Para este lote mínimo se propone puente autenticado en lugar de migración masiva de autoridad.

## Puente propuesto, todavía sin handler nuevo

Archivos nuevos propuestos: functions/src/modules/documents/downloadAccess.ts (resolver canónico), documentDownloadHttp.ts (POST streaming autenticado), src/lib/downloadPrivateDocument.ts (ID token en Authorization, referencia de documento en JSON, blob local). Export index y wrapper frontend solo junto con pruebas y aprobación de integración.

Entrada acotada {family, documentId}; nunca storagePath/root/URL de origen elegidos por cliente. Verificar token Firebase servidor, perfil actual/guard, root, lifecycle de entidad y upload/documento ACTIVE/READY, propietario o permiso operativo/grant/cadena vigente; resolver objeto desde uploads/entityDocuments/assetDocuments canónicos y fijar generation. Reutilizar comprobaciones de acceso documental de telegram/actionTokens y módulos de dominio; no reutilizar capability Telegram ni emitir URL GCS firmada/bearer. CORS orígenes app exactos, cache no-store, errores sanitizados, límites/timeout/abort, sin logging de body/Authorization. Revalidar antes de iniciar efecto/stream; bytes entregados previamente no son revocables.

Consumidores concretos y transición:

- src/lib/uploadSolicitudDoc.ts: eliminar generación getDownloadURL después de finalize; devolver referencia canónica y adaptar quienes abren downloadURL.
- src/lib/uploadDispersionDoc.ts: actualmente obtiene bearer ANTES de finalize; separar finalización de presentación, no bloquear finalize por fallo del enlace, usar puente después.
- src/lib/uploadEntityDocument.ts y src/components/EntityDocumentsPanel.tsx: sustituir getDownloadURL/apertura por helper autenticado. Conservar init/upload/finalize y metadata.
- src/app/assets/documents/page.tsx: reemplazar getDownloadURL por resolver assetDocuments con owner y root actual.
- src/lib/uploadPagoDoc.ts no solicita getDownloadURL en la fuente examinada; inventariar sus consumidores de referencias/url antes cerrar rutas pagos.
- src/lib/uploadAssetDocument.ts, uploadSatCatalog.ts y services/corporateResources.ts siguen init/prepared upload: guard Storage directo necesario aunque init fue autorizado antes de restringir al actor.

Primero implementar resolver/handler+pruebas; luego consumidores y prueba de descarga legítima delegada; solo después añadir user guard universal y retirar rama delegated Storage directa. No eliminar funciones ni deshabilitar delegación funcional. Inventariar referencias persistidas downloadURL y retirar/rotar tokens Storage existentes mediante migración aprobada: URLs bearer ya emitidas no consultan reglas por cada acceso. Puente no revoca URLs históricas por sí mismo.

## Pruebas candidatas

qa/scripts/remediation-restriction-rules-candidate.cjs transforma SOLO strings en memoria para initializeTestEnvironment. Anclas exigen coincidencia única, ninguna escritura en firestore.rules/storage.rules. Suite remediation-restriction-boundaries.test.mjs usa project demo-pay0-restriction-boundaries, localhost18088/19198 y datos sintéticos. Modos baseline (reproduce bypass conocido) y candidate (espera controles nuevos y registra delegado pendiente). Prueba owner/admin, delegado/operador y root/superadmin; NONE, ACTIVE, EXPIRED, REVOKED, falso REVOKED, wrong-root, fake-writer, null, unknown field, TTL excesivo y legacy-only; Firestore económico, Storage tres familias, perfil propio y upload preparado.

Runner limpia DEBUG heredado y restaura al finalizar; logs son locales ignorados y jamás se versionan. La ejecución inicial heredó DEBUG y Firebase volcó entorno; no reproducir ni leer rawlogs. Una ejecución de emulador NO prueba IAM real, URLs históricas ni despliegue productivo. Resultado candidato se incorpora tras completar ejecución.

## Gates para reglas persistentes

1. Candidato compila y supera pruebas positivas/negativas sin exceder presupuesto real Storage; añadir matrices de entity/assets/SAT/canonical antes aplicar esos branches si faltan en suite.
2. Diff revisable sin tocar bloque generado, política verificada y pruebas regresión S10 para delegación vigente. Excepción perfil propio revisada explícitamente.
3. Nueva revisión de herramienta con autorización del usuario y evidencia anterior; respetar rechazo previo, sin ejecutar una variante equivalente no aprobada.
4. Resolver puente/consumidores/URLs bearer antes declarar S01 completo y antes publicar writer; despliegue central exige revisión exacta y pruebas de recuperación.

## Evidencia de evaluacion y coordinacion S10

Los ensayos previos culminaron en 323/325 comprobaciones conformes: Firestore clientDispersions denegaba las lecturas legitimas del delegado con restriccion EXPIRED o REVOKED por el limite de 1000 expresiones. La fusion de lecturas y permisos individuales fuera del bloque generado no basto. No se aplicaron reglas.

Contrato S10: requireClientOperationalAccess/resolveClientOperationalAccess admiten transaction opcional, recorren hasta 16 ancestros y validan otorgante actual, permisos y restriccion; grantAuthority v1 identifica source/grantorUid/parentPath. El puente debe reutilizar el resolver dentro del snapshot transaccional antes del stream. Legacy sin procedencia conserva LEGACY_PROVENANCE_UNVERIFIED hasta migracion. El candidato S01 verifica al actor, pero NO certifica revocacion transitiva S10 en SDK directo. Mantener delegados legitimos hasta migrar consumidores; el proxy de archivos tampoco resuelve consultas Firestore.

Fuentes: [Firebase Rules behavior](https://firebase.google.com/docs/rules/rules-behavior) limita Storage a dos consultas Firestore; [Firestore rules structure](https://firebase.google.com/docs/firestore/security/rules-structure) limita cada peticion a 1000 expresiones. No se cambian esos limites.

## Generador canonico candidato autorizado

Archivos: scripts/lib/authorization-policy-generator.mjs, scripts/generate-authorization-policy.mjs, scripts/verify-authorization-policy.mjs y qa/scripts/remediation-authorization-generator.test.mjs. La configuracion JSON sigue siendo la autoridad; no se modifica su contenido ni el backend generado. El comando generador es read-only por defecto, --check comprueba igualdad y --write es explicito. NO se ejecuto --write. El verificador compara el bloque COMPLETO contra rendering canonico legacy o nuevo, incluyendo los controles frontend/backend existentes; rechaza una inyeccion OR true que el parser antiguo de listas podria omitir.

Matriz ejecutada PASS: 8 roles/variantes por 15 modulos por 23 acciones = 2760 decisiones de politica. Doce formas de permisos individuales producen 33120 decisiones de guard compuesto. Se ejecutan los cuerpos reales anterior/candidato mediante adaptacion del subconjunto Rules y se comparan con referencia independiente del JSON. Incluye operator, rol desconocido, ADMIN, null, modulos ausentes/false/null y valores individuales no booleanos. Es equivalencia del subconjunto, NO un sustituto del emulador ni de autenticacion real. Orden de claves invertido produce rendering identico; entradas invalidas se rechazan; preview no altera fuentes.

Primera representacion cacheando rol y seleccionando acciones por modulo: ensayo15035 termino 324/325. EXPIRED delegado clientDispersions ya pasa; REVOKED sigue excediendo expresiones (check134). Los 24 accesos Storage delegados restringidos permanecen explicitamente como brecha conocida, securityClosure:false. Emuladores apagados al terminar.

Segunda representacion validada: cachear rol y seleccionar lista de modulos por accion, con view primero porque es prerrequisito universal. Misma matriz 2760+33120 PASS; ensayo19798 completo 325/325 PASS, failures:[], emuladores apagados al finalizar. Ambos casos EXPIRED/REVOKED legitimos ahora pasan. Idempotencia y preservacion exacta fuera del bloque, tambien con CRLF, PASS. No se truncan campos, validaciones de REVOKED, TTL ni permisos para bajar costo.

## Gate pendiente

El diff documental RESTRICTION-CANDIDATE-NOT-VALIDATED.patch es SOLO revision, nunca aplicado. La suite325 ya es conforme para este candidato. Faltan regresion de delegacion integrada y revision central antes de persistir reglas. Runner -Mode candidate carga strings en memoria; -Mode actual queda para la futura fuente revisada; -Mode baseline reproduce limites actuales. Ningun modo acredita produccion, URLs bearer historicas, IAM, el puente ni cierre S01/S10. Mantener writer sin exportar hasta cerrar todas esas fronteras.

## Materializacion preparada para integracion

qa/scripts/remediation-materialize-restriction-rules.mjs es read-only sin argumentos o con --check. Valida hashes SHA256 de seis entradas (ambas reglas vigentes, config, factory candidata, renderer y materializador) y de ambas salidas contra RESTRICTION-CANDIDATE-HASHES.json antes de cualquier escritura. El comando revisable de integracion es node qa/scripts/remediation-materialize-restriction-rules.mjs --write; NO fue ejecutado por este agente. No invoca Firebase ni despliegue. Las dos escrituras locales no forman una transaccion de filesystem; revisar ambas salidas y Mode actual antes integrar. Los hashes son de bytes exactos: preservar CRLF/LF al copiar fuentes entre worktrees; cualquier cambio falla cerrado y exige regenerar evidencia revisada, no omitir el guard.

BOM inicial eliminado solo de scripts/docs propios donde existia. UTF8 estricto, materializador --check, verifier legacy y matriz 2760+33120 PASS posteriores. Sin emuladores durante ventana de despliegue central. firestore.rules/storage.rules siguen intactos en esta entrega.

## Persistencia de los gates despues de materializar

Snapshots explicitos bajo qa/fixtures/remediation-restriction-baseline preservan ambas reglas anteriores, sin depender de git show o HEAD. candidateRules(inputs = {}) admite strings opcionales; por defecto conserva lectura de fuentes actuales para el materializador. La matriz usa snapshots para comparar baseline/candidato y acepta que la fuente actual tenga rendering legacy o cached-selector. Runner baseline/candidate tambien usa snapshots; actual usa exclusivamente las fuentes reales.

Matriz 2760+33120 PASS antes de materializar y nuevamente en workspace temporal con ambas reglas candidatas como fuente actual. No se escribieron reglas raiz para esa simulacion. Materializador --check PASS; hashes de ambas salidas identicos a la evidencia325. Solo cambio el inputhash de la factory por agregar su parametro, actualizado en manifest. No se repitieron emuladores durante la ventana reservada.

## Gate actual tras materializacion central

Integracion materializo localmente ambas reglas con el manifest aprobado. Sus hashes coinciden con las salidas325. El primer Mode actual (session34899) no acredita PASS: fallo en infraestructura durante owner none. Inspeccion filtrada, sin volcar logs ni entorno, encontro ArrayIndexOutOfBoundsException (Index0/length0) en EmulatorRequest.permissionTracesAsJsonArray / BufferingRequestListener.afterRulesEvaluation; posteriormente CLI reporto ENOENT al abrir un archivo temporal GUID sin extension. No se encontraron errores de limite1000 ni permission-denied en ese intento. Esto no prueba relacion causal con otros archivos temporales desaparecidos.

El fallo dejo un proceso Java del proyecto demo vivo en18088/9151. Se verifico identidad/comando/proyecto y se detuvo solo ese PID. Un intento intermedio se detuvo correctamente por18088 ocupado y tampoco cuenta como gate.

Runner ahora fija websocket19088 y aisla XDG_CONFIG_HOME, TEMP y TMP por ejecucion. Temporales van a .firebase/remediation-temp/GUID, ruta ignorada, sin copiar credenciales ni entorno. Finally restaura variables y limpia configuracion XDG solo despues de validar ruta absoluta dentro del directorio propio. Se conservan otros temporales locales ignorados para diagnostico; no versionar logs ni contenido. Ensayo actual61094 final PASS: ACTUAL_LOCAL_ENFORCEMENT,325 comprobaciones,failures:[],24 gaps delegados conocidos,securityClosure:false,exit0. Emuladores apagados normalmente y finally completo. Este resultado acredita las fuentes locales materializadas, no produccion ni cierre de delegacion. No se cambiaron reglas durante diagnostico.
