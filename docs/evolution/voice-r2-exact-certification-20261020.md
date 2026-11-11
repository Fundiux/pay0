# Voz R2 y corrección de sesión: certificación exacta

Rama aislada: `fix/voice-r2-certified-overlay-20261020`, desde main `48741917ff2b3f0a856e64ebd267a3760ec2faac`. No modifica la copia concurrente de la laptop.

La fuente vigente de `delegateHugoVoiceTurn` es `delegatehugovoiceturn-00010-caj`, ZIP `f7407ccfd1fcfb8ccca950b8b7a731a5df0fc80ea6c91560ac3e90edac2f8c88`. El constructor exige esa base y reproduce su emit antes de sustituir cinco módulos: delegación, corrección de voz, helper transaccional, conector y semántica de reportes. Conserva 782 archivos, manifiesto, lockfile, handler financiero canónico y autorización productiva.

Candidato backend: `60af834eff55b146fac1ee6744db183c1b3a4bfb0b723a300ca275f1e112095b`. El overlay no representa un build completo de main y sólo tiene como destino `delegateHugoVoiceTurn`.

La imagen usa como base el digest productivo previo y `npm ci --omit=dev --ignore-scripts`. Cloud Build `0d839593-4dd2-4675-8ddf-a3c1f391e0fa` terminó SUCCESS. Imagen certificada:

`us-central1-docker.pkg.dev/pay-0-system/cloud-run-source-deploy/hugo-voice-gateway-canary@sha256:1411300ac4cda7950f66fccba8ed9a2c329a172c1eac9546ee8b62b324076c06`

El contexto se ensambló por archivos verificados; no incluyó archivos de entorno. El archivo de historial contiene un entorno heredado, omitido deliberadamente en QA. Las dependencias de los tres runtimes se verificaron contra sus manifiestos y lockfiles iguales.

## Pruebas

- Imagen Linux: 57/57 pruebas gateway y 12/12 pruebas integradas en Firestore emulado, exit 0.
- Integración con los artefactos publicados de historial y lectores: ACK después de commit, lectura propia, aislamiento de dueño/root, retiro sin borrar, replay, concurrencia, revocación entre preautorización y transacción y fallo después de staged writes sin estado parcial.
- Reporte R2: dos periodos explícitos, totales del handler canónico, diferencia 25.10, exclusión de root ajeno y rechazo de fechas incompletas. Son dos lecturas independientes, no una instantánea transaccional.
- Regresiones sobre el candidato exacto: 17/17 de permisos y consultas. Sólo se adaptaron rutas de importación y de lectura de fuente UI; no se sustituyeron políticas.
- Build NORMAL Functions, lint y verificador de autorización: PASS.

No se llamaron modelos ni proveedores reales y no se escribieron datos de negocio productivos. Las pruebas de sideband y continuación audible son simuladas; no certifican audio real ni reutilización durable entre sesiones. La corrección es una indicación privada USER_STATEMENT, no un hecho ni un cambio de permisos o datos financieros.

## Publicación y reversión

Este commit prepara la entrega; no acredita despliegue por sí solo. Antes de ejecutar se comparan de nuevo fuente, Function/Run/IAM, historial/lectores y gateway/tráfico. El backend se actualiza exclusivamente con el ejecutor acotado. El gateway debe recibir sólo el digest certificado, conservar configuración/IAM y arrancar primero sin retirar tráfico de la revisión previa.

Se preservan el ZIP backend anterior y su configuración/IAM, y la imagen previa `sha256:ae8aea1811185a409a7150fd82fe46aeddc605bd20d0ec2d6ecea3757d27c9b7`, con todas las asignaciones de tráfico y etiquetas previas. La reversión no borra recuerdos ni cambia lectores; éstos ya pudieron retirar una corrección VOICE en la prueba integrada. Cualquier deriva concurrente invalida las precondiciones y requiere reconciliar antes de escribir.
