# Restricción manual y recuperación: implementación preparada, no publicada

`restrictionService.ts` y `restrictionsCallables.ts` preparan issue/revoke/getMyRestrictionStatus sin exportarlos en index. No se ha creado ninguna restricción productiva. NO publicar writer antes de cerrar HTTP/manual, workers diferidos, reglas directas, Storage y recuperación. Un guard común no demuestra bloqueo transversal completo.

## Autoridad y atomicidad

Emisión/revocación requieren actor superadmin vigente no restringido, mismo root que sujeto y autenticación Firebase reciente (claim auth_time verificado por runtime, hasta300s, nunca futuro). El payload no puede aportar root, autoridad, writer, tiempos de emisión, versión nueva ni identidad del emisor. No se permite operar sobre uno mismo. La transacción vuelve a leer ambos perfiles y evalúa el guard antes de escribir. La revocación mantiene la misma autoridad superadmin; admin ordinario no obtiene nueva facultad por el nombre «soporte».

TTL por defecto15min, máximo24h exactas. Emisión sobre restricción ACTIVE o INVALID se rechaza; EXPIRED/REVOKED válido permite nueva emisión incrementando autorización. Recuperación exige restrictionId+authorizationVersion coincidentes y motivo enum; una versión obsoleta aborta. Registro y auditoría trustedRestrictionAudit se escriben en la misma transacción. Reintentos internos conservan ID servidor; una repetición externa de emisión nunca reemplaza una restricción vigente. Una repetición externa de revocación recibe conflicto de versión, sin nuevo efecto.

La excepción getMyRestrictionStatus requiere autenticación y perfil activo con rol canónico. Solo devuelve state, restricted, expiresAtMs y CONTACT_SUPPORT del propio actor; no lee cuentas ajenas, IDs de incidentes, autoridad ni datos financieros. No entrega credenciales ni tokens que permitan saltar el guard. La UI debe ofrecer reautenticación y soporte; no debe decidir que una restricción desapareció ni escribir campos de seguridad.

## Recuperación excepcional del último administrador

No hay bypass de rol, código cliente, clave maestra en UI ni endpoint IAM expuesto. Si no existe superadmin habilitado en el root, el operador de infraestructura autorizado debe usar un procedimiento separado con identidad IAM nominativa temporal y revisión independiente. Esta ruta NO se ha ejecutado ni se entrega un script de mutación automática.

Contrato operativo previo a ejecución: ticket aprobado con root/UID/ID/versión y motivo; identidad independiente del sujeto; lectura fresca y captura restringida del registro original; comparación CAS del valor completo observado; transacción única de corrección y auditoría con referencias al ticket y aprobador; comprobación de recuperación y retirada del acceso IAM temporal. Para registro válido, revocar preservando issuer, incidentId, ID, TTL original e incrementando versión. Para registro corrupto que el guard no admite, conservar original en evidencia de acceso restringido y retirar el campo inválido mediante CAS solo bajo revisión específica; no fabricar una historia de restricción válida. Si cambió el registro desde revisión, abortar y revisar nuevamente. No copiar perfiles ni secretos a logs/Git.

IAM de Firestore Admin no es aislamiento por colección: el operador excepcional tiene capacidad mayor que el writer de aplicación y se trata como acceso de emergencia auditado. Deshabilitar una función no constituye recuperación. Expiración válida se aplica por reloj sin tarea asíncrona; registro inválido no libera acceso por fingir caducidad. El procedimiento exige ensayo en emulador/entorno aislado antes de habilitación productiva; pruebas unitarias de negación no acreditan validación real de IAM ni un simulacro operacional.

## Validación y gates

Suite `remediation-restriction-service.test.cjs`: emisión/auditoría atómica y rollback, payload de autoridad rechazado, auth_time/rol/root/self, emisión concurrente, CAS/reemplazo, actor restringido, estado propio acotado, registro inválido/último administrador y TTL exacto. No usa Firebase ni proveedores reales.

Pendiente antes de export: pruebas reglas de users y auditoría append-only; inspección de todos los writers Admin existentes que puedan aceptar campos arbitrarios; cobertura HTTP/workers/direct SDK/Storage; UI estado y soporte; simulacro breakglass con CAS y auditoría, verificación IAM efectiva, despliegue aprobado y evidencia de versión publicada. El servicio no recibe eventos Sentinel ni acepta decisiones de IA. Sentinel continúa OBSERVE_ONLY sin autoridad para invocar este writer.
