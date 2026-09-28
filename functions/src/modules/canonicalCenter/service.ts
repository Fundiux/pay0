import * as admin from "firebase-admin";
import { createHash, randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { logActivityTx } from "../../utils/logActivity";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { isOwnInvoiceIssuerCompany } from "../facturama/service";
import { canonicalCompanyCatalog, loadCanonicalBundle, type CanonicalDocumentUse } from "../documents/canonicalBundle";
import { PAY0_CANONICAL_STORAGE } from "./contracts";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), store = PAY0_CANONICAL_STORAGE;
const clean = (value: unknown, max = 180) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const uses: CanonicalDocumentUse[] = ["COTIZACION", "CONSTANCIA_ENTREGA_BIENES", "CONSTANCIA_SERVICIO"];
const resourceId = (rootId: string, companyId: string, kind: string, key: string) => sha(`${rootId}:${companyId}:${kind}:${key}`);
const versionRef = (id: string, version: number) => db.collection(store.versions).doc(`${id}:${version}`);
const artifactPrefix = (rootId: string, companyId: string, kind: string, id: string, version: number) => `pay0-canonical/${rootId}/${companyId}/${kind}/${id}/${version}`;
type Context = { uid: string; rootId: string };

async function context(request: any, action: "view" | "manage"): Promise<Context> {
  const uid = requireAuth(request), user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "corporateResources", requiredAction: action });
  const permission = user.modules?.corporateResources;
  if (permission === false || permission?.view === false || (action === "manage" && permission?.manage === false))
    throw new HttpsError("permission-denied", "El acceso a recursos corporativos está deshabilitado.");
  return { uid, rootId: clean(user.rootId || uid, 128) };
}
async function companyFor(ctx: Context, companyId: string) {
  if (!companyId || companyId.includes("/")) throw new HttpsError("invalid-argument", "Empresa requerida.");
  const row = (await db.doc(`companies/${companyId}`).get()).data();
  if (!row || row.active === false || row.rootId !== ctx.rootId || !isOwnInvoiceIssuerCompany(row))
    throw new HttpsError("permission-denied", "Selecciona una empresa propia activa de tu ámbito.");
  return { ...row, id: companyId, rfc: clean(row.rfc, 13).toUpperCase() };
}
async function resourceFor(ctx: Context, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "Recurso inválido.");
  const ref = db.collection(store.resources).doc(id), row = (await ref.get()).data();
  if (!row || row.rootId !== ctx.rootId) throw new HttpsError("not-found", "Recurso no disponible.");
  await companyFor(ctx, row.ownCompanyId);
  return { ref, row };
}
function audit(tx: FirebaseFirestore.Transaction, ctx: Context, id: string, action: string, version: number) {
  tx.create(db.collection(store.audit).doc(), { rootId: ctx.rootId, resourceId: id, version, action,
    actorUid: ctx.uid, createdAt: FieldValue.serverTimestamp() });
  logActivityTx(tx, db, { event: `PAY0_CORPORATE_RESOURCE_${action}`, rootId: ctx.rootId,
    actorUid: ctx.uid, actorRole: ctx.uid === "SYSTEM" ? "system" : "superadmin", referenceId: id, referenceType: "corporateResource",
    description: `Recurso corporativo: ${action.toLowerCase()}, versión ${version}.` });
}
function serial(row: FirebaseFirestore.DocumentSnapshot) {
  const data = row.data() || {};
  return { id: row.id, ...data, createdAt: data.createdAt?.toDate?.().toISOString() || null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() || null };
}

async function saveImmutable(path: string, bytes: Buffer, contentType: string) {
  const file = admin.storage().bucket().file(path);
  try {
    await file.save(bytes, { resumable: false, contentType, preconditionOpts: { ifGenerationMatch: 0 } });
  } catch (error: any) {
    if (Number(error?.code) !== 412) throw error;
    const [existing] = await file.download();
    if (sha(existing) !== sha(bytes)) throw new HttpsError("failed-precondition", "El objeto inmutable ya existe con otro contenido.");
  }
}

