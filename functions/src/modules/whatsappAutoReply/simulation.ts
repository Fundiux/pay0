import { classifyMessage, isWithinWorkingHours, MAX_REPLY_AGE_MS, DEFAULT_HUMAN_WAIT_MS, type RequestLookup, type WorkingHours } from "./domain";
import { maskPhrase } from "./lessons";
import { guardProblem } from "./playbook";
import type { InboundRow } from "./planner";

// Stage 3 of Hugo's learning: SIMULATION ONLY. For groups with an approved playbook entry, a free-text draft is written
// and checked by hard guardrails, then stored for the owner to review. Nothing here is ever queued or sent to a client.

export const SIMULATED_REPLIES = "whatsappAgentSimulatedReplies";
export const SIMULATION_CONFIGS = "whatsappAgentSimulationConfigs";
export const DRAFT_MIN = 10;
export const DRAFT_MAX = 320;
export const SIM_DAILY_CAP_PER_GROUP = 10;
export const SIM_MAX_PER_RUN = 3;

export type DraftStatus = "SIMULATED" | "REJECTED_BY_GUARD" | "MODEL_UNAVAILABLE";

export const simulatedReplyId = (rootId: string, messageId: string) => `sim__${rootId.slice(0, 40)}__${messageId}`.slice(0, 200);

const PROGRESS_CLAIM = /en proceso|se encuentra en|ya (se )?(envi|realiz|sali|pag|dispers|factur|emiti|gener|quedo|quedó)|ya est[aá]|est[aá] listo|ya lo tenemos|ya cuent/i;
const CHANNEL_LEAK = /https?:|www\.|@|\bwhats\s?app\b|\bgrupo interno\b/i;

export type GuardResult = { ok: boolean; reasons: string[] };

/**
 * Hard guardrails for a drafted client reply. The model can never override them.
 * Facts about progress are allowed only when the system lookup confirmed the request.
 */
export function guardDraft(text: string, lookup: RequestLookup): GuardResult {
  const reasons: string[] = [];
  const base = guardProblem(text, DRAFT_MIN, DRAFT_MAX);
  if (base) reasons.push(base);
  const value = String(text ?? "");
  if (CHANNEL_LEAK.test(value)) reasons.push("No debe incluir enlaces, menciones ni referencias a canales.");
  if (lookup !== "FOUND" && PROGRESS_CLAIM.test(value)) reasons.push("Afirma avances que el sistema no confirmó.");
  return { ok: reasons.length === 0, reasons };
}

const LOOKUP_FACT: Record<RequestLookup, string> = {
  FOUND: "El sistema confirmó que la solicitud del cliente existe y está en proceso.",
  NOT_FOUND: "El sistema no encontró la solicitud del cliente.",
  UNKNOWN: "No se pudo verificar nada en el sistema.",
};

export const DRAFT_SYSTEM = [
  "Eres Hugo, quien atiende a un cliente en un grupo de WhatsApp. Escribes en español, breve, cálido y profesional, en una sola respuesta de máximo dos frases.",
  "Reglas absolutas: no escribas cifras, montos, porcentajes ni números; no prometas tiempos ni fechas; no menciones empresas, despachos, folios ni sistemas internos;",
  "no digas que algo se valida o consulta con otra persona o empresa; afirma un avance solo si el dato del sistema lo confirma.",
  "Si no tienes el dato, di con amabilidad: «permítanos validarlo». Responde solo con el texto del mensaje.",
].join(" ");

/** Everything the model sees: the approved guidance, the client's message masked, and one fact. Never other clients' data. */
export function buildDraftPrompt(guidance: string[], clientMessage: string, lookup: RequestLookup): string {
  return [
    `Indicaciones aprobadas para este cliente:\n${guidance.map(text => `- ${text}`).join("\n")}`,
    `Mensaje del cliente (se omiten cifras y nombres): «${maskPhrase(clientMessage)}»`,
    `Dato del sistema: ${LOOKUP_FACT[lookup]}`,
    "Escribe la respuesta.",
  ].join("\n\n");
}

export type SimulationCandidate = { messageId: string; chatId: string; body: string };

export type CandidateInput = {
  messages: InboundRow[];
  /** Groups where Hugo is acting and that have an approved, still running playbook. */
  simulatedChats: ReadonlySet<string>;
  operatorHashes: ReadonlySet<string>;
  /** Messages that already got a real reply, or that the planner is answering in this run. */
  handledIds: ReadonlySet<string>;
  /** Messages that already have a simulated reply. */
  knownIds: ReadonlySet<string>;
  nowMs: number;
  workingHours: WorkingHours | null;
};

/** Client questions Hugo would not answer on its own: past the human wait, still fresh, unanswered by a person, inside working hours. */
export function findSimulationCandidates(input: CandidateInput): SimulationCandidate[] {
  if (!isWithinWorkingHours(input.workingHours, input.nowMs)) return [];
  const isTeam = (row: InboundRow) => row.fromMe || (!!row.authorHash && input.operatorHashes.has(row.authorHash));
  const found: SimulationCandidate[] = [];
  for (const row of input.messages) {
    if (!input.simulatedChats.has(row.chatId) || isTeam(row) || input.handledIds.has(row.id) || input.knownIds.has(row.id)) continue;
    const age = input.nowMs - row.timestampMs;
    if (age < DEFAULT_HUMAN_WAIT_MS || age > MAX_REPLY_AGE_MS) continue;
    const kind = classifyMessage(row.body);
    if (kind !== "STATUS_INQUIRY" && kind !== "QUESTION") continue;
    if (input.messages.some(other => other.chatId === row.chatId && other.timestampMs > row.timestampMs && isTeam(other))) continue;
    found.push({ messageId: row.id, chatId: row.chatId, body: row.body });
  }
  return found;
}
