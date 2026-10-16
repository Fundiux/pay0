# Build aislado del frontend de notas

Base: main ee2a7d0. Rama: fix/notes-hosting-trace-root-20261015.

El build previo de integración usó Next 15.5.27 de dependencias compartidas aunque su manifest y lockfile fijaban 15.5.25. Ese resultado no demostraba reproducibilidad con el lockfile. El primer build aislado con 15.5.25 terminó correctamente (35e319), pero no se seleccionó para publicación.

Se aplicó exactamente la parte frontend del cambio de dependencias ya revisado d66555b: package.json y package-lock.json, preservando todos los scripts de main. No se cambiaron paquetes de Functions. outputFileTracingRoot se fija al directorio del archivo de configuración para evitar depender del repositorio exterior al construir desde un worktree.

Validación del nuevo candidato:

- npm ci --offline --ignore-scripts --no-audit --no-fund: 457 paquetes, exit 0 (5c87e7, sesión 64594, terminal 847773). Dependencias propias, sin descargas ni scripts de instalación.
- Manifest y lockfile coinciden; lockfile idéntico al revisado en d66555b y scripts idénticos a main (594606). Next, Sharp, gRPC, DOMPurify y UUID instalados coinciden con el lock (10c680).
- npm run build: exit 0 (b8eb04, sesión 90654, terminal ad854b). Next 15.5.27; configuración 7/7, baseline y 22 controles críticos aprobados; compilación, tipos y 46 páginas estáticas correctos.
- Trazas 05aa2f: 61 manifiestos, 829 rutas únicas, ninguna fuera del worktree ni ausente. appDir y outputFileTracingRoot coinciden con este worktree; relativeAppDir vacío. Recibo local ignorado: .firebase/notes-hosting-build-20261015/trace-receipt.json.
- git diff --check aprobado.

El nuevo build se justifica por cambios de dependencias y configuración; no se repitieron pruebas financieras, de autorización o SDK previamente aprobadas. No hubo cambios de Functions, Rules, despliegues, mensajes ni operaciones financieras. Este resultado acredita el build local; quedan empaquetado/publicación del frontend, despliegue autorizado de lectores y verificación autenticada de UI. No acredita todavía el contenedor SSR de producción.