export const listCorporateResources = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "view");
  const [resources, companies] = await Promise.all([
    db.collection(store.resources).where("rootId", "==", ctx.rootId).limit(500).get(),
    db.collection("companies").where("rootId", "==", ctx.rootId).limit(500).get(),
  ]);
  return { ok: true, resources: resources.docs.map(serial), companies: companies.docs.filter(doc => doc.data().active !== false && isOwnInvoiceIssuerCompany(doc.data()))
    .map(doc => ({ id: doc.id, name: clean(doc.data().nombre || doc.data().razonSocial), rfc: clean(doc.data().rfc, 13) })), truncated: resources.size === 500 };
});

export const getCorporateResource = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "view"), id = clean(request.data?.resourceId);
  const { ref } = await resourceFor(ctx, id);
  const [versions, history] = await Promise.all([
    db.collection(store.versions).where("resourceId", "==", id).limit(200).get(),
    db.collection(store.audit).where("resourceId", "==", id).limit(200).get(),
  ]);
  return { ok: true, resource: serial(await ref.get()), versions: versions.docs.map(serial).sort((a: any, b: any) => b.version - a.version), history: history.docs.map(serial) };
});

export const prepareCorporateResourceMigration = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "view"), companyId = clean(request.data?.companyId, 128);
  const company = await companyFor(ctx, companyId);
  if (!canonicalCompanyCatalog().some(row => row.rfc === company.rfc)) return { ok: true, candidates: [], reason: "Esta empresa aún no tiene un paquete canónico registrado." };
  const candidates = uses.map(use => ({ use, ...loadCanonicalBundle(company.rfc, use).snapshot }));
  return { ok: true, candidates, readOnly: true, source: "Git / paquete canónico publicado", companyId };
});

