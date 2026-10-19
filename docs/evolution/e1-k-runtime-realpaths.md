# K — confinamiento del runtime reutilizado

Revisión de `30e3da8`: el hash de todos los archivos del ZIP protege la fuente extraída, pero `node_modules` no forma parte del ZIP. Una dependencia ESM enlazada fuera del runtime puede pasar `npm ls` y cargar código externo sin atravesar `Module._resolveFilename`. Se reprodujo con un paquete sintético local; **no es evidencia de un incidente productivo**.

`qa/scripts/verify-runtime-realpaths.cjs` recorre el runtime antes de cargar código. Rechaza enlaces simbólicos/junctions que resuelvan fuera, enlaces rotos, ciclos, un root que sea enlace, archivos inaccesibles y exceso del límite de entradas. Permite enlaces internos no cíclicos y evita volver a recorrer el mismo directorio físico. No amplía el alcance a hardlinks y no congela el filesystem frente a modificaciones concurrentes.

Se integró en `verify-modular-hosting-runtime.mjs` después de la instalación o selección del runtime reutilizado y antes del cierre de dependencias/startup. El proof registra:

- `runtimeRealpathsPassed`: resultado obligatorio verdadero.
- `runtimeRealpathsSha256`: hash del código del helper ejecutado.
- `runtimeRealpathsReportSha256`: hash del informe privado.
- `dependencyClosureVerifierSha256`: hash del helper de dependencias.

Los hashes de ambos helpers se capturan antes de usarlos y se vuelven a comprobar al finalizar. `assertRuntimeProof` exige los hashes actuales; un proof antiguo o alterado falla antes de publicar. El cambio del ejecutor invalida los inputs anteriores: deben prepararse de nuevo, sin considerar que el proof preliminar de R1 apruebe el contrato nuevo.

Pruebas: **28/28 PASS** entre publicación, reanudación y filesystem. Incluyen escape ESM real por junction, enlace interno permitido, ancestro `node_modules` externo, ciclo, enlace roto y negativos de hashes faltantes/obsoletos. Windows negó la creación de un symlink de archivo; esa rama usa un fixture de filesystem explícito, sin omitir el caso.

Runtime E preservado: PASS, 42,194 entradas, 6,159 directorios, cero enlaces y cero incidencias. Evidencia privada: `output/reuse-review/e-runtime-realpaths.json`. Revisión de rutas únicamente; no se arrancó ni cambió el runtime durante ese escaneo. Los árboles Functions con junctions de test no se inspeccionaron.

Sin nuevas dependencias, instalaciones, builds ni publicación. El check no sustituye la verificación de bytes del ZIP, el cierre transitivo, las pruebas de navegador ni una auditoría de vulnerabilidades.
