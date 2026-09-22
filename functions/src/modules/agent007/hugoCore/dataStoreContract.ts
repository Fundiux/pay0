import { HugoMemory, RecentEntity } from "./contextBuilder";

export type HugoConversationState = { history: any[]; memory: HugoMemory; recentEntities: RecentEntity[] };
export type HugoTraceFilter = { conversationId?: string; resultStatus?: string; tool?: string; sourceSystem?: string; completeness?: string; errorOnly?: boolean; from?: Date; to?: Date; cursor?: string; limit?: number };
export type HugoTurnInput = { rootId: string; uid: string; conversationId: string; text: string; reply: string; source: string; capability?: string | null; capabilityExecuted: boolean; contextSummary: any; recentEntities: RecentEntity[]; trace: Record<string, any>; traceId: string };
export interface HugoDataStore {
  loadConversationState(identity: { uid: string; rootId: string }, conversationId: string): Promise<HugoConversationState>;
  listObservations(rootId: string, limit?: number): Promise<any[]>;
  listRecommendations(rootId: string, limit?: number): Promise<any[]>;
  recordObservation(rootId: string, payload: Record<string, any>): Promise<string>;
  listMessages(rootId: string, uid: string, limit?: number): Promise<any[]>;
  markMessagesRead(rootId: string, uid: string): Promise<number>;
  saveTurn(input: HugoTurnInput): Promise<{ id: string; createdAt: unknown }>;
  saveErrorTrace(rootId: string, traceId: string, payload: Record<string, any>): Promise<void>;
  listTraces(rootId: string, filter: HugoTraceFilter): Promise<{ traces: any[]; cursor: string | null; complete: boolean; scanned: number }>;
  getTrace(rootId: string, id: string): Promise<any>;
}
