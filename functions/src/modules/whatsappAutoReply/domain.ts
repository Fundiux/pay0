import { createHash } from "node:crypto";

// Pure rules for when an agent may answer in a WhatsApp group. No I/O and no sending here:
// the caller supplies what it observed and gets back a decision with a fixed text.

export const OBSERVATION_MS = 72 * 60 * 60 * 1000;
export const DEFAULT_HUMAN_WAIT_MS = 3 * 60 * 1000;
export const MAX_REPLY_AGE_MS = 30 * 60 * 1000;

// Fixed, warm wordings. Each situation has a few variants so the agent does not sound like a robot; the variant is chosen
// from the message id, so the same message always gets the same wording. A status reply names what the client asked about
// (transfer or invoice), one or the other, never both, and never promises a time.
export const REPLY_TEXT_VARIANTS = {
  VALIDATING: [
    "Con gusto lo revisamos. Permítanos validarlo, un momento por favor.",
    "Gracias por avisarnos. Permítanos validarlo y en un momento le confirmamos.",
    "Enseguida lo revisamos. Permítanos validarlo, un momento por favor.",
  ],
  PROCESSING: {
    TRANSFER: [
      "Gracias por su paciencia. Su transferencia ya se encuentra en proceso y, en cuanto contemos con el comprobante, se lo compartiremos de inmediato. Entendemos la urgencia y estamos trabajando en ello.",
      "Con gusto le informamos que su transferencia ya está en proceso. Tan pronto tengamos el comprobante se lo compartimos de manera inmediata. Agradecemos mucho su confianza y su paciencia.",
      "Entendemos que es importante para usted. Su transferencia se encuentra en proceso y, en cuanto contemos con el comprobante, se lo compartiremos de inmediato.",
    ],
    INVOICE: [
      "Gracias por su paciencia. Su solicitud de factura ya se encuentra en proceso y, en cuanto contemos con la factura, se la compartiremos de inmediato. Entendemos la urgencia y estamos trabajando en ello.",
      "Con gusto le informamos que su solicitud de factura ya está en proceso. Tan pronto tengamos la factura se la compartimos de manera inmediata. Agradecemos mucho su confianza y su paciencia.",
      "Entendemos que es importante para usted. Su factura se encuentra en proceso y, en cuanto la tengamos lista, se la compartiremos de inmediato.",
    ],
  },
  REQUEST_DATA: {
    TRANSFER: [
      "Con gusto lo revisamos. Para ubicar su transferencia, ¿nos podría confirmar el nombre del cliente, o de la empresa o persona que realizó el pago? Permítanos validarlo, un momento por favor.",
      "Gracias por escribirnos. Para ayudarle más rápido con su transferencia, ¿nos confirma por favor el nombre del cliente, o de la empresa o persona que realizó el pago? Lo validamos enseguida.",
    ],
    INVOICE: [
      "Con gusto lo revisamos. Para ubicar su solicitud de factura, ¿nos podría confirmar el nombre del cliente, o de la empresa o persona que realizó el pago? Permítanos validarlo, un momento por favor.",
      "Gracias por escribirnos. Para ayudarle más rápido con su factura, ¿nos confirma por favor el nombre del cliente, o de la empresa o persona que realizó el pago? Lo validamos enseguida.",
    ],
  },
} as const;

function pickVariant<T>(variants: readonly T[], seed: string): T {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return variants[hash % variants.length];
}

/** The text for a status reply. A subject that is neither a transfer nor an invoice can only get the neutral wording. */
export function replyText(kind: "VALIDATING" | "PROCESSING" | "REQUEST_DATA", subject: "TRANSFER" | "INVOICE" | "OTHER", seed: string): string {
  if (kind === "VALIDATING" || subject === "OTHER") return pickVariant(REPLY_TEXT_VARIANTS.VALIDATING, seed);
  return pickVariant(REPLY_TEXT_VARIANTS[kind][subject], seed);
}

