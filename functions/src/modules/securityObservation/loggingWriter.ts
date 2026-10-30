import type { LogEntry } from "./publisher";

/** Future transport only, intentionally not wired to listUsers. Runtime metadata
 * proves the sending workload to this adapter, not the original producer to the
 * receiver. Activation remains blocked pending additional producer authentication.
 * No ADC, keyfiles, financial SDK, retry, response-body log or arbitrary URL. */
export function createObservationLoggingWriter(options: {
  expectedServiceAccount: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 750;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]@pay-0-system\.iam\.gserviceaccount\.com$/.test(options.expectedServiceAccount) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 750) throw Error("INVALID_OBSERVATION_TRANSPORT");
  return async (entry: LogEntry): Promise<void> => {
    const controller = new AbortController(), signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    async function metadata(path: string, limit: number): Promise<string> {
      const response = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/" + path,
        { headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal });
      if (!response.ok || response.headers.get("metadata-flavor") !== "Google" || !response.body) {
        await response.body?.cancel(); throw Error("OBSERVATION_WRITE_FAILED");
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength; if (size > limit) throw Error("OBSERVATION_WRITE_FAILED");
          chunks.push(chunk.value);
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      } finally { await reader.cancel().catch(() => {}); }
    }
    try {
      // Event construction/whitelist belongs to the existing pure publisher.
      const body = JSON.stringify({ entries: [entry], partialSuccess: false });
      if (Buffer.byteLength(body) > 8192 || entry.logName !== "projects/pay-0-system/logs/pay0_security_observation" ||
          entry.resource.labels.project_id !== "pay-0-system") throw Error("OBSERVATION_WRITE_FAILED");
      const [email, project] = await Promise.all([
        metadata("instance/service-accounts/default/email", 256), metadata("project/project-id", 128),
      ]);
      if (email !== options.expectedServiceAccount || project !== "pay-0-system") throw Error("OBSERVATION_WRITE_FAILED");
      const token = JSON.parse(await metadata("instance/service-accounts/default/token", 8192));
      if (token.token_type !== "Bearer" || typeof token.access_token !== "string" ||
          !/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(token.access_token) || !Number.isFinite(token.expires_in) || token.expires_in < 30) throw Error("OBSERVATION_WRITE_FAILED");
      const response = await fetchImpl("https://logging.googleapis.com/v2/entries:write", {
        method: "POST", redirect: "error", signal,
        headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body,
      });
      await response.body?.cancel(); if (!response.ok) throw Error("OBSERVATION_WRITE_FAILED");
    } catch { throw Error("OBSERVATION_WRITE_FAILED"); }
    finally { clearTimeout(timer); controller.abort(); }
  };
}
