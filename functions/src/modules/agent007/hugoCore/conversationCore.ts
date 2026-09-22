import { buildHugoContext, HugoMemory, RecentEntity } from "./contextBuilder";
import { HugoToolRouter, ToolRequest, ToolResult } from "./toolRouter";
import { HugoModelAdapter, ModelOutput } from "./modelContract";
import { HUGO_PROMPT_VERSION } from "./legacyPrompt";
import { HugoDataStore } from "./dataStoreContract";
import { ConversationState, normalizeConversationState } from "./conversationState";
import { buildHugoContextV2, isGlobalCountQuestion, canStateGlobalTotalForMessage, relevantEvidenceBoundaries, MemoryUsage } from "./contextBuilderV2";
import { HUGO_V2_CONFIG } from "./intelligenceConfig";
import { checkExhaustiveness } from "./exhaustivenessPolicy";

function fallbackReply(message: string, name: string, context: any): string {
  const normalized = message.toLocaleLowerCase("es-MX");
  if (/^(hola|buen(os|as)?\s+(dias|tardes|noches)|qué tal|que tal)[!.\s]*$/.test(normalized)) {
    return `Hola, ${name}. Estoy atento. Puedo revisar contigo solicitudes, pagos, facturación y las dudas que vaya detectando.`;
  }
  if (context.folioConsultado && context.solicitudes.length) {
    const item = context.solicitudes[0];
    const amount = Number(item.monto || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    return `Revisé ${item.folio}. Está en ${item.estado || "estado no especificado"}, por ${amount}${item.facturamaStatus ? ` y su estado fiscal es ${item.facturamaStatus}` : ""}. Si quieres, dime qué parte revisamos con más detalle.`;
  }
  if (/complement|beneficiari|dispersion|dispersión/.test(normalized)) {
    return `En el contexto reciente veo ${context.complementosPendientes.length} complementos pendientes. Consulta IQ: ${context.capacidadesIq.consultaComplemento}; nuevas solicitudes IQ: ${context.capacidadesIq.solicitudComplemento}; Facturama: ${context.capacidadesIq.complementoFacturama}. Cada caso requiere perfil, permisos y cuota vigentes. Registrar un pendiente no significa que el proveedor lo recibió. No he enviado ninguna operación desde este chat.`;
  }
  if (/qué (pasó|hiciste)|que (paso|hiciste)|resumen|último|ultimo/.test(normalized)) {
    return `Veo ${context.solicitudes.length} solicitudes recientes, ${context.pagos.length} pagos en el contexto actual y ${context.dudasPendientes.length} dudas pendientes. Puedo revisar un folio concreto si me lo indicas.`;
  }
  return `Entendido, ${name}. Guardé tu mensaje en esta conversación. Todavía no tengo evidencia suficiente para afirmarlo como una regla; cuando vea un caso relacionado te lo señalaré para que lo confirmemos.`;
}

export type ConversationInput = { channel: string; conversationId: string; identity: { uid: string; rootId: string; role: string }; name: string; message: string; history?: any[]; memory?: HugoMemory; recentEntities?: RecentEntity[]; conversationState?: ConversationState; commandReply?: string; promptVersion?: "legacy-v1" | "hugo-v2" };
export type ConversationOutput = { text: string; source: "MODEL_RESPONSE" | "DETERMINISTIC_FALLBACK" | "POLICY_RESPONSE"; responsePolicy?: string | null; context: any; pieces: any[]; recentEntities: RecentEntity[]; conversationState?: ConversationState; memoryUsage?: MemoryUsage; composition?: Record<string, number>; intelligenceConfig?: typeof HUGO_V2_CONFIG; toolsRequested: ToolRequest[]; toolsExecuted: ToolResult[]; model: ModelOutput; promptVersion: string };

export class HugoConversationCore {
  constructor(private readonly router: HugoToolRouter, private readonly model: HugoModelAdapter, private readonly dataStore?: HugoDataStore) {}
  async respond(input: ConversationInput): Promise<ConversationOutput> {
    if (!input.identity.uid || !input.identity.rootId || !input.message.trim() || !input.conversationId || !input.channel) throw Error("HUGO_CONVERSATION_INVALID_INPUT");
    this.router.assertIdentity(input.identity);
    const state = this.dataStore ? await this.dataStore.loadConversationState(input.identity, input.conversationId) : null;
    const history = state?.history || input.history || [];
    const memory = state?.memory || input.memory || { recommendations: [], rules: [] };
    const recentEntities = state?.recentEntities || input.recentEntities || [];
    const requested: ToolRequest[] = [];
    const executed: ToolResult[] = [];
    const recordingRouter = { execute: async (request: ToolRequest) => {
      requested.push(request);
      const result = await this.router.execute(request);
      executed.push(result);
      return result;
    } };
    const v2 = input.promptVersion === "hugo-v2";
    const built = await (v2 ? buildHugoContextV2({ message: input.message, rootId: input.identity.rootId, conversationState: state?.conversationState || normalizeConversationState(input.conversationState, input.identity.rootId), router: recordingRouter, dataStore: this.dataStore }) :
      buildHugoContext({ message: input.message, recentEntities, memory, router: recordingRouter })).catch(error => {
      if (error instanceof Error) (error as Error & { hugoToolsRequested?: string[]; hugoToolsExecuted?: string[] }).hugoToolsRequested = requested.map(row => row.name);
      if (error instanceof Error) (error as Error & { hugoToolsExecuted?: string[] }).hugoToolsExecuted = executed.map(row => row.tool);
      throw error;
    });
    const policyReply = v2 && !input.commandReply ? ("clarification" in built && built.clarification ? built.clarification :
      isGlobalCountQuestion(input.message) && "evidenceBoundaries" in built.context && !canStateGlobalTotalForMessage(input.message, built.context.evidenceBoundaries as any)
        ? "La evidencia disponible es una muestra parcial o insuficiente; no puedo establecer el total para toda tu raíz con estos datos." : null) : null;
    const promptVersion = v2 ? HUGO_V2_CONFIG.promptVersion : HUGO_PROMPT_VERSION;
    const model: ModelOutput = input.commandReply || policyReply ? { text: null, model: "gemini-2.5-flash", modelVersion: "publisher-model", promptVersion, tokenUsage: null, error: input.commandReply ? "COMMAND_HANDLED" : "POLICY_HANDLED" }
      : await this.model.generate({ message: input.message, name: input.name, context: built.context, history, promptVersion });
    const bounds = v2 && "evidenceBoundaries" in built.context && canStateGlobalTotalForMessage(model.text || input.message, built.context.evidenceBoundaries as any)
      ? relevantEvidenceBoundaries(model.text || input.message, built.context.evidenceBoundaries as any) : [];
    const checked = v2 && model.text ? checkExhaustiveness(model.text, bounds) : { allowed: true, reason: null };
    const text = input.commandReply || policyReply || (!checked.allowed ? "La evidencia disponible no permite afirmar un total o una ausencia global. Puedo revisar un folio concreto." : null) || model.text || fallbackReply(input.message, input.name, built.context);
    return { text, source: policyReply || !checked.allowed ? "POLICY_RESPONSE" : model.text ? "MODEL_RESPONSE" : "DETERMINISTIC_FALLBACK", responsePolicy: policyReply ? "PARTIAL_TOTAL_OR_CLARIFICATION" : checked.reason,
      context: built.context, pieces: built.pieces,
      recentEntities: built.recentEntities.length ? built.recentEntities : recentEntities, conversationState: "conversationState" in built ? built.conversationState : undefined,
      memoryUsage: "memoryUsage" in built ? built.memoryUsage : undefined, composition: "composition" in built ? built.composition : undefined,
      intelligenceConfig: v2 ? HUGO_V2_CONFIG : undefined, toolsRequested: requested, toolsExecuted: executed, model, promptVersion };
  }
}
