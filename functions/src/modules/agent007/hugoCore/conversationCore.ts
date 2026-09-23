import { buildHugoContext, HugoMemory, RecentEntity } from "./contextBuilder";
import { HugoToolRouter, ToolRequest, ToolResult } from "./toolRouter";
import { HugoModelAdapter, ModelOutput, canonicalModelRequest } from "./modelContract";
import { HUGO_PROMPT_VERSION } from "./legacyPrompt";
import { HugoDataStore } from "./dataStoreContract";
import { ConversationState, normalizeConversationState } from "./conversationState";
import { buildHugoContextV2, isGlobalCountQuestion, canStateGlobalTotalForMessage, relevantEvidenceBoundaries, MemoryUsage } from "./contextBuilderV2";
import { HUGO_V2_CONFIG } from "./intelligenceConfig";
import { checkExhaustiveness } from "./exhaustivenessPolicy";
import { HugoLearningStore } from "./learningStore";
import { applyHugoContextBudget, compactLearningExperience, HugoBudgetReport } from "./learningContextBudget";

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

export type ConversationInput = { channel: string; conversationId: string; identity: { uid: string; rootId: string; role: string }; name: string; message: string; scope?: "GLOBAL" | "PAY0"; profile?: "OPERATOR" | "PROGRAMMER"; routingSignals?: { intent: string; risk: "READ" | "WRITE" | "EXTERNAL_SIDE_EFFECT"; complexity: "LOW" | "MEDIUM" | "HIGH"; requiredCapabilities: string[] }; history?: any[]; memory?: HugoMemory; recentEntities?: RecentEntity[]; conversationState?: ConversationState; commandReply?: string; promptVersion?: "legacy-v1" | "hugo-v2"; modelCapability?: "FAST_EXTERNAL" | "STRONG_EXTERNAL" | "LOCAL" };
export type ConversationOutput = { text: string; source: "MODEL_RESPONSE" | "DETERMINISTIC_FALLBACK" | "POLICY_RESPONSE"; responsePolicy?: string | null; context: any; pieces: any[]; recentEntities: RecentEntity[]; conversationState?: ConversationState; memoryUsage?: MemoryUsage; learningUsage?: { considered: number; selected: number; candidateIds?: string[]; retrievedIds?: string[]; includedIds: string[]; referencedByModel?: string[]; effectClassification?: "NOT_EVALUATED"; rejected: Array<{ experienceId: string; reason: string }>; error?: string; conflict?: boolean }; budget?: HugoBudgetReport; composition?: Record<string, number>; intelligenceConfig?: typeof HUGO_V2_CONFIG; toolsRequested: ToolRequest[]; toolsExecuted: ToolResult[]; model: ModelOutput; promptVersion: string };

