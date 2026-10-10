import { randomUUID } from "node:crypto";
import { canonicalizeSignedTuple, exactSignedObject, signedIdentifier, SIGNED_SCHEMA } from "./signedContract";
import { createKmsObservationSigner } from "./kmsSigner";
import type { ObservationCredential } from "./kmsSigner";
import { createObservationMetadataCredential } from "./metadataCredential";
import type { ObservationResource, ObservationResult } from "./publisher";

/** Production capability stays closed; there is no env/boolean activation path. */
export const signedLoggingObservationPort = Object.freeze({
  authorizationDenied: async (_context: unknown): Promise<ObservationResult> => "DISABLED",
});
const failed = () => Error("OBSERVATION_WRITE_FAILED");
function live(signal: AbortSignal) { if (signal.aborted) throw failed(); }
function pending<T>(action: () => Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  live(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(failed()); signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { live(signal); return action(); }).then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) { late?.(value); reject(failed()); } else resolve(value);
    }, () => { signal.removeEventListener("abort", abort); reject(failed()); });
  });
}
async function confirmLogging(response: Response, signal: AbortSignal) {
  if (response.status !== 200 || response.redirected) {
    void response.body?.cancel().catch(() => {}); throw failed();
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) { void response.body?.cancel().catch(() => {}); throw failed(); }
  if (!response.body) { if (length !== null && Number(length) !== 0) throw failed(); live(signal); return; }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const item = await pending(() => reader.read(), signal); if (item.done) break;
      size += item.value.byteLength; if (size > 1024) throw failed(); chunks.push(item.value);
    }
    live(signal);
    const body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    if (body.length && (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") || "") ||
        !/^[\x20\t\r\n]*\{[\x20\t\r\n]*\}[\x20\t\r\n]*$/.test(body))) throw failed();
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); }
}
/** Prepared capability for synthetic tests and a separately reviewed future
 * composition. Nothing imports it from a deployed handler. Caller context must
 * come from verified auth and a freshly reread profile, never a request body. */
