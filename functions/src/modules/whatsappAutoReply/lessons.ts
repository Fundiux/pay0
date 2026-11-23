import { classifyMessage, isWithinWorkingHours, MAX_REPLY_AGE_MS, statusSubject, type StatusSubject, type WorkingHours } from "./domain";
import type { InboundRow } from "./planner";

// Stage 1 of Hugo's learning: capture only. Nothing here changes what Hugo sends.
// Lessons are per group (each client writes differently) and never keep the client's raw message:
// a phrase is stored masked (no digits, emails, links or capitalised names) and short.

export const LESSONS = "whatsappAgentLessons";
export const CORRECTION_CATEGORIES = ["WRONG_FACT", "TONE", "NOT_NEEDED", "TOO_LATE", "OTHER"] as const;
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

export const MASKED_PHRASE_MAX = 140;

/** Masks a client phrase so a lesson can describe how clients ask without keeping who or how much. */
export function maskPhrase(text: string): string {
  const masked = String(text ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[enlace]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\d[\d.,\s-]*\d|\d/g, "#")
    // A capitalised word in the middle of a sentence is most likely a person or company.
    .replace(/(?<=[a-záéíóúñ,;:]\s)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*/g, "[nombre]")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return masked.slice(0, MASKED_PHRASE_MAX);
}

export const correctionLessonId = (jobId: string) => `corr__${jobId}`;
export const missedLessonId = (rootId: string, messageId: string) => `miss__${rootId.slice(0, 40)}__${messageId}`.slice(0, 200);

export type MissedQuestion = {
  messageId: string;
  chatId: string;
  kind: "STATUS_INQUIRY" | "QUESTION";
  subject: StatusSubject | null;
  phrase: string;
  /** The message arrived inside Hugo's working hours: a miss outside them is expected, not a gap. */
  withinHours: boolean;
};

export type MissedInput = {
  messages: InboundRow[];
  /** Only acting groups are passed here: ownerByChat holds exactly those. */
  ownerByChat: Record<string, string>;
  operatorHashes: ReadonlySet<string>;
  repliedIds: ReadonlySet<string>;
  nowMs: number;
  workingHours: WorkingHours | null;
};

/**
 * Client questions nobody answered: Hugo is acting in the group, the message is past the point where Hugo may still reply,
 * no reply was queued and no person (operator or the connected number) wrote afterwards. Each one is a gap to learn from.
 */
export function findMissedQuestions(input: MissedInput): MissedQuestion[] {
  const found: MissedQuestion[] = [];
  const byChat = new Map<string, InboundRow[]>();
  for (const row of input.messages) if (input.ownerByChat[row.chatId]) byChat.set(row.chatId, [...(byChat.get(row.chatId) || []), row]);
  for (const [chatId, rows] of byChat) {
    for (const row of rows) {
      if (row.fromMe || (row.authorHash && input.operatorHashes.has(row.authorHash)) || input.repliedIds.has(row.id)) continue;
      if (input.nowMs - row.timestampMs <= MAX_REPLY_AGE_MS) continue;
      const kind = classifyMessage(row.body);
      if (kind !== "STATUS_INQUIRY" && kind !== "QUESTION") continue;
      const answered = rows.some(other => other.timestampMs > row.timestampMs && (other.fromMe || (!!other.authorHash && input.operatorHashes.has(other.authorHash))));
      if (answered) continue;
      found.push({
        messageId: row.id, chatId, kind, subject: kind === "STATUS_INQUIRY" ? statusSubject(row.body) : null,
        phrase: maskPhrase(row.body), withinHours: isWithinWorkingHours(input.workingHours, row.timestampMs),
      });
    }
  }
  return found;
}

export function isCorrectionCategory(value: unknown): value is CorrectionCategory {
  return typeof value === "string" && (CORRECTION_CATEGORIES as readonly string[]).includes(value);
}
