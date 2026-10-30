# Reconciliacion de la actualizacion de notas

Estado: la operacion remota termino; el launcher fallo su validacion de
respuesta. No se repite la mutacion ni se modifica el receipt historico.

El candidato integrado a52959b y Execute33777 enviaron un solo UPDATE.
La operacion `operation-1791701277259-65d8af62cb6f7-78339efc-00d901df`
termino con done:true, sin error, revision `listclientdispersionnotes-00002-lah`
y source generation1791701277897589. GET independiente c35bfa conserva la
respuesta privada con SHA68235e34465de7fc7b4d3f0fb72fb6b73aa63ae6744d783f544d32995d422812.
El receipt termina en UPDATE_ACCEPTED, siete estados. El proceso salio1 a
06:49:21Z por API_MAX_OVERRIDE; dotenv restaurado y arbol limpio comprobados.

Root reprodujo offline ese rechazo usando la respuesta real fijada por hash
y el assertApi original (ad3b1a). La validacion de envio prohibe un override
maxInstanceCount, pero la respuesta contiene20. Reutilizar esa misma
validacion para la respuesta no admite esta diferencia. No se relaja el
guard historico ni se convierte su resultado en PASS retrospectivo.

## Fuente desplegada

Fetch31583 fallo sin conservar metadata/ZIP; causa no determinada. El parser
de dotenv y expectedInputs completos pasaron offline1251. Se descarto una
hipotesis de escapes incorrectos. Una copia diagnostica conserva los checks,
endpoints y limites y agrega solamente fase/contador/codigos permitidos.

Fetch68631 con esa copia paso seis GET, sin mutaciones ni invocaciones.
El verifier original e68fbabcaffb39e012ee9123535b4ad5ac5856d101b1a5d257919c67c02a9f25
tambien paso localmente en32483 sobre los archivos fijados por hash.
ZIP exactamente1251 archivos: sin faltantes, extras o hashes diferentes,
CRC/limites/nombres validados. SHA del ZIP final:
`7c7da3c0d3358a714dfda8966436aa2a02f4924cf5713e0ba4714f4ff3c98183`.
Coincide con los bytes subidos; generation del objeto final difiere del
objeto temporal de subida, como queda registrado en los receipts privados.
Metadata SHA9d2771ae40672bcdc04e30965d174ee9777564e8d1902f269cd37f1134cde308.
Request local SHA7877ee53b97e3244cbf32b07bcf8a1ebb6a72670a8eb0b974ac260d0530ab717;
proof local SHA698b44ea05fcf92f40f597a4f9fbb10d753dcc29c5072e122f9a236b509124a9.

## Cambio de escala y alcance de evidencia

| Nivel | Antes | Despues |
|---|---|---|
| GCF | ausente | 20 |
| Servicio Run | 20 | 20 |
| Template Run | ausente | 20 |
| Revision Run | ausente | 20 |

El limite del servicio permanece20, con una sola revision al100%, sin tags.
La documentacion oficial indica que al combinar limites de servicio y
revision se aplica el menor. Por tanto, esta configuracion mantiene el
techo configurado de20 en este reparto de trafico; no significa que los
cuatro campos sean identicos ni garantiza un limite fisico absoluto durante
transitorios. [Cloud Run: limites combinados](https://docs.cloud.google.com/run/docs/configuring/max-instances#limits).

Comparacion rootad3b1a sobre metadata proyectada: todos los campos que
comprueba el guard original se preservan salvo los tres max explicitos.
Se comparo una copia local con solo esos tres campos normalizados; los
artefactos reales no fueron modificados. No es un PASS del gate historico.

La proyeccion historica omite campos del servicio y de la revision. Su
ausencia en ambos JSON no prueba preservacion. Se solicitan metadata
completas de funcion/servicio/revision nueva y revision anterior. Para
campos del servicio sin snapshot historico completo solo puede verificarse
su valor actual; esa limitacion debe conservarse en la evaluacion final.
Lectura completa de cuatro recursos PASS, SHA privado
4de5a9b9708ed433dfc3006a79f98778cce3069961a11e70c096d8c2091f27df.
Root20bdf8 reviso todas las rutas diferentes entre revisiones: identificadores,
etiquetas de despliegue, tiempos/condiciones, imagen, ubicacion de build y
escala. Recursos, env, probes, identidad y configuracion ejecutable restante
coinciden. Servicio actual: ingressALL, invokerIamDisabled/defaultUriDisabled
ausentes (false), customAudience exacta de la callable, trafico LATEST100.

Decision central: aceptar explicitamente20/20/20/20 como nueva configuracion
revisada, conservando las limitaciones anteriores y el fallo historico. Esto
permite preparar Hosting sin otra actualizacion de notas. Input de Hosting
nuevo y preflight/stage locales autorizados; Execute aun no iniciado.