type SignedLoggingWriterOptions = {
  resource: ObservationResource; audience: string; keyVersion: string; allowedKeyVersions: string[];
  expectedServiceAccount: string; roots: string[]; actors: string[];
  window: { issuedAtMs: number; startsAtMs: number; endsAtMs: number };
  credential?: (signal: AbortSignal) => Promise<ObservationCredential>;
  fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number;
};
export function createPreparedSignedLoggingWriter(options: SignedLoggingWriterOptions) {
  const resource = { ...options.resource }, now = options.now || Date.now, rawFetch = options.fetchImpl || fetch;
  const window = exactSignedObject(options.window, ["issuedAtMs", "startsAtMs", "endsAtMs"]);
  const issued = window.issuedAtMs as number, starts = window.startsAtMs as number, ends = window.endsAtMs as number;
  if (![issued, starts, ends].every(value => Number.isSafeInteger(value) && value >= 0) ||
      issued > starts || starts >= ends || ends - issued > 3600000) throw failed();
  let highestClock = -1, closed = false;
  const windowTime = () => {
    const stamp = now();
    if (closed || !Number.isSafeInteger(stamp) || stamp < 0 || stamp < highestClock || stamp >= ends) { closed = true; throw failed(); }
    highestClock = stamp;
    if (stamp < starts) throw failed();
    return stamp;
  };
  // A supplied fixed window is never recomputed from the clock. Every metadata,
  // KMS and Logging request rechecks it; clock rollback closes this writer forever.
  const fetchImpl: typeof fetch = (url, init) => { windowTime(); return rawFetch(url, init); };
  const timeoutMs = options.timeoutMs ?? 750;
  if (resource.projectId !== "pay-0-system" || ![resource.serviceName, resource.revisionName, resource.configurationName].every(signedIdentifier) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 750) throw failed();
  const signerConfig = { keyVersion: options.keyVersion, allowedKeyVersions: [...options.allowedKeyVersions], expectedServiceAccount: options.expectedServiceAccount,
    audience: options.audience, serviceName: resource.serviceName, revisionName: resource.revisionName, roots: [...options.roots], actors: [...options.actors], fetchImpl, now: windowTime };
  const credential = options.credential || createObservationMetadataCredential({ expectedServiceAccount: signerConfig.expectedServiceAccount, expectedProjectId: "pay-0-system", fetchImpl });
  // Validate fixed signer configuration while construction still performs no I/O.
  createKmsObservationSigner({ ...signerConfig, credential });
  let minute = -1, attempts = 0, lifetimeAttempts = 0, busy = false;
  return Object.freeze({
    async authorizationDenied(trustedContext: unknown, parentSignal?: AbortSignal): Promise<ObservationResult> {
      let rootId: string, actorUid: string, timestamp: number, tuple: unknown[], id: string;
      try {
        const context = exactSignedObject(trustedContext, ["rootId", "actorUid"]);
        if (!signedIdentifier(context.rootId) || !signedIdentifier(context.actorUid) || !signerConfig.roots.includes(context.rootId) || !signerConfig.actors.includes(context.actorUid)) return "INVALID_CONTEXT";
        rootId = context.rootId; actorUid = context.actorUid;
        try { timestamp = windowTime(); } catch { return "DISABLED"; }
        id = randomUUID();
        tuple = [SIGNED_SCHEMA, signerConfig.audience, signerConfig.keyVersion, "pay-0-system", "listUsers", resource.serviceName, resource.revisionName,
          rootId, actorUid, id, "AUTHORIZATION_DENIED", "SERVER_AUTH_DECISION", timestamp, timestamp, timestamp + 86400000];
        canonicalizeSignedTuple(tuple);
      } catch { return "INVALID_CONTEXT"; }
      const window = Math.floor(timestamp / 60000);
      if (window !== minute) { minute = window; attempts = 0; }
      // Per factory/process only. Never described as global durable quotas.
      if (busy || attempts >= 6 || lifetimeAttempts >= 20) return "RATE_LIMITED";
      attempts++; lifetimeAttempts++; busy = true;
      const controller = new AbortController(), signal = controller.signal;
      const abort = () => controller.abort(); const timer = setTimeout(abort, timeoutMs);
      parentSignal?.addEventListener("abort", abort, { once: true }); if (parentSignal?.aborted) abort();
      try {
        const identity = { ...await pending(() => { windowTime(); return credential(signal); }, signal) };
        windowTime();
        const signer = createKmsObservationSigner({ ...signerConfig, credential: async childSignal => { live(childSignal); return identity; } });
        const signed = await pending(() => { windowTime(); return signer(tuple, signal); }, signal);
        windowTime();
        const entry = {
          logName: "projects/pay-0-system/logs/pay0_security_observation", resource: { type: "cloud_run_revision", labels: {
            project_id: resource.projectId, service_name: resource.serviceName, revision_name: resource.revisionName,
            configuration_name: resource.configurationName, location: "us-central1",
          } }, timestamp: new Date(timestamp).toISOString(), insertId: id, severity: "NOTICE",
          jsonPayload: { schemaVersion: SIGNED_SCHEMA, context: { rootId, actorUid }, ...signed },
        };
        const body = JSON.stringify({ entries: [entry], partialSuccess: false });
        if (Buffer.byteLength(body, "utf8") > 8192) throw failed();
        const response = await pending(() => fetchImpl("https://logging.googleapis.com/v2/entries:write", { method: "POST", redirect: "error", signal,
          headers: { Authorization: "Bearer " + identity.accessToken, "Content-Type": "application/json" }, body }), signal,
          late => { void late.body?.cancel().catch(() => {}); });
        await confirmLogging(response, signal); live(signal); windowTime();
        return "ACCEPTED";
      } catch { return "WRITE_FAILED"; }
      finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", abort); controller.abort(); busy = false; }
    },
  });
}

// Future composition must acquire one writer once, outside a handler. This slot
// accepts one configuration object for the module lifetime; it cannot replace a
// used/expired writer or reset its budgets by passing a fresh configuration.
// It is not imported by production and does not change the DISABLED port above.
let preparedComposition: { configuration: SignedLoggingWriterOptions; writer: ReturnType<typeof createPreparedSignedLoggingWriter> } | undefined;
export function getPreparedSignedLoggingComposition(configuration: SignedLoggingWriterOptions) {
  if (preparedComposition) {
    if (preparedComposition.configuration !== configuration) throw failed();
    return preparedComposition.writer;
  }
  const writer = createPreparedSignedLoggingWriter(configuration);
  preparedComposition = { configuration, writer };
  return writer;
}
