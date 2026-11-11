import { createHash } from "node:crypto";

// Pure rules for when an agent may answer in a WhatsApp group. No I/O and no sending here:
// the caller supplies what it observed and gets back a decision with a fixed text.

export const OBSERVATION_MS = 72 * 60 * 60 * 1000;
export const DEFAULT_HUMAN_WAIT_MS = 3 * 60 * 1000;
export const MAX_REPLY_AGE_MS = 30 * 60 * 1000;

export const REPLY_TEXTS = {
  processing: "Su solicitud ya se está procesando. No contamos con un tiempo estimado, ya que las solicitudes se atienden en el orden en que fueron llegando.",
  validating: "Permítanos validarlo, un momento por favor.",
} as const;

export type WorkingHours = { timezone: string; windows: { days: number[]; from: string; to: string }[] };
// Working hours the owner set on 2026-11-11 (Mexico City). Not applied by default: an agent with no hours configured never answers.
export const OWNER_WORKING_HOURS: WorkingHours = {
  timezone: "America/Mexico_City",
  windows: [{ days: [1, 2, 3, 4, 5], from: "07:30", to: "19:30" }, { days: [6], from: "08:00", to: "15:00" }],
};
export type AutoReplyConfig = { enabled?: boolean; humanWaitMs?: number; workingHours?: WorkingHours | null };
export type ReplyKind = "GREETING" | "PROCESSING" | "VALIDATING";
export type GroupMessage = { timestampMs: number; fromMe: boolean; authorIsOperator: boolean; type: string; body: string };
export type ReplyDecision = { action: "NONE"; reason: string } | { action: "REPLY"; kind: ReplyKind; text: string };

export type ReplyInput = {
  config: AutoReplyConfig;
  nowMs: number;
  firstObservedAtMs: number | null;
  message: GroupMessage;
  laterMessages: Pick<GroupMessage, "timestampMs" | "fromMe" | "authorIsOperator">[];
  hasOpenSolicitud: boolean;
  alreadyReplied: boolean;
  clientName?: string | null;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9? ]+/g, " ").replace(/\s+/g, " ").trim();
const BUSINESS = /\b(factura|facturas|transferencia|transferencias|comprobante|comprobantes|pago|pagos|dispersion|dispersiones|solicitud|solicitudes|oc|orden de compra|deposito|cfdi)\b/;
const QUESTION = /\?|\b(cuando|como|cual|cuales|donde|que paso|en que va|ya (esta|llego|salio|quedo|se)|me (puede|pueden|ayuda|ayudan)|podrian?|puedes?|hay (noticias|avance))\b/;
const GREETING = /^(hola|buenas|buen dias?|buenos dias|buenas tardes|buenas noches)( [a-z ]{0,25})?$/;

export type MessageKind = "GREETING" | "STATUS_INQUIRY" | "QUESTION" | "OTHER";

export function classifyMessage(body: string): MessageKind {
  const text = normalize(body);
  if (!text) return "OTHER";
  const question = QUESTION.test(text);
  if (BUSINESS.test(text) && question) return "STATUS_INQUIRY";
  if (text.length <= 40 && !BUSINESS.test(text) && !question && GREETING.test(text)) return "GREETING";
  return question ? "QUESTION" : "OTHER";
}

export function isWithinWorkingHours(hours: WorkingHours | null | undefined, nowMs: number): boolean {
  if (!hours?.windows?.length) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: hours.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  } catch { return false; }
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  return hours.windows.some(window => window.days.includes(day) && minutes >= toMinutes(window.from) && minutes < toMinutes(window.to));
}

export function decideGroupReply(input: ReplyInput): ReplyDecision {
  const { config, nowMs, message } = input;
  const none = (reason: string): ReplyDecision => ({ action: "NONE", reason });
  if (config.enabled !== true) return none("DISABLED");
  if (message.fromMe || message.authorIsOperator) return none("NOT_A_CLIENT_MESSAGE");
  if (message.type !== "chat" || !message.body.trim()) return none("NOT_TEXT");
  if (input.alreadyReplied) return none("ALREADY_REPLIED");
  // The first days in a group are only for learning: never answer before the observation period ends.
  if (input.firstObservedAtMs === null || nowMs - input.firstObservedAtMs < OBSERVATION_MS) return none("LEARNING_PERIOD");
  if (!isWithinWorkingHours(config.workingHours, nowMs)) return none("OFF_HOURS");
  if (input.laterMessages.some(later => later.timestampMs > message.timestampMs && (later.fromMe || later.authorIsOperator))) return none("HUMAN_ANSWERED");
  const age = nowMs - message.timestampMs;
  if (age > MAX_REPLY_AGE_MS) return none("TOO_OLD");

  const kind = classifyMessage(message.body);
  if (kind === "OTHER") return none("NOT_A_QUESTION");
  if (kind === "GREETING") {
    const name = (input.clientName || "").trim();
    return { action: "REPLY", kind: "GREETING", text: name ? `Buen día, ${name}.` : "Buen día." };
  }
  const waitMs = Number.isFinite(config.humanWaitMs) && (config.humanWaitMs as number) >= 0 ? (config.humanWaitMs as number) : DEFAULT_HUMAN_WAIT_MS;
  if (age < waitMs) return none("WAITING_FOR_HUMAN");
  // "Already processing" is only said when a real open request exists; otherwise the team validates first.
  if (kind === "STATUS_INQUIRY" && input.hasOpenSolicitud) return { action: "REPLY", kind: "PROCESSING", text: REPLY_TEXTS.processing };
  return { action: "REPLY", kind: "VALIDATING", text: REPLY_TEXTS.validating };
}

// The inbound store keeps only a hash of each author; this builds the hashes of a user's operator numbers
// in both forms WhatsApp uses for Mexico (52 and 521), matching how the connector hashes authors.
export function operatorAuthorHashes(rootId: string, numbers: string[]): Set<string> {
  const hashes = new Set<string>();
  for (const number of numbers) {
    const ten = /^52(\d{10})$/.exec(number)?.[1];
    if (!ten) continue;
    for (const authorId of [`52${ten}@c.us`, `521${ten}@c.us`]) hashes.add(createHash("sha256").update(`${rootId}|${authorId}`).digest("hex").slice(0, 32));
  }
  return hashes;
}
