// The greeting mentions the person who wrote ("Buen día @cliente"). The server never knows or stores that person's number:
// it queues the text with a placeholder and the id of the inbound message; the connected WhatsApp resolves the author
// from that message at send time. If it cannot, the placeholder is removed and the greeting goes out without the mention.

export const MENTION_TOKEN = "{{MENCION}}";
export const GREETING_WITH_MENTION = `Buen día, ${MENTION_TOKEN}.`;

/** The text with no mention: what is sent when the author cannot be resolved. */
export const withoutMention = (text: string) => String(text ?? "").replace(/,?\s*\{\{MENCION\}\}/gi, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a message body is one of the texts Hugo itself sent. `sent` holds normalised (lower-case, single-spaced) texts as queued;
 * a text with the placeholder matches the sent body whether the mention was applied (@number) or dropped.
 */
export function matchesSentText(sent: ReadonlySet<string> | undefined, body: string, normalize: (value: string) => string): boolean {
  if (!sent) return false;
  const text = normalize(body);
  if (sent.has(text)) return true;
  const token = MENTION_TOKEN.toLowerCase();
  for (const candidate of sent) {
    if (!candidate.includes(token)) continue;
    if (normalize(withoutMention(candidate)) === text) return true;
    const pattern = candidate.split(token).map(escapeRegex).join("@\\S+");
    if (new RegExp(`^${pattern}$`).test(text)) return true;
  }
  return false;
}
