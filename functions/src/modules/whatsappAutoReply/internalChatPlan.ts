import { MENTION_TOKEN } from "./mention";

// Hugo in the team's internal group: he answers only when someone addresses him (a WhatsApp mention or his name) and only
// within a short, fixed script. He cannot resolve client matters there; he says so and points to the system. Pure planning:
// no Firestore and no sending here.

export type InternalKind = "INTERNAL_GREETING" | "INTERNAL_LIMITED";

export type InternalRow = {
  id: string;
  chatId: string;
  authorHash: string | null;
  fromMe: boolean;
  timestampMs: number;
  body: string;
  /** The connector saw a WhatsApp mention of Hugo's number. */
  mentionsMe?: boolean;
  /** WhatsApp id of the message, so the connector can mention the person who wrote. */
  waMessageId?: string;
};

export type InternalReply = { messageId: string; chatId: string; kind: InternalKind; text: string; mentionMessageId: string | null };

export const INTERNAL_MAX_AGE_MS = 10 * 60 * 1000;
export const INTERNAL_COOLDOWN_MS = 20 * 1000;

const NAME = /\bhugo\b/i;
const GREETING_ONLY = /^(hola|holi|holis|hey|ey|buen(o|a)?s?(\s+(dias?|tardes|noches))?|que tal|como estas?|como esta|saludos|ola)$/;

const normalize = (value: string) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Whether the message addresses Hugo: a WhatsApp mention of his number or his name. */
export function isAddressedToHugo(row: Pick<InternalRow, "body" | "mentionsMe">): boolean {
  return row.mentionsMe === true || NAME.test(normalize(row.body));
}

/** A bare greeting ("@Hugo buen día") gets the greeting; anything else gets the limited answer. */
export function internalKindOf(body: string): InternalKind {
  const rest = normalize(body).replace(/@\S+/g, " ").replace(/\bhugo\b/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return !rest || GREETING_ONLY.test(rest) ? "INTERNAL_GREETING" : "INTERNAL_LIMITED";
}

export const INTERNAL_TEXTS: Record<InternalKind, readonly string[]> = {
  INTERNAL_GREETING: [
    `Buen día, ${MENTION_TOKEN}. Aquí estoy, ¿en qué le puedo ayudar?`,
    `Buen día, ${MENTION_TOKEN}. Dígame, ¿qué necesita?`,
  ],
  INTERNAL_LIMITED: [
    `Gracias, ${MENTION_TOKEN}. Por este grupo todavía no puedo resolver esa consulta: solo les aviso de lo que detecto, como consultas de clientes sin respuesta o solicitudes de clientes sin grupo asignado. Para resolverla, háganlo desde el sistema o con quien corresponda.`,
    `Entendido, ${MENTION_TOKEN}. Aquí no puedo resolver ni decidir eso; mi función en este grupo es avisarles de lo que detecto en el sistema. Para atenderlo, por favor háganlo desde el sistema o con quien corresponda.`,
  ],
};

function pick<T>(variants: readonly T[], seed: string): T {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return variants[hash % variants.length];
}

export type InternalPlanInput = {
  nowMs: number;
  messages: InternalRow[];
  /** Hashes of the agents' own numbers: a message from another agent is never answered. */
  ignoreHashes: ReadonlySet<string>;
  repliedIds: ReadonlySet<string>;
  /** When Hugo last answered in each internal group. */
  lastReplyAtByChat: Record<string, number | undefined>;
};

/** At most one reply per internal group per run, oldest addressed message first. */
export function planInternalReplies(input: InternalPlanInput): InternalReply[] {
  const planned: InternalReply[] = [];
  const done = new Set<string>();
  for (const row of [...input.messages].sort((a, b) => a.timestampMs - b.timestampMs)) {
    if (done.has(row.chatId) || row.fromMe || input.repliedIds.has(row.id)) continue;
    if (row.authorHash && input.ignoreHashes.has(row.authorHash)) continue;
    if (input.nowMs - row.timestampMs > INTERNAL_MAX_AGE_MS || row.timestampMs > input.nowMs + 60 * 1000) continue;
    if (!isAddressedToHugo(row)) continue;
    const last = input.lastReplyAtByChat[row.chatId];
    if (last !== undefined && input.nowMs - last < INTERNAL_COOLDOWN_MS) continue;
    const kind = internalKindOf(row.body);
    done.add(row.chatId);
    planned.push({ messageId: row.id, chatId: row.chatId, kind, text: pick(INTERNAL_TEXTS[kind], row.id), mentionMessageId: row.waMessageId || null });
  }
  return planned;
}
