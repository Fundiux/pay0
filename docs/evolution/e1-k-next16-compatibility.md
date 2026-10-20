# K — evaluación acotada Next 16

Fecha: 2026-10-19. Base del experimento: `cb88bae359649524f34243bc1aa153ca95a60ecb`.
Complementa `2026-10-19/GK-technology.md`; no sustituye el baseline ni certifica publicación.

## Candidato reversible

La copia ignorada `output/next16-compat` procede de `git archive` de esa base: `src public config scripts qa evals package.json package-lock.json tsconfig.json next.config.mjs next-env.d.ts .firebaserc postcss.config.js tailwind.config.js`. No contiene `.env`, credenciales ni configuración de sesión. Sólo cambia `next: 15.5.27 → 16.4.2` en su manifest. El lock conserva React 18.3.1 y cambia once entradas: Next, sus nueve paquetes `@next/*` y `@swc/helpers` 0.5.15 → 0.5.23. No cambia manifests, locks, CI o configuración de despliegue del checkout activo. No se necesita revertir el producto para descartar este experimento.

La metadata consultada mediante `npm view next@16.4.2 version engines peerDependencies --json` admite React/ReactDOM `^18.2.0` y Node `>=20.9.0`. Esto permite evaluar el bundler sin introducir además una migración de React. El App Router incluye React canary internamente; conservar los paquetes 18 no demuestra equivalencia del comportamiento del renderer. El build emite la deprecación de React 18 y anuncia su retirada en Next 17: esta combinación es un candidato transitorio.

## Matriz de uso real

Inventario AST con TypeScript sobre `src`: imports de `next/link` en 24 archivos; `next/navigation` en 30; tipos de `next` en dos; `next/font/google`, `next/script` y `next/dynamic` en uno cada uno. Evidencia JSON local: `output/next16-compat/import-inventory.json`.

| Área | Uso PAY0 / cambio necesario | Estado |
|---|---|---|
| Node / TypeScript | Node 22 y TS 5.9.3 satisfacen mínimos 20.9 / 5.1 | Compatible por restricciones |
| Request APIs asíncronas | Sin imports `next/headers`; rutas dinámicas usan `useParams`, sin lectura síncrona de props servidor detectada | Sin migración identificada |
| Cache APIs | Sin import `next/cache`; no `revalidateTag` de un argumento | Sin migración identificada |
| Imágenes / metadata | Sin `next/image`, generadores sitemap/imágenes dinámicas ni slots paralelos; sí manifest estático | Sin migración identificada |
| Middleware / runtimeConfig | Sin middleware/proxy ni runtimeConfig en configuración | Sin migración identificada |
| Turbopack | No webpack custom; Next 16 cambia bundler predeterminado | Compilación real PASS |
| JSX TypeScript | `jsx: preserve` de la base es reemplazado automáticamente por `react-jsx` en la copia durante build16 | Cambio obligatorio confirmado; incluir en futuro patch revisado |
| Fuentes | Inter mediante `next/font/google` en layout | Build necesita resolver fuente; fallo de red no demuestra incompatibilidad |
| ESLint | No `next lint` ni `eslint-config-next` en manifest | No agregar ESLint 9/10 innecesariamente; build16 no realiza lint |
| React / navegación | Hooks cliente, Script y dynamic existentes | Build y humo anónimo real PASS; roles autenticados pendientes |
| Hosting | `firebase.json` conserva `source: "."` y `frameworksBackend` | Adaptador framework-aware no certificado para este candidato |

## Fuentes oficiales y límites

