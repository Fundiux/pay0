import { ToolRequest, ToolResult } from "./toolRouter";
import { advanceConversationState, ConversationEntity, ConversationState, resolveConversationReference } from "./conversationState";
import { HugoDataStore } from "./dataStoreContract";
import { HugoEntityReference, memoryPriority, RetrievedMemory } from "./memoryContract";
import { ContextPiece, RecentEntity } from "./contextBuilder";

export const CONTEXT_BUILDER_VERSION = "context-v2";
export type EvidenceBoundary = { completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN"; scope: "ROOT_AGGREGATE" | "EXACT_FOLIO" | "RECENT_SAMPLE" | "CONFIGURATION"; meaning: string; totalAllowed: boolean };
export type MemoryUsage = { considered: number; selected: number; included: number; idsConsidered: string[]; includedReferences: Array<{ id: string; kind: string; status: string; reason: string }>; legacyObservationsConsidered: number; legacyObservationsIncluded: number; approximateTokens: number };
const boundary = (completeness: EvidenceBoundary["completeness"], scope: EvidenceBoundary["scope"]): EvidenceBoundary => ({ completeness, scope,
  meaning: completeness === "PARTIAL" ? "Muestra limitada: no establece totales, ausencia global ni exhaustividad." : completeness === "UNKNOWN" ? "Evidencia insuficiente para establecer este hecho." : `Resultado completo únicamente dentro de ${scope}.`,
  totalAllowed: completeness === "COMPLETE" && scope === "ROOT_AGGREGATE" });
export const isGlobalCountQuestion = (message: string) => /\b(cu[aá]ntos?|total|todos|todas|ninguno|ninguna|no hay)\b/i.test(message) && /\b(pagos?|solicitudes?|complementos?|pendientes?)\b/i.test(message);
export function canStateGlobalTotal(evidence: EvidenceBoundary[]): boolean { return evidence.some(row => row.totalAllowed); }
export function relevantEvidenceBoundaries(message: string, groups: Record<string, EvidenceBoundary[]>): EvidenceBoundary[] {
  const domains = [
    { pattern: /\bpagos?\b/i, key: "pagos" },
    { pattern: /\bsolicitudes?\b/i, key: "solicitudes" },
    { pattern: /\bcomplementos?\b/i, key: "complementos" },
  ];
  const named = domains.filter(domain => domain.pattern.test(message));
  return named.length ? named.flatMap(domain => groups[domain.key] || []) : Object.values(groups).flat();
}
export function canStateGlobalTotalForMessage(message: string, groups: Record<string, EvidenceBoundary[]>): boolean {
  const keys = [
    { pattern: /\bpagos?\b/i, key: "pagos" },
    { pattern: /\bsolicitudes?\b/i, key: "solicitudes" },
    { pattern: /\bcomplementos?\b/i, key: "complementos" },
  ].filter(domain => domain.pattern.test(message));
  return keys.length > 0 && keys.every(domain => canStateGlobalTotal(groups[domain.key] || []));
}
const asRows = (data: any): any[] => Array.isArray(data) ? data : data ? [data] : [];
const compact = (value: unknown, max = 350) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function buildHugoContextV2(input: { message: string; rootId: string; conversationState: ConversationState; router: { execute(request: ToolRequest): Promise<ToolResult> }; dataStore?: HugoDataStore; now?: number }) {
  const now = input.now || Date.now();
  const resolution = resolveConversationReference(input.message, input.conversationState, input.rootId, now);
  if (resolution.clarification) {
    return { context: { schemaVersion: CONTEXT_BUILDER_VERSION, clarificationNeeded: resolution.clarification, evidenceBoundaries: {}, activeEntity: null,
      folioConsultado: null, solicitudes: [] as any[], pagos: [] as any[], dudasPendientes: [] as any[], complementosPendientes: [] as any[], capacidadesIq: {} }, pieces: [] as ContextPiece[], toolResults: [] as ToolResult[],
      recentEntities: [] as RecentEntity[], conversationState: advanceConversationState(resolution, [], input.rootId), clarification: resolution.clarification,
      memoryUsage: { considered: 0, selected: 0, included: 0, idsConsidered: [], includedReferences: [], legacyObservationsConsidered: 0, legacyObservationsIncluded: 0, approximateTokens: 0 } as MemoryUsage,
      composition: { currentFacts: 0, verifiedRules: 0, experiences: 0, userStatements: 0, hypotheses: 0, unknowns: 0, approximateTokens: 0 }, referenceReason: resolution.reason };
  }
  const folios = resolution.folios;
  const requests: ToolRequest[] = folios.length ? [
    ...folios.filter(x => x.startsWith("S")).map(folio => ({ name: "getSolicitud" as const, input: { folio } })),
    ...folios.filter(x => x.startsWith("P")).map(folio => ({ name: "getPago" as const, input: { folio } })),
    { name: "getPaymentComplementStatus", input: folios.length === 1 ? { folio: folios[0] } : {} }, { name: "getIqCapabilities", input: {} },
  ] : [{ name: "searchSolicitudes", input: { limit: 40 } }, { name: "searchPagos", input: { limit: 30 } }, { name: "getPaymentComplementStatus", input: {} }, { name: "getIqCapabilities", input: {} }];
  const results = await Promise.all(requests.map(row => input.router.execute(row)));
  const by = (name: ToolRequest["name"]) => results.filter(row => row.tool === name);
  const solicitudResults = [...by("getSolicitud"), ...by("searchSolicitudes")], pagoResults = [...by("getPago"), ...by("searchPagos")];
  const solicitudes = solicitudResults.flatMap(row => asRows(row.data)).slice(0, 8);
  const pagos = pagoResults.flatMap(row => asRows(row.data)).slice(0, 6);
  const references: HugoEntityReference[] = [...solicitudes.map(row => ({ sourceSystem: "PAY0", entityType: "SOLICITUD", entityId: compact(row.id, 160), displayReference: compact(row.folio, 40) })),
    ...pagos.map(row => ({ sourceSystem: "PAY0", entityType: "PAGO", entityId: compact(row.id, 160), displayReference: compact(row.folio, 40) }))].filter(row => row.entityId && row.displayReference).slice(0, folios.length ? 3 : 2);
  const resolved: ConversationEntity[] = references.filter(row => folios.includes(row.displayReference || "")).map(row => ({ system: "PAY0", entityType: row.entityType as "SOLICITUD" | "PAGO", entityId: row.entityId, folio: row.displayReference || "", rootId: input.rootId,
    resolvedAt: now, resolvedTurn: resolution.state.turn + 1, source: "PAY0_EXACT_TOOL", confidence: 1 }));
  const nextState = advanceConversationState(resolution, resolved, input.rootId);
  const relevantRefs = folios.length ? references : [];
  const retrieval = input.dataStore && relevantRefs.length ? await input.dataStore.retrieveMemory({ rootId: input.rootId, entityReferences: relevantRefs, intent: resolution.intent, limit: 4, now: new Date(now).toISOString() }) :
    { considered: 0, selected: [] as RetrievedMemory[], legacyObservationsConsidered: 0, legacyObservations: [] as any[] };
  const historicalQuestion = /(ayer|antes|histori|última vez|ultima vez|anterior|pasó|ocurrió)/i.test(input.message);
  const currentOperationalQuestion = ["STATUS", "AMOUNT"].includes(resolution.intent) && !historicalQuestion;
  const relevant = currentOperationalQuestion ? [] : retrieval.selected.filter(row => resolution.intent !== "AMOUNT" || ["RULE", "PREFERENCE"].includes(row.record.kind));
  const included = relevant.filter(row => historicalQuestion || !row.record.claim ||
    ![...solicitudes, ...pagos].some(current => current.id === row.record.entityReference?.entityId && ["estado", "monto"].includes(row.record.claim!.field) && current[row.record.claim!.field] != null))
    .sort((a, b) => memoryPriority(a.record) - memoryPriority(b.record)).slice(0, 4);
  const legacyIncluded = !currentOperationalQuestion && ["REASON", "STATUS"].includes(resolution.intent) ? retrieval.legacyObservations.slice(0, 2) : [];
  const memoryContext = included.map(row => ({ id: row.record.id, kind: row.record.kind, status: row.record.status, source: row.record.source, sourceSystem: row.record.sourceSystem,
    entityReference: row.record.entityReference, effectiveAt: row.record.effectiveAt, lastVerifiedAt: row.record.lastVerifiedAt,
    relevanceReason: row.relevanceReason, historical: row.record.kind === "FACT" || row.record.kind === "EXPERIENCE", claim: row.record.claim || null, content: compact(row.record.content) }));
  const memoryConflicts: Array<{ ids: string[]; reason: string }> = [];
  for (let i = 0; i < included.length; i++) {
    const a = included[i].record;
    if (!a.claim) continue;
    const current = [...solicitudes, ...pagos].find(row => row.id === a.entityReference?.entityId);
    const currentValue = current && ["estado", "monto"].includes(a.claim.field) ? current[a.claim.field] : undefined;
    if (currentValue != null && String(currentValue) !== a.claim.value) memoryConflicts.push({ ids: [a.id], reason: "CURRENT_PAY0_FACT_PREVAILS" });
    for (let j = i + 1; j < included.length; j++) {
      const b = included[j].record;
      if (b.claim?.field === a.claim.field && b.claim.value !== a.claim.value && b.entityReference?.entityId === a.entityReference?.entityId) memoryConflicts.push({ ids: [a.id, b.id], reason: "MEMORY_VALUES_CONFLICT" });
    }
  }
  const observationContext = legacyIncluded.map(row => ({ id: row.id, sourceEvent: row.sourceEvent, status: row.verificationStatus, outcome: compact(row.outcome), relevanceReason: row.relevanceReason }));
  const scopeFor = (rows: ToolResult[], fallback: EvidenceBoundary["scope"]) => rows.map(row => boundary(row.completeness, row.tool.startsWith("get") ? "EXACT_FOLIO" : fallback));
  const boundaries = { solicitudes: scopeFor(solicitudResults, "RECENT_SAMPLE"), pagos: scopeFor(pagoResults, "RECENT_SAMPLE"),
    complementos: by("getPaymentComplementStatus").map(row => boundary(row.completeness, "RECENT_SAMPLE")), capacidadesIq: by("getIqCapabilities").map(row => boundary(row.completeness, "CONFIGURATION")) };
  const context = { schemaVersion: CONTEXT_BUILDER_VERSION, questionIntent: resolution.intent, referenceResolution: resolution.reason, folioConsultado: folios.length === 1 ? folios[0] : null,
    dudasPendientes: [] as any[], activeEntity: nextState.activeEntity ? { type: nextState.activeEntity.entityType, folio: nextState.activeEntity.folio } : null,
    evidenceBoundaries: boundaries, totalGlobalAllowed: canStateGlobalTotalForMessage(input.message, boundaries),
    solicitudes: solicitudes.map(row => ({ folio: row.folio, monto: row.monto, estado: row.estado, factura: row.factura, facturamaStatus: row.facturamaStatus })),
    pagos: pagos.map(row => ({ folio: row.folio, monto: row.monto, estado: row.estado })),
    complementosPendientes: asRows(by("getPaymentComplementStatus")[0]?.data).filter(row => row.status !== "RECEIVED" && row.status !== "VOIDED").slice(0, 6).map(row => ({ solicitud: row.solicitudFolio, pago: row.pagoFolio, estado: row.status, enviadoAlProveedor: row.externalRequestSent === true })),
    capacidadesIq: by("getIqCapabilities")[0]?.data || {}, memoriasHistoricas: memoryContext, observacionesHistoricasNoVerificadas: observationContext, memoryConflicts,
    memoryPrecedence: "El estado operativo actual verificado por PAY0 prevalece sobre memoria histórica; decisiones y observaciones no son reglas universales." };
  let truncatedForBudget = false;
  while (JSON.stringify(context).length > 10_000) {
    truncatedForBudget = true;
    if (context.observacionesHistoricasNoVerificadas.length) { context.observacionesHistoricasNoVerificadas.pop(); legacyIncluded.pop(); }
    else if (context.memoriasHistoricas.length) { context.memoriasHistoricas.pop(); included.pop(); }
    else if (!folios.length && context.solicitudes.length > 1) context.solicitudes.pop();
    else if (!folios.length && context.pagos.length > 1) context.pagos.pop();
    else break;
  }
  if (truncatedForBudget) (context as typeof context & { truncatedForBudget: boolean }).truncatedForBudget = true;
  const pieces: ContextPiece[] = [{ kind: "USER_STATEMENT", sourceSystem: "USER", completeness: "COMPLETE" }, ...results.flatMap(result => result.evidence.map(row => ({ kind: "FACT" as const, sourceSystem: row.sourceSystem, entityType: row.entityType, entityId: row.entityId, completeness: row.completeness }))),
    ...included.map(row => ({ kind: row.record.kind === "RULE" ? "RULE" as const : "MEMORY" as const, sourceSystem: "HUGO", entityType: row.record.kind, entityId: row.record.id, completeness: "PARTIAL" })),
    ...legacyIncluded.map(row => ({ kind: "MEMORY" as const, sourceSystem: "HUGO", entityType: "LEGACY_OBSERVATION", entityId: row.id, completeness: "UNKNOWN" }))];
  const recentEntities: RecentEntity[] = [...solicitudes.map(row => ({ system: "PAY0" as const, type: "SOLICITUD" as const, id: row.id, folio: row.folio })), ...pagos.map(row => ({ system: "PAY0" as const, type: "PAGO" as const, id: row.id, folio: row.folio }))].filter(row => row.folio).slice(0, 8);
  const memoryUsage: MemoryUsage = { considered: retrieval.considered, selected: retrieval.selected.length, included: included.length, idsConsidered: retrieval.selected.map(row => row.record.id),
    includedReferences: [...included.map(row => ({ id: row.record.id, kind: row.record.kind, status: row.record.status, reason: row.relevanceReason })), ...legacyIncluded.map(row => ({ id: row.id, kind: "LEGACY_OBSERVATION", status: row.verificationStatus, reason: row.relevanceReason }))],
    legacyObservationsConsidered: retrieval.legacyObservationsConsidered, legacyObservationsIncluded: legacyIncluded.length,
    approximateTokens: Math.ceil(JSON.stringify({ memoryContext, observationContext }).length / 4) };
  const composition = { currentFacts: context.solicitudes.length + context.pagos.length, verifiedRules: included.filter(row => row.record.kind === "RULE").length,
    experiences: included.filter(row => ["EXPERIENCE", "OUTCOME"].includes(row.record.kind)).length + legacyIncluded.length,
    userStatements: included.filter(row => ["USER_STATEMENT", "PREFERENCE"].includes(row.record.kind)).length, hypotheses: 0,
    unknowns: results.filter(row => row.completeness === "UNKNOWN").length, approximateTokens: Math.ceil(JSON.stringify(context).length / 4) };
  return { context, pieces, toolResults: results, recentEntities, conversationState: nextState, clarification: null, memoryUsage, composition, referenceReason: resolution.reason };
}
