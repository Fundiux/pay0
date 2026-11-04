import { createHash, createPublicKey, verify } from "node:crypto";

export type WorkerAction = "SYNC_CHATS" | "NEW_QR" | "HEARTBEAT" | "INBOUND_GROUP";

export interface Enrollment {
  id: string;
  ownerUid: string;
  rootId: string;
  publicKeyPem: string;
  challenge: string;
  createdAtMs: number;
  expiresAtMs: number;
  state: "PENDING" | "CONSUMED" | "REVOKED";
}

export interface Binding {
  id: string;
  ownerUid: string;
  rootId: string;
  publicKeyPem: string;
  generation: number;
  state: "ACTIVE" | "REVOKED";
}

export interface EnrollmentProof {
  enrollmentId: string;
  signature: string;
}

export interface WorkerEnvelope {
  bindingId: string;
  generation: number;
  action: WorkerAction;
  nonce: string;
  issuedAtMs: number;
  dataHash: string;
  signature: string;
}

const MAX_CANONICAL_BYTES = 64 * 1024;
const MAX_CANONICAL_DEPTH = 12;
const MAX_PEM_CHARS = 2048;
const MAX_ENROLLMENT_LIFETIME_MS = 600_000;
const MAX_OPERATION_SKEW_MS = 60_000;

const ENROLLMENT_PREFIX = "PAY0-WA-ENROLL-V1";
const OPERATION_PREFIX = "PAY0-WA-OP-V1";

const ERROR_CANONICAL = "WA_POLICY_CANONICAL_INVALID";
const ERROR_PUBLIC_KEY = "WA_POLICY_PUBLIC_KEY_INVALID";
const ERROR_ENROLLMENT = "WA_POLICY_ENROLLMENT_INVALID";
const ERROR_WORKER = "WA_POLICY_WORKER_INVALID";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const LOWER_HEX_64 = /^[a-f0-9]{64}$/;
const SIGNATURE_BASE64URL = /^[A-Za-z0-9_-]{86}$/;
const CONTROL_OR_SLASH = /[\/\u0000-\u001f\u007f-\u009f]/;
const PUBLIC_KEY_PEM =
  /^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/]{1,64}\r?\n)*[A-Za-z0-9+/]{2,64}={0,2}\r?\n-----END PUBLIC KEY-----\r?\n?$/;


function fail(code: string): never {
  throw new Error(code);
}


function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}


function assertExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: string,
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail(code);
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== "string")
  ) {
    fail(code);
  }

  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.some((key, index) => key !== sortedExpected[index])) {
    fail(code);
  }

  for (const key of actualKeys) {
    if (FORBIDDEN_KEYS.has(key)) {
      fail(code);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      fail(code);
    }
  }
}


function quoteString(value: string): string {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") {
    fail(ERROR_CANONICAL);
  }
  return encoded;
}


function canonicalize(
  value: unknown,
  depth: number,
  active: WeakSet<object>,
): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    fail(ERROR_CANONICAL);
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return quoteString(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail(ERROR_CANONICAL);
    }
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") {
      fail(ERROR_CANONICAL);
    }
    return encoded;
  }

  if (typeof value !== "object") {
    fail(ERROR_CANONICAL);
  }

  if (active.has(value)) {
    fail(ERROR_CANONICAL);
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key !== "string")) {
        fail(ERROR_CANONICAL);
      }

      for (const key of ownKeys as string[]) {
        if (key === "length") {
          continue;
        }
        if (FORBIDDEN_KEYS.has(key) || !/^(0|[1-9][0-9]*)$/.test(key)) {
          fail(ERROR_CANONICAL);
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
          fail(ERROR_CANONICAL);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !Object.prototype.hasOwnProperty.call(descriptor, "value")
        ) {
          fail(ERROR_CANONICAL);
        }
      }

      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          fail(ERROR_CANONICAL);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !Object.prototype.hasOwnProperty.call(descriptor, "value")
        ) {
          fail(ERROR_CANONICAL);
        }
        items.push(canonicalize(descriptor.value, depth + 1, active));
      }

      if (ownKeys.length !== value.length + 1) {
        fail(ERROR_CANONICAL);
      }
      return "[" + items.join(",") + "]";
    }

    if (!isPlainObject(value)) {
      fail(ERROR_CANONICAL);
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      fail(ERROR_CANONICAL);
    }

    const keys = (ownKeys as string[]).sort();
    const fields: string[] = [];
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) {
        fail(ERROR_CANONICAL);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) {
        fail(ERROR_CANONICAL);
      }
      fields.push(
        quoteString(key) +
          ":" +
          canonicalize(descriptor.value, depth + 1, active),
      );
    }
    return "{" + fields.join(",") + "}";
  } finally {
    active.delete(value);
  }
}


