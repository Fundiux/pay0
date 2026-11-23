import { mexicoDayStartMs } from "../documentDelivery/whatsappDeliveryDomain";
import { GREETING_WITH_MENTION } from "./mention";
import { classifyMessage, decideGroupReply, statusSubject, type AutoReplyConfig, type ReplyKind, type RequestLookup, type StatusSubject } from "./domain";

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
  /** The WhatsApp id of the message: the connector resolves its author to mention them. */
  waMessageId?: string;
};

export type LastReply = { lastReplyAtMs: number; lastKind: string; lastSubject: string | null; lastGreetingAtMs: number | null };

export const REPEAT_COOLDOWN_MS = 30 * 60 * 1000;

/** Turn memory: why a decided reply must be skipped for this group, or null. */
export function repeatBlockReason(last: LastReply | undefined, kind: string, subject: string | null, nowMs: number): "ALREADY_GREETED_TODAY" | "REPEAT_COOLDOWN" | null {
  if (!last) return null;
  if (kind === "GREETING") return last.lastGreetingAtMs != null && mexicoDayStartMs(last.lastGreetingAtMs) === mexicoDayStartMs(nowMs) ? "ALREADY_GREETED_TODAY" : null;
  return last.lastKind === kind && (last.lastSubject ?? null) === (subject ?? null) && nowMs - last.lastReplyAtMs < REPEAT_COOLDOWN_MS ? "REPEAT_COOLDOWN" : null;
}

export type PlannedReply = {
  messageId: string;
  chatId: string;
  ownerUserUid: string;
  kind: ReplyKind;
  text: string;
  /** What the client asked about, when it was a status question. */
  subject: StatusSubject | null;
  /** The request was not found in the system: the internal team should be told. */
  notifyInternal: boolean;
  /** The greeting mentions whoever wrote this message; the connector resolves them at send time. */
  mentionMessageId?: string | null;
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
  /** Looks the client's request up in the system. Absent means it is not checked (the neutral reply is used). */
  lookupRequest?: (ownerUserUid: string, subject: StatusSubject, row: InboundRow) => RequestLookup;
  clientNameByOwner: Record<string, string>;
  /** Turn memory of each group: what Hugo last answered. Greets once per day and does not repeat the same answer too soon. */
  lastReplyByChat?: Record<string, LastReply | undefined>;
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
      const isStatus = classifyMessage(row.body) === "STATUS_INQUIRY", subject = isStatus ? statusSubject(row.body) : "OTHER" as StatusSubject;
      const decision = decideGroupReply({
        config,
        nowMs,
        firstObservedAtMs: input.firstObservedByChat[chatId] ?? null,
        message: { timestampMs: row.timestampMs, fromMe: row.fromMe, authorIsOperator: isOperator, type: row.type, body: row.body },
        laterMessages: rows
          .filter(other => other.timestampMs > row.timestampMs)
          .map(other => ({ timestampMs: other.timestampMs, fromMe: other.fromMe, authorIsOperator: !!other.authorHash && input.operatorHashes.has(other.authorHash) })),
        hasOpenSolicitud: input.hasOpenSolicitud(ownerUserUid),
        requestLookup: isStatus ? input.lookupRequest?.(ownerUserUid, subject, row) : undefined,
        alreadyReplied: input.repliedIds.has(row.id),
        seed: row.id,
        clientName: input.clientNameByOwner[ownerUserUid] || null,
      });
      if (decision.action !== "REPLY") continue;
      if (repeatBlockReason(input.lastReplyByChat?.[chatId], decision.kind, isStatus ? subject : null, nowMs)) continue;
      if (config.mode !== "STANDARD" && decision.kind !== "GREETING") continue;
      // "Buen día @cliente": the greeting mentions the person who wrote, from the first day. Without a message id it falls back to the plain greeting.
      const mention = decision.kind === "GREETING" && row.waMessageId ? row.waMessageId : null;
      planned.push({ messageId: row.id, chatId, ownerUserUid, kind: decision.kind, text: mention ? GREETING_WITH_MENTION : decision.text, subject: isStatus ? subject : null, notifyInternal: decision.kind === "REQUEST_DATA", ...(mention ? { mentionMessageId: mention } : {}) });
      break;
    }
  }
  return planned;
}
