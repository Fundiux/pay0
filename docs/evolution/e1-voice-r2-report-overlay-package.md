# B: overlay local de reportes R2 para voz

**Estado: LOCAL_CANDIDATE_PURE_TESTED_NOT_DEPLOY_READY.** No hay input, publicacion ni nueva imagen. No se ejecuto build Functions, npm, JVM, servicio, proveedor ni consulta cloud. Este candidato no incluye memoria durable ni correccion SESSION f328eea; no modifica gates.

## Identidad exacta

- Baseline archivada de voz R1.1: `delegatehugovoiceturn-00010-caj`, ZIP `f7407ccfd1fcfb8ccca950b8b7a731a5df0fc80ea6c91560ac3e90edac2f8c88`. Archivo privado `r1-token-usage-hotfix/delegateHugoVoiceTurn-token-usage-hotfix.zip`, ligado al snapshot local de publicacion ACTIVE. No es una captura fresca del estado actual.
- Fuente R2 reutilizada: `0a783d038393113b955029df7c940f54da203d3a`; padre `afe9ad2ad45233888d3f9f768e25dab16432089f`.
- ZIP candidato: `87cad026bb579bc614f9be75ccd036fbf4c6083b7bbe8866abadc45e6ad22d31`; ruta `.firebase/modular-release/voice-r2-report-overlay/voice-r2-report.zip`.
- Gateway compatible preparado: fuente `0a783d038393113b955029df7c940f54da203d3a`, ZIP `049e1ab1417551dfa52b0f01c37f2994768e3fe322698dd90b344dd66983be9c`. No construido como imagen.

Los cinco JS de la fuente padre coinciden exactamente con los de f740 mediante transpilacion del tsconfig vigente. No se copiaron fuentes actuales de chat ni se reconciliaron diferencias ajenas. Se emiten cinco TS: toolRouter cambia solo tipos y conserva su JS/map.

| Fuente exacta bajo functions/src/ | SHA256 |
| --- | --- |
| `modules/agent007/reportConnector.ts` | `ec028f6c825159ee32eb53b1595ee63ae459aa389994924b093111f7c74df53b` |
| `modules/agent007/hugoCore/reportSemantics.ts` | `764572c52edb5340bfadf35f39ea55eacc65fee8e15a4daa71ae789b17583660` |
| `modules/agent007/hugoCore/toolRouter.ts` | `d5d54c9f2874d5e247374a47895fabab5b3ead9d7d108061d4d238eda8b6fe20` |
| `modules/agent007/hugoCore/contextBuilderV2.ts` | `f8d72b8d76cdb050ba22a1a75c1c3ad7742b6090a7034c8e68ce6218c34e1f41` |
| `modules/agent007/hugoCore/conversationState.ts` | `e91485546a500206282db721f3e5c02da633c491e4a9951d02eee7249436b0c7` |

## Conservacion y cierre

El ZIP conserva 788 entradas: **8 JS/maps cambiados, 780 entradas identicas, cero altas y cero bajas**. No contiene .env. Los cambios runtime se limitan a reportConnector y hugoCore/reportSemantics, contextBuilderV2 y conversationState, con sus maps. Los ocho imports relativos de esos JS resuelven a entradas presentes. El helper toSafeMoneyNumber ya existe en la baseline.

Se comprobaron byte por byte los adaptadores openAiResponsesAdapter y vertexGeminiAdapter con la correccion R1.1; voiceDelegation, reports/callables y sharedCallables/helpers permanecen identicos. No se cambian exports, autenticacion, permisos ni formulas canonicas. La ruta de voz ya llamaba al handler autorizado; la extension reutiliza sus dos lecturas independientes para comparar periodos.

## Evidencia local acotada

- `manifest.json` SHA256 `f39cdf58138815a1dde667e51081d732c6daa496fb8b95c951b53cbe76218b2e`.
- `baseline-emit-check.json` SHA256 `8f0eb8f30a85b4f17b06971c061896e87985d16ee419025895d8bc97be97a21c`.
- `reproduce.py` SHA256 `3a0d32154053868005ac35a5dd74e815132a92932b591e9dfa9316986281d7e2`.
- `pure-contract.cjs` SHA256 `c61130ffd2780e5d58fdfec6d5d885f4e31be392cd0370e68d4f58b4aa623e1a`.

La receta privada `reproduce.py` fija f740 y el commit R2, lee los cinco TS exactos desde Git, verifica los cinco emisores padre, transpila solo esos modulos con TypeScript ya instalado y conserva el resto del ZIP. Reproduccion ejecutada en `.firebase/modular-release/voice-r2-report-overlay-reproduced`: el SHA del ZIP es exactamente el candidato anterior. No equivale a compilacion completa ni typecheck.

La prueba pura ejecuto los JS candidatos: comparo las 13 herramientas gateway previas contra 7dfcd8a y mantuvo su igualdad, con total 14; transporto ambos periodos mediante la herramienta adicional, ejecuto router y formateador reales, comprobo dos lecturas y diferencia sintetica, cuatro entradas invalidas y rechazo de cambio de root entre lecturas. **PASS local**, sin proveedor. El handler canonico y el helper monetario se sustituyeron deliberadamente por fakes; no acredita autorizacion real, reglas de Firestore ni ejecucion financiera.

## Pendientes antes de una propuesta ejecutable

- Typecheck y compilacion completa aislada, arranque desde package.main con identidad/exports y rechazo anonimo del callable exacto.
- Pruebas de handler real con autenticacion, perfil vigente, permisos y root; comparaciones y limites contra almacenamiento sintetico/emulado.
- Verificador canonico de dependencias y una captura propia fresca de fuente/configuracion/Run/IAM de delegateHugoVoiceTurn; despues, source identity/input/proofs y autorizacion especifica.
- Motor de imagen disponible y construccion con base/digest inmutables: docker, podman, nerdctl y buildctl no estaban disponibles localmente; Docker CLI estandar y servicio com.docker.service tampoco. No se instalaron ni iniciaron.
- La imagen gateway exige sus verificaciones y autorizacion propias; la configuracion build-only existente no se ejecuto. Chat R2 publicado no prueba la compatibilidad del callable de voz.

Orden futuro: certificar el callable de voz y solicitar autorizacion; luego certificar imagen gateway y su propuesta de trafico. Reversion del callable contra f740 y recibos propios, previa comprobacion del estado vigente. Preservar la imagen gateway anterior documentada hasta capturar su estado fresco; no usar una etiqueta historica como autorizacion. No borrar memorias ni activar reglas.

La memoria personal durable por voz sigue INCOMPLETE: el seam59a3 gate OFF no conecta confirmacion, persistencia y recuperacion entre sesiones. Este paquete de reportes no declara cerrado ese frente.
