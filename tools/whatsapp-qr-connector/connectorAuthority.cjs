"use strict";
// Explicitly invoked transport. Importing this file starts no process/session and reads no credential/file/environment.
const crypto = require("node:crypto");
function createWorkerKey() {
  const pair = crypto.generateKeyPairSync("ed25519");
  return { publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
function createAuthorityTransport({ baseUrl, privateKeyPem, binding, policy, fetchImpl = globalThis.fetch }) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error("HTTPS_ENDPOINT_REQUIRED");
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw Error("ED25519_REQUIRED");
  const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  policy.assertPublicKey(publicKeyPem);
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const sameKey = pem => {
    policy.assertPublicKey(pem);
    return crypto.createPublicKey(pem).export({ type: "spki", format: "der" }).equals(publicKeyDer);
  };
  if (binding && !sameKey(binding.publicKeyPem)) throw Error("LOCAL_BINDING_KEY_MISMATCH");
  async function call(name, data) {
    const response = await fetchImpl(url.href.replace(/\/$/, "") + "/" + name, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(30000),
      redirect: "error", credentials: "omit",
    });
    if (!response.ok) throw Error("AUTHORITY_REQUEST_FAILED");
    const body = await response.json();
    if (body.error || !body.result?.ok) throw Error("AUTHORITY_REJECTED");
    return body.result;
  }
  const sign = text => crypto.sign(null, Buffer.from(text, "utf8"), privateKey).toString("base64url");
  async function consume(enrollment) {
    if (binding) throw Error("ALREADY_ENROLLED");
    if (!sameKey(enrollment.publicKeyPem)) throw Error("ENROLLMENT_KEY_MISMATCH");
    const result = await call("consumeWhatsAppConnectorEnrollment", { enrollmentId: enrollment.id, signature: sign(policy.enrollmentSigningText(enrollment)) });
    if (result.binding?.id !== enrollment.id || result.binding.rootId !== enrollment.rootId || result.binding.ownerUid !== enrollment.ownerUid ||
        !sameKey(result.binding.publicKeyPem) || result.binding.state !== "ACTIVE" || result.binding.generation !== 1) throw Error("ENROLLMENT_RECEIPT_MISMATCH");
    binding = result.binding;
    return result;
  }
  async function operate(action, data) {
    if (!binding) throw Error("ENROLLMENT_REQUIRED");
    const unsigned = { bindingId: binding.id, generation: binding.generation, action, nonce: crypto.randomBytes(32).toString("hex"),
      issuedAtMs: Date.now(), dataHash: policy.canonicalDataHash(data) };
    const envelope = { ...unsigned, signature: sign(policy.operationSigningText(unsigned)) };
    // Exactly one transport attempt. Unknown effects after a lost response are not retried with another nonce.
    const result = await call("operateWhatsAppConnector", { envelope, data });
    if (result.bindingId !== binding.id || result.generation !== binding.generation || result.rootId !== binding.rootId) throw Error("OPERATION_RECEIPT_MISMATCH");
    return result;
  }
  async function synchronize(chats, commandId) {
    if (!Array.isArray(chats)) throw Error("CHATS_ARRAY_REQUIRED");
    const syncId = crypto.randomUUID();
    await operate("SYNC_CHATS", { phase: "BEGIN", syncId, ...(commandId ? { commandId } : {}) });
    let written = 0, quarantined = 0;
    const normalized = chats.map(chat => ({ chatId: String(chat?.id?._serialized || chat?.chatId || ""),
      name: String(chat?.name || chat?.formattedTitle || chat?.id?._serialized || "").slice(0, 500),
      isGroup: !!chat?.isGroup, archived: !!chat?.archived, pinned: !!chat?.pinned }));
    for (let i = 0; i < normalized.length; i += 50) {
      const result = await operate("SYNC_CHATS", { phase: "UPSERT", syncId, chats: normalized.slice(i, i + 50) });
      written += result.written; quarantined += result.quarantined;
    }
    for (let page = 0; page < 10000; page++) {
      const result = await operate("SYNC_CHATS", { phase: "FINISH", syncId });
      if (result.done === true) return { written, quarantined };
    }
    throw Error("SYNC_PAGE_LIMIT_REQUIRES_REVIEW");
  }
  return { consume, operate, synchronize, getBinding: () => binding && { ...binding } };
}
module.exports = { createWorkerKey, createAuthorityTransport };