function canonicalJson(value: unknown): string {
  const encoded = canonicalize(value, 0, new WeakSet<object>());
  if (Buffer.byteLength(encoded, "utf8") > MAX_CANONICAL_BYTES) {
    fail(ERROR_CANONICAL);
  }
  return encoded;
}


function assertIdentifier(value: unknown, code: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 180 ||
    CONTROL_OR_SLASH.test(value)
  ) {
    fail(code);
  }
}


function assertSafeNonnegativeInteger(
  value: unknown,
  code: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code);
  }
}


function assertPositiveSafeInteger(
  value: unknown,
  code: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(code);
  }
}


function assertAction(value: unknown, code: string): asserts value is WorkerAction {
  if (
    value !== "SYNC_CHATS" &&
    value !== "NEW_QR" &&
    value !== "HEARTBEAT" &&
    value !== "INBOUND_GROUP"
  ) {
    fail(code);
  }
}


function parsePublicKey(publicKeyPem: string) {
  if (
    typeof publicKeyPem !== "string" ||
    publicKeyPem.length < 1 ||
    publicKeyPem.length > MAX_PEM_CHARS ||
    !PUBLIC_KEY_PEM.test(publicKeyPem)
  ) {
    fail(ERROR_PUBLIC_KEY);
  }

  try {
    const key = createPublicKey(publicKeyPem);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      fail(ERROR_PUBLIC_KEY);
    }
    return key;
  } catch {
    fail(ERROR_PUBLIC_KEY);
  }
}


function decodeSignature(signature: unknown, code: string): Buffer {
  if (
    typeof signature !== "string" ||
    !SIGNATURE_BASE64URL.test(signature)
  ) {
    fail(code);
  }

  try {
    const decoded = Buffer.from(signature, "base64url");
    if (
      decoded.length !== 64 ||
      decoded.toString("base64url") !== signature
    ) {
      fail(code);
    }
    return decoded;
  } catch {
    fail(code);
  }
}


function verifyText(
  publicKeyPem: string,
  signingText: string,
  signature: unknown,
  code: string,
): void {
  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(signingText, "utf8"),
      parsePublicKey(publicKeyPem),
      decodeSignature(signature, code),
    );
  } catch {
    fail(code);
  }
  if (!valid) {
    fail(code);
  }
}


function assertEnrollmentShape(enrollment: Enrollment): void {
  assertExactRecord(
    enrollment,
    [
      "id",
      "ownerUid",
      "rootId",
      "publicKeyPem",
      "challenge",
      "createdAtMs",
      "expiresAtMs",
      "state",
    ],
    ERROR_ENROLLMENT,
  );
  assertIdentifier(enrollment.id, ERROR_ENROLLMENT);
  assertIdentifier(enrollment.ownerUid, ERROR_ENROLLMENT);
  assertIdentifier(enrollment.rootId, ERROR_ENROLLMENT);
  if (
    typeof enrollment.challenge !== "string" ||
    !LOWER_HEX_64.test(enrollment.challenge)
  ) {
    fail(ERROR_ENROLLMENT);
  }
  assertSafeNonnegativeInteger(enrollment.createdAtMs, ERROR_ENROLLMENT);
  assertSafeNonnegativeInteger(enrollment.expiresAtMs, ERROR_ENROLLMENT);
  if (
    enrollment.state !== "PENDING" &&
    enrollment.state !== "CONSUMED" &&
    enrollment.state !== "REVOKED"
  ) {
    fail(ERROR_ENROLLMENT);
  }
  assertPublicKey(enrollment.publicKeyPem);
}


function assertBindingShape(binding: Binding): void {
  assertExactRecord(
    binding,
    ["id", "ownerUid", "rootId", "publicKeyPem", "generation", "state"],
    ERROR_WORKER,
  );
  assertIdentifier(binding.id, ERROR_WORKER);
  assertIdentifier(binding.ownerUid, ERROR_WORKER);
  assertIdentifier(binding.rootId, ERROR_WORKER);
  assertPositiveSafeInteger(binding.generation, ERROR_WORKER);
  if (binding.state !== "ACTIVE" && binding.state !== "REVOKED") {
    fail(ERROR_WORKER);
  }
  try {
    assertPublicKey(binding.publicKeyPem);
  } catch {
    fail(ERROR_WORKER);
  }
}


