import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes } from "firebase/storage";
import { functions, storage } from "@/lib/firebaseClient";

export type CorporateResource = { id: string; title: string; ownCompanyId: string; resourceKind: string; stableKey: string; activeVersion: number | null; latestVersion: number };
export type CorporateVersion = { id: string; version: number; status: string; contentDigest?: string; comment?: string; createdAt?: string; payload?: { template?: { templateId: string; templateVersion: string; templateBundleSha256: string } }; artifacts?: Array<{ name: string; contentType: string; sizeBytes: number }> };
export type CorporateCompany = { id: string; name: string; rfc: string };
const call = async <T>(name: string, data: Record<string, unknown> = {}) => (await httpsCallable<Record<string, unknown>, T>(functions, name)(data)).data;

export const listCorporateResources = () => call<{ resources: CorporateResource[]; companies: CorporateCompany[]; truncated: boolean }>("listCorporateResources");
export const getCorporateResource = (resourceId: string) => call<{ resource: CorporateResource; versions: CorporateVersion[]; history: Array<{ id: string; action: string; version: number; createdAt: string }> }>("getCorporateResource", { resourceId });
export const prepareCorporateResourceMigration = (companyId: string) => call<{ candidates: Array<{ use: string; templateId: string; templateVersion: string; templateBundleSha256: string }>; reason?: string }>("prepareCorporateResourceMigration", { companyId });
export const importCorporateResource = (companyId: string, use: string) => call<{ resourceId: string }>("importCorporateResource", { companyId, use });
export const changeCorporateVersion = (action: "approve" | "activate" | "restore" | "retire", resourceId: string, version: number) => call(
  { approve: "reviewCorporateResourceVersion", activate: "activateCorporateResourceVersion", restore: "restoreCorporateResourceVersion", retire: "retireCorporateResourceVersion" }[action], { resourceId, version, ...(action === "approve" ? { approve: true } : {}) });
export const downloadCorporateResource = (resourceId: string, version: number, name: string) => call<{ url: string }>("getCorporateResourceDownloadUrl", { resourceId, version, name });
export async function uploadCorporateResource(input: { companyId: string; kind: string; key: string; title: string; file: File }) {
  const session = await call<{ sessionId: string; storagePath: string; resourceId: string }>("initCorporateResourceUpload", {
    companyId: input.companyId, kind: input.kind, key: input.key, title: input.title,
    contentType: input.file.type, sizeBytes: input.file.size,
  });
  await uploadBytes(ref(storage, session.storagePath), input.file, { contentType: input.file.type });
  await call("finalizeCorporateResourceUpload", { sessionId: session.sessionId });
  return session;
}
