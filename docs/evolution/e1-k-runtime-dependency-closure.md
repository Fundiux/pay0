# K — cierre de dependencias instaladas

Módulo independiente: `qa/scripts/verify-runtime-dependency-closure.cjs`. No cambia scripts de publicación, manifests, locks ni CI durante la preparación de MAT.

Ejecuta `npm ls --omit=dev --all --offline --json` en el directorio solicitado, sin instalar ni ejecutar scripts de paquetes. Usa un comando fijo, `cwd` separado y timeout de 60 segundos. La salida persistida contiene hashes y hallazgos estructurados, no URLs de registro ni texto bruto de errores npm. Un JSON inválido, un error de ejecución o un cambio de manifest/lock durante la comprobación produce `INDETERMINATE`; una dependencia obligatoria faltante o incompatible produce `FAIL`.

## Evidencia

Fixtures locales sin descargas: árbol transitivo con dependencia resuelta desde el padre, dependencia directa ausente, transitiva ausente, versión transitiva incompatible, opcional ausente, peer obligatorio ausente, peer opcional ausente, paquete adicional y dependencias dev omitidas. Se añaden casos de salida no interpretable, timeout, error npm sin explicación de dependencias y cambio concurrente de manifest.

Los nueve casos reales npm y los casos de errores del controlador pasaron. Se verificó con Node22.23.2 y npm10.9.8. Comandos:

```powershell
node --test qa/scripts/runtime-dependency-closure.test.cjs
node qa/scripts/verify-runtime-dependency-closure.cjs .firebase/modular-release/i-mat-readiness/release-getMatUserHome/runtime --output output/dependency-closure/mat-closure-verification.json
```

Resultado MAT: **PASS**, 546 referencias de dependencias, cero hallazgos y exit npm0. Manifest SHA256 `5b0e932d0264c6acbc38c3d0d327650769f01b0e902d8fbb8f9b1e469b68a20c`; lock SHA256 `b3b5776ca6364563f51ca6e0d95963b1b046fe449c9cf8b9440059a6db9472ff`. El directorio usa las dependencias ya instaladas de lock idéntico; no se reinstaló ni cambió el runtime. Evidencia privada en `output/dependency-closure/`.

## Límites confirmados

- npm permite que falten dependencias opcionales y peers opcionales. Por tanto este control **no detecta por sí solo** una capacidad como Storage si su SDK está declarado como opcional. Deben mantenerse las pruebas de importación/consumidor y de capacidades requeridas.
- Paquetes adicionales se informan como `EXTRANEOUS`, pero no se consideran un fallo del cierre de dependencias obligatorias. Un consumidor que exija instalación exacta debe tratarlos por separado.
- No verifica integridad de archivos contra registry, correspondencia completa con lock, vulnerabilidades, imports dinámicos, binarios nativos ni funcionalidad financiera. `PASS` no significa instalación certificada ni audit limpio.
- No congela `node_modules`. No ejecutar instalación concurrente durante la inspección. Los hashes comprueban únicamente que manifest y lock no cambiaron.

## Integración propuesta para revisión del coordinador

En `verify-scoped-functions-artifact.cjs`, después de `npm ci` y antes del probe de startup, invocar `inspectRuntimeDependencyClosure(directory)`, persistir el resultado en el directorio privado y exigir `status === 'PASS'`. Aplicar el mismo paso al camino de instalación reutilizada, manteniendo su comparación exacta de package/lock y archivos runtime. Conservar las pruebas de importación de capacidades opcionales. No convertir este resultado en un certificado de vulnerabilidades.

Una integración posterior puede adjuntar el hash del informe al proof existente. Este paquete no modifica su esquema ni introduce una exigencia nueva en publicaciones ya preparadas.
