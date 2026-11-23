// Observer/acting mode of each agent in each group. Pure: no Firestore here.
// An agent in OBSERVER mode only reads and learns; in ACTING mode it may answer, inside the reply rules.
// Hugo is the main agent: nobody else may act in a group where Hugo is still observing, and María and Sofía never greet.

export type AgentMode = "OBSERVER" | "ACTING";
export const MAIN_AGENT_ID = "hugo";
export const MIN_REASON_LENGTH = 3;

export function readAgentModes(raw: unknown): Record<string, AgentMode> {
  const out: Record<string, AgentMode> = {};
  if (raw && typeof raw === "object") for (const [agentId, mode] of Object.entries(raw as Record<string, unknown>)) if (mode === "ACTING") out[agentId] = "ACTING";
  return out;
}

export const modeOf = (modes: Record<string, AgentMode>, agentId: string): AgentMode => modes[agentId] === "ACTING" ? "ACTING" : "OBSERVER";

/** Whether the agent may answer in the group right now. */
export function agentCanAct(agentId: string, modes: Record<string, AgentMode>, enabledInCatalog: boolean): boolean {
  if (modeOf(modes, agentId) !== "ACTING") return false;
  if (agentId === MAIN_AGENT_ID) return true;
  return enabledInCatalog && modeOf(modes, MAIN_AGENT_ID) === "ACTING";
}

/** Only Hugo greets, even when several agents share the group. */
export const mayGreet = (agentId: string) => agentId === MAIN_AGENT_ID;

export type ModeChange = { agentId: string; mode: AgentMode; reason?: string };
export type ModeChangeResult =
  | { ok: true; modes: Record<string, AgentMode>; changed: string[] }
  | { ok: false; code: "AGENT_NOT_IN_GROUP" | "AGENT_DISABLED" | "HUGO_MUST_ACT_FIRST" | "REASON_REQUIRED" | "NO_CHANGE"; message: string };

export function applyModeChange(input: { change: ModeChange; modes: Record<string, AgentMode>; agentsInGroup: string[]; enabledInCatalog: (agentId: string) => boolean }): ModeChangeResult {
  const { change, agentsInGroup } = input;
  const modes = { ...input.modes };
  if (!agentsInGroup.includes(change.agentId)) return { ok: false, code: "AGENT_NOT_IN_GROUP", message: "El agente no está en este grupo." };
  const current = modeOf(modes, change.agentId);
  if (current === change.mode) return { ok: false, code: "NO_CHANGE", message: "El agente ya está en ese modo." };
  if (change.mode === "ACTING") {
    if (!input.enabledInCatalog(change.agentId)) return { ok: false, code: "AGENT_DISABLED", message: "Este agente está apagado en el catálogo y no puede actuar." };
    if (change.agentId !== MAIN_AGENT_ID && modeOf(modes, MAIN_AGENT_ID) !== "ACTING") return { ok: false, code: "HUGO_MUST_ACT_FIRST", message: "Hugo debe estar actuando en este grupo antes que los demás agentes." };
    modes[change.agentId] = "ACTING";
    return { ok: true, modes, changed: [change.agentId] };
  }
  if (String(change.reason ?? "").trim().length < MIN_REASON_LENGTH) return { ok: false, code: "REASON_REQUIRED", message: "Escribe el motivo para regresar al agente a Observador." };
  const changed = [change.agentId];
  delete modes[change.agentId];
  // Hugo back to observer pulls everyone else back: no secondary agent speaks first.
  if (change.agentId === MAIN_AGENT_ID) for (const other of Object.keys(modes)) { changed.push(other); delete modes[other]; }
  return { ok: true, modes, changed };
}
