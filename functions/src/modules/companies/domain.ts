export type CanonicalCompanyIdentity = { nombre: string; rfc: string };

export function normalizeCompanyName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeCompanyRfc(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9Ãƒâ€˜&]/g, "");
}

export function normalizeCompanyIdentity(input: any): CanonicalCompanyIdentity {
  return { nombre: normalizeCompanyName(input?.nombre), rfc: normalizeCompanyRfc(input?.rfc) };
}

export function assertValidCompanyIdentity(input: CanonicalCompanyIdentity): void {
  if (input.nombre.length < 2) throwCompanyError("COMPANY_NAME_INVALID", "nombre invalido.");
  if (input.rfc.length < 12 || input.rfc.length > 13) throwCompanyError("COMPANY_RFC_INVALID", "rfc invalido.");
}

function throwCompanyError(code: string, message: string): never {
  const error = new Error(message) as Error & { code: string }; error.code = code; throw error;
}

export function companyBelongsToDispatch(company: any, despachoId: unknown): boolean {
  return Boolean(String(company?.despachoId ?? "").trim()) && String(company?.despachoId ?? "").trim() === String(despachoId ?? "").trim();
}

export function companyBelongsToRoot(company: any, rootId: unknown): boolean {
  const companyRootId=String(company?.rootId ?? "").trim(); return !companyRootId || companyRootId===String(rootId ?? "").trim();
}