export type WorkingHours = { timezone: string; windows: { days: number[]; from: string; to: string }[] };
// Working hours the owner set on 2026-11-11 (Mexico City). Not applied by default: an agent with no hours configured never answers.
export const OWNER_WORKING_HOURS: WorkingHours = {
  timezone: "America/Mexico_City",
  windows: [{ days: [1, 2, 3, 4, 5], from: "07:30", to: "19:30" }, { days: [6], from: "08:00", to: "15:00" }],
};
export type AutoReplyConfig = { enabled?: boolean; humanWaitMs?: number; workingHours?: WorkingHours | null };
export type ReplyKind = "GREETING" | "PROCESSING" | "VALIDATING" | "REQUEST_DATA";
// Replies in the internal team group are kept apart in internalChatPlan.ts (INTERNAL_GREETING, INTERNAL_LIMITED).
/** What the system lookup found for the client's request: FOUND, NOT_FOUND, or UNKNOWN when it could not be checked. */
export type RequestLookup = "FOUND" | "NOT_FOUND" | "UNKNOWN";
export type GroupMessage = { timestampMs: number; fromMe: boolean; authorIsOperator: boolean; type: string; body: string };
export type ReplyDecision = { action: "NONE"; reason: string } | { action: "REPLY"; kind: ReplyKind; text: string };

export type ReplyInput = {
  config: AutoReplyConfig;
  nowMs: number;
  firstObservedAtMs: number | null;
  message: GroupMessage;
  laterMessages: Pick<GroupMessage, "timestampMs" | "fromMe" | "authorIsOperator">[];
  hasOpenSolicitud: boolean;
  /** When present it decides the status reply; UNKNOWN or absent falls back to hasOpenSolicitud. */
  requestLookup?: RequestLookup;
  /** Stable per message (its id): picks the wording variant. */
  seed?: string;
  alreadyReplied: boolean;
  clientName?: string | null;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9? ]+/g, " ").replace(/\s+/g, " ").trim();
const TRANSFER_WORDS = "transferencia|transferencias|tranferencia|tranferencias|trasferencia|trasferencias|transferncia|transferecia|transferensia|transfer|transferir|spei|dispersion|dispersiones|dispercion|pago a proveedor|pago al proveedor|envio de dinero|deposito";
const INVOICE_WORDS = "factura|facturas|cfdi|solicitud|solicitudes|oc|orden de compra|comprobante|comprobantes|cotizacion";
const BUSINESS = new RegExp(`\\b(${TRANSFER_WORDS}|${INVOICE_WORDS}|pago|pagos)\\b`);
const TRANSFER_SUBJECT = new RegExp(`\\b(${TRANSFER_WORDS})\\b`);
const INVOICE_SUBJECT = new RegExp(`\\b(${INVOICE_WORDS})\\b`);
// Ways a client asks how something is going, including polite requests for help and urgency.
const QUESTION = new RegExp([
  "\\?",
  "\\b(cuando|como|cual|cuales|donde|que paso|que pasa|que onda|en que va|en que quedo|como va|como vamos|como sigue|como quedo)\\b",
  "\\bya (esta|estan|llego|llegaron|salio|salieron|quedo|quedaron|se|lo|la|los|las|hay|tienen|vieron|hicieron|reflejo|aparece|aparecio)\\b",
  "\\b(me|nos) (puede|pueden|podria|podrian|podrias|ayuda|ayudan|apoya|apoyan|confirma|confirman|avisa|avisan|informa|informan|comparte|comparten)\\b",
  "\\b(apoyo|apoyarnos|apoyarme|ayuda|ayudarnos|ayudarme|favor de|por favor)\\b.*\\b(con|de|para)\\b",
  "\\b(nos|me) urge\\b|\\burge\\b|\\burgente\\b",
  "\\bpodrian?\\b|\\bpuedes?\\b|\\bpueden\\b",
  "\\bsaben\\b|\\bsabe\\b|\\bme confirman\\b|\\bconfirmen\\b",
  "\\bhay (noticias|avance|novedad|novedades|respuesta)\\b|\\balguna (noticia|novedad|respuesta)\\b|\\b(avance|estatus|status)\\b",
  "\\b(cuanto|cuanta) (falta|tarda|demora)\\b|\\bfalta (mucho|algo)\\b|\\bpara cuando\\b",
  "\\b(sigue|siguen) (pendiente|pendientes)\\b|\\b(aun|todavia) no\\b|\\bno (ha|han|me ha|nos ha|se ha) (llegado|salido|reflejado|quedado)\\b|\\bno se (refleja|ve|ha reflejado)\\b",
].join("|"));
const GREETING = /^(hola|buenas|buen dias?|buenos dias|buenas tardes|buenas noches)( [a-z ]{0,25})?$/;

