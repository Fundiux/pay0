import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type Agent007Observation = { id: string; caseType: string; caseId: string; intent: string; humanDecision: string; outcome: string; source?: string; sourceEvent?: string; createdAt?: any };
export type Agent007Recommendation = { id: string; kind: string; caseType: string; caseId: string; proposal: string; confidence: number; status: string; evidence?: Record<string, string | null>; createdAt?: any };
export type Agent007Message = { id: string; role: "user" | "assistant"; text: string; source?: "USER" | "VERTEX_AI" | "HUGO_ENGINE" | "SYSTEM_EVENT"; read?: boolean; relatedCaseType?: string; relatedCaseId?: string; createdAt?: any };

export async function recordAgent007Observation(input: Omit<Agent007Observation, "id" | "createdAt">) { return (await httpsCallable<typeof input, { ok: boolean; observationId: string }>(functions, "recordAgent007Observation")(input)).data; }
export async function listAgent007Observations() { return (await httpsCallable<Record<string, never>, { ok: boolean; observations: Agent007Observation[] }>(functions, "listAgent007Observations")({})).data; }
export async function listAgent007Recommendations() { return (await httpsCallable<Record<string, never>, { ok: boolean; recommendations: Agent007Recommendation[] }>(functions, "listAgent007Recommendations")({})).data; }
export async function resolveAgent007Recommendation(recommendationId: string, decision: "APPROVED" | "REJECTED", correction = "") { return (await httpsCallable<{ recommendationId: string; decision: string; correction?: string }, { ok: boolean }>(functions, "resolveAgent007Recommendation")({ recommendationId, decision, correction })).data; }
export async function listAgent007Messages() { return (await httpsCallable<Record<string, never>, { ok: boolean; conversationId: string; messages: Agent007Message[] }>(functions, "listAgent007Messages")({})).data; }
export async function markAgent007MessagesRead() { return (await httpsCallable<Record<string, never>, { ok: boolean; marked: number }>(functions, "markAgent007MessagesRead")({})).data; }
export async function sendAgent007Message(text: string) { return (await httpsCallable<{ text: string }, { ok: boolean; conversationId: string; message: Agent007Message }>(functions, "sendAgent007Message")({ text })).data; }
