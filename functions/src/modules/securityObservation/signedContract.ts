/** Pure canonical contract. No network, credentials, logging or persistence. */
export const SIGNED_SCHEMA = "PAY0-SECURITY-SIGNED@1" as const;
export const SIGNED_LIMITS = Object.freeze({ canonicalBytes: 4096, payloadBytes: 8192, signatureBytes: 384, lifetimeMs: 86400000, skewMs: 60000 });
export type SignedTuple = [typeof SIGNED_SCHEMA, string, string, "pay-0-system", "listUsers", string, string, string, string, string, "AUTHORIZATION_DENIED", "SERVER_AUTH_DECISION", number, number, number];
const fail = (): never => { throw Error("INVALID_SIGNED_EVENT"); };
export const signedIdentifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function exactSignedObject(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const props = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== names.length || names.some(name => !props[name] || !Object.prototype.hasOwnProperty.call(props[name], "value"))) return fail();
  return value as Record<string, unknown>;
}
export function validateSignedTuple(value: unknown): SignedTuple {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 15 || Reflect.ownKeys(value).length !== 16) return fail();
  const props = Object.getOwnPropertyDescriptors(value);
  for (let i = 0; i < 15; i++) if (!props[String(i)] || !Object.prototype.hasOwnProperty.call(props[String(i)], "value")) return fail();
  if (value[0] !== SIGNED_SCHEMA || !signedIdentifier(value[1]) || typeof value[2] !== "string" || value[2].length > 512 ||
      !/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/us-central1\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,9}$/.test(value[2]) ||
      value[3] !== "pay-0-system" || value[4] !== "listUsers" || !value.slice(5, 9).every(signedIdentifier) ||
      typeof value[9] !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value[9]) ||
      value[10] !== "AUTHORIZATION_DENIED" || value[11] !== "SERVER_AUTH_DECISION" ||
      !value.slice(12).every(item => Number.isSafeInteger(item) && item >= 0)) return fail();
  const [occurred, issued, expires] = value.slice(12) as number[];
  if (!Number.isSafeInteger(occurred + SIGNED_LIMITS.lifetimeMs) || issued < occurred || issued > occurred + SIGNED_LIMITS.skewMs || expires !== occurred + SIGNED_LIMITS.lifetimeMs) return fail();
  return value as SignedTuple;
}
export function canonicalizeSignedTuple(value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(validateSignedTuple(value)), "utf8");
  if (bytes.length > SIGNED_LIMITS.canonicalBytes) return fail();
  return bytes;
}
export function decodeCanonicalBase64(value: unknown, maximumBytes: number): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(maximumBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return fail();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maximumBytes || bytes.toString("base64") !== value) return fail();
  return bytes;
}
export function decodeSignedPayload(payload: unknown, nowMs: number): { tuple: SignedTuple; bytes: Buffer; signature: Buffer } {
  const row = exactSignedObject(payload, ["schemaVersion", "context", "signedBytesB64", "signatureB64"]);
  const context = exactSignedObject(row.context, ["rootId", "actorUid"]);
  if (row.schemaVersion !== SIGNED_SCHEMA || !signedIdentifier(context.rootId) || !signedIdentifier(context.actorUid) ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) return fail();
  const bytes = decodeCanonicalBase64(row.signedBytesB64, SIGNED_LIMITS.canonicalBytes);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail(); }
  const tuple = validateSignedTuple(raw);
  if (!canonicalizeSignedTuple(tuple).equals(bytes) || tuple[7] !== context.rootId || tuple[8] !== context.actorUid ||
      tuple[13] > nowMs + SIGNED_LIMITS.skewMs || tuple[12] > nowMs + SIGNED_LIMITS.skewMs || nowMs >= tuple[14]) return fail();
  const signature = decodeCanonicalBase64(row.signatureB64, SIGNED_LIMITS.signatureBytes);
  if (signature.length !== SIGNED_LIMITS.signatureBytes || Buffer.byteLength(JSON.stringify(row), "utf8") > SIGNED_LIMITS.payloadBytes) return fail();
  return { tuple, bytes, signature };
}
