"use client";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type WhatsAppEnrollment = {
  id: string; ownerUid: string; rootId: string; publicKeyPem: string; challenge: string;
  createdAtMs: number; expiresAtMs: number; state: "PENDING";
};
export type WhatsAppBinding = {
  id: string; ownerUid: string; rootId: string; generation: number; state: "ACTIVE" | "REVOKED";
  externalAccountVerified: false;
};
// The caller presents the local worker's PUBLIC key for explicit human enrollment.
// Never send a worker private key to the browser or these endpoints.
export async function createWhatsAppConnectorEnrollment(publicKeyPem: string) {
  const fn = httpsCallable<{ publicKeyPem: string }, { ok: true; enrollment: WhatsAppEnrollment; externalAccountVerified: false }>(functions, "createWhatsAppConnectorEnrollment");
  return (await fn({ publicKeyPem })).data;
}
export async function getWhatsAppConnectorBinding() {
  const fn = httpsCallable<Record<string, never>, { ok: true; binding: WhatsAppBinding | null }>(functions, "getWhatsAppConnectorBinding");
  return (await fn({})).data;
}
export async function revokeWhatsAppConnectorBinding(bindingId: string) {
  const fn = httpsCallable<{ bindingId: string }, { ok: true; revoked: true }>(functions, "revokeWhatsAppConnectorBinding");
  return (await fn({ bindingId })).data;
}
