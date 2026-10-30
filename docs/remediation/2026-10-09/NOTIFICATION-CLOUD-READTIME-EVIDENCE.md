# Lectura historica cloud de cohorte sintetica

El gate phase2 termino con exit0 el2026-10-11, ejecucion88600:
`CLOUD_FIXED_READTIME_45MIN_VERIFIED`. Edad observada por el servidor y local:
48min. Se conservaron ancla y fixtures de la admision original; no hubo reseed.

- Proyecto/base aislados: `pay0-sentinel-observe/sentinel-observation`.
- Ancla servidor: `2026-10-11T01:16:09.846Z`.
- Ventana permitida:45min inclusivos a50min exclusivos.
- SDK `@google-cloud/firestore`7.11.6, transacciones publicas readOnly/readTime.
- Fase2:10 entradas SDK y5RunQuery, comparacion de cohorte historica y actual.
- Limpieza: cinco deletes con updateTime esperado, seis nombres verificados
  ausentes; `REMOVED_VERIFIED`, uncertain=false, grpcCode=null.
- Receipt final CLEANED, sin lock ni .new al verificar localmente.

## Pins y preservacion

Coordinador SHA256:
`b9200a1da8f957702e972317bcfe15a69c4861d6a029a1ef20daff5e6d117075`.
Helper cloud:
`ed51b0849f655fcf8ee0b9ad3bbcae757eb943a12f5f79637c872413609f1a91`.
Receipt anterior WAITING_PHASE2, preservado antes de ejecutar:
`438c6b932678164057f181d4df7a720992294f77ed597f8e12a934f7b68f916f`.
Receipt final:
`fc7eb4767d5603474305d61ed5ce3753b5fc9ae409ce0d39f115d2c6bb2f6247`.

Evidencia privada en `.firebase/notification-cohort-readtime/`; no tokens,
payloads productivos ni credenciales se incorporan al repositorio. Autenticacion
capturada en memoria por el coordinador y pasada por stdin. Destino de transporte
limitado a Firestore TLS y nombres exactos del fixture para lecturas/escrituras.

## Limites y fallos previos

Esta prueba acredita el escenario sintetico observado a48min, no el limite
exacto50min ni operacion productiva del notificador. No activa tareas, mensajes
Telegram, autoridad financiera ni el nuevo adaptador. CLEANED solo no demuestra
retencion: la evidencia incluye invocacion phase2 y comparaciones exitosas.

Se preservan dos fallos anteriores: rechazo local del TCP path null antes de
operaciones SDK, corregido sin ampliar destino; y fallo al persistir ANCHOR tras
crear cinco fixtures. Este segundo tiene causa no demostrada. Se concilio con
seis lecturas exactas antes de promover el recibo local y continuar con la misma
ancla. No se atribuye a antivirus ni a un defecto general de Windows. Recibos,
helper original y detalle de recuperacion permanecen preservados privadamente.

Siguiente lote: admision/outbox inertes, despues dispatcher y entrega con fences,
revalidacion de autoridad y tratamiento de resultados inciertos. La prueba cloud
resuelve su prerrequisito de retencion; no sustituye esos contratos ni sus gates.