export type StatusSubject = "TRANSFER" | "INVOICE" | "OTHER";

/** What a status question is about: a transfer (dispersion) or an invoice request (solicitud). */
export function statusSubject(body: string): StatusSubject {
  const text = normalize(body);
  const transfer = TRANSFER_SUBJECT.test(text), invoice = INVOICE_SUBJECT.test(text);
  if (transfer && !invoice) return "TRANSFER";
  if (invoice && !transfer) return "INVOICE";
  return "OTHER";
}

export type MessageKind = "GREETING" | "STATUS_INQUIRY" | "QUESTION" | "OTHER";

export function classifyMessage(body: string): MessageKind {
  const text = normalize(body);
  if (!text) return "OTHER";
  // A thank-you that mentions the request ("gracias, ya quedo la factura") is not a question.
  if (/\bgracias\b/.test(text) && !text.includes("?") && !/\b(me|nos) (puede|pueden|podria|podrian|podrias|ayuda|ayudan|apoya|apoyan|confirma|confirman)\b|\burge\b/.test(text)) return "OTHER";
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
  // Owner decision 2026-11-22: the agent greets from the first day. Every other reply still waits for the learning period.
  const kind = classifyMessage(message.body);
  const learning = input.firstObservedAtMs === null || nowMs - input.firstObservedAtMs < OBSERVATION_MS;
  if (learning && kind !== "GREETING") return none("LEARNING_PERIOD");
  if (!isWithinWorkingHours(config.workingHours, nowMs)) return none("OFF_HOURS");
  if (input.laterMessages.some(later => later.timestampMs > message.timestampMs && (later.fromMe || later.authorIsOperator))) return none("HUMAN_ANSWERED");
  const age = nowMs - message.timestampMs;
  if (age > MAX_REPLY_AGE_MS) return none("TOO_OLD");

  if (kind === "OTHER") return none("NOT_A_QUESTION");
  if (kind === "GREETING") {
    const name = (input.clientName || "").trim();
    return { action: "REPLY", kind: "GREETING", text: name ? `Buen día, ${name}.` : "Buen día." };
  }
  const waitMs = Number.isFinite(config.humanWaitMs) && (config.humanWaitMs as number) >= 0 ? (config.humanWaitMs as number) : DEFAULT_HUMAN_WAIT_MS;
  if (age < waitMs) return none("WAITING_FOR_HUMAN");
  // "Already processing" is only said when a real open request exists; otherwise the team validates first.
  const seed = input.seed || String(message.timestampMs);
  if (kind === "STATUS_INQUIRY") {
    // Without knowing whether it is a transfer or an invoice, the reply cannot name it: only the neutral wording fits.
    const subject = statusSubject(message.body);
    if (subject !== "OTHER") {
      // The system was checked: say it is in process only when it really is there; when it is not, ask the client who it is for.
      if (input.requestLookup === "FOUND") return { action: "REPLY", kind: "PROCESSING", text: replyText("PROCESSING", subject, seed) };
      if (input.requestLookup === "NOT_FOUND") return { action: "REPLY", kind: "REQUEST_DATA", text: replyText("REQUEST_DATA", subject, seed) };
      if (input.hasOpenSolicitud) return { action: "REPLY", kind: "PROCESSING", text: replyText("PROCESSING", subject, seed) };
    }
  }
  return { action: "REPLY", kind: "VALIDATING", text: replyText("VALIDATING", "OTHER", seed) };
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