async function createDraft(ctx: Context, input: { companyId: string; kind: string; key: string; title: string; comment: string; requireUnmanaged?: boolean }, payload: any) {
  const id = resourceId(ctx.rootId, input.companyId, input.kind, input.key), ref = db.collection(store.resources).doc(id);
  const version = await db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    if (input.requireUnmanaged && previous) throw new HttpsError("failed-precondition", "El recurso ya está administrado; se conserva su versión.");
    if (previous && previous.rootId !== ctx.rootId) throw new HttpsError("permission-denied", "Ámbito inválido.");
    const next = Number(previous?.latestVersion || 0) + 1;
    tx.set(ref, { schemaVersion: 1, rootId: ctx.rootId, ownCompanyId: input.companyId, resourceKind: input.kind,
      stableKey: input.key, title: input.title, activeVersion: previous?.activeVersion || null, latestVersion: next,
      scope: { system: "PAY0", rootId: ctx.rootId, ownCompanyId: input.companyId, environment: "PRODUCTION" },
      createdBy: previous?.createdBy || ctx.uid, createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
      updatedBy: ctx.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(versionRef(id, next), { schemaVersion: 1, rootId: ctx.rootId, resourceId: id, resourceKind: input.kind,
      ownCompanyId: input.companyId, version: next, status: "DRAFT", payload, contentDigest: null,
      comment: input.comment, createdBy: ctx.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, id, "DRAFT_CREATED", next);
    return next;
  });
  return { id, version };
}

async function publishDraft(ctx: Context, id: string, version: number, patch: Record<string, unknown>) {
  await db.runTransaction(async tx => {
    const ref = versionRef(id, version), row = (await tx.get(ref)).data();
    if (!row || row.rootId !== ctx.rootId || row.resourceId !== id || row.status !== "DRAFT")
      throw new HttpsError("failed-precondition", "La versión ya no está en borrador.");
    tx.update(ref, { ...patch, status: "REVIEW", updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, id, "READY_FOR_REVIEW", version);
  });
}

async function importCorporateResourceCore(ctx: Context, input: { companyId: string; use: CanonicalDocumentUse; comment?: string; requireUnmanaged?: boolean; resumeVersion?: number }) {
  const companyId = clean(input.companyId, 128);
  const company = await companyFor(ctx, companyId), use = input.use;
  if (!uses.includes(use)) throw new HttpsError("invalid-argument", "Tipo de plantilla inválido.");
  const bundle = loadCanonicalBundle(company.rfc, use);
  const encoded = Buffer.from(JSON.stringify({ html: bundle.html, css: bundle.css, logo: bundle.logo.toString("base64"), snapshot: bundle.snapshot }));
  const resumed = input.resumeVersion ? (await versionRef(resourceId(ctx.rootId, companyId, "DOCUMENT_TEMPLATE", use), input.resumeVersion).get()).data() : null;
  if (input.resumeVersion && (ctx.uid !== "SYSTEM" || !resumed || resumed.rootId !== ctx.rootId || resumed.createdBy !== "SYSTEM" ||
      resumed.payload?.migrationRevision !== "ASTRA_CANONICAL_MIGRATION_V1" || !["DRAFT", "REVIEW"].includes(resumed.status) ||
      (resumed.contentDigest && resumed.contentDigest !== sha(encoded)))) throw new HttpsError("failed-precondition", "El borrador de migración cambió.");
  const draft = input.resumeVersion ? { id: resourceId(ctx.rootId, companyId, "DOCUMENT_TEMPLATE", use), version: input.resumeVersion } :
    await createDraft(ctx, { companyId, kind: "DOCUMENT_TEMPLATE", key: use, title: `${use.replace(/_/g, " ")} · ${company.rfc}`, comment: clean(input.comment, 500) || "Importación del paquete canónico existente; sin cambio del consumidor hasta activar.", requireUnmanaged: input.requireUnmanaged },
      { use, companyRfc: company.rfc, template: bundle.snapshot, source: "BUNDLED_IMPORT", ...(input.requireUnmanaged ? { migrationRevision: "ASTRA_CANONICAL_MIGRATION_V1" } : {}) });
  const prefix = artifactPrefix(ctx.rootId, companyId, "DOCUMENT_TEMPLATE", draft.id, draft.version);
  const artifacts = [];
  for (const [name, bytes, contentType] of [["bundle.json", encoded, "application/json"], ["referencia.pdf", bundle.reference, "application/pdf"]] as const) {
    const storagePath = `${prefix}/${name}`;
    await saveImmutable(storagePath, bytes, contentType);
    artifacts.push({ name, storagePath, sha256: sha(bytes), contentType, sizeBytes: bytes.length });
  }
  if (resumed?.status !== "REVIEW") await publishDraft(ctx, draft.id, draft.version, { artifacts, contentDigest: sha(encoded) });
  return { ok: true, resourceId: draft.id, version: draft.version };
}

export const importCorporateResource = onCall({ region: "us-central1", timeoutSeconds: 90 }, async request => {
  const ctx = await context(request, "manage");
  return importCorporateResourceCore(ctx, { companyId: request.data?.companyId, use: request.data?.use, comment: request.data?.comment });
});

/** Internal maintenance only. No public Function exports this operation. */
export async function inspectBundledCorporateMigration(rootId: string, companyId: string) {
  const ctx = { uid: "SYSTEM", rootId }, company = await companyFor(ctx, companyId);
  if (!canonicalCompanyCatalog().some(row => row.rfc === company.rfc)) return [];
  return Promise.all(uses.map(async use => {
    const bundle = loadCanonicalBundle(company.rfc, use);
    const encoded = Buffer.from(JSON.stringify({ html: bundle.html, css: bundle.css, logo: bundle.logo.toString("base64"), snapshot: bundle.snapshot }));
    const id = resourceId(rootId, companyId, "DOCUMENT_TEMPLATE", use), row = await db.collection(store.resources).doc(id).get();
    return { companyId, use, resourceId: id, contentDigest: sha(encoded), companyRfc: company.rfc,
      managed: row.exists, activeVersion: row.data()?.activeVersion || null };
  }));
}

export async function migrateBundledCorporateResource(input: { rootId: string; companyId: string; use: CanonicalDocumentUse; expectedDigest: string }) {
  const ctx = { uid: "SYSTEM", rootId: input.rootId };
  const item = (await inspectBundledCorporateMigration(input.rootId, input.companyId)).find(row => row.use === input.use);
  if (!item || item.contentDigest !== input.expectedDigest) throw new HttpsError("failed-precondition", "El paquete cambió después del plan.");
  let resumeVersion: number | undefined;
  if (item.managed) {
    const resource = (await db.collection(store.resources).doc(item.resourceId).get()).data();
    const previous = resource?.latestVersion ? (await versionRef(item.resourceId, resource.latestVersion).get()).data() : null;
    if (resource && !resource.activeVersion && previous?.createdBy === "SYSTEM" && previous.payload?.migrationRevision === "ASTRA_CANONICAL_MIGRATION_V1" && ["DRAFT", "REVIEW"].includes(previous.status)) resumeVersion = resource.latestVersion;
    else return { ok: true, skipped: true, resourceId: item.resourceId, reason: "ALREADY_MANAGED" };
  }
  const result = await importCorporateResourceCore(ctx, { ...input, requireUnmanaged: true, resumeVersion,
    comment: "Migración ASTRA del paquete Git verificado; aprobación técnica de Sistema, sin sustituir recursos ya administrados." });
  await db.runTransaction(async tx => {
    const ref = db.collection(store.resources).doc(result.resourceId), version = versionRef(result.resourceId, result.version);
    const [resource, candidate, company] = await Promise.all([tx.get(ref), tx.get(version), tx.get(db.doc(`companies/${input.companyId}`))]);
    const row = candidate.data();
    if (!company.exists || company.get("rootId") !== input.rootId || company.get("active") === false || !isOwnInvoiceIssuerCompany(company.data()) ||
        clean(company.get("rfc"), 13).toUpperCase() !== item.companyRfc || resource.get("rootId") !== input.rootId ||
        resource.get("activeVersion") || resource.get("latestVersion") !== result.version || row?.status !== "REVIEW" ||
        row.createdBy !== "SYSTEM" || row.contentDigest !== input.expectedDigest || row.payload?.source !== "BUNDLED_IMPORT")
      throw new HttpsError("failed-precondition", "El recurso cambió durante la migración; conserva revisión manual.");
    tx.update(version, { status: "ACTIVE", reviewedBy: "SYSTEM", reviewedAt: FieldValue.serverTimestamp(),
      activatedBy: "SYSTEM", activatedAt: FieldValue.serverTimestamp(), migrationRevision: "ASTRA_CANONICAL_MIGRATION_V1" });
    tx.update(ref, { activeVersion: result.version, hasActivated: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: "SYSTEM" });
    audit(tx, ctx, result.resourceId, "APPROVED", result.version);
    audit(tx, ctx, result.resourceId, "ACTIVATED", result.version);
  });
  return { ...result, skipped: false };
}

export const reviewCorporateResourceVersion = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "manage"), id = clean(request.data?.resourceId), version = Number(request.data?.version);
  await resourceFor(ctx, id);
  await db.runTransaction(async tx => {
    const ref = versionRef(id, version), row = (await tx.get(ref)).data();
    if (!row || row.rootId !== ctx.rootId || row.status !== "REVIEW" || !row.contentDigest || !row.artifacts?.length)
      throw new HttpsError("failed-precondition", "La versión no está lista para revisión.");
    const status = request.data?.approve === true ? "APPROVED" : "RETIRED";
    tx.update(ref, { status, reviewedBy: ctx.uid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, id, status, version);
  });
  return { ok: true };
});

