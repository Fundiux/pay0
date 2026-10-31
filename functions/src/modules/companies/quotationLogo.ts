import * as admin from "firebase-admin";
import { createHash } from "crypto";

/**
 * Logo an issuing company shows on its quotations when it has no canonical
 * package of its own. Issuers are not own companies, so this lives on the
 * company record (Despachos > empresa) instead of in Recursos corporativos.
 */
export const QUOTATION_LOGO_MAX_BYTES = 1024 * 1024;
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

export type CompanyQuotationLogo = {
  storagePath: string; sha256: string; contentType: "image/png" | "image/jpeg"; sizeBytes: number; fileName: string;
};

/** Accepts only real PNG or JPEG bytes, whatever the browser claimed. */
export function inspectQuotationLogo(bytes: Buffer): { contentType: CompanyQuotationLogo["contentType"]; extension: string } {
  if (!bytes.length || bytes.length > QUOTATION_LOGO_MAX_BYTES) throw Error("QUOTATION_LOGO_SIZE_INVALID");
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  throw Error("QUOTATION_LOGO_FORMAT_INVALID");
}

export function quotationLogoPrefix(rootId: string, companyId: string): string {
  return `company-quotation-logos/${rootId}/${companyId}/`;
}

export async function storeCompanyQuotationLogo(rootId: string, companyId: string, bytes: Buffer, fileName: string): Promise<CompanyQuotationLogo> {
  const { contentType, extension } = inspectQuotationLogo(bytes);
  const digest = sha(bytes);
  const storagePath = `${quotationLogoPrefix(rootId, companyId)}${digest}.${extension}`;
  await admin.storage().bucket().file(storagePath).save(bytes, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
  return { storagePath, sha256: digest, contentType, sizeBytes: bytes.length, fileName: String(fileName || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) };
}

/** The stored logo, checked against its scope and digest; null when the company has none. */
export async function loadCompanyQuotationLogo(rootId: string, companyId: string, company: any): Promise<{ bytes: Buffer; sha256: string } | null> {
  const logo = company?.quotationLogo;
  if (!logo?.storagePath) return null;
  if (company.rootId !== rootId || !String(logo.storagePath).startsWith(quotationLogoPrefix(rootId, companyId))) throw Error("QUOTATION_LOGO_SCOPE_INVALID");
  const [bytes] = await admin.storage().bucket().file(logo.storagePath).download();
  if (sha(bytes) !== logo.sha256) throw Error("QUOTATION_LOGO_INTEGRITY_INVALID");
  return { bytes, sha256: logo.sha256 };
}
