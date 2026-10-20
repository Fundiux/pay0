import { createHash } from "node:crypto";
import { canonicalizeSignedTuple, decodeCanonicalBase64, signedIdentifier, SIGNED_LIMITS } from "./signedContract";

export type ObservationCredential = { accessToken: string; serviceAccount: string; projectId: string };
export type KmsSignerOptions = {
  keyVersion: string; allowedKeyVersions: string[]; expectedServiceAccount: string;
  audience: string; serviceName: string; revisionName: string; roots: string[]; actors: string[];
  credential: (signal: AbortSignal) => Promise<ObservationCredential>;
  fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number;
};
const error = () => Error("OBSERVATION_SIGN_FAILED");
const keyPattern = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/us-central1\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,9}$/;
export function observationCrc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function assertLive(signal: AbortSignal): void { if (signal.aborted) throw error(); }
/** Propagates cancellation and refuses late success even if an injected port ignores it. */
function cancellable<T>(operation: () => Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  assertLive(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(error());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { assertLive(signal); return operation(); }).then(
      value => { signal.removeEventListener("abort", abort); if (signal.aborted) { late?.(value); reject(error()); } else resolve(value); },
      () => { signal.removeEventListener("abort", abort); reject(error()); },
    );
  });
}
/** KMS response is a bounded flat object of strings/booleans. Reject duplicate
 * decoded keys before conversion; no dependency on a general JSON parser. */
function parseResponse(text: string): Record<string, string | boolean> {
  let at = 0; const result: Record<string, string | boolean> = Object.create(null);
  const whitespace = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  const string = () => {
    const token = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
    token.lastIndex = at; const match = token.exec(text); if (!match) throw error(); at = token.lastIndex;
    return JSON.parse(match[0]) as string;
  };
  whitespace(); if (text[at++] !== "{") throw error(); whitespace();
  if (text[at] === "}") throw error();
  for (;;) {
    const key = string(); whitespace(); if (Object.prototype.hasOwnProperty.call(result, key) || text[at++] !== ":") throw error(); whitespace();
    let value: string | boolean;
    if (text[at] === '"') value = string();
    else if (text.startsWith("true", at)) { value = true; at += 4; }
    else if (text.startsWith("false", at)) { value = false; at += 5; }
    else throw error();
    result[key] = value; whitespace();
    if (text[at] === "}") { at++; break; }
    if (text[at++] !== ",") throw error(); whitespace();
  }
  whitespace(); if (at !== text.length) throw error();
  const allowed = ["signature", "signatureCrc32c", "verifiedDigestCrc32c", "name", "verifiedDataCrc32c", "protectionLevel", "algorithm"];
  if (Object.keys(result).some(key => !allowed.includes(key))) throw error();
  return result;
}
async function readResponse(response: Response, signal: AbortSignal): Promise<Record<string, string | boolean>> {
  if (response.status !== 200 || response.redirected || !response.body ||
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") || "")) {
    void response.body?.cancel().catch(() => {}); throw error();
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096)) { void response.body.cancel().catch(() => {}); throw error(); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const item = await cancellable(() => reader.read(), signal);
      if (item.done) break;
      size += item.value.byteLength; if (size > 4096) throw error(); chunks.push(item.value);
    }
    assertLive(signal);
    return parseResponse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); }
}
/** Inert until explicitly invoked. The credential port is trusted and must honor
 * AbortSignal; it is not a caller-supplied assertion of workload identity.
 * No metadata adapter, listUsers wiring, Logging call, retry, or activation. */
export function createKmsObservationSigner(options: KmsSignerOptions) {
  const { credential, fetchImpl = fetch, now = Date.now, timeoutMs = 750 } = options;
  const config = { keyVersion: options.keyVersion, expectedServiceAccount: options.expectedServiceAccount,
    audience: options.audience, serviceName: options.serviceName, revisionName: options.revisionName,
    roots: [...options.roots], actors: [...options.actors], allowedKeyVersions: [...options.allowedKeyVersions] };
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 750 || typeof credential !== "function" ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@pay-0-system\.iam\.gserviceaccount\.com$/.test(config.expectedServiceAccount) ||
      ![config.audience, config.serviceName, config.revisionName].every(signedIdentifier) ||
      !config.allowedKeyVersions.length || config.allowedKeyVersions.length > 2 || new Set(config.allowedKeyVersions).size !== config.allowedKeyVersions.length ||
      config.allowedKeyVersions.some(key => typeof key !== "string" || key.length > 512 || !keyPattern.test(key)) || !config.allowedKeyVersions.includes(config.keyVersion) ||
      config.roots.length !== 1 || !config.roots.every(signedIdentifier) || !config.actors.length || config.actors.length > 100 || !config.actors.every(signedIdentifier)) throw error();
  const url = `https://cloudkms.googleapis.com/v1/${config.keyVersion}:asymmetricSign`;
  return async (tuple: unknown, parentSignal?: AbortSignal): Promise<{ signedBytesB64: string; signatureB64: string }> => {
    const controller = new AbortController(), signal = controller.signal;
    const parentAbort = () => controller.abort();
    const timer = setTimeout(parentAbort, timeoutMs);
    parentSignal?.addEventListener("abort", parentAbort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    try {
      assertLive(signal);
      const bytes = canonicalizeSignedTuple(tuple);
      // Use a snapshot decoded from canonical bytes, never mutable caller data after await.
      const row = JSON.parse(bytes.toString("utf8")); const stamp = now();
      if (!Number.isSafeInteger(stamp) || stamp < 0 || row[1] !== config.audience || row[2] !== config.keyVersion ||
          row[5] !== config.serviceName || row[6] !== config.revisionName || !config.roots.includes(row[7]) || !config.actors.includes(row[8]) ||
          row[13] > stamp + SIGNED_LIMITS.skewMs || stamp >= row[14]) throw error();
      const identity = await cancellable(() => credential(signal), signal);
      if (!identity || identity.projectId !== "pay-0-system" || identity.serviceAccount !== config.expectedServiceAccount ||
          typeof identity.accessToken !== "string" || !/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(identity.accessToken)) throw error();
      const digest = createHash("sha256").update(bytes).digest();
      const response = await cancellable(() => fetchImpl(url, { method: "POST", redirect: "error", signal,
        headers: { Authorization: `Bearer ${identity.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ digest: { sha256: digest.toString("base64") }, digestCrc32c: String(observationCrc32c(digest)) }),
      }), signal, late => { void late.body?.cancel().catch(() => {}); });
      const result = await readResponse(response, signal);
      if (result.name !== config.keyVersion || result.verifiedDigestCrc32c !== true ||
          (result.verifiedDataCrc32c !== undefined && result.verifiedDataCrc32c !== false) ||
          (result.protectionLevel !== undefined && result.protectionLevel !== "SOFTWARE") ||
          (result.algorithm !== undefined && result.algorithm !== "RSA_SIGN_PSS_3072_SHA256") ||
          typeof result.signatureCrc32c !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(result.signatureCrc32c) || Number(result.signatureCrc32c) > 0xffffffff) throw error();
      const signature = decodeCanonicalBase64(result.signature, SIGNED_LIMITS.signatureBytes);
      if (signature.length !== SIGNED_LIMITS.signatureBytes || String(observationCrc32c(signature)) !== result.signatureCrc32c) throw error();
      assertLive(signal);
      return { signedBytesB64: bytes.toString("base64"), signatureB64: signature.toString("base64") };
    } catch { throw error(); }
    finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", parentAbort); controller.abort(); }
  };
}
