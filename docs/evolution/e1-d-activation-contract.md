# Contrato propuesto de activación D — revisión local

Estado: PLANIFICADOR_PURO_LOCAL_PROBADO; sin ejecutor, red, token, cambios de configuración ni autorización de publicación. Instalar D1 con gate OFF permite diagnóstico y revocación autorizada, pero no aprobación ni aprendizaje activo. La activación sería otra operación autorizada, posterior a instalación y verificación de las superficies siguientes. No se generó ningún plan productivo: review todavía no existe.

## Superficies e identidades

- Chat `sendAgent007Message`: fuente D1 compuesta sobre R1.5, candidato SHA256 `763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62`, base `45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474`. Antes de activar exigir fuente publicada exacta, entryPoint correcto, ACTIVE y revisión/servicio/imagen verificados. Preservar reportes R1.5/R1.4/R2. Los candidatos anteriores R1.4/R2 no cumplen esta identidad.
- Administración `reviewAgent007LearningRule`: endpoint nuevo con ZIP `c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d`, contrato RuleStore/D1 con REVOKE OFF. Su instalación necesita autorización y recibo propios. No basta que chat exporte la función dentro del ZIP: el recurso debe existir y estar verificado.
- Lectura `listAgent007LearningDiagnostics`: el modo D2 y la UI compatible deben estar publicados y probados antes de activar. Candidato diagnostics `d148d084149f6be8e76ce297d4639c22583ead14e5eee64f6386b3969d353ce8`, separado del chat. No requiere copiar D2 al chat.
- UI existente de revisión D2, wrapper y contrato comprobados: lista candidatos, selecciona 2–5, confirma, llama review y refresca estado canónico; rechazo controlado, paginación y cambio uid/root/rol probados. La UI por sí sola no autoriza nada.

Capturar baseline fresco e independiente de cada recurso: fuente, revisión, configuración, IAM y operaciones pendientes. Gate exacto `HUGO_SUPERVISED_RULES_ENABLED="true"` en **review y chat**, por separado; ausente u otro valor equivale a OFF. Configuración restante, runtime, cuenta de servicio, secretos, ingress, escalado, memoria, timeout, labels ajenas y políticas IAM deben preservarse. No modificar permisos de invocación para resolver errores funcionales: la autenticación Firebase y la autorización server-side superadmin/root siguen siendo obligatorias incluso si el transporte admite invocación pública. No activar voz ni otros recursos.

El contrato de un futuro controlador debe fijar los dos recursos, identidades exactas, baselines y único cambio de configuración; bloquear drift, operaciones concurrentes y reintentos de resultado incierto. Guardar estado durable antes de mutar y conservar lock ante incertidumbre. Confirmar nueva revisión y tráfico efectivo antes de avanzar; no atribuir atomicidad a dos despliegues de configuración. Esta nota no propone modificar helpers ya fijados por otros paquetes.

## Condiciones funcionales previas

La primera versión sólo admite `VERIFY_DOCUMENT_BEFORE_DECISION`: recomendación, nunca ejecución financiera ni confirmación de causa. Tanto aprobación como resolución revalidan superadmin vigente y root desde Firestore, sin confiar en rol del navegador. La aplicación requiere contexto V2, folio S exacto/completo, solicitud actual PENDIENTE sin `deletedAt` ni `isDeleted`, y coincidencia de rasgos. Otros roles no tienen esta capacidad D1 actualmente.

Se necesitan 2–5 experiencias independientes elegibles y coherentes, corrección validada, memoria CONFIRMED, observación/decisión/outcome vinculados y evidencia vigente del mismo root. No fabricar registros para llenar el panel. La procedencia requiere productores reales compatibles, identidad system/type/id y tiempos válidos; en fallback de `activityLog`, versión 2, atomicBatch y referencias canónicas de aplicación. No se detectan secretos/keys nuevos requeridos por RuleStore; el acceso depende de IAM Firestore existente. Esto no certifica que existan experiencias reales elegibles en producción.

La aprobación persiste regla ACTIVE, versión, supervisor, referencias/revisiones y evaluación sin modelo; caduca a las 24 horas. Caducidad, contradicción, soporte cambiado/protegido o supervisor revocado impiden aplicación y pueden invalidar en la siguiente resolución; no existe un barrido automático garantizado. Con más de 20 reglas ACTIVE del root, resolución devuelve null. No prometer cobertura general.

Las consultas D1 y D2 tienen comprobaciones plan-only locales archivadas (`query-plan-only-proof.json`, `d2-query-plan-only-proof.json`); no prueban datos, permisos ni resultados. No afirmar bloqueo por índice compuesto ausente: el plan D1 ya pasó mediante índices combinados. Datos/eligibilidad y autorización se validan por separado.

## Orden y criterios de salida

