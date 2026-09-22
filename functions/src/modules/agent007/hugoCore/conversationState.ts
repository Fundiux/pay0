export const CONVERSATION_STATE_VERSION = "conversation-state-v2";
export type ConversationEntity = { system: "PAY0"; entityType: "SOLICITUD" | "PAGO"; entityId: string; folio: string; rootId: string; resolvedAt: number; resolvedTurn: number; source: string; confidence: number };
export type ConversationState = { version: typeof CONVERSATION_STATE_VERSION; rootId: string; turn: number; activeEntity: ConversationEntity | null; recentEntities: ConversationEntity[]; pendingAmbiguity: ConversationEntity[]; lastIntent: string | null };
export type ReferenceResolution = { folios: string[]; active: ConversationEntity | null; clarification: string | null; reason: string; intent: string; state: ConversationState };

const distinct = <T>(items: T[]) => [...new Set(items)];
const explicitFolios = (message: string) => distinct(message.toUpperCase().match(/\b[SP]\d[A-Z0-9]{4,19}\b/g) || []).slice(0, 3);
const fresh = (entity: ConversationEntity, state: ConversationState, now: number) => now - entity.resolvedAt <= 30 * 60_000 && state.turn - entity.resolvedTurn <= 4;
export function emptyConversationState(rootId: string): ConversationState { return { version: CONVERSATION_STATE_VERSION, rootId, turn: 0, activeEntity: null, recentEntities: [], pendingAmbiguity: [], lastIntent: null }; }
export function normalizeConversationState(raw: unknown, rootId: string, now = Date.now()): ConversationState {
  const row = raw as Partial<ConversationState> | null;
  if (!row || row.version !== CONVERSATION_STATE_VERSION || row.rootId !== rootId) return emptyConversationState(rootId);
  const valid = (x: any): x is ConversationEntity => x?.rootId === rootId && x.system === "PAY0" && ["SOLICITUD", "PAGO"].includes(x.entityType) && typeof x.folio === "string" && /^[SP][A-Z0-9]{5,19}$/.test(x.folio) && Number.isFinite(x.resolvedAt) && x.resolvedAt <= now && Number.isInteger(x.resolvedTurn);
  const recentEntities = Array.isArray(row.recentEntities) ? row.recentEntities.filter(valid).slice(0, 6) : [];
  const activeEntity = valid(row.activeEntity) && fresh(row.activeEntity, { ...row, turn: Number(row.turn) || 0 } as ConversationState, now) ? row.activeEntity : null;
  return { version: CONVERSATION_STATE_VERSION, rootId, turn: Math.min(Math.max(Number(row.turn) || 0, 0), 100000), activeEntity,
    recentEntities, pendingAmbiguity: Array.isArray(row.pendingAmbiguity) ? row.pendingAmbiguity.filter(valid).slice(0, 3) : [], lastIntent: typeof row.lastIntent === "string" ? row.lastIntent.slice(0, 60) : null };
}
export function resolveConversationReference(message: string, previous: ConversationState, rootId: string, now = Date.now()): ReferenceResolution {
  const state = normalizeConversationState(previous, rootId, now);
  const folios = explicitFolios(message);
  const normalized = message.toLocaleLowerCase("es-MX");
  const intent = /cu[aá]l|compara|comparar/i.test(message) ? "COMPARE" : /cu[aá]nto|monto|importe/i.test(message) ? "AMOUNT" : /por\s+qu[eé]|motivo|raz[oó]n/i.test(message) ? "REASON" : "STATUS";
  if (folios.length > 1) return { folios, active: null, clarification: null, reason: "EXPLICIT_MULTIPLE", intent, state };
  if (folios.length === 1) return { folios, active: null, clarification: null, reason: "EXPLICIT", intent, state };
  if (/\b(otro|otra)\b/i.test(message) && state.recentEntities.length > 1) return { folios: [], active: null, clarification: `¿Te refieres a ${state.recentEntities.slice(0, 3).map(x => x.folio).join(" o ")}?`, reason: "AMBIGUOUS_OTHER", intent, state };
  if (/\b(otro|otra)\b/i.test(message)) return { folios: [], active: null, clarification: "¿A qué folio te refieres?", reason: "UNRESOLVED_OTHER", intent, state };
  if (intent === "COMPARE" && /\b(mayor|menor|compara|comparar)\b/i.test(message) && state.recentEntities.length === 2 && state.recentEntities.every(x => fresh(x, state, now))) {
    return { folios: state.recentEntities.map(x => x.folio), active: null, clarification: null, reason: "COMPARISON_SET", intent, state };
  }
  if (/\b(ahora hablemos de|cambiando de tema|otro tema|por otro lado|en general)\b/i.test(normalized) || (/\b(iq|beneficiario|dispersi[oó]n)\b/i.test(normalized) && !/\b(esa|ese|sigue|cu[aá]nto)\b/i.test(normalized))) {
    return { folios: [], active: null, clarification: null, reason: "TOPIC_SHIFT", intent, state };
  }
  const looksFollowup = /\b(y|esa|ese|anterior|monto|importe|sigue|ahora)\b|cu[aá]nto|por\s+qu[eé]|c[oó]mo\s+est[aá]|est[aá]/i.test(message);
  const type = /solicitud/i.test(message) ? "SOLICITUD" : /pago/i.test(message) ? "PAGO" : null;
  const candidates = state.recentEntities.filter(x => fresh(x, state, now) && (!type || x.entityType === type));
  const active = state.activeEntity && fresh(state.activeEntity, state, now) && (!type || state.activeEntity.entityType === type) ? state.activeEntity : null;
  if (looksFollowup && active && candidates.length === 1) return { folios: [active.folio], active, clarification: null, reason: "ACTIVE_ENTITY", intent, state };
  if (looksFollowup && candidates.length > 1) return { folios: [], active: null, clarification: `¿Te refieres a ${candidates.slice(0, 3).map(x => x.folio).join(" o ")}?`, reason: "AMBIGUOUS_REFERENCE", intent, state };
  if (looksFollowup && active) return { folios: [active.folio], active, clarification: null, reason: "ACTIVE_ENTITY", intent, state };
  return { folios: [], active: null, clarification: null, reason: "NO_REFERENCE", intent, state };
}
export function advanceConversationState(resolution: ReferenceResolution, resolved: ConversationEntity[], rootId: string): ConversationState {
  const previous = resolution.state;
  const recent = [...resolved, ...previous.recentEntities.filter(old => !resolved.some(next => next.folio === old.folio))].slice(0, 6);
  const activeEntity = resolution.reason === "TOPIC_SHIFT" || resolution.reason === "EXPLICIT_MULTIPLE" || resolution.reason === "COMPARISON_SET" || (resolution.reason === "EXPLICIT" && !resolved.length) ? null :
    resolved.length === 1 ? resolved[0] : resolution.clarification ? null : resolution.active || previous.activeEntity;
  return { version: CONVERSATION_STATE_VERSION, rootId, turn: previous.turn + 1, activeEntity, recentEntities: recent,
    pendingAmbiguity: resolution.clarification ? recent.slice(0, 3) : [], lastIntent: resolution.intent };
}
