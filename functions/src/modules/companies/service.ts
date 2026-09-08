export type CompanyActivePatchInput = { nextActive: boolean; updatedBy: string; updatedAt: unknown };

export function buildCompanyActivePatch(input: CompanyActivePatchInput) {
  return { active: Boolean(input.nextActive), updatedAt: input.updatedAt, updatedBy: String(input.updatedBy || "") };
}

export function buildCompanyCreateIdentity(input: { nombre: string; rfc: string }) {
  return { nombre: input.nombre, rfc: input.rfc, active: true };
}
