const DEFAULT_TIMEOUT_MS = 30_000;

function normalizedTimeout(value?: number): number {
  const candidate = Number(value ?? DEFAULT_TIMEOUT_MS);
  return Math.max(5_000, Math.min(candidate, 60_000));
}

/**
 * Bounded transport for IQ. Callers keep ownership of retry/idempotency policy;
 * this helper only prevents an external dependency from consuming the callable's
 * entire execution window.
 */
export async function fetchIq(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; operation: string } = { operation: "request" },
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalizedTimeout(options.timeoutMs));

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`IQ_HTTP_TIMEOUT:${options.operation}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