export class HugoConversationCore {
  constructor(private readonly router: HugoToolRouter, private readonly model: HugoModelAdapter | null, private readonly dataStore?: HugoDataStore, private readonly learningStore?: HugoLearningStore) {}
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
    const factContext = built.context as any;
    const exactRow = factContext.folioConsultado && (String(factContext.folioConsultado).startsWith("S") ? factContext.solicitudes?.[0] : factContext.pagos?.[0]);
    const exactDomain = String(factContext.folioConsultado || "").startsWith("S") ? "solicitudes" : "pagos";
    const exactComplete = !!factContext.evidenceBoundaries?.[exactDomain]?.some((row: any) => row.completeness === "COMPLETE" && row.scope === "EXACT_FOLIO");
    const exactFactReply = v2 && !policyReply && !input.commandReply && exactComplete && exactRow && exactRow.folio === factContext.folioConsultado ?
      !/\b(comparar?|mayor|menor)\b/i.test(input.message) && /\b(estado|estatus)\b/i.test(input.message) && exactRow.estado ?
        `El estado actual de ${exactRow.folio} en PAY0 es ${exactRow.estado}.` :
        !/\b(comparar?|mayor|menor)\b/i.test(input.message) && /\b(cu[aá]nto|monto|importe)\b/i.test(input.message) && exactRow.monto != null && exactRow.monto !== "" && Number.isFinite(Number(exactRow.monto)) ?
          `El monto registrado de ${exactRow.folio} en PAY0 es ${Number(exactRow.monto).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}.` : null : null;
    const promptVersion = v2 ? HUGO_V2_CONFIG.promptVersion : HUGO_PROMPT_VERSION;
    const learningContext = built.context as any;
    let learningUsage: ConversationOutput["learningUsage"];
    if (v2 && this.learningStore && !policyReply && learningContext.folioConsultado && learningContext.questionIntent === "REASON") {
      const isSolicitud = String(learningContext.folioConsultado).startsWith("S");
      const first = isSolicitud ? learningContext.solicitudes?.[0] : learningContext.pagos?.[0];
      if (first) {
        const entityType = isSolicitud ? "SOLICITUD" : "PAGO";
        const issueCode = typeof first.issueCode === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(first.issueCode) ? first.issueCode :
          /\b(documentos? faltantes?|faltan? (los? )?documentos?|falta (el )?documento)\b/i.test(input.message) ? "DOCUMENT_MISSING" : null;
        try {
          const retrieved = await this.learningStore.retrieve({ rootId: input.identity.rootId, domain: isSolicitud ? "SOLICITUDES" : "PAGOS", taskType: "REASON", entityType,
            features: { entityType, ...(first.estado ? { status: String(first.estado).toUpperCase() } : {}), ...(issueCode ? { issueCode } : {}) }, limit: 2 });
          const included = retrieved.selected.slice(0, 2);
          learningContext.learningExperiences = included.map(compactLearningExperience);
          learningUsage = { considered: retrieved.considered, selected: retrieved.selected.length,
            candidateIds: [...retrieved.selected.map(row => row.experienceId), ...retrieved.rejected.map(row => row.experienceId)].slice(0, 20),
            retrievedIds: retrieved.selected.map(row => row.experienceId), includedIds: included.map(row => row.experienceId),
            rejected: retrieved.rejected.slice(0, 10), conflict: retrieved.conflict, effectClassification: "NOT_EVALUATED" };
        } catch { learningUsage = { considered: 0, selected: 0, includedIds: [], rejected: [], error: "LEARNING_RETRIEVAL_UNAVAILABLE" }; }
      }
    }
    const learningUnavailableReply = learningUsage?.error ? "No pude consultar experiencias anteriores verificadas. Puedo revisar el estado actual del folio, pero no confirmar su motivo histórico ahora." : null;
    const conflictReply = learningUsage?.conflict ? "Encontré experiencias verificadas contradictorias para este patrón. No tomaré una como guía sin revisión humana." : null;
    const budget = v2 ? applyHugoContextBudget(learningContext) : undefined;
    if (learningUsage) learningUsage.includedIds = (learningContext.learningExperiences || []).map((row: any) => row.id);
    const budgetReply = budget?.exceeded ? "El contexto excede el límite seguro. Puedo revisar un folio concreto con menos antecedentes." : null;
    const skipModel = input.commandReply || policyReply || exactFactReply || learningUnavailableReply || conflictReply || budgetReply;
    let model: ModelOutput = skipModel ? { text: null, model: "none", modelVersion: "none", promptVersion, tokenUsage: null, error: input.commandReply ? "COMMAND_HANDLED" : "POLICY_HANDLED" } :
      !this.model ? { text: null, model: "none", modelVersion: "none", promptVersion, tokenUsage: null, error: "MODEL_UNAVAILABLE" } :
        { text: null, model: "none", modelVersion: "none", promptVersion, tokenUsage: null };
    if (!skipModel && this.model) {
      try { model = this.model.generateCanonical ? await this.model.generateCanonical(canonicalModelRequest({ message: input.message, name: input.name, context: built.context, history, promptVersion, capability: input.modelCapability, profile: input.profile, scope: input.scope, routingSignals: input.routingSignals })) :
        await this.model.generate({ message: input.message, name: input.name, context: built.context, history, promptVersion }); }
      catch (error) { model = { text: null, model: "unavailable", modelVersion: "unknown", promptVersion, tokenUsage: null,
        error: error instanceof Error && /timeout|abort/i.test(error.name + " " + error.message) ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE" }; }
    }
    if (learningUsage) learningUsage.referencedByModel = learningUsage.includedIds.filter(id => model.text?.includes(id));
    const bounds = v2 && "evidenceBoundaries" in built.context && canStateGlobalTotalForMessage(model.text || input.message, built.context.evidenceBoundaries as any)
      ? relevantEvidenceBoundaries(model.text || input.message, built.context.evidenceBoundaries as any) : [];
    const checked = v2 && model.text ? checkExhaustiveness(model.text, bounds) : { allowed: true, reason: null };
    const redactedModelText = learningUsage?.includedIds.reduce((value, id) => value?.split(id).join("una experiencia verificada") || null, model.text) || model.text;
    const internalReferenceRedacted = !!model.text && redactedModelText !== model.text;
    const modelFailureReply = v2 && model.error && !["COMMAND_HANDLED", "POLICY_HANDLED", "EMULATOR_DISABLED"].includes(model.error) ?
      model.error === "MAX_TOKENS" ? "No pude completar una respuesta verificable. Puedes pedirme revisar un folio concreto de nuevo." :
        "El razonamiento generativo no está disponible por ahora. Puedo consultar hechos concretos de PAY0 o pedir una revisión humana." : null;
    const text = input.commandReply || policyReply || exactFactReply || learningUnavailableReply || conflictReply || budgetReply || (!checked.allowed ? "La evidencia disponible no permite afirmar un total o una ausencia global. Puedo revisar un folio concreto." : null) || redactedModelText || modelFailureReply || fallbackReply(input.message, input.name, built.context);
    return { text, source: policyReply || exactFactReply || learningUnavailableReply || conflictReply || budgetReply || !checked.allowed || internalReferenceRedacted ? "POLICY_RESPONSE" : model.text ? "MODEL_RESPONSE" : "DETERMINISTIC_FALLBACK", responsePolicy: learningUnavailableReply ? "LEARNING_RETRIEVAL_UNAVAILABLE" : conflictReply ? "LEARNING_CONFLICT" : budgetReply ? "CONTEXT_BUDGET_EXCEEDED" : exactFactReply ? "EXACT_FACT" : policyReply ? "PARTIAL_TOTAL_OR_CLARIFICATION" : internalReferenceRedacted ? "INTERNAL_EXPERIENCE_REFERENCE_REDACTED" : checked.reason,
      context: built.context, pieces: built.pieces,
      recentEntities: built.recentEntities.length ? built.recentEntities : recentEntities, conversationState: "conversationState" in built ? built.conversationState : undefined,
      memoryUsage: "memoryUsage" in built ? built.memoryUsage : undefined, composition: "composition" in built ? built.composition : undefined,
      learningUsage, budget,
      intelligenceConfig: v2 ? HUGO_V2_CONFIG : undefined, toolsRequested: requested, toolsExecuted: executed, model, promptVersion };
  }
}
