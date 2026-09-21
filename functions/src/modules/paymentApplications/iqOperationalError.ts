/** Keep IQ's functional rejection reason without persisting its response body. */
export function sanitizeIqOperationalError(value: unknown): string | null {
  const candidate = typeof value === "string" ? value :
    Array.isArray(value) && value.length <= 3 && value.every(item => typeof item === "string") ? value.join("; ") :
    value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).message === "string"
      ? (value as Record<string, string>).message : null;
  if (!candidate) return null;
  const cleaned = candidate.slice(0, 4096)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\bhttps?:\/\/[^\s<>"']+/gi, "[URL_REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[TOKEN_REDACTED]")
    .replace(/\b(?:cookie|set-cookie|authorization)\s*[:=]\s*.+$/gi, "[HEADER_REDACTED]")
    .replace(/\b(authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL_REDACTED]")
    .replace(/\b\d{8,}\b/g, "[NUMBER_REDACTED]")
    .replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 500) : null;
}
