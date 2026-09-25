export const realtimeTools = [
  {
    type: "function",
    name: "get_authorized_capabilities",
    description: "Obtiene desde PAY0 las capacidades y modulos efectivos del usuario autenticado.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "get_system_catalog",
    description: "Obtiene desde PAY0 el catalogo real de sistemas y el acceso efectivo del usuario autenticado.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "count_clients_for_user",
    description: "Cuenta en PAY0 los clientes activos visibles para un usuario autorizado del mismo arbol. Usa el nombre, correo o UID en query. En PAY0, preguntas como 'cuantos usuarios tiene [persona]' significan cuantos clientes activos tiene asignados esa persona y siempre requieren esta herramienta.",
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
    name: "query_received_payments",
    description: "Consulta deterministicamente pagos PAY0 ordenados por la fecha canonica recibida. Usa LATEST para el ultimo, LIST para los ultimos hasta cinco y PREVIOUS para el inmediatamente anterior. Es lectura; nunca crea, concilia ni aplica pagos.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        operation: { type: "string", enum: ["LATEST", "LIST", "PREVIOUS"] },
        limit: { type: "integer", minimum: 1, maximum: 5 },
        before_payment_id: { type: "string", description: "Referencia opaca devuelta por una consulta anterior; omitir para usar el contexto seguro reciente." },
      }, required: ["operation"],
    },
  },
  {
    type: "function",
    name: "get_payment_details",
    description: "Obtiene monto, pagador registrado, estado y conciliacion de un pago ya resuelto usando su referencia opaca.",
    parameters: { type: "object", additionalProperties: false, properties: { payment_id: { type: "string" } }, required: ["payment_id"] },
  },
  {
    type: "function",
    name: "get_payment_complement_status",
    description: "Consulta el estado de complemento de pago para un folio PAY0 ya resuelto. Solo lectura; nunca solicita un REP.",
    parameters: { type: "object", additionalProperties: false, properties: { folio: { type: "string" } }, required: ["folio"] },
  },
  {
    type: "function",
    name: "get_recent_session_context",
    description: "Recupera el sistema, intencion y entidad segura recientes tras una reconexion. No devuelve secretos ni datos financieros completos.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
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
    description: "Delega exclusivamente una tarea cognitiva compleja o una consulta PAY0 que no cubran las herramientas deterministicas disponibles.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { request: { type: "string", description: "Solicitud completa del usuario en espanol." } },
      required: ["request"],
    },
  },
];

export const realtimeToolNames = realtimeTools.map(tool => tool.name);

export function delegationForRealtimeTool(name, args = {}) {
  if (name === "get_authorized_capabilities") return { request: "¿A qué tengo acceso?", toolName: "getAuthorizedCapabilities", toolInput: {} };
  if (name === "get_system_catalog") return { request: "¿Cuáles son los sistemas disponibles?", toolName: "getSystemCatalog", toolInput: {} };
  if (name === "count_clients_for_user") return { request: `¿Cuántos clientes tiene el usuario ${String(args.query || "").trim()}?`, toolName: "countClientsForUser", toolInput: { query: String(args.query || "").trim() } };
  if (name === "count_my_visible_clients") return { request: "¿Cuántos clientes activos puedo ver?", toolName: "countClientsForCurrentUser", toolInput: {} };
  if (name === "query_received_payments") {
    const operation = ["LATEST", "LIST", "PREVIOUS"].includes(args.operation) ? args.operation : "LATEST";
    return { request: operation === "PREVIOUS" ? "¿Y el pago recibido anterior?" : operation === "LIST" ? "Muéstrame los últimos pagos recibidos." : "¿Cuál fue el último pago recibido en PAY0?",
      toolName: "searchReceivedPagos", toolInput: { position: operation === "PREVIOUS" ? "PREVIOUS" : "LATEST", limit: operation === "LIST" ? Math.min(Math.max(Number(args.limit) || 5, 1), 5) : 1, ...(String(args.before_payment_id || "").trim() ? { beforePaymentId: String(args.before_payment_id).trim() } : {}) } };
  }
  if (name === "get_payment_details") return { request: "Dame los detalles del pago seleccionado.", toolName: "getPagoById", toolInput: { paymentId: String(args.payment_id || "").trim() } };
  if (name === "get_payment_complement_status") return { request: "¿Tiene complemento el pago seleccionado?", toolName: "getPaymentComplementStatus", toolInput: { folio: String(args.folio || "").trim() } };
  if (name === "get_recent_session_context") return { request: "Recupera el contexto reciente de esta sesión.", toolName: "getSessionContext", toolInput: {} };
  if (name === "explain_last_operation") return { request: "¿Qué bloqueó la consulta anterior?", toolName: "getLastOperationDiagnostic", toolInput: {} };
  if (name === "delegate_to_hugo_core") return { request: String(args.request || "").trim() };
  throw Error("UNKNOWN_REALTIME_TOOL");
}
