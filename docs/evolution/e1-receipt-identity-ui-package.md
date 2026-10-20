# Comprobantes: selección explícita de identidad autorizada

Estado: **INTEGRATION_PENDING**. Fuente candidata aislada y QA específica verificadas; build canónico de entrega en curso, sin artefacto Hosting final ni autorización de publicación todavía.

La capacidad de selección ya existe en la rama integrada, pero falta en la UI productiva. La base de esta entrega es la fuente publicada `28924fbb31675a09ac5be35662f28731a163e146`, Hosting `18cb9743dfc01c50` y SSR `00612-yuq`, ZIP `39e008804f66f1a01fb580102c898b146a8d55c403f84775cceb32af9f7ec218`. Se conserva esa fuente completa; no se copia la página acumulativa de raíz, cuyo diff contiene cambios ajenos de autoregistro y edición.

## Delta acotado

Sólo `src/app/pagos/page.tsx` y `src/services/pagoReceipt.ts` cambian en el candidato privado `receipt-identity-ui-source`. Se portan las opciones de catálogo autorizadas devueltas por el servidor y los campos `selectedClientId`/`selectedCompanyId` del contrato existente. Ambos selectores permanecen disponibles incluso si el servidor identificó una coincidencia única; no se elige el primer candidato.

Commit privado `025b06e0aebd438ac1d23dd89c3ab5efc0690f97`, rama `fix/receipt-authorized-identity-selection-20261020`, checkout limpio antes del build. Su delta es de dos archivos: 36 líneas añadidas y 26 eliminadas. El contrato del wrapper ya existe en raíz; los cambios nuevos de raíz se limitan a navegación de selección/procedencia y conservación de los IDs en análisis inicial.

Cambiar una selección invalida la identificación READY anterior y sólo vuelve a analizar: no crea un pago por ese cambio. El botón existente de validación/registro sigue siendo una acción explícita en ese caso. Los demás caminos de autoregistro productivos se preservan. La creación utiliza únicamente `createPayload` autorizado por el servidor; no se inyectan los IDs elegidos en el payload financiero del navegador.

El par elegido se conserva y reenvía en análisis inicial, relectura, corrección y recuperación de duplicado/reintento. La corrección invalida el resultado de identidad anterior y adopta la identificación que devuelve el servidor. Una selección manual sólo se presenta como «seleccionado; acceso validado» cuando la evidencia servidor es `USER_SELECTED_AUTHORIZED_CATALOG_ENTRY`; no afirma que un RFC, cuenta o nombre OCR acreditó esa identidad.

## Pruebas y dependencia backend

QA específica: `qa/scripts/receipt-identity-ui-contract.test.cjs`, con override de fuente `PAY0_RECEIPT_IDENTITY_UI_ROOT`. Ejecuta wrappers reales con transporte sintético, handlers extraídos por AST y JSX real en Chromium: forwarding de ambos IDs, invalidación previa, parse sin creación, ausencia de primera opción automática, recuperación/corrección y distinción de procedencia manual. Esta prueba no certifica autorización productiva ni operaciones financieras.

Resultado: seis casos PASS tanto contra raíz como contra el candidato aislado. Los primeros intentos fallaron por delimitación textual del fixture, resolución de dependencias de esbuild bajo sandbox y comparación de una propiedad `undefined`; se corrigieron únicamente el fixture y su ejecución, sin rebajar aserciones del producto. Esos fallos no cuentan como PASS. La extracción final usa AST y la ejecución Chromium requiere el permiso de herramienta normal para resolver los paquetes locales. Logs finales: `output/receipt-identity-ui-root-tests.log` y `output/receipt-identity-ui-candidate-tests.log`.

El backend debe estar publicado y verificado con el contrato de catálogo activo autorizado, nombre exacto único y selección explícita validada en servidor. Los candidatos visibles no son autoridad: el servidor vuelve a validar usuario, raíz, permisos e IDs. Sin ese backend, no se ofrece esta UI como ciclo resuelto.

## Entrega y reversión pendientes

Se requiere congelar la fuente, un build canónico aislado, preparación del ZIP exacto, runtime nuevo y pruebas bajo emulador con los dos overrides QA históricos declarados. El helper de publicación no se modifica. Antes de preparar se recapturará metadata de Hosting/SSR/Run/IAM y cero operaciones activas, preservando la provenance publicada.

Una eventual publicación Hosting/SSR necesita autorización específica nueva. La reversión será sólo a la fuente/ZIP anteriores `28924fbb`/`39e00880`, mediante recibo propio y comprobación de estado exacto; conservará configuración, IAM, correcciones documentales y todas las capacidades de la UI anterior. No modifica backend, reglas, sesiones ni datos de negocio.
