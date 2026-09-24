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
    description: "Cuenta en PAY0 los clientes activos visibles para un usuario autorizado del mismo arbol. Usa el nombre, correo o UID en query. Si el usuario dice usuarios cuando parece referirse a clientes asignados, usa esta herramienta; si el significado es ambiguo, pide aclaracion.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "Nombre, correo o UID del usuario." } },
      required: ["query"],
    },
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
  if (name === "delegate_to_hugo_core") return { request: String(args.request || "").trim() };
  throw Error("UNKNOWN_REALTIME_TOOL");
}
