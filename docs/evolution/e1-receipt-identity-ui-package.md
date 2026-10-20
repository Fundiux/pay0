# Comprobantes: selección explícita de identidad autorizada

Estado: **INTEGRATION_PENDING**. Fuente final congelada, QA y tipos verificados; build canónico de entrega en curso. Sin artefacto Hosting final ni autorización de publicación todavía.

La capacidad de selección ya existe en la rama integrada, pero falta en la UI productiva. La base de esta entrega es la fuente publicada `28924fbb31675a09ac5be35662f28731a163e146`, Hosting `18cb9743dfc01c50` y SSR `00612-yuq`, ZIP `39e008804f66f1a01fb580102c898b146a8d55c403f84775cceb32af9f7ec218`. Se conserva esa fuente completa; no se copia la página acumulativa de raíz, cuyo diff contiene cambios ajenos de autoregistro y edición.

## Delta acotado

Sólo `src/app/pagos/page.tsx` y `src/services/pagoReceipt.ts` cambian en el candidato privado `receipt-identity-ui-source`. Se portan las opciones de catálogo autorizadas devueltas por el servidor y los campos `selectedClientId`/`selectedCompanyId` del contrato existente. Ambos selectores permanecen disponibles incluso si el servidor identificó una coincidencia única; no se elige el primer candidato.

Commit privado final `f1df4a2835e37db725897bd97a26475437d88637`, rama `fix/receipt-authorized-identity-selection-20261020`, checkout limpio antes del build. Su delta sigue limitado a dos archivos. Los selectores y campos de transporte reutilizan el contrato existente; se añaden únicamente compatibilidad de evidencias, revisión explícita y recuperación del comprobante ya registrado.

Cambiar una selección invalida la identificación READY anterior y sólo vuelve a analizar: no crea un pago por ese cambio. El auto previo se conserva cuando ambas identidades tienen RFC_EXACT o FULL_ACCOUNT_EXACT, sin marcadores de selección manual. Sobre LIVE6e0 se usan exclusivamente `evidence.client/company` e IDs de `createPayload` servidor cuando `verifiedMatches` está ausente; si la propiedad está presente, sólo se usan sus matches correspondientes y cualquier resultado incompleto queda cerrado.

Los nombres y elecciones manuales requieren el botón existente «Validar y registrar». Esa acción acepta los IDs elegidos o sugerencias del servidor con ID y nombre visibles, vuelve a consultar al servidor y sólo registra si la respuesta nueva es READY y contiene el payload canónico. No se elige el primer candidato ni se usa un createPayload nulo. El tipo/corrección y el callback de selección no crean pagos. La creación utiliza únicamente `createPayload` autorizado por el servidor; no se inyectan los IDs elegidos en el payload financiero del navegador.

El par elegido se conserva y reenvía en análisis inicial, relectura, corrección y recuperación de duplicado/reintento. La corrección invalida el resultado de identidad anterior y adopta la identificación que devuelve el servidor. Una selección manual sólo se presenta como «seleccionado; acceso validado» cuando la evidencia servidor es `USER_SELECTED_AUTHORIZED_CATALOG_ENTRY`; no afirma que un RFC, cuenta o nombre OCR acreditó esa identidad.

La recuperación de un pago existente se separa de crear uno nuevo: sólo REGISTERED, receiptPending exactamente true y un pagoId servidor no vacío permiten adjuntar al pago existente, sin llamar a createPago. Si el primer resultado REGISTERED devuelve DUPLICATE y opciones visibles, el panel ofrece «Revalidar y retomar comprobante»; primero envía los IDs explícitos y exige un receiptPending nuevo del servidor. No depende de SELECTION_REQUIRED, que esa respuesta REGISTERED no expone. Un pago completo que siga con pending false produce cero uploads y cero creaciones.

## Pruebas y dependencia backend

QA específica: `qa/scripts/receipt-identity-ui-contract.test.cjs`, con override de fuente `PAY0_RECEIPT_IDENTITY_UI_ROOT`. Ejecuta wrappers reales con transporte sintético, handlers extraídos por AST y JSX real en Chromium: forwarding de ambos IDs, invalidación previa, parse sin creación, ausencia de primera opción automática, recuperación/corrección y distinción de procedencia manual. Esta prueba no certifica autorización productiva ni operaciones financieras.

Resultado final: diez casos PASS tanto contra raíz como contra el candidato aislado, cero omisiones. Incluye auto fuerte legacy/nuevo, matches presentes incompletos, preview por nombre/manual, creación explícita después de revalidar IDs visibles, recuperación REGISTERED con upload único sin crear y duplicado completo sin efectos; Chromium muestra los selectores incluso en el caso REGISTERED con reason DUPLICATE. Los primeros intentos de fixture fallaron por delimitación textual, resolución de paquetes de esbuild bajo sandbox y comparación de una propiedad `undefined`; esos fallos no cuentan como PASS. La extracción final usa AST. Logs finales: `output/receipt-identity-ui-root-tests-final.log` y `output/receipt-identity-ui-candidate-tests-final.log`.

El primer build canónico histórico `025b06e0` terminó con `FRONTEND_BUILD_FAILED`: la compilación Next pasó, pero faltaban los tipos opcionales de los dos IDs en el lote inicial. Log conservado: `.firebase/modular-release/hosting-025b06e0aebd-7f654752-8a53-4656-a0d7-9ea5ba9cd065/build.log`; no es PASS ni produjo un input. La fuente siguiente `17f1856` quedó SUPERSEDED y su build fue detenido únicamente tras verificar el entrypoint y la ancestría de sus tres procesos privados; prueba `output/receipt-identity-ui/cancelled-17f-build-process-proof.json`. No se borraron locks, sesiones o evidencia.

El preflight de tipos también detectó un import omitido en el port; se corrigió antes de otra instalación. La fuente final pasó `tsc --noEmit --incremental false` con las dependencias privadas y `.next/types` existentes: exit 0, log `output/receipt-identity-ui/typecheck-final-registered-review.log`. Es un preflight, no un recibo de build. Revisión independiente de Intel: PASS sobre fallback legacy, matches incompletos, selección explícita y recuperación. El build canónico literal de `f1df4a2` no omite npm ci ni ninguna guarda.

El backend final exige IDs explícitos autorizados para nombres sin corroboración fuerte: mantiene las sugerencias visibles, devuelve CLIENT_SELECTION_REQUIRED/COMPANY_SELECTION_REQUIRED y createPayload nulo hasta revalidar la selección. Esto protege también pestañas SSR612 antiguas ya abiertas; no basta depender de la UI nueva. Los candidatos visibles no son autoridad: el servidor vuelve a validar usuario, raíz, permisos e IDs. La UI es compatible con el auto fuerte de6e0 y con el contrato nuevo; el ciclo manual completo requiere ambos componentes publicados y verificados. Los artefactos backend anteriores sin esa guarda quedan fuera de esta entrega.

## Entrega y reversión pendientes

Se requiere congelar la fuente, un build canónico aislado, preparación del ZIP exacto, runtime nuevo y pruebas bajo emulador con los dos overrides QA históricos declarados. El helper de publicación no se modifica. Antes de preparar se recapturará metadata de Hosting/SSR/Run/IAM y cero operaciones activas, preservando la provenance publicada.

Una eventual publicación Hosting/SSR necesita autorización específica nueva. La reversión será sólo a la fuente/ZIP anteriores `28924fbb`/`39e00880`, mediante recibo propio y comprobación de estado exacto; conservará configuración, IAM, correcciones documentales y todas las capacidades de la UI anterior. No modifica backend, reglas, sesiones ni datos de negocio.