[Guía Next16](https://nextjs.org/docs/app/guides/upgrading/version-16): mínimos de runtime, bundler predeterminado, APIs removidas y cambios de lint. [Política de soporte](https://nextjs.org/support-policy): 16 es Active LTS y 15 Maintenance LTS al consultar. La evaluación se justifica por continuidad del soporte; no por una vulnerabilidad demostrada en 15.5.27.

[Firebase Hosting framework-aware](https://firebase.google.com/docs/hosting/frameworks/nextjs) sigue descrito como preview y cerrado a nuevos participantes. La documentación de [App Hosting](https://firebase.google.com/docs/app-hosting/frameworks-tooling) corresponde a otro producto: no acredita el adaptador usado por este repositorio. No modificar infraestructura dentro de esta evaluación.

## Verificación

Instalación exacta del lock candidato con `npm ci --ignore-scripts --no-audit --no-fund`, cache local y ejecución elevada: PASS, 457 paquetes. `npm audit --package-lock-only --ignore-scripts --json`: cero vulnerabilidades. Node real: 22.23.2. Guards del checkout activo: autorización PASS y tecnología `LOCAL_CONTRACT_PASSED`.

El primer build aislado falló porque la exportación selectiva omitía ocho JSON de `evals/` importados por el frontend. Se completó la copia desde el mismo commit, sin modificar esos JSON ni el código. Este fallo del montaje local no acredita una incompatibilidad de Next16. Segundo build: **PASS, exit 0**, Turbopack compiló en 9.1 s, TypeScript en 2.3 min y generación estática 46/46. No se modificó ningún TSX para lograrlo. Next cambió automáticamente JSX en el tsconfig de la copia.

Comparación con el manifest `.next` local activo: conserva las 57 rutas de referencia y agrega únicamente la ruta interna `/_global-error/page` (58 entradas). El contador de páginas estáticas cambia entre versiones y no implica pérdida de ruta. Esta comparación es local, no contra producción. Evidencia persistida: `output/next16-compat/verification.json` con hashes del candidato, BUILD_ID y manifest.

Manifest candidato SHA256: `ac97b6c47fa20ca73f28451980d17d2788a8a7572e3af4385d1c642256fdf58a`. Lock candidato: `4eda112926d4fb80865d12a41c6c0721cb4ba72fa5e57b3a69baf539cfbafad3`. El fixture `build-fixture.json` usa exclusivamente valores públicos de compilación y emuladores; `node build.cjs` invoca el binario local `next build`.

Runtime real: `node runtime-smoke.cjs` inicia Next16 en loopback y puerto efímero; Chromium sin credenciales y con bloqueo de toda red externa. PASS: login hidrata y permite editar el campo; `/dashboard`, `/usuarios` y `/wallet` redirigen a login; `/descarga/documento` sigue pública. Cero errores JavaScript, cero solicitudes externas y cero credenciales enviadas. El servidor se cierra al terminar. Evidencia: `runtime-verification.json`.

Cuatro pruebas UI adicionales PASS con copias de los componentes actuales y dependencias del candidato: Modal, DateScopeBar, UiSelect y confirmaciones de Clientes. Cubren teclado, foco, aislamiento entre modal/select, cierre y bloqueo durante operación, con anchos 320/390/768/1440 donde aplica. Evidencia: `component-verification.json`, con hashes de tests. Estas pruebas montan React 18 UMD con servicios sintéticos; no se presentan como ejecución del renderer interno Next16. El humo de rutas anterior sí usa el artefacto real Next16. Los componentes actuales copiados son posteriores a la base cb88 y no modifican ese artefacto compilado.

## Siguiente paquete propuesto

1. Si se decide integrar, portar únicamente el pin Next16.4.2, el delta de once entradas del lock y `jsx: react-jsx`. Mantener Node22, React18 y los guards actuales; su deprecación obliga a tratar este candidato como transición y planear React19 aparte. No activar React Compiler o Cache Components.
2. Repetir el build y las pruebas sobre el commit definitivo, añadir navegación con identidades sintéticas autenticadas para los roles relevantes y verificar las rutas públicas de firma/verificación sin datos reales. El humo anónimo no valida permisos de negocio.
3. Antes de publicación, probar el empaquetado con la versión exacta del adaptador Firebase usado y un preview autorizado. La evidencia actual no autoriza cambiar Hosting por App Hosting ni publicar un runtime no probado. Si se detecta una incompatibilidad real del bundler, comparar `--webpack` en aislado; no hay evidencia actual que requiera ese cambio.

No se ha publicado el candidato ni ejercido operaciones financieras reales. Manifests, locks, tsconfig y Next env del checkout activo permanecen intactos; sólo se añade este documento al repositorio.
