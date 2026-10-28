// General read tools: the model picks filters; identity, rootId and read-only scope stay server-side.
const ORDEN = ["RECIENTES", "ANTIGUAS", "MONTO_DESC", "MONTO_ASC"], PERSON_TYPES = ["USUARIO", "CLIENTE", "EMPRESA", "TODOS"], MAX_TEXT = 120;
const str = description => ({ type: "string", maxLength: MAX_TEXT, description });
const num = description => ({ type: "number", minimum: 0, description });
const rangeProps = {
  desde: { type: "string", description: "Primer día incluido, AAAA-MM-DD en hora de Ciudad de México. Resuelve tú hoy, ayer, este mes o la semana pasada con la fecha de las instrucciones." },
  hasta: { type: "string", description: "Último día incluido, AAAA-MM-DD en hora de Ciudad de México." },
  monto: num("Monto exacto en pesos, por ejemplo 7540 para 'de 7,540 pesos'."), montoMin: num("Monto mínimo en pesos."), montoMax: num("Monto máximo en pesos."),
};
const listProps = {
  orden: { type: "string", enum: ORDEN, description: "RECIENTES por defecto; MONTO_DESC para 'la más grande'." },
  limite: { type: "integer", minimum: 1, maximum: 20, description: "Cuántos elementos devolver; 5 por defecto." },
  soloConteo: { type: "boolean", description: "true para '¿cuántas?' o '¿cuánto suman?': devuelve total y montoTotal sin lista." },
};
const objectSchema = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const readTools = [
  { type: "function", name: "buscar_solicitudes",
    description: "Busca y cuenta Solicitudes PAY0 visibles con cualquier combinación de filtros. Úsala para la última o las últimas solicitudes, '¿cuántas?', 'hoy', 'la semana pasada', 'de 7,540 pesos', por estado, factura o folio, 'del cliente X con la empresa/proveedor Y' o 'las que creó Z'. empresa es la empresa de PAY0 que factura; el usuario también le dice proveedor. Pasa los nombres como se escucharon. Devuelve total real, montoTotal, items con id e interpretacion de nombres aproximados. Sólo lectura.",
    parameters: objectSchema({ folio: str("Folio exacto o como se dictó."), cliente: str("Cliente como lo dijo el usuario."), empresa: str("Empresa de PAY0 que factura (proveedor)."),
      creadoPor: str("Usuario de PAY0 que la creó: nombre, usuario o correo."), estado: str("Estado como se dijo, por ejemplo rechazada o procesando."), factura: str("Folio, serie o fragmento de UUID de la factura."),
      ...rangeProps, ...listProps }) },
  { type: "function", name: "ver_solicitud",
    description: "Detalle completo de UNA solicitud: monto, subtotal, estado, motivo de rechazo, factura, OC con partidas, cotización, documentos y pagos relacionados. Úsala para detalles, monto, estado, OC, cotización o documentos de una solicitud ya mencionada, pasando el id devuelto antes ('esa', 'la anterior', 'su OC', 'analiza la OC'); usa folio sólo si el usuario lo dicta. Sólo lectura.",
    parameters: objectSchema({ id: str("id devuelto por buscar_solicitudes o ver_solicitud en esta conversación."), folio: str("Folio dictado por el usuario si no hay id.") }) },
  { type: "function", name: "buscar_pagos",
    description: "Busca y cuenta pagos recibidos en PAY0 con cualquier combinación de filtros: último o últimos pagos, '¿cuántos?', fechas, monto, cliente, empresa/proveedor que lo recibió, pagador, quién lo registró, estado, folio o si está conciliado. Para monto, pagador o conciliación de un pago ya mencionado vuelve a llamarla con su folio. Úsala sólo si el usuario habla de pagos; 'movimiento' o 'actividad' ambiguos no son pagos. Sólo lectura; nunca concilia ni aplica.",
    parameters: objectSchema({ folio: str("Folio del pago, devuelto antes o dictado."), cliente: str("Cliente como se dijo."), empresa: str("Empresa de PAY0 que recibió el pago (proveedor)."),
      pagador: str("Quién pagó, como se dijo."), creadoPor: str("Usuario de PAY0 que lo registró."), estado: str("Estado como se dijo."),
      conciliado: { type: "boolean", description: "true sólo conciliados; false sólo pendientes de conciliar." }, ...rangeProps, ...listProps }) },
  { type: "function", name: "buscar_personas",
    description: "Resuelve un nombre dicho por voz a usuarios, clientes o empresas de PAY0 visibles, con su confianza. Úsala cuando no sepas si un nombre es cliente, empresa o usuario, o cuando una búsqueda no encontró un nombre y quieres las coincidencias más cercanas. Sólo lectura.",
    parameters: objectSchema({ texto: str("Nombre, usuario o correo tal como se dijo."), tipo: { type: "string", enum: PERSON_TYPES, description: "TODOS por defecto." },
      limite: { type: "integer", minimum: 1, maximum: 20, description: "5 por defecto." } }, ["texto"]) },
];
const READ_TOOL_MAP = {
  buscar_solicitudes: ["findSolicitudes", "Buscar solicitudes con filtros.", ["folio", "cliente", "empresa", "creadoPor", "estado", "factura"]],
  ver_solicitud: ["getSolicitudDetail", "Ver el detalle de una solicitud.", ["id", "folio"]],
  buscar_pagos: ["findPagos", "Buscar pagos con filtros.", ["folio", "cliente", "empresa", "pagador", "creadoPor", "estado"]],
  buscar_personas: ["findPeople", "Buscar usuarios, clientes o empresas por nombre.", ["texto"]],
};
const cleanText = value => typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
const cleanDate = value => { const text = typeof value === "string" ? value.trim() : ""; return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text) ? text : undefined; };
const cleanAmount = value => { const amount = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : value; return typeof value !== "boolean" && value !== "" && typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : undefined; };
const cleanLimit = value => { const limit = Math.trunc(Number(value)); return value === undefined || value === null || value === "" || typeof value === "boolean" || !Number.isFinite(limit) ? undefined : Math.min(Math.max(limit, 1), 20); };

