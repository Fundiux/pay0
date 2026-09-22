import { EvidenceBoundary, canStateGlobalTotal } from "./contextBuilderV2";

export const EXHAUSTIVENESS_POLICY_VERSION = "exhaustiveness-v1";
export function checkExhaustiveness(text: string, boundaries: EvidenceBoundary[]): { allowed: boolean; reason: string | null } {
  if (canStateGlobalTotal(boundaries)) return { allowed: true, reason: null };
  const claim = /\b(en total|todos? los? (pagos?|solicitudes?)|todas? las? solicitudes?|no hay (pagos?|solicitudes?)|ning[uú]n (pago|solicitud)|el [uú]nico (pago|solicitud)|son los [uú]nicos)\b/i.test(text);
  return claim ? { allowed: false, reason: "UNSUPPORTED_EXHAUSTIVE_CLAIM" } : { allowed: true, reason: null };
}
