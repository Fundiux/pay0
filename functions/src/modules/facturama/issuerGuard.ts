import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

// Verified against the canonical PAY0 despacho, TROSTRE company and issuer
// configuration. New own companies need an explicit own-company flag and
// Facturama capability on the same PAY0 despacho; an RFC or legacy flag alone
// never grants access to PAY0's fiscal provider.
export const PAY0_ROOT_ID = "Ab4z0RttIqXbZFT0NuWsDjBkt6J2";
export const PAY0_DISPATCH_ID = "vjq4SEnucenerXvoLqtK";
export const TROSTRE_COMPANY_ID = "jSwDsbuGRJrNnHqiXlKe";
export const TROSTRE_RFC = "TRO230717L64";

const clean = (value: unknown) => String(value ?? "").trim();
const rfc = (value: unknown) => clean(value).toUpperCase();

export function belongsToPay0Dispatch(rootId: unknown, despachoId: unknown): boolean {
  return clean(rootId) === PAY0_ROOT_ID && clean(despachoId) === PAY0_DISPATCH_ID;
}

export function ownIssuerIdentityReason(input: {
  rootId: string; companyId: string; company: any; dispatch: any;
}): string | null {
  const { rootId, companyId, company, dispatch } = input;
  if (!belongsToPay0Dispatch(rootId, company?.despachoId) ||
      clean(company?.rootId) !== rootId || clean(dispatch?.rootId) !== rootId ||
      company?.active === false || company?.isActive === false || company?.deleted === true ||
      company?.isDeleted || company?.deletedAt || dispatch?.active === false ||
      dispatch?.isActive === false || dispatch?.deleted === true || dispatch?.isDeleted ||
      dispatch?.deletedAt) return "NOT_PAY0_OWN_DISPATCH";
  if (company?.isOwnCompany === false || company?.facturamaEnabled === false ||
      ["EXTERNA", "EXTERNAL"].includes(clean(company?.ownership).toUpperCase())) return "OWN_CAPABILITY_DISABLED";
  if (companyId === TROSTRE_COMPANY_ID && rfc(company?.rfc) === TROSTRE_RFC) return null;
  if (company?.isOwnCompany === true && company?.facturamaEnabled === true &&
      /^[A-Z&\u00D1]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc(company?.rfc))) return null;
  return "OWN_COMPANY_NOT_AUTHORIZED";
}

export function fiscalIssuerReason(input: {
  rootId: string; companyId: string; company: any; dispatch: any; config: any;
}): string | null {
  const identityReason = ownIssuerIdentityReason(input);
  if (identityReason) return identityReason;
  const { rootId, companyId, company, config } = input;
  if (!config || clean(config.rootId) !== rootId || clean(config.companyId) !== companyId ||
      config.active === false || config.facturamaEnabled === false) return "ISSUER_CONFIG_NOT_AUTHORIZED";
  if (clean(config.csdRegistrationStatus) !== "REGISTERED_API_MULTIISSUER" ||
      rfc(config.csdRfc) !== rfc(company.rfc)) return "CSD_RFC_MISMATCH_OR_UNREGISTERED";
  return null;
}

export async function loadPay0IssuerGuard(input: {
  db: Firestore; rootId: string; companyId: string; requireCsd?: boolean;
}) {
  const { db, rootId, companyId } = input;
  if (clean(rootId) !== PAY0_ROOT_ID || !companyId || companyId.includes("/")) {
    return { allowed: false as const, reason: "NOT_PAY0_ROOT", company: null, config: null };
  }
  const [companySnap, dispatchSnap] = await Promise.all([
    db.doc(`companies/${companyId}`).get(),
    db.doc(`despachos/${PAY0_DISPATCH_ID}`).get(),
  ]);
  const company = companySnap.exists ? companySnap.data() || {} : null;
  const dispatch = dispatchSnap.exists ? dispatchSnap.data() || {} : null;
  const identityReason = !company || !dispatch ? "OWN_RELATION_NOT_FOUND" :
    ownIssuerIdentityReason({ rootId, companyId, company, dispatch });
  if (identityReason || input.requireCsd === false) {
    return { allowed: !identityReason, reason: identityReason, company, config: null };
  }
  const configSnap = await db.doc(`facturamaIssuerConfigs/${companyId}`).get();
  const config = configSnap.exists ? configSnap.data() || {} : null;
  const reason = fiscalIssuerReason({ rootId, companyId, company, dispatch, config });
  return { allowed: !reason, reason, company, config };
}

export async function assertPay0Issuer(input: {
  db: Firestore; rootId: string; companyId: string; requireCsd?: boolean;
}) {
  const result = await loadPay0IssuerGuard(input);
  if (!result.allowed) {
    console.warn("FACTURAMA_ISSUER_REJECTED", { rootId: input.rootId, companyId: input.companyId, reason: result.reason });
    throw new HttpsError("failed-precondition", `Emisor Facturama no autorizado: ${result.reason}.`);
  }
  return { ...result, company: result.company as Record<string, any> };
}
