import { buildHugoContext, HugoMemory, RecentEntity } from "./contextBuilder";
import { HugoToolRouter, ToolRequest, ToolResult } from "./toolRouter";
import { HugoModelAdapter, ModelOutput } from "./modelContract";
import { HUGO_PROMPT_VERSION } from "./legacyPrompt";
import { HugoDataStore } from "./dataStoreContract";

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

export type ConversationInput = { channel: string; conversationId: string; identity: { uid: string; rootId: string; role: string }; name: string; message: string; history?: any[]; memory?: HugoMemory; recentEntities?: RecentEntity[]; commandReply?: string };
export type ConversationOutput = { text: string; source: "MODEL_RESPONSE" | "DETERMINISTIC_FALLBACK"; context: any; pieces: any[]; recentEntities: RecentEntity[]; toolsRequested: ToolRequest[]; toolsExecuted: ToolResult[]; model: ModelOutput; promptVersion: string };

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
    const built = await buildHugoContext({ message: input.message, recentEntities, memory, router: recordingRouter }).catch(error => {
      if (error instanceof Error) (error as Error & { hugoToolsRequested?: string[]; hugoToolsExecuted?: string[] }).hugoToolsRequested = requested.map(row => row.name);
      if (error instanceof Error) (error as Error & { hugoToolsExecuted?: string[] }).hugoToolsExecuted = executed.map(row => row.tool);
      throw error;
    });
    const model = input.commandReply ? { text: null, model: "gemini-2.5-flash", modelVersion: "publisher-model", promptVersion: HUGO_PROMPT_VERSION, tokenUsage: null, error: "COMMAND_HANDLED" }
      : await this.model.generate({ message: input.message, name: input.name, context: built.context, history });
    const text = input.commandReply || model.text || fallbackReply(input.message, input.name, built.context);
    return { text, source: model.text ? "MODEL_RESPONSE" : "DETERMINISTIC_FALLBACK", context: built.context, pieces: built.pieces,
      recentEntities: built.recentEntities.length ? built.recentEntities : recentEntities, toolsRequested: requested, toolsExecuted: executed, model, promptVersion: HUGO_PROMPT_VERSION };
  }
}
