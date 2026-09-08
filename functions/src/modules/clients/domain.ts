export type CanonicalClientIdentity = { name: string; rfc: string; email: string; whatsapp: string };

export function normalizeClientName(value: unknown): string { return String(value ?? "").trim(); }
export function normalizeClientRfc(value: unknown): string { return String(value ?? "").trim().toUpperCase(); }
export function normalizeClientEmail(value: unknown): string { return String(value ?? "").trim().toLowerCase(); }
export function normalizeClientWhatsapp(value: unknown): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return digits;
}

export function normalizeClientIdentity(input: any): CanonicalClientIdentity {
  return { name: normalizeClientName(input?.name), rfc: normalizeClientRfc(input?.rfc), email: normalizeClientEmail(input?.email), whatsapp: normalizeClientWhatsapp(input?.whatsapp) };
}

export function assertValidClientIdentity(input: CanonicalClientIdentity): void {
  if (input.name.length < 2) { const error=new Error("nombre invalido.") as Error & { code: string }; error.code="CLIENT_NAME_INVALID"; throw error; }
  if (input.whatsapp && !/^52\d{10}$/.test(input.whatsapp)) { const error=new Error("WhatsApp invalido. Usa un numero mexicano de 10 digitos con o sin lada 52.") as Error & { code: string }; error.code="CLIENT_WHATSAPP_INVALID"; throw error; }
}

export function getCanonicalClientDisplayName(data: any, fallback: string): string {
  return String(data?.name || data?.nombreComercial || data?.nombre || data?.razonSocial || data?.clienteNombre || fallback).trim();
}

export function clientBelongsToRoot(client: any, rootId: unknown): boolean { const value=String(client?.rootId ?? "").trim(); return !value || value===String(rootId ?? "").trim(); }
