# QA autenticado local con Firebase Emulator

`npm run qa:ui:authenticated-emulator` ejecuta la certificación local de interfaz sobre `demo-pay0-ui-qa`.

- Reutiliza `scripts/run-firebase-clean-env.mjs`, que serializa emuladores y comprueba sus puertos.
- Arranca solamente Auth y Firestore en `127.0.0.1`; no se carga configuración de Firebase productiva.
- Crea tres cuentas efímeras (`superadmin`, `admin`, `operador limitado`) con contraseñas aleatorias que se guardan sólo en `qa/.auth/`, directorio ignorado por Git.
- Siembra registros sintéticos mínimos y genera sesiones Playwright reutilizables en `qa/.auth/`.
- Ejecuta pantallas reales de Usuarios, Beneficiarios, Dispersiones, Clientes y Reportes. Los callables de catálogo se interceptan dentro del navegador con respuestas locales para aislar la revisión de interfaz: no son una certificación de Functions.
- Las capturas de las resoluciones 320, 390, 768 y 1440 se guardan localmente en `test-results/authenticated-emulator/`.

La ejecución falla si el proyecto no es exactamente `demo-pay0-ui-qa` o si Auth/Firestore no apuntan a `127.0.0.1`. No usar este comando contra un proyecto Firebase real.

Cobertura actual: autenticación local, lectura de reglas para superadmin y operador limitado, foco de Modal, `UiSelect` en modales, confirmación de Clientes y `DateScopeBar`. Operaciones mutantes, IQ, bancos, Facturama y datos productivos quedan fuera de alcance.

## Pendiente de producto: SOFÍA — Centro de inteligencia artificial de PAY0

El módulo denominado HUGO podrá evolucionar a SOFÍA. Hugo, María y Sofía deberán conservar identidades diferenciables y admitir conversación individual o unificada. Las reparaciones automáticas deberán asignarse al agente competente y conservar autorización, trazabilidad y confirmaciones cuando correspondan. Esta nota no habilita agentes, escritura autónoma ni cambios de arquitectura.