// Copies only whitelisted keys with type coercion and bounds; uid, rootId or any other model-supplied key is dropped.
export function readToolInput(name, args = {}) {
  const source = args && typeof args === "object" ? args : {}, input = {};
  for (const key of READ_TOOL_MAP[name][2]) { const value = cleanText(source[key]); if (value) input[key] = value; }
  if (name === "ver_solicitud") { if (!input.id && !input.folio) throw Error("INVALID_TOOL_INPUT"); return input; }
  const limite = cleanLimit(source.limite);
  if (name === "buscar_personas") {
    if (!input.texto) throw Error("INVALID_TOOL_INPUT");
    if (PERSON_TYPES.includes(source.tipo)) input.tipo = source.tipo;
    if (limite !== undefined) input.limite = limite;
    return input;
  }
  for (const key of ["desde", "hasta"]) { const value = cleanDate(source[key]); if (value) input[key] = value; }
  for (const key of ["monto", "montoMin", "montoMax"]) { const value = cleanAmount(source[key]); if (value !== undefined) input[key] = value; }
  if (ORDEN.includes(source.orden)) input.orden = source.orden;
  if (limite !== undefined) input.limite = limite;
  if (typeof source.soloConteo === "boolean") input.soloConteo = source.soloConteo;
  if (name === "buscar_pagos" && typeof source.conciliado === "boolean") input.conciliado = source.conciliado;
  return input;
}

export const realtimeTools = [
  ...readTools,
  { type: "function", name: "get_earnings_by_client_report",
    description: "Consulta el reporte canónico de utilidades por cliente. Pide fechas explícitas antes de usarla; sólo lectura, alcance de la sesión autenticada. Devuelve resumen y hasta 25 clientes, con advertencia si se alcanza el límite.",
    parameters: { type: "object", additionalProperties: false, properties: { dateFrom: { type: "string", description: "Fecha inicial AAAA-MM-DD." }, dateTo: { type: "string", description: "Fecha final AAAA-MM-DD." }, compareDateFrom: { type: "string", description: "Inicio del periodo a comparar AAAA-MM-DD; requiere compareDateTo." }, compareDateTo: { type: "string", description: "Fin del periodo a comparar AAAA-MM-DD; requiere compareDateFrom." }, includeCompensated: { type: "boolean", description: "Incluir operaciones compensadas sólo si el usuario lo pide explícitamente; false por defecto." }, limit: { type: "integer", minimum: 1, maximum: 5000 } }, required: ["dateFrom", "dateTo"] }
  },
  {
    type: "function",
    name: "get_authorized_capabilities",
    description: "Obtiene desde PAY0 las capacidades y modulos efectivos del usuario autenticado.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "get_system_catalog",
    description: "Obtiene desde PAY0 el catalogo real de sistemas, su conectividad y el acceso efectivo. Usala para preguntas sobre PAY0, HUGO, ASSETS o TTT.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "count_clients_for_user",
    description: "Cuenta en PAY0 los clientes activos visibles para un usuario autorizado del mismo arbol. Usa nombre o correo. Para yo, mi usuario o mi cuenta usa count_my_visible_clients. Si una variante fonetica apunta al usuario actual, confirma antes de contar.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "Nombre, correo o UID del usuario." } },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "count_my_visible_clients",
    description: "Cuenta los clientes activos visibles del usuario autenticado actual. Usa esta herramienta para 'mis clientes', 'los que puedo ver', 'mi usuario' o 'esta sesion'; no busques su nombre.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "get_payment_complement_status",
    description: "Consulta el estado de complemento de pago para un folio PAY0 ya resuelto. Solo lectura; nunca solicita un REP.",
    parameters: { type: "object", additionalProperties: false, properties: { folio: { type: "string" } }, required: ["folio"] },
  },
  {
    type: "function",
    name: "explain_last_operation",
    description: "Explica de forma segura la ultima consulta: capability, autorizacion, disponibilidad, categoria de error y si se puede reintentar.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "delegate_to_hugo_core",
    description: "Delega una consulta PAY0 no cubierta. Delega siempre 'ultimo movimiento' o 'ultima actividad' sin dominio para que Hugo Core pida aclarar pago, solicitud, dispersion o actividad operativa; no asumas pagos.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { request: { type: "string", description: "Solicitud completa del usuario en espanol." } },
      required: ["request"],
    },
  },
  { type: "function", name: "correct_current_voice_response",
    description: "Guarda una corrección explícita que el usuario acaba de dictar sobre la respuesta anterior de esta sesión. No crea reglas globales ni cambia datos. Sólo confirma que quedó guardada si la herramienta devuelve persisted true.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } },
  ...[
    ["request_voice_topic_memory", "Solicita recordar la última corrección de sesión para el tema exacto declarado por el usuario. Requiere que diga Recuerda esta indicación para el tema: seguido de la etiqueta. No recibe texto del modelo ni guarda todavía memoria durable."],
    ["confirm_voice_topic_memory", "Confirma únicamente el challenge pendiente cuando el usuario dicta la frase exacta de confirmationText. No interpretes un sí aislado. Sólo anuncia guardado durable tras durablePersisted true."],
    ["select_voice_memory_topic", "Selecciona el tema privado declarado por el usuario con Usa el tema: seguido de etiqueta exacta. No infiere clientes, hechos ni permisos."],
    ["clear_voice_memory_topic", "Quita el tema de esta sesión sólo cuando el usuario dice Quita el tema activo. No borra recuerdos."],
    ["retire_current_voice_topic_memory", "Retira únicamente la indicación que se guardó para un tema en este socket, con declaración exacta Retira la indicación del tema: seguida de la etiqueta. No acepta IDs del modelo."],
  ].map(([name, description]) => ({ type: "function", name, description,
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } })),
];

