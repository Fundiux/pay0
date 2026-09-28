export const HUGO_READ_TOOLS = {
  getSolicitud: { description: "Consulta una solicitud por folio", input: "folio", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  searchSolicitudes: { description: "Muestra solicitudes recientes", input: "limit", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getLatestSolicitud: { description: "Obtiene la solicitud mas reciente por createdAt dentro de la raiz autorizada", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getPago: { description: "Consulta un pago por folio", input: "folio", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  searchPagos: { description: "Muestra pagos recientes", input: "limit", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  searchReceivedPagos: { description: "Consulta pagos por fecha canónica de recepción", input: "receivedPaymentQuery", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getPagoById: { description: "Consulta un pago por referencia interna autorizada", input: "paymentId", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getPaymentComplementStatus: { description: "Muestra seguimiento de complementos", input: "folio?", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getPay0OperationalSummary: { description: "Resumen limitado de operaciones", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getIqCapabilities: { description: "Estado de capacidades IQ", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getAuthorizedCapabilities: { description: "Capacidades efectivas del usuario actual", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getSystemCatalog: { description: "Sistemas registrados y acceso efectivo", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  countClientsForUser: { description: "Cuenta clientes visibles de un usuario autorizado del mismo arbol", input: "query", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getLatestSolicitudForUser: { description: "Busca solicitudes creadas por un usuario visible dentro del alcance autorizado", input: "creatorQuery", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getLatestPagoForUser: { description: "Busca pagos creados por un usuario visible dentro del alcance autorizado", input: "creatorQuery", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  countClientsForCurrentUser: { description: "Cuenta clientes activos visibles del usuario autenticado", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getSessionContext: { description: "Recupera contexto conversacional reciente y seguro de la sesion autenticada", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getLastOperationDiagnostic: { description: "Explica de forma sanitizada el ultimo intento operativo", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
} as const;
export type HugoToolName = keyof typeof HUGO_READ_TOOLS;
export type ToolResult = { sourceSystem: string; tool: string; retrievedAt: string; scope: { rootId: string }; completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN"; evidence: Array<{ entityType: string; entityId: string; kind: string; sourceSystem: string; completeness: string }>; data: any; trace: { latencyMs: number; result: string; error?: string } };
export type ToolIdentity = { uid: string; rootId: string; role: string };
export type ToolRequest = { name: HugoToolName; input?: { folio?: string; limit?: number; query?: string; paymentId?: string; beforePaymentId?: string; position?: "LATEST" | "PREVIOUS"; period?: "ALL" | "TODAY" | "YESTERDAY" | "THIS_WEEK" | "PREVIOUS_WEEK" | "THIS_MONTH" | "PREVIOUS_MONTH" } };

export class HugoToolRouter {
  constructor(private readonly identity: ToolIdentity, private readonly tools: Partial<Record<HugoToolName, (input: any) => Promise<ToolResult>>>, private readonly onResult?: (request: ToolRequest, result?: ToolResult, error?: unknown) => void) {
    if (!identity.uid || !identity.rootId || !["superadmin", "admin", "operador"].includes(identity.role)) throw Error("HUGO_TOOL_UNAUTHORIZED");
  }
  assertIdentity(identity: ToolIdentity) {
    if (identity.uid !== this.identity.uid || identity.rootId !== this.identity.rootId || identity.role !== this.identity.role) throw Error("HUGO_TOOL_IDENTITY_MISMATCH");
  }
  async execute(request: ToolRequest): Promise<ToolResult> {
    if (!Object.prototype.hasOwnProperty.call(HUGO_READ_TOOLS, request.name)) throw Error("HUGO_TOOL_UNKNOWN");
    const tool = this.tools[request.name];
    if (!tool) throw Error("HUGO_TOOL_NOT_ALLOWED");
    const input = request.input || {};
    const schema = HUGO_READ_TOOLS[request.name].input;
    const allowedKeys = schema === "folio" || schema === "folio?" ? ["folio"] : schema === "limit" ? ["limit"] : schema === "query" ? ["query"] : schema === "creatorQuery" ? ["query", "period", "limit"] : schema === "paymentId" ? ["paymentId"] : schema === "receivedPaymentQuery" ? ["limit", "beforePaymentId", "position"] : [];
    if (Object.keys(input).some(key => !allowedKeys.includes(key)) || (input.folio !== undefined && !/^[SP][A-Z0-9]{5,19}$/.test(input.folio)) ||
      (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)) ||
      (input.query !== undefined && (!String(input.query).trim() || String(input.query).length > 120)) ||
      (input.paymentId !== undefined && (!String(input.paymentId).trim() || String(input.paymentId).length > 160 || String(input.paymentId).includes("/"))) ||
      (input.beforePaymentId !== undefined && (!String(input.beforePaymentId).trim() || String(input.beforePaymentId).length > 160 || String(input.beforePaymentId).includes("/")))) throw Error("HUGO_TOOL_INVALID_INPUT");
    if (input.position !== undefined && !["LATEST", "PREVIOUS"].includes(input.position)) throw Error("HUGO_TOOL_INVALID_INPUT");
    if (input.period !== undefined && !["ALL", "TODAY", "YESTERDAY", "THIS_WEEK", "PREVIOUS_WEEK", "THIS_MONTH", "PREVIOUS_MONTH"].includes(input.period)) throw Error("HUGO_TOOL_INVALID_INPUT");
    if (HUGO_READ_TOOLS[request.name].input === "folio" && !input.folio) throw Error("HUGO_TOOL_INVALID_INPUT");
    if (HUGO_READ_TOOLS[request.name].input === "query" && !input.query) throw Error("HUGO_TOOL_INVALID_INPUT");
    if (HUGO_READ_TOOLS[request.name].input === "creatorQuery" && !input.query) throw Error("HUGO_TOOL_INVALID_INPUT");
    if (HUGO_READ_TOOLS[request.name].input === "paymentId" && !input.paymentId) throw Error("HUGO_TOOL_INVALID_INPUT");
    try {
      const result = await tool(input);
      if (result.scope.rootId !== this.identity.rootId || result.sourceSystem !== HUGO_READ_TOOLS[request.name].owner || result.tool !== request.name ||
        result.evidence.some(e => (e as any).scope?.rootId !== undefined && (e as any).scope.rootId !== this.identity.rootId)) throw Error("HUGO_TOOL_SCOPE_MISMATCH");
      this.onResult?.(request, result);
      return result;
    } catch (error) { this.onResult?.(request, undefined, error); throw error; }
  }
}