export const activateCorporateResourceVersion = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "manage"), id = clean(request.data?.resourceId), version = Number(request.data?.version);
  const { ref } = await resourceFor(ctx, id);
  await db.runTransaction(async tx => {
    const [resource, candidate] = await Promise.all([tx.get(ref), tx.get(versionRef(id, version))]);
    const current = resource.data()!, row = candidate.data();
    if (current.activeVersion === version && row?.status === "ACTIVE") return;
    if (!row || row.rootId !== ctx.rootId || row.status !== "APPROVED") throw new HttpsError("failed-precondition", "Aprueba la versión antes de activarla.");
    const previous = current.activeVersion ? await tx.get(versionRef(id, current.activeVersion)) : null;
    if (previous?.exists) tx.update(previous.ref, { status: "RETIRED", retiredAt: FieldValue.serverTimestamp() });
    tx.update(candidate.ref, { status: "ACTIVE", activatedBy: ctx.uid, activatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, { activeVersion: version, hasActivated: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: ctx.uid });
    audit(tx, ctx, id, "ACTIVATED", version);
  });
  return { ok: true };
});

export const retireCorporateResourceVersion = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "manage"), id = clean(request.data?.resourceId), version = Number(request.data?.version);
  const { ref } = await resourceFor(ctx, id);
  await db.runTransaction(async tx => {
    const [resource, candidate] = await Promise.all([tx.get(ref), tx.get(versionRef(id, version))]);
    const row = candidate.data();
    if (!row || row.rootId !== ctx.rootId) throw new HttpsError("not-found", "Versión no disponible.");
    if (row.status === "RETIRED") return;
    tx.update(candidate.ref, { status: "RETIRED", retiredAt: FieldValue.serverTimestamp(), retiredBy: ctx.uid });
    if (resource.data()?.activeVersion === version) tx.update(ref, { activeVersion: null, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, id, "RETIRED", version);
  });
  return { ok: true };
});

