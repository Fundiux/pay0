# G/K — control tecnológico local

Estado: PARTIAL. No se publicó ni se verificó producción.

Se reutilizan `config/release-baseline.json`, su verificador, el candidato de
release con archivo SHA-256 y la CI. El nuevo `npm run qa:technology` valida,
antes de instalar, seis manifests/lockfiles, versiones directas resueltas,
integridad registrada, Node 22 y runtime Firebase. Rechaza claves JSON
duplicadas incluso con escapes. El staging sin dependencias mantiene su
excepción explícita; agregarle dependencias exige ampliar cobertura de lockfile.
El parser HTTP estricto existente tiene un límite de 16 KiB: no se amplió su
superficie para procesar lockfiles grandes; la validación local usa un escáner
propio sobre JSON sintácticamente válido.

El inventario JSON incluye commit, rama, estado del checkout, hashes de
manifests/locks/configuración, versiones declaradas/resueltas y opcionalmente
instaladas (`node scripts/verify-technology-baseline.mjs --installed`). La
identidad corresponde al árbol local, posiblemente modificado, no al artefacto
publicado. El candidato existente conserva la identidad de su archivo fuente.
Certificación, publicación, versión recuperable y runtime productivo siguen
explícitamente desconocidos/no realizados. El control no certifica compatibilidad
de APIs ni estados remotos; las compilaciones y pruebas de dominio siguen siendo
obligatorias. Los rangos directos soportados son exactos, caret y tilde; un formato
nuevo requiere una ampliación probada, nunca una aceptación silenciosa.

## Matriz y objetivo inmediato

| Componente | Evidencia y objetivo | Compatibilidad / riesgo |
| --- | --- | --- |
| Node/npm | Local Node 22.23.2, npm 10.9.8; conservar Node 22 en manifests, CI y Firebase | Node 22 Maintenance LTS; fin previsto 2027-04-30 |
| Next/React | Mantener Next 15.5.27 y React 18.3.1 resueltos | Builds/pruebas locales; revisar migración a Next 16 por ventana de soporte, no migrar sin evaluar APIs |
| TypeScript/esbuild | Conservar versiones resueltas; esbuild 0.28.2 sin clave duplicada | Se elimina sólo duplicado idéntico; lockfile no cambia |
| Firebase Admin | Frontend/Functions 13.x, gateway/E2E 14.5.0 | Procesos separados; no forzar misma major sin pruebas de consumidores |
| UUID | Gateway/E2E pasan de 9.0.1 a 11.1.1 mediante override ya usado en raíz | Cambio major acotado y probado: único consumidor gaxios 6.7.1 usa v4; Storage 8.2.0 preservado |
| Servicios auxiliares | Locks de gateway, E2E, publisher y sentinel incluidos | Instalación ausente no equivale a fallo productivo; `--installed` la reporta |
| SDKs/modelos/protocolos remotos | Inventario E0 permanece referencia | Versiones efectivamente ejecutadas y compatibilidad de proveedores requieren evidencia externa |

Consulta oficial 2026-10-19: [calendario Node](https://github.com/nodejs/Release)
y [soporte Next.js](https://nextjs.org/support-policy). Next 15 figura en
Maintenance LTS; la política establece dos años desde su lanzamiento
2024-10-21. Por ello el horizonte de 2026-10-21 requiere revisión inmediata; no
se concluye que una migración mayor esté certificada por compilar el código actual.

Auditoría npm de los seis locks ejecutada con
`npm audit --package-lock-only --ignore-scripts`. Raíz, Functions, publisher y
sentinel no registraron hallazgos. Gateway y E2E inicialmente registraron siete
moderados cada uno, todos derivados de UUID 9.0.1; la corrección a 11.1.1 elimina
la cadena del [advisory oficial](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
Audits finales: cero hallazgos en los seis locks. No demuestra ausencia absoluta
de vulnerabilidades. No hubo `audit fix`. Informes completos en
`output/technology-audit-*.json` son artefactos locales ignorados.

La verificación instalada inicial confirmó raíz/Functions; gateway estaba sin
`node_modules` y `--installed` lo detectó. Después de auditar se ejecutó `npm ci`
en gateway y E2E para verificar la corrección, con 190 paquetes en cada servicio.
La cache npm predeterminada fuera del workspace produjo EPERM y descartó
dependencias opcionales silenciosamente en los primeros intentos. Esos locks
se descartaron; se regeneraron desde HEAD en copias locales con cache escribible
`output/npm-cache`. El diff final cambia sólo la entrada UUID de cada lock,
sin eliminar Storage ni ningún otro paquete.

Pruebas: contrato tecnológico 7/7; consumidor real UUID/gaxios multipart y
importación Storage 2/2 (sin red); candidato de release 8/8; gateway completo
49/49. El guard verifica que el override UUID corresponda a la versión resuelta.
Los builds generales corresponden al coordinador. Próximo paso: decidir migración Next 16 mediante cambios
compatibles y evaluación de soporte, y verificar identidad productiva con autorización.
