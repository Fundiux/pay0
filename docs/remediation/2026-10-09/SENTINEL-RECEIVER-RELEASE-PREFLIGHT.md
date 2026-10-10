# Receiver firmado: preflight de release aislado

2026-10-10. Lectura y propuesta; NO apply, activacion de confianza/sink/productor, KMS ni efectos financieros. Scope candidato: solo imagen de google_cloud_run_v2_service.observer en pay0-sentinel-observe.

## Evidencia consultada 19:44:58 UTC

- Observer pay0-sentinel-observer-00005-dgr, Ready, generation/observedGeneration5, trafico100. Imagen anterior8968768dc71dd286d799944674b060abba5b7d47d4f244d50724fe7a70326977. SA aislada pay0-sentinel-observer; servicio/template max1, concurrency4, timeout10s, ingressALL con IAM invocacion privado.
- Env del observer exactamente igual al state local: cinco nombres (ALLOWED_ORIGINS_JSON, OBSERVATION_DATABASE_ID, OBSERVATION_PROJECT_ID, PUSH_AUDIENCE, PUSH_SERVICE_ACCOUNT). SIGNED_TRUST_MANIFEST_JSON ausente: defaultvacio. No se imprimieron valores/cohortes. No existe modeDISABLED del observer: detector OBSERVE_ONLY; DISABLED corresponde al canario/productor.
- Canary pay0-security-canary-00006-6wv Ready100%, generation6, OBSERVATION_PUBLISHER_MODE=DISABLED y env igualstate. No actualizar canario en este lote.
- Sink pay0-sentinel-observe-v1 disabledtrue, filtro/writer igualesstate; SHA256 filtro4ee63e7b10f4156cef4582cc8e94d6a0a95e7b1cc8a79384d084900994cfe0b9.
- IAM del servicio observer: solo roles/run.invoker para SA push exacta; sin allUsers/allAuthenticatedUsers. Esto no es auditoria de toda herencia IAM del proyecto.
- CloudBuild140322af-4c09-40f2-a315-c0f8eeb03f1c SUCCESS confirma imagen candidata `us-central1-docker.pkg.dev/pay0-sentinel-observe/sentinel-images/observer@sha256:c4841dab1e20e3cd125d63adc22fac15d4414db7c44f084ccad881f0f6f98549`, builderdedicado. Stageprivado context-x6s45T conserva22archivos; siete fuentes normalizadas CRLF segun build.mjs coinciden con core-manifest. No ejecutar artefacto ni rebuild en este preflight.

Infra main/signed limpia desde76d588a; state local serial91, sin lock al inspeccionar. La metadata muestreada coincide; no se afirma ausencia de drift de todos los42recursos. Fuente main.tf SHA dd4fc7f15c33df2520c380280b0880769e96b0757f29508d7b8f0b89fcdf0af5; signed.tf SHA dca94e8b79d824eacfb7d91b390bd831e0978783b36460096248f236c1dfb0ed.

## Revision y plan en memoria PASS

Auto-review rechazo persistir respuestas API completas. Alternativa aprobada utilizo proyeccion fields, comparacion env en memoria contra stateexistente y salida de opciones/enums/hashes; no guardo respuestas raw. La revision tambien rechazo Terraform plan con -out por exportacion local de payload sensible. Ese comando NO se ejecuto y no genero plan/vars/lock. No se reintenta el mismo -out.

Alternativa privada revisada `.firebase/sentinel-receiver-preflight/plan-memory.mjs`: plan sin -out, vars/token solo en memoria de proceso, stdout capturado y descartado tras parser cerrado. Exige state91 sin cambios/lock liberado,0add/1updateobserver/0destroy e imagenexacta; rechaza modificaciones env/IAM/uotroscampos, bloques desconocidos, drift explicito o salidas nuevas. Siete fixtures sinteticos PASS.

Ejecucion alternativa autorizada y aprobada por herramienta, sesion71815 exit0: **0add/1update/0destroy, solo google_cloud_run_v2_service.observer, unico campo template.containers.image** de8968768... a c4841dab... exactos. SHA256 de stdout en memoria `602409d0747aec1d3e9d2c455021a155f785491d3e937d8f01be14cf254344c7`; rawPersistedfalse/planFilefalse/applyfalse. Hashstate preservado y lockliberado. No cambios IAM/env/limites en el plan dirigido. No plan global ni certificacion de recursos fuera de dependencias del target.

El target observer incluye dependencias de Terraform: revisar cambios efectivos, no asumir que -target evita IAMchanges. Mantener enable_observation_budgettrue, canaryDISABLED/imagenoriginal, activate_sinkfalse, trustmanifestempty y origenlegacy exacto derivado del state; no inferir cohortes nuevas. Estado y lock deben revalidarse antes de futura accion.

## Gates posteriores

Primero plan revisado de SOLOimagen; cualquier drift funcional bloquea y requiere analisis. Apply sigue reservado al coordinador tras revision, sin reutilizar un plan inexistente. Una aprobacion del plan en memoria no crea un archivo inmutable aplicable: sera necesario otro mecanismo revisado que vuelva a comprobar exactamente el cambio antes de apply.

Postflight previsto: revisionnueva Ready/trafico100, digest exacto, SA/env/recursos/limits/IAM invariantes; canarioDISABLED y sinkoff; trustausente/defaultvacio. Smoke publico no autenticado solo verifica rechazo del endpoint privado, sin publicar eventos, leer Firestore ni inventar E2E firmado. Recovery usa imagenanterior con la misma configuracion y nuevo plan revisado, nunca rollback automatico ni habilitar unsigned. No cerrar productores reales o contencion por desplegar receiver con confianza vacia.