export const restoreCorporateResourceVersion = onCall({ region: "us-central1", timeoutSeconds: 90 }, async request => {
  const ctx = await context(request, "manage"), id = clean(request.data?.resourceId), version = Number(request.data?.version);
  const { row: resource } = await resourceFor(ctx, id), previous = (await versionRef(id, version).get()).data();
  if (!previous || previous.rootId !== ctx.rootId || !previous.contentDigest || !previous.artifacts?.length)
    throw new HttpsError("failed-precondition", "Versión histórica no disponible.");
  const draft = await createDraft(ctx, { companyId: resource.ownCompanyId, kind: resource.resourceKind, key: resource.stableKey,
    title: resource.title, comment: `Restauración como nueva versión de la versión ${version}.` }, previous.payload);
  // Existing artifacts remain immutable and are referenced by the new version.
  await publishDraft(ctx, id, draft.version, { artifacts: previous.artifacts, contentDigest: previous.contentDigest, supersedesVersion: version });
  return { ok: true, version: draft.version };
});

export const getCorporateResourceDownloadUrl = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "view"), id = clean(request.data?.resourceId), version = Number(request.data?.version);
  await resourceFor(ctx, id);
  const row = (await versionRef(id, version).get()).data();
  if (!row || row.rootId !== ctx.rootId) throw new HttpsError("not-found", "Versión no disponible.");
  const artifact = row.artifacts?.find((item: any) => item.name === clean(request.data?.name));
  if (!artifact || !String(artifact.storagePath).startsWith(`pay0-canonical/${ctx.rootId}/`)) throw new HttpsError("not-found", "Archivo no disponible.");
  const [url] = await admin.storage().bucket().file(artifact.storagePath).getSignedUrl({ action: "read", expires: Date.now() + 5 * 60_000 });
  return { ok: true, url, expiresInSeconds: 300 };
});