1. Publicar/verificar D1 chat y endpoint review con ambos gates OFF; publicar/verificar D2 diagnostics/UI. Confirmar fuentes y preservar R1.5/R1.4/R2. Estado: INSTALADO_INACTIVO.
2. Con autorización explícita, habilitar **review primero**, mantener chat OFF. Verificar revisión y configuración efectiva; probar autorización y lectura. Estado: ADMINISTRACIÓN_DISPONIBLE_SIN_APLICACIÓN. Review ON permite también APPROVE: coordinar operadores, no presentarlo como modo sólo revocación.
3. Revisar evidencia real y aprobar únicamente una regla permitida mediante UI y confirmación explícita. Leer de nuevo estado/version/ledger canónicos; no inferir éxito desde respuesta optimista. Esta escritura de aprendizaje requiere autorización propia; no forma parte de pruebas de sólo lectura.
4. Habilitar chat después y verificar revisión/tráfico/configuración. Una consulta autorizada, exacta y acordada debe mostrar respuesta `SUPERVISED_DOCUMENT_REVIEW` y appliedRuleId de la regla correcta; no invocar proveedor real ni operaciones financieras para demostrarlo. Entonces puede declararse OPERATIVO_LIMITADO, no antes.
5. Diagnostics expone sólo `diagnosticsLocalFlag`; review y chat se mantienen UNKNOWN en su DTO. Prueba/recibo externo debe acreditar ambos gates reales. Activar diagnostics no habilita los otros recursos y no es necesario para consultar/aprobar. Un intento APPROVE con review OFF recibe failed-precondition; REVOKE autorizado sí permanece disponible. No rotularlo como activado globalmente.

## Apagado y revocación: contrato corregido

El código corregido permite REVOKE con review OFF, preservando autenticación, actor/root dentro de transacción, versión y ledger idempotente. APPROVE sigue gated. `resolve()` con chat OFF devuelve null antes de leer/invalidate; apagar no revoca las reglas persistidas. Si después se reactiva chat, una regla aún ACTIVE, no caducada y válida puede volver a aplicarse. El gate es un interruptor de ejecución, no una revocación durable.

Apagado de emergencia: chat OFF verificado primero y después review OFF. La revocación durable de reglas concretas puede realizarse con ambos OFF, mediante acción deliberada y confirmada del usuario autorizado y lectura posterior de INVALIDATED/versión/ledger. No reactivar ningún gate sólo para revocar. No borrar reglas/evidencia, escribir Firestore directamente ni revocar reglas reales como smoke test.

La corrección procede de `b0545c2`; está incorporada en los dos artefactos fijados arriba. No se introduce un gate independiente de administración ni se relajan autorización o IAM. Las pruebas locales del artefacto no sustituyen autorización de publicación ni comprobación autenticada productiva.

## Reversión y pruebas mínimas

Rollback de activación y apagado de emergencia son operaciones distintas. El rollback restaura exactamente el valor anterior o la ausencia del gate, en orden chat→review, sólo sobre el estado posterior propio verificado y sin deriva. Si el valor previo era ON, restaurarlo no es un apagado de emergencia. Emergencia fuerza ambos a `false`, también chat→review. Ninguna operación revoca reglas ni elimina ledger/experiencias. Ante estado desconocido se reconcilia, sin repetición ciega.

Antes de activar: matriz local OFF/OFF, ON/OFF, OFF/ON, ON/ON; deny anónimo/no-superadmin/root cambiado; review OFF rechaza APPROVE pero permite REVOKE autorizado/idempotente; apagado/encendido no resucita una regla INVALIDATED. Verificar caducidad, contradicción, soporte/evidencia/supervisor revocados, soft-delete y contexto completo. Mantener R1.5/R1.4 PDF/Excel/mes/año/cambio de cliente y comparación R2, sin proveedor. Los fixtures locales no sustituyen una demostración funcional autorizada.

## Planificador puro y evidencia

`scripts/plan-supervised-learning-gates.mjs` sólo exporta validación y propuestas de activación, rollback y emergencia. No tiene CLI, filesystem, credenciales, red ni ejecutor. Exige bytes y SHA externos del manifiesto, baseline y proof de lectura de fuente; exactamente dos targets; Node22/ACTIVE/entrypoints correctos, Run listo, IAM completo, cero operaciones y gate literal `true`, `false` o ausente. Coteja el gate efectivo de Run. Un recurso review ausente se rechaza.

El proof debe vincular target, bucket/object/generation como string exacto, SHA de bytes descargados e identidades completas resource/Run/IAM. El planificador valida su coherencia y pins, pero no autentica quién lo capturó ni afirma lectura remota propia. Los SHA esperados y el manifiesto deberán revisarse externamente; etiquetar unos bytes arbitrarios como D1/R15 no pasa los pins de los dos ZIPs.

Cada propuesta PATCH contiene únicamente `serviceConfig.environmentVariables` con el mapa completo conservado salvo `HUGO_SUPERVISED_RULES_ENABLED`. No cambia IAM, source, labels, build env ni otra configuración. Rollback exige evidencia original pinneada, reconstruye íntegro el plan de activación y compara el estado actual con un recibo posterior propio fijado por SHA y ligado al plan. El recibo enumera `appliedTargets` como prefijo exacto del orden review→chat; si sólo review terminó, propone restaurar sólo review y su ausencia/valor anterior. No acepta pasos fuera de orden, un paso desconocido ni un estado que no coincida con ese prefijo. No basta inventar un valor previo válido o un contador PASS.

`qa/scripts/supervised-learning-gate-plan.test.mjs`: 16/16 PASS offline, incluyendo pins ajenos, gate ambiguo, source generation/hash/proof ausentes o cambiados, IAM/config drift, recibo ajeno, valor previo inventado, ausencia previa restaurada y rollback de activación parcial con prefijo verificado. No se creó ningún plan productivo ni se ejecutó activación.
