// Display-only mirror of the server rule (iqLinkReadiness in functions): an account is white once IQ has it
// reconciled, orange until then. The dispersion callable enforces it; this only shows it.
type MethodLike = { iqLinkStatus?: unknown; iqBeneficiaryId?: unknown; iqAccountId?: unknown; iqLinksByCatalog?: unknown };

const text = (value: unknown) => String(value ?? "").trim();

export function isIqReconciled(method: MethodLike | null | undefined): boolean {
  if (!method) return false;
  const entries = method.iqLinksByCatalog && typeof method.iqLinksByCatalog === "object" ? Object.values(method.iqLinksByCatalog as Record<string, any>) : [];
  if (entries.some(entry => text(entry?.status).toUpperCase() === "LINKED" && entry?.nameDiffers !== true)) return true;
  return text(method.iqLinkStatus).toUpperCase() === "VERIFIED" && /^\d+$/.test(text(method.iqBeneficiaryId)) && /^\d+$/.test(text(method.iqAccountId));
}

export const IQ_PENDING_LABEL = "Pendiente de conciliar en IQ";
