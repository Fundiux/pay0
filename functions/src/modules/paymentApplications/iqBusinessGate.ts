export type IqCompanyDespachoGateInput = {
  rootId: unknown;
  despachoId: unknown;
  companyId: unknown;
  company: Record<string, unknown>;
  sourceLabel: unknown;
};

export type IqCompanyDespachoGateResult =
  | { ok: true; companyId: string; despachoId: string }
  | { ok: false; code: string; message: string; companyId: string; despachoId: string };

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function evaluateIqCompanyDespachoGate(
  input: IqCompanyDespachoGateInput,
): IqCompanyDespachoGateResult {
  const rootId = cleanText(input.rootId);
  const despachoId = cleanText(input.despachoId);
  const companyId = cleanText(input.companyId);
  const sourceLabel = cleanText(input.sourceLabel) || "La operacion";
  const companyRootId = cleanText(input.company.rootId ?? input.company.ownerRootId);
  const companyDespachoId = cleanText(input.company.despachoId ?? input.company.firmId);

  if (!despachoId) {
    return { ok: false, code: "IQ_DESPACHO_REQUIRED", message: sourceLabel + " no tiene despacho IQ canonico.", companyId, despachoId };
  }
  if (!companyId) {
    return { ok: false, code: "IQ_COMPANY_REQUIRED", message: sourceLabel + " no tiene empresa emisora canonica.", companyId, despachoId };
  }
  if (!companyRootId || companyRootId !== rootId) {
    return { ok: false, code: "IQ_COMPANY_OUT_OF_SCOPE", message: "La empresa emisora de " + sourceLabel + " esta fuera del scope autorizado.", companyId, despachoId };
  }
  if (!companyDespachoId) {
    return { ok: false, code: "IQ_COMPANY_WITHOUT_DESPACHO", message: "La empresa emisora de " + sourceLabel + " no pertenece al catalogo de empresas del despacho IQ.", companyId, despachoId };
  }
  if (companyDespachoId !== despachoId) {
    return { ok: false, code: "IQ_COMPANY_DESPACHO_MISMATCH", message: "La empresa emisora de " + sourceLabel + " pertenece a otro despacho y no puede enviarse a este IQ.", companyId, despachoId };
  }
  return { ok: true, companyId, despachoId };
}
