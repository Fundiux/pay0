import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Server-only AES-256-GCM envelope for personal commission bank instruments.
 * Key must come from a managed secret, never Firestore, browser bundles or source.
 * Caller must enforce rootId/ownerUid authorization before decrypting.
 */
export type EncryptedCommissionInstrument = {
  algorithm: "aes-256-gcm";
  keyVersion: string;
  iv: string;
  ciphertext: string;
  tag: string;
};
function parseKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("La clave de cifrado debe tener 32 bytes.");
  return key;
}
function context(rootId: string, ownerUid: string, accountId: string): Buffer {
  if (![rootId, ownerUid, accountId].every(value => typeof value === "string" && value.trim() && !value.includes("|"))) {
    throw new Error("Contexto de cuenta inválido.");
  }
  return Buffer.from(JSON.stringify([rootId, ownerUid, accountId]), "utf8");
}
export function encryptCommissionInstrument(input: {
  number: string;
  rootId: string;
  ownerUid: string;
  accountId: string;
  keyBase64: string;
  keyVersion: string;
}): EncryptedCommissionInstrument {
  if (!/^\d{16,19}$/.test(input.number) || !input.keyVersion.trim()) throw new Error("Instrumento o versión de clave inválidos.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", parseKey(input.keyBase64), iv);
  cipher.setAAD(context(input.rootId, input.ownerUid, input.accountId));
  const ciphertext = Buffer.concat([cipher.update(input.number, "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", keyVersion: input.keyVersion, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function decryptCommissionInstrument(input: {
  encrypted: EncryptedCommissionInstrument;
  rootId: string;
  ownerUid: string;
  accountId: string;
  keyBase64: string;
}): string {
  const envelope = input.encrypted;
  if (envelope.algorithm !== "aes-256-gcm") throw new Error("Algoritmo de cifrado no admitido.");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Sobre de cifrado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", parseKey(input.keyBase64), iv);
  decipher.setAAD(context(input.rootId, input.ownerUid, input.accountId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