export const initCorporateResourceUpload = onCall({ region: "us-central1" }, async request => {
  const ctx = await context(request, "manage"), companyId = clean(request.data?.companyId, 128);
  await companyFor(ctx, companyId);
  const kind = clean(request.data?.kind), key = clean(request.data?.key, 80).toUpperCase();
  const contentType = clean(request.data?.contentType), sizeBytes = Number(request.data?.sizeBytes);
  if (!["OWN_COMPANY_DOCUMENT", "BRAND_STATIONERY"].includes(kind) || !/^[A-Z0-9_-]{3,80}$/.test(key) ||
      !["application/pdf", "image/png", "image/jpeg"].includes(contentType) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 10_000_000 ||
      (kind === "BRAND_STATIONERY" && contentType === "application/pdf")) throw new HttpsError("invalid-argument", "Usa PDF, PNG o JPG válidos, hasta 10 MB; los logos deben ser imágenes.");
  const draft = await createDraft(ctx, { companyId, kind, key, title: clean(request.data?.title), comment: clean(request.data?.comment, 500) }, { source: "AUTHORIZED_UPLOAD", contentType });
  const sessionId = randomUUID(), storagePath = `pay0-canonical-staging/${ctx.rootId}/${ctx.uid}/${sessionId}/file`;
  await db.doc(`pay0CanonicalUploadSessions/${sessionId}`).set({ rootId: ctx.rootId, uid: ctx.uid, resourceId: draft.id,
    version: draft.version, companyId, kind, contentType, sizeBytes, storagePath, status: "PENDING", expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 15 * 60_000) });
  return { ok: true, sessionId, storagePath, resourceId: draft.id, version: draft.version };
});

export const finalizeCorporateResourceUpload = onCall({ region: "us-central1", timeoutSeconds: 90 }, async request => {
  const ctx = await context(request, "manage"), sessionId = clean(request.data?.sessionId);
  if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new HttpsError("invalid-argument", "Sesión inválida.");
  const sessionRef = db.doc(`pay0CanonicalUploadSessions/${sessionId}`), session = (await sessionRef.get()).data();
  if (!session || session.rootId !== ctx.rootId || session.uid !== ctx.uid)
    throw new HttpsError("permission-denied", "La carga no pertenece a tu sesión.");
  await companyFor(ctx, session.companyId);
  if (session.status === "FINALIZED") return { ok: true, alreadyFinalized: true };
  if (session.status !== "PENDING" || session.expiresAt.toMillis() < Date.now())
    throw new HttpsError("permission-denied", "La carga expiró o no pertenece a tu sesión.");
  const file = admin.storage().bucket().file(session.storagePath), [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== session.sizeBytes || metadata.contentType !== session.contentType) throw new HttpsError("failed-precondition", "El archivo no coincide con la carga autorizada.");
  const [bytes] = await file.download();
  const valid = session.contentType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" : session.contentType === "image/png"
    ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw new HttpsError("failed-precondition", "El contenido no corresponde al tipo declarado.");
  const name = session.contentType === "application/pdf" ? "recurso.pdf" : session.contentType === "image/png" ? "recurso.png" : "recurso.jpg";
  const storagePath = `${artifactPrefix(ctx.rootId, session.companyId, session.kind, session.resourceId, session.version)}/${name}`;
  await saveImmutable(storagePath, bytes, session.contentType);
  await db.runTransaction(async tx => {
    const current = (await tx.get(sessionRef)).data();
    const target = versionRef(session.resourceId, session.version), version = (await tx.get(target)).data();
    if (!current || current.rootId !== ctx.rootId || current.uid !== ctx.uid || current.resourceId !== session.resourceId || current.version !== session.version ||
        !version || version.rootId !== ctx.rootId || version.resourceId !== session.resourceId || version.ownCompanyId !== session.companyId)
      throw new HttpsError("permission-denied", "La sesión o la versión cambiaron de ámbito.");
    if (current?.status === "FINALIZED") return;
    if (current.status !== "PENDING" || current.expiresAt.toMillis() < Date.now() || version.status !== "DRAFT")
      throw new HttpsError("failed-precondition", "La carga expiró o la versión ya no está en borrador.");
    tx.update(target, { status: "REVIEW", contentDigest: sha(bytes),
      artifacts: [{ name, storagePath, sha256: sha(bytes), contentType: session.contentType, sizeBytes: bytes.length }], updatedAt: FieldValue.serverTimestamp() });
    tx.update(sessionRef, { status: "FINALIZED", finalizedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, session.resourceId, "UPLOAD_FINALIZED", session.version);
  });
  return { ok: true };
});

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
