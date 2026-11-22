import { decideGroupReply, type AutoReplyConfig, type ReplyKind } from "./domain";

// Pure planner for the group reply runner: from the recent messages of the groups an agent observes,
// it decides which replies to queue. No Firestore here; the runner supplies what it read.

export type ReplyMode = "GREETINGS_ONLY" | "STANDARD";

export type ReplyRuntimeConfig = AutoReplyConfig & { mode?: ReplyMode };

export type InboundRow = {
  id: string;
  chatId: string;
  authorHash: string | null;
  fromMe: boolean;
  timestampMs: number;
  type: string;
  body: string;
};

export type PlannedReply = {
  messageId: string;
  chatId: string;
  ownerUserUid: string;
  kind: ReplyKind;
  text: string;
};

export type PlanInput = {
  config: ReplyRuntimeConfig;
  nowMs: number;
  /** Recent messages of the observed groups, any order. */
  messages: InboundRow[];
  /** Only groups assigned to a user are ever answered, and only with that user's context. */
  ownerByChat: Record<string, string>;
  /** Hashes of every registered operator number of the root. */
  operatorHashes: ReadonlySet<string>;
  /** When each group was first observed; a group without a value is still learning. */
  firstObservedByChat: Record<string, number | null | undefined>;
  /** Messages that already have a queued reply. */
  repliedIds: ReadonlySet<string>;
  /** Whether the owner user has a request in progress (decides "already processing" vs "let us validate"). */
  hasOpenSolicitud: (ownerUserUid: string) => boolean;
  clientNameByOwner: Record<string, string>;
  /** Hard cap per run so a burst can never flood a group. */
  maxReplies?: number;
};

const MAX_REPLIES_PER_RUN = 5;

export function planGroupReplies(input: PlanInput): PlannedReply[] {
  const { config, nowMs } = input;
  if (config.enabled !== true) return [];
  const byChat = new Map<string, InboundRow[]>();
  for (const row of input.messages) {
    if (!input.ownerByChat[row.chatId]) continue;
    byChat.set(row.chatId, [...(byChat.get(row.chatId) || []), row]);
  }
  const planned: PlannedReply[] = [];
  const cap = input.maxReplies ?? MAX_REPLIES_PER_RUN;
  for (const [chatId, rows] of byChat) {
    const ownerUserUid = input.ownerByChat[chatId];
    // One reply per group per run: the first message that deserves it, oldest first.
    for (const row of [...rows].sort((a, b) => a.timestampMs - b.timestampMs)) {
      if (planned.length >= cap) return planned;
      const isOperator = !!row.authorHash && input.operatorHashes.has(row.authorHash);
      const decision = decideGroupReply({
        config,
        nowMs,
        firstObservedAtMs: input.firstObservedByChat[chatId] ?? null,
        message: { timestampMs: row.timestampMs, fromMe: row.fromMe, authorIsOperator: isOperator, type: row.type, body: row.body },
        laterMessages: rows
          .filter(other => other.timestampMs > row.timestampMs)
          .map(other => ({ timestampMs: other.timestampMs, fromMe: other.fromMe, authorIsOperator: !!other.authorHash && input.operatorHashes.has(other.authorHash) })),
        hasOpenSolicitud: input.hasOpenSolicitud(ownerUserUid),
        alreadyReplied: input.repliedIds.has(row.id),
        clientName: input.clientNameByOwner[ownerUserUid] || null,
      });
      if (decision.action !== "REPLY") continue;
      if (config.mode !== "STANDARD" && decision.kind !== "GREETING") continue;
      planned.push({ messageId: row.id, chatId, ownerUserUid, kind: decision.kind, text: decision.text });
      break;
    }
  }
  return planned;
}
