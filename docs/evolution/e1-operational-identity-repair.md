# Corrección de consultas operativas y confirmación documental

Estado: IMPLEMENTED_VALIDATION_PENDING. Sin publicación ni autorización productiva para estos nuevos bytes. La respuesta del usuario no verifica el ciclo de aprendizaje: «parece que sí» no acredita guardado y relectura.

## Fallos reproducidos

- «Último cliente en hacer una solicitud» no coincidía con la expresión contigua «última solicitud». Un pago activo podía contaminar la respuesta a una pregunta explícita sobre solicitudes.
- El contexto descartaba el nombre de cliente resuelto por el conector. La respuesta podía usar un pagador o remitente OCR para contestar una pregunta sobre clientes.
- La lectura OCR del remitente se elevaba a pagador confirmado. El nombre del cliente no siempre se consultaba por su identificador canónico y su raíz.
- La solicitud no exponía su método PPD/PUE al contexto. Importes ausentes podían convertirse en cero.
- La respuesta generativa no indicaba el panel real para leer comprobantes.
- La pantalla documental no comprobaba suficientemente la versión y evidencia del acuse ni distinguía guardado de relectura verificada.

## Cambio implementado

El enrutamiento prioriza el dominio explícito del turno y resuelve la solicitud ordenada como entidad activa. Las preguntas posteriores sobre el nombre consultan la misma operación; un cambio explícito a solicitud no reutiliza el pago anterior. Las objeciones sobre banco/remitente consultan el pago activo y distinguen esas identidades del cliente sin delegar esa afirmación al modelo.

El conector conserva el aislamiento superadmin/root existente. Resuelve el cliente por ID dentro de la raíz; un ID ajeno, inválido o inexistente no permite rescatar un nombre de snapshot que podría ser engañoso. Sin ID puede usar el nombre registrado en la propia operación, con procedencia explícita. Pagador confirmado, remitente detectado y banco permanecen separados. PPD/PUE procede sólo del campo canónico `tipoFactura`; no se infiere del estado. Cero sigue siendo cero; un importe ausente o inválido queda desconocido.

La respuesta de solicitud presenta cliente, método e importe verificados juntos. Una consulta sobre nombres de clientes no enumera bancos o pagadores como clientes. La respuesta de ubicación apunta a `/hugo` → «Revisar un comprobante con María», con los formatos/límite vigentes y acceso sujeto a la sesión autorizada.

Se preservan los nodos `semanticReceipt` y `comprobante` exclusivos de la fuente productiva del conector. El emisor del parche verifica la diferencia AST específica frente a la rama y no sustituye el módulo perdiendo esos campos. No se reconstruyen reportes ni se cambian cálculos, fechas/cursor de pagos, permisos, reglas globales o voz.

La UI documental exige acuse real del análisis, ID de corrección, siguiente versión y campo `HUMAN_CORRECTION`. Muestra campo/valor/versión confirmados y separa ese estado de la comprobación al volver a analizar. Una relectura que pierde la corrección muestra una alerta, no «verificado».

## Validación y entrega

- Fuente: nueve escenarios de routing/Core, siete de frontera de datos y cinco de presentación/procedencia; fixtures sintéticas, sin proveedores ni datos productivos.
- UI documental: doce pruebas de transporte/componente y build Next de 47 rutas PASS; fuente `65accf31e98992939e8e51e4951377749e547251`.
- Política de autorización: PASS, sin cambios de roles ni reglas.
- Builds NORMAL anteriores y comparación de seis emisores pasaron antes de los últimos guardas de banco y recuperación de comprobante. No se atribuyen a la fuente final. Build final y comparación posterior pendientes.
- Receta de overlay preparada sobre ZIP productivo chat `22cbdbd9`, con seis módulos permitidos y preservación del resto. Aún no hay artefacto final aprobado para publicar.
- UI aislada de confirmación: fuente privada `28924fb` sobre la interfaz productiva `3b6602d`, sólo un componente de producto. Instalación propia cancelada deliberadamente para serializar carga; logs y archivos parciales preservados. No es un build aprobado ni una regresión de producto demostrada.

La publicación requerirá paquete exacto, pruebas del ZIP, bases productivas frescas, identidad y reversión. Las aprobaciones anteriores de aprendizaje personal no cubren estos artefactos. El backend y la UI pueden prepararse como paquetes independientes; ninguno se declara COMPLETED sin publicación y comprobación real.
