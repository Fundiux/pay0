# F — Resultado explícito de recuperación

Estado: `LOCAL_VALIDATED_INTEGRATION_PENDING`. Sin despliegue ni cambios productivos.

El worker distinguía únicamente excepciones: un retorno temprano por fuente terminal, generación antigua o error ya resuelto terminaba como `COMPLETED` y emitía `OPERACION_RECUPERADA` aunque no hubiera ejecutado el dominio.

`executeRecovery` devuelve un resultado explícito. Los trabajos obsoletos terminan `SUPERSEDED`; una fuente que dejó de estar en error antes de ejecutar termina `RESOLVED_EXTERNALLY`. Ninguno declara recuperación. El evento `OPERACION_RECUPERACION_OMITIDA` tiene entrada en el catálogo. Después de ejecutar el dominio, se conservan las protecciones de generación, terminalidad y error nuevo; una actualización legítima de estado del propio dominio conserva el éxito. El cierre exige tanto la lease propia como estado `RUNNING`, evitando sobrescribir una terminalización concurrente con la misma lease.

No cambia la autorización, los servicios de dominio, los cinco intentos, el backoff, las claves de idempotencia ni los exports públicos.

## Evidencia local

`node qa/scripts/e1-operations-emulator.mjs qa/scripts/e1-operations-recovery-outcomes.test.cjs` terminó con código 0: ocho escenarios sobre Firestore emulado. El módulo recovery editado se transpila aisladamente; sus dependencias compiladas actuales de autorización, auditoría y materialidad son reales. No constituye una prueba del artefacto desplegable ni de reglas de seguridad Firestore.

- Fuente terminal, generación obsoleta y resolución externa: estado explícito, fuente intacta y ningún evento de recuperación exitosa.
- Dominio de materialidad real: proyección persistida, trabajo completado y exactamente un evento `OPERACION_RECUPERADA` tras una segunda pasada.
- Dominio real seguido de actualización de su estado durante la espera: conserva `COMPLETED`, sin falsa resolución externa.
- Terminalización de job con la misma lease y cambio de propietario de lease: no sobrescribe ni emite éxito.
- Quinto fallo: `NEEDS_REVIEW`, cinco intentos y sin próximo reintento.

Proyecto demo aislado y puertos aleatorios; Firestore, hub y logging se cerraron al terminar. Sin escrituras financieras ni acciones externas. Log privado `tmp/f-recovery-outcomes-emulator.log`, SHA256 `dcfd7874db294d3a4cfae5e8948cb49c93fed4f277f103af168528efa9d797f0`.

Build NORMAL Functions (`npm run build:normal`, sin instalación) PASS, código 0; log privado `tmp/f-recovery-outcomes-functions-build.log`. `git diff --check` PASS.

Pendiente: revisión de esta integración, paquete exacto sobre las fuentes productivas de ambos workers, pruebas del artefacto y autorización específica antes de publicar. No se certifica recuperación productiva ni concurrencia universal.
