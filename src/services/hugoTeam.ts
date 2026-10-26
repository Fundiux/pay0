import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type HugoTeamAgent = "hugo" | "maria" | "sofia" | "sentinel";
export type HugoTeamTurn = { actorUid: string; conversationId: string; turnId: string; selectedAgent: HugoTeamAgent; agent: HugoTeamAgent; consultedAgents: HugoTeamAgent[]; channel: "TEXT" | "AUDIO"; message: string; reply: string; action: "READ" | "PENDING_AUTHORIZATION" | "UNAVAILABLE" | "NEEDS_CLARIFICATION"; activity: string; evidence: Array<{ collection: string; folio: string; kind: string }>; toolsUsed: string[]; modulesAffected: string[]; result: "READ_COMPLETE" | "NO_EXECUTION" | "CAPABILITY_NOT_AVAILABLE" | "NEEDS_FOLIO"; createdAt?: unknown };
export async function sendHugoTeamTurn(input: { message: string; agent: HugoTeamAgent; channel: "TEXT" | "AUDIO"; turnId: string }) {
  return (await httpsCallable<typeof input, HugoTeamTurn & { ok: true }>(functions, "sendHugoTeamTurn")(input)).data;
}
export async function listHugoTeamTurns(agent: HugoTeamAgent) {
  return (await httpsCallable<{ agent: HugoTeamAgent }, { ok: true; agent: HugoTeamAgent; turns: HugoTeamTurn[] }>(functions, "listHugoTeamTurns")({ agent })).data;
}
