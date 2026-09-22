export const HUGO_READ_TOOLS = {
  getSolicitud: { description: "Consulta una solicitud por folio", input: "folio", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  searchSolicitudes: { description: "Muestra solicitudes recientes", input: "limit", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getPago: { description: "Consulta un pago por folio", input: "folio", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  searchPagos: { description: "Muestra pagos recientes", input: "limit", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getPaymentComplementStatus: { description: "Muestra seguimiento de complementos", input: "folio?", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getPay0OperationalSummary: { description: "Resumen limitado de operaciones", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
  getIqCapabilities: { description: "Estado de capacidades IQ", input: "none", output: "Pay0ToolResult", owner: "PAY0", permission: "READ", sideEffect: "NONE" },
} as const;
export type HugoToolName = keyof typeof HUGO_READ_TOOLS;
export type ToolResult = { sourceSystem: string; tool: string; retrievedAt: string; scope: { rootId: string }; completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN"; evidence: Array<{ entityType: string; entityId: string; kind: string; sourceSystem: string; completeness: string }>; data: any; trace: { latencyMs: number; result: string; error?: string } };
export type ToolIdentity = { uid: string; rootId: string; role: string };
export type ToolRequest = { name: HugoToolName; input?: { folio?: string; limit?: number } };

export class HugoToolRouter {
  constructor(private readonly identity: ToolIdentity, private readonly tools: Partial<Record<HugoToolName, (input: any) => Promise<ToolResult>>>, private readonly onResult?: (request: ToolRequest, result?: ToolResult, error?: unknown) => void) {
    if (!identity.uid || !identity.rootId || identity.role !== "superadmin") throw Error("HUGO_TOOL_UNAUTHORIZED");
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
    const allowedKeys = schema === "folio" || schema === "folio?" ? ["folio"] : schema === "limit" ? ["limit"] : [];
    if (Object.keys(input).some(key => !allowedKeys.includes(key)) || (input.folio !== undefined && !/^[SP][A-Z0-9]{5,19}$/.test(input.folio)) ||
      (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50))) throw Error("HUGO_TOOL_INVALID_INPUT");
    if (HUGO_READ_TOOLS[request.name].input === "folio" && !input.folio) throw Error("HUGO_TOOL_INVALID_INPUT");
    try {
      const result = await tool(input);
      if (result.scope.rootId !== this.identity.rootId || result.sourceSystem !== HUGO_READ_TOOLS[request.name].owner || result.tool !== request.name ||
        result.evidence.some(e => (e as any).scope?.rootId !== undefined && (e as any).scope.rootId !== this.identity.rootId)) throw Error("HUGO_TOOL_SCOPE_MISMATCH");
      this.onResult?.(request, result);
      return result;
    } catch (error) { this.onResult?.(request, undefined, error); throw error; }
  }
}