export const realtimeToolNames = realtimeTools.map(tool => tool.name);

export function delegationForRealtimeTool(name, args = {}) {
  if (Object.hasOwn(READ_TOOL_MAP, name)) { const [toolName, request] = READ_TOOL_MAP[name]; return { request, toolName, toolInput: readToolInput(name, args) }; }
  const topicActions = { request_voice_topic_memory: "REQUEST", confirm_voice_topic_memory: "CONFIRM", select_voice_memory_topic: "SELECT",
    clear_voice_memory_topic: "CLEAR", retire_current_voice_topic_memory: "RETIRE" };
  if (Object.hasOwn(topicActions, name)) return { request: "Procesar la declaración privada del tema observado en esta sesión.", voiceTopicAction: topicActions[name] };
  if (name === "correct_current_voice_response") return { request: "Registrar la corrección explícita del turno de voz.", recordResponseCorrection: true };
  if (name === "get_earnings_by_client_report") return { request: "Consulta el reporte de utilidades por cliente.", toolName: "getEarningsByClientReport", toolInput: { dateFrom: args.dateFrom, dateTo: args.dateTo, limit: args.limit ?? 5000, ...(args.includeCompensated !== undefined ? { includeCompensated: args.includeCompensated } : {}), ...(args.compareDateFrom !== undefined ? { compareDateFrom: args.compareDateFrom } : {}), ...(args.compareDateTo !== undefined ? { compareDateTo: args.compareDateTo } : {}) } };
  if (name === "get_authorized_capabilities") return { request: "¿A qué tengo acceso?", toolName: "getAuthorizedCapabilities", toolInput: {} };
  if (name === "get_system_catalog") return { request: "¿Cuáles son los sistemas disponibles?", toolName: "getSystemCatalog", toolInput: {} };
  if (name === "count_clients_for_user") return { request: `¿Cuántos clientes tiene el usuario ${String(args.query || "").trim()}?`, toolName: "countClientsForUser", toolInput: { query: String(args.query || "").trim() } };
  if (name === "count_my_visible_clients") return { request: "¿Cuántos clientes activos puedo ver?", toolName: "countClientsForCurrentUser", toolInput: {} };
  if (name === "get_payment_complement_status") return { request: "¿Tiene complemento el pago seleccionado?", toolName: "getPaymentComplementStatus", toolInput: { folio: String(args.folio || "").trim() } };
  if (name === "explain_last_operation") return { request: "¿Qué bloqueó la consulta anterior?", toolName: "getLastOperationDiagnostic", toolInput: {} };
  if (name === "delegate_to_hugo_core") return { request: String(args.request || "").trim() };
  throw Error("UNKNOWN_REALTIME_TOOL");
}