function assertUnsignedEnvelope(
  envelope: Omit<WorkerEnvelope, "signature">,
): void {
  assertExactRecord(
    envelope,
    [
      "bindingId",
      "generation",
      "action",
      "nonce",
      "issuedAtMs",
      "dataHash",
    ],
    ERROR_WORKER,
  );
  assertIdentifier(envelope.bindingId, ERROR_WORKER);
  assertPositiveSafeInteger(envelope.generation, ERROR_WORKER);
  assertAction(envelope.action, ERROR_WORKER);
  if (typeof envelope.nonce !== "string" || !LOWER_HEX_64.test(envelope.nonce)) {
    fail(ERROR_WORKER);
  }
  assertSafeNonnegativeInteger(envelope.issuedAtMs, ERROR_WORKER);
  if (
    typeof envelope.dataHash !== "string" ||
    !LOWER_HEX_64.test(envelope.dataHash)
  ) {
    fail(ERROR_WORKER);
  }
}


export function canonicalDataHash(data: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(data), "utf8")
    .digest("hex");
}


export function enrollmentSigningText(enrollment: Enrollment): string {
  assertEnrollmentShape(enrollment);
  return (
    ENROLLMENT_PREFIX +
    "\n" +
    canonicalJson({
      challenge: enrollment.challenge,
      enrollmentId: enrollment.id,
      expiresAtMs: enrollment.expiresAtMs,
      ownerUid: enrollment.ownerUid,
      publicKeyPem: enrollment.publicKeyPem,
      rootId: enrollment.rootId,
    })
  );
}


export function operationSigningText(
  envelope: Omit<WorkerEnvelope, "signature">,
): string {
  assertUnsignedEnvelope(envelope);
  return OPERATION_PREFIX + "\n" + canonicalJson(envelope);
}


export function assertPublicKey(publicKeyPem: string): void {
  parsePublicKey(publicKeyPem);
}


export function assertEnrollmentProof(
  enrollment: Enrollment,
  proof: EnrollmentProof,
  nowMs: number,
): void {
  assertEnrollmentShape(enrollment);
  assertExactRecord(
    proof,
    ["enrollmentId", "signature"],
    ERROR_ENROLLMENT,
  );
  assertIdentifier(proof.enrollmentId, ERROR_ENROLLMENT);
  assertSafeNonnegativeInteger(nowMs, ERROR_ENROLLMENT);

  if (
    enrollment.state !== "PENDING" ||
    proof.enrollmentId !== enrollment.id ||
    nowMs < enrollment.createdAtMs ||
    nowMs >= enrollment.expiresAtMs ||
    enrollment.expiresAtMs <= enrollment.createdAtMs ||
    enrollment.expiresAtMs - enrollment.createdAtMs >
      MAX_ENROLLMENT_LIFETIME_MS
  ) {
    fail(ERROR_ENROLLMENT);
  }

  verifyText(
    enrollment.publicKeyPem,
    enrollmentSigningText(enrollment),
    proof.signature,
    ERROR_ENROLLMENT,
  );
}


export function assertWorkerEnvelope(
  binding: Binding,
  envelope: WorkerEnvelope,
  data: unknown,
  nowMs: number,
): void {
  assertBindingShape(binding);
  assertExactRecord(
    envelope,
    [
      "bindingId",
      "generation",
      "action",
      "nonce",
      "issuedAtMs",
      "dataHash",
      "signature",
    ],
    ERROR_WORKER,
  );
  assertUnsignedEnvelope({
    bindingId: envelope.bindingId,
    generation: envelope.generation,
    action: envelope.action,
    nonce: envelope.nonce,
    issuedAtMs: envelope.issuedAtMs,
    dataHash: envelope.dataHash,
  });
  assertSafeNonnegativeInteger(nowMs, ERROR_WORKER);

  let expectedDataHash: string;
  try {
    expectedDataHash = canonicalDataHash(data);
  } catch {
    fail(ERROR_WORKER);
  }

  if (
    binding.state !== "ACTIVE" ||
    envelope.bindingId !== binding.id ||
    envelope.generation !== binding.generation ||
    envelope.dataHash !== expectedDataHash ||
    Math.abs(nowMs - envelope.issuedAtMs) > MAX_OPERATION_SKEW_MS
  ) {
    fail(ERROR_WORKER);
  }

  verifyText(
    binding.publicKeyPem,
    operationSigningText({
      bindingId: envelope.bindingId,
      generation: envelope.generation,
      action: envelope.action,
      nonce: envelope.nonce,
      issuedAtMs: envelope.issuedAtMs,
      dataHash: envelope.dataHash,
    }),
    envelope.signature,
    ERROR_WORKER,
  );
}
