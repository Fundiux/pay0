import type { ObservationCredential } from "./kmsSigner";
const BASE = "http://metadata.google.internal/computeMetadata/v1/";
const EMAIL = "instance/service-accounts/default/email";
const PROJECT = "project/project-id";
const TOKEN = "instance/service-accounts/default/token";
const failure = () => Error("OBSERVATION_CREDENTIAL_FAILED");
function live(signal: AbortSignal) { if (signal.aborted) throw failure(); }
function pending<T>(action: () => Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  live(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure()); signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { live(signal); return action(); }).then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) { late?.(value); reject(failure()); } else resolve(value);
    }, () => { signal.removeEventListener("abort", abort); reject(failure()); });
  });
}
/** Closed metadata response: only the three documented keys, without escaped
 * names or token text. Duplicate keys never survive JSON.parse last-write wins. */
function tokenResponse(text: string): { access_token: string; token_type: string; expires_in: number } {
  let at = 0; const fields: Record<string, unknown> = Object.create(null);
  const whitespace = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  whitespace(); if (text[at++] !== "{") throw failure();
  for (;;) {
    whitespace();
    const member = /"(access_token|token_type|expires_in)"[\x20\t\r\n]*:[\x20\t\r\n]*("[A-Za-z0-9._~+\/=-]*"|0|[1-9][0-9]*)/y;
    member.lastIndex = at; const match = member.exec(text);
    if (!match || Object.prototype.hasOwnProperty.call(fields, match[1])) throw failure();
    at = member.lastIndex; fields[match[1]] = JSON.parse(match[2]); whitespace();
    if (text[at] === "}") { at++; break; }
    if (text[at++] !== ",") throw failure();
  }
  whitespace();
  if (at !== text.length || Object.keys(fields).length !== 3 || fields.token_type !== "Bearer" ||
      typeof fields.access_token !== "string" || !/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(fields.access_token) ||
      typeof fields.expires_in !== "number" || !Number.isSafeInteger(fields.expires_in) || fields.expires_in < 30 || fields.expires_in > 3600) throw failure();
  return fields as { access_token: string; token_type: string; expires_in: number };
}
/** Explicit metadata-only port. Construction is inert; no ADC, env/keyfile or
 * external host fallback. The default metadata alias means the attached identity;
 * its email must equal the dedicated configured SA before a token is requested. */
export function createObservationMetadataCredential(options: {
  expectedServiceAccount: string; expectedProjectId: "pay-0-system";
  fetchImpl?: typeof fetch; timeoutMs?: number;
}): (parentSignal: AbortSignal) => Promise<ObservationCredential> {
  const { expectedServiceAccount, expectedProjectId, fetchImpl = fetch, timeoutMs = 750 } = options;
  if (expectedProjectId !== "pay-0-system" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@pay-0-system\.iam\.gserviceaccount\.com$/.test(expectedServiceAccount) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 750) throw failure();
  return async parentSignal => {
    if (!(parentSignal instanceof AbortSignal)) throw failure();
    const controller = new AbortController(), signal = controller.signal;
    const abort = () => controller.abort();
    parentSignal.addEventListener("abort", abort, { once: true }); if (parentSignal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    async function read(path: typeof EMAIL | typeof PROJECT | typeof TOKEN, maximum: number): Promise<string> {
      const response = await pending(() => fetchImpl(BASE + path, { method: "GET", headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal }), signal,
        late => { void late.body?.cancel().catch(() => {}); });
      if (response.status !== 200 || response.redirected || response.headers.get("metadata-flavor") !== "Google" || !response.body) {
        void response.body?.cancel().catch(() => {}); throw failure();
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) { void response.body.cancel().catch(() => {}); throw failure(); }
      if (path === TOKEN && !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") || "")) { void response.body.cancel().catch(() => {}); throw failure(); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          const item = await pending(() => reader.read(), signal); if (item.done) break;
          size += item.value.byteLength; if (size > maximum) throw failure(); chunks.push(item.value);
        }
        live(signal); return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
      } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); }
    }
    try {
      live(signal);
      const [email, project] = await Promise.all([read(EMAIL, 256), read(PROJECT, 128)]);
      if (email !== expectedServiceAccount || project !== expectedProjectId) throw failure();
      const token = tokenResponse(await read(TOKEN, 8192)); live(signal);
      return { accessToken: token.access_token, serviceAccount: email, projectId: project };
    } catch { throw failure(); }
    finally { clearTimeout(timer); parentSignal.removeEventListener("abort", abort); controller.abort(); }
  };
}
