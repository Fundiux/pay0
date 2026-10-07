import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { loadCanonicalBundle, type CanonicalDocumentUse } from "../documents/canonicalBundle";
import { PAY0_CANONICAL_STORAGE } from "./contracts";
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), store = PAY0_CANONICAL_STORAGE;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const resourceId = (rootId: string, companyId: string, kind: string, key: string) => sha(`${rootId}:${companyId}:${kind}:${key}`);
const versionRef = (id: string, version: number) => db.collection(store.versions).doc(`${id}:${version}`);
async function resolveTemplateBundle(rootId: string, companyId: string, rfc: string, use: CanonicalDocumentUse) {
  const id = resourceId(rootId, companyId, "DOCUMENT_TEMPLATE", use);
  const resource = (await db.collection(store.resources).doc(id).get()).data();
  if (!resource?.activeVersion) {
    if (resource?.hasActivated) throw Error("CORPORATE_RESOURCE_ACTIVE_VERSION_REQUIRED");
    return loadCanonicalBundle(rfc, use);
  }
  if (resource.rootId !== rootId || resource.ownCompanyId !== companyId) throw Error("CORPORATE_RESOURCE_SCOPE_INVALID");
  const version = (await versionRef(id, resource.activeVersion).get()).data();
  const artifact = version?.artifacts?.find((row: any) => row.name === "bundle.json");
  if (version?.status !== "ACTIVE" || version.rootId !== rootId || !artifact || !artifact.storagePath.startsWith(`pay0-canonical/${rootId}/${companyId}/`)) throw Error("CORPORATE_RESOURCE_VERSION_INVALID");
  const [bytes] = await admin.storage().bucket().file(artifact.storagePath).download();
  if (sha(bytes) !== version.contentDigest) throw Error("CORPORATE_RESOURCE_INTEGRITY_INVALID");
  const bundle = JSON.parse(bytes.toString("utf8"));
  if (bundle.snapshot.companyRfc !== rfc || bundle.snapshot.documentUse !== use) throw Error("CORPORATE_RESOURCE_COMPANY_INVALID");
  return { ...bundle, logo: Buffer.from(bundle.logo, "base64"), reference: Buffer.alloc(0),
    snapshot: { ...bundle.snapshot, corporateResourceId: id, corporateResourceVersion: version.version } } as ReturnType<typeof loadCanonicalBundle>;
}

/** Consumers use their existing solicitud authorization; resource management is independent. */
export async function resolveCorporateDocumentBundle(rootId: string, companyId: string, rfc: string, use: CanonicalDocumentUse) {
  const bundle = await resolveTemplateBundle(rootId, companyId, rfc, use);
  const id = resourceId(rootId, companyId, "BRAND_STATIONERY", "LOGO");
  const resource = (await db.collection(store.resources).doc(id).get()).data();
  if (!resource?.activeVersion) {
    if (resource?.hasActivated) throw Error("CORPORATE_LOGO_ACTIVE_VERSION_REQUIRED");
    return bundle;
  }
  const version = (await versionRef(id, resource.activeVersion).get()).data();
  const artifact = version?.artifacts?.find((item: any) => ["image/png", "image/jpeg"].includes(item.contentType));
  if (resource.rootId !== rootId || resource.ownCompanyId !== companyId || version?.rootId !== rootId || version?.status !== "ACTIVE" ||
      !artifact || !artifact.storagePath.startsWith(`pay0-canonical/${rootId}/${companyId}/`)) throw Error("CORPORATE_LOGO_SCOPE_INVALID");
  const [logo] = await admin.storage().bucket().file(artifact.storagePath).download();
  if (sha(logo) !== version.contentDigest) throw Error("CORPORATE_LOGO_INTEGRITY_INVALID");
  return { ...bundle, logo: Buffer.from(logo), snapshot: { ...bundle.snapshot,
    templateBundleSha256: sha(Buffer.concat([Buffer.from(bundle.html), Buffer.from(bundle.css), logo])),
    corporateLogoResourceId: id, corporateLogoVersion: version.version, corporateLogoSha256: sha(logo) } };
}
