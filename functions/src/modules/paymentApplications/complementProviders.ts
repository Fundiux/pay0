import * as admin from "firebase-admin";
import JSZip from "jszip";
import { createHash } from "crypto";
import { defineSecret } from "firebase-functions/params";
import { db } from "../sharedCallables/helpers";
import { getUserRole } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { loginIqHttpDirect } from "../iq/iqHttpAuth";
import { resolveIqAccess, IQ_PAYMENT_APPLICATION_CREDENTIALS_KEY } from "./iqExecution";
import { buildFacturamaRep, iqAvailability, text } from "./complementPolicy";
import { saveComplementDocuments, validateRep } from "./complementDocuments";
import { inspectIqComplementGate, type IqComplementAction } from "./complementGates";

const USERNAME = defineSecret("FACTURAMA_SANDBOX_USERNAME"), PASSWORD = defineSecret("FACTURAMA_SANDBOX_PASSWORD");
export const COMPLEMENT_SECRETS = [IQ_PAYMENT_APPLICATION_CREDENTIALS_KEY, USERNAME, PASSWORD];
const IQ_ORIGIN = "https://iq-produccion-ccc570f75402.herokuapp.com";
async function requireGate(job: any, action: IqComplementAction) {
  const decision = await inspectIqComplementGate(job, action);
  if (!decision.allowed) throw Error(decision.reason);
}
export async function iqSession(job: any, action: IqComplementAction = "REQUEST") {
  const user = (await db.doc(`users/${job.actorUid}`).get()).data();
  if (!user || text(user.rootId || job.actorUid) !== job.rootId || user.active === false || user.disabled === true) throw Error("REP_ACTOR_INVALID");
  const role = getUserRole(user);
  if (!role) throw Error("REP_ACTOR_INVALID");
  await requireClientOperationalAccess({ uid: job.actorUid, role, rootId: job.rootId, clientId: job.clientId, permission: "operatePagos" });
  const access = await resolveIqAccess({ uid: job.actorUid, rootId: job.rootId, adminId: job.rootId, role, displayName: "", username: "" });
  if (access.profileId !== job.profileId || access.apiOrigin !== IQ_ORIGIN) throw Error("REP_IQ_PROFILE_CHANGED");
  await requireGate(job, action);
  const session = await loginIqHttpDirect({ apiOrigin: IQ_ORIGIN, credentials: access, requiredPermissions: "NONE" });
  for (const permission of action === "REQUEST" ? ["create", "view"] : ["view"])
    if (!session.permissions.some(p => p.entity === "deposits/complement" && p.action === permission)) throw Error("REP_IQ_PERMISSION_REQUIRED");
  return session;
}
export async function requestIqComplement(job: any, session: any) {
  // No body or provider idempotency token is documented. Every response after
  // sending, including 401, belongs to this single attempt; never replay it.
  await requireGate(job, "REQUEST");
  const response = await fetch(`${IQ_ORIGIN}/deposits/${job.depositId}/complement`, { method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || body?.message !== "success") throw Error(`IQ_REP_REQUEST_HTTP_${response.status}`);
}
export async function preflightIqComplement(job: any, session: any): Promise<"REQUEST" | "AVAILABLE"> {
  for (let offset = 0; offset < 10000; offset += 100) {
    await requireGate(job, "LOOKUP");
    const query = new URLSearchParams({ limit: "100", offset: String(offset), order_by_field: "id", order_by_direction: "desc" });
    const response = await fetch(`${IQ_ORIGIN}/deposits?${query}`, { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`IQ_REP_PREFLIGHT_HTTP_${response.status}`);
    const rows = await response.json(); if (!Array.isArray(rows)) throw Error("IQ_REP_DEPOSIT_LIST_INVALID");
    const matches = rows.filter((row: any) => text(row.id) === job.depositId);
    if (matches.length === 1) {
      const row = matches[0];
      if (row.conciliation_status !== "Conciliado" || row.operation_status !== "En Operacion") throw Error("IQ_REP_DEPOSIT_NOT_RECONCILED");
      if (row.rep === true) return "AVAILABLE";
      if (row.can_request_rep !== true) throw Error("IQ_REP_REQUEST_STATE_REQUIRES_REVIEW");
      // The field is observed only as an adapter condition, not as a provider
      // contract. Even true cannot authorize a real generation request yet.
      throw Error("IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED");
    }
    if (rows.length < 100) break;
  }
  throw Error("IQ_REP_DEPOSIT_NOT_FOUND");
}
export async function availableIqComplement(job: any, session: any) {
  await requireGate(job, "LOOKUP");
  const response = await fetch(`${IQ_ORIGIN}/deposits/complement/${job.depositId}`, { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => null);
  return iqAvailability(response.status, body) === "PENDING" ? null : text(body.url);
}
export async function observeIqRepAttachment(job: any, session: any) {
  await requireGate(job, "LOOKUP");
  const response = await fetch(`${IQ_ORIGIN}/deposits/complement/${job.depositId}`, {
    method: "GET", headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  const body = raw.length <= 1_000_000 ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
  const object = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const field = (name: string) => {
    const present = !!object && Object.prototype.hasOwnProperty.call(object, name), value = object?.[name];
    return { present, type: !present ? "absent" : value === null ? "null" : typeof value,
      ...((typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) ||
        typeof value === "string" && value.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(value)) ? { value } : {}),
      ...(present && typeof value === "string" && !(value.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(value))
        ? { valueSha256: createHash("sha256").update(value).digest("hex") } : {}) };
  };
  const url = typeof object?.url === "string" ? object.url : null;
  const exactMissing = Array.isArray(object?.errors) && object.errors.length === 1 && object.errors[0] === "El depósito no tiene ningún REP adjunto";
  const shape = { httpStatus: response.status, contentType: response.headers.get("content-type")?.split(";")[0] || null,
    bodyKind: Array.isArray(body) ? "array" : body === null ? "unparsed_or_null" : typeof body,
    topLevelKeys: object ? Object.keys(object).sort().slice(0, 40) : [], bodyBytes: Buffer.byteLength(raw),
    bodySha256: createHash("sha256").update(raw).digest("hex"), rep: field("rep"), canRequestRep: field("can_request_rep"),
    urlPresent: !!url, urlKind: url ? (() => { try { const parsed = new URL(url); return parsed.protocol === "https:" ? "HTTPS" : "OTHER_SCHEME"; } catch { return "INVALID"; } })() : "ABSENT",
    errorCount: Array.isArray(object?.errors) ? object.errors.length : null,
    exactNoAttachmentMessage: exactMissing };
  const classification = response.status === 200 && url?.startsWith("https://") && !object?.errors ? "REP_ATTACHMENT_AVAILABLE"
    : response.status === 400 && exactMissing && !url ? "REP_ATTACHMENT_NOT_AVAILABLE" : "REP_ATTACHMENT_AMBIGUOUS";
  return { classification, shape, url: classification === "REP_ATTACHMENT_AVAILABLE" ? url : null };
}
async function boundedDownload(initial: string, job?: any) {
  let url = new URL(initial);
  if (url.origin !== IQ_ORIGIN || !url.pathname.startsWith("/rails/active_storage/blobs/redirect/")) throw Error("REP_DOWNLOAD_ORIGIN_INVALID");
  for (let step = 0; step < 4; step++) {
    if (job) await requireGate(job, "LOOKUP");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !(url.origin === IQ_ORIGIN || /^[a-z0-9.-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname))) throw Error("REP_DOWNLOAD_REDIRECT_INVALID");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get("location") || "", url); continue; }
    if (!response.ok || !response.body) throw Error("REP_DOWNLOAD_FAILED");
    const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 10_000_000) { await reader.cancel(); throw Error("REP_DOWNLOAD_TOO_LARGE"); } chunks.push(Buffer.from(part.value)); }
    return Buffer.concat(chunks);
  }
  throw Error("REP_DOWNLOAD_TOO_MANY_REDIRECTS");
}
export async function validateIqRepAttachmentDownload(url: string, source: any, job: any) {
  const archive = await boundedDownload(url, job);
  const zip = await JSZip.loadAsync(archive);
  const files = Object.values(zip.files).filter(file => !file.dir);
  if (files.length > 30 || files.reduce((n, file) => n + Number((file as any)._data?.uncompressedSize || 0), 0) > 20_000_000)
    throw Error("REP_ZIP_LIMIT");
  const candidates = [];
  for (const xmlFile of files.filter(file => /\.xml$/i.test(file.name))) {
    const xml = await xmlFile.async("nodebuffer");
    let uuid: string;
    try { uuid = validateRep(xml, source); } catch { continue; }
    const pdfFile = files.find(file => file.name.toLowerCase() === xmlFile.name.replace(/\.xml$/i, ".pdf").toLowerCase());
    if (!pdfFile) throw Error("REP_PDF_PAIR_MISSING");
    const pdf = await pdfFile.async("nodebuffer");
    if (pdf.length > 10_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-") throw Error("REP_PDF_INVALID");
    candidates.push({ uuid, xml, pdf });
  }
  if (candidates.length !== 1) throw Error("REP_ZIP_APPLICATION_MISMATCH");
  const match = candidates[0];
  return { repUuid: match.uuid, archiveSha256: createHash("sha256").update(archive).digest("hex"),
    xmlSha256: createHash("sha256").update(match.xml).digest("hex"), pdfSha256: createHash("sha256").update(match.pdf).digest("hex"),
    xmlBytes: match.xml.length, pdfBytes: match.pdf.length, validated: true };
}
export async function importIqComplement(url: string, sources: any[], job?: any) {
  const zip = await JSZip.loadAsync(await boundedDownload(url, job));
  const files = Object.values(zip.files).filter(file => !file.dir);
  if (files.length > 30 || files.some(file => Number((file as any)._data?.uncompressedSize || 0) > 10_000_000) || files.reduce((n, file) => n + Number((file as any)._data?.uncompressedSize || 0), 0) > 20_000_000) throw Error("REP_ZIP_LIMIT");
  const xmlFiles = files.filter(file => /\.xml$/i.test(file.name)), result = [];
  for (const source of sources) {
    if (job) await requireGate(job, "LOOKUP");
    const matches: { xml: Buffer; pdf: Buffer }[] = [];
    for (const file of xmlFiles) {
      const xml = await file.async("nodebuffer");
      try { validateRep(xml, source); } catch { continue; }
      const pdfFile = files.find(candidate => candidate.name.toLowerCase() === file.name.replace(/\.xml$/i, ".pdf").toLowerCase());
      if (!pdfFile) throw Error("REP_PDF_PAIR_MISSING");
      matches.push({ xml, pdf: await pdfFile.async("nodebuffer") });
    }
    if (matches.length !== 1) throw Error("REP_ZIP_APPLICATION_MISMATCH");
    result.push({ source, documents: await saveComplementDocuments(source, matches[0].xml, matches[0].pdf) });
  }
  return result;
}

async function facturama(path: string, init: RequestInit = {}) {
  const credentials = Buffer.from(`${USERNAME.value()}:${PASSWORD.value()}`).toString("base64");
  const response = await fetch(`https://api.facturama.mx${path}`, { ...init, headers: { Authorization: `Basic ${credentials}`, Accept: "application/json", "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`REP_FACTURAMA_HTTP_${response.status}`);
  return response.json();
}
export async function prepareFacturamaComplement(job: any, source: any, app: any, solicitud: any, pago: any) {
  const invoice = (await db.doc(`facturamaInvoices/${text(solicitud.facturamaInvoiceId)}`).get()).data();
  if (!invoice || invoice.rootId !== job.rootId || invoice.status !== "PRODUCTION_ISSUED" || invoice.sourceSolicitudId !== source.solicitudId || invoice.companyId !== solicitud.companyId || invoice.uuid !== source.invoiceUuid) throw Error("REP_FACTURAMA_SOURCE_INVALID");
  const company = (await db.doc(`companies/${solicitud.companyId}`).get()).data();
  if (!company || company.rootId !== job.rootId || company.active === false) throw Error("REP_ISSUER_SCOPE_INVALID");
  const upload = (await db.doc(`uploads/${text(invoice.xmlUploadId)}`).get()).data();
  if (!upload || upload.rootId !== job.rootId || upload.solicitudId !== source.solicitudId || upload.status !== "READY" || upload.active !== true || !text(upload.storagePath).startsWith(`roots/${job.rootId}/solicitudes/${source.solicitudId}/`)) throw Error("REP_SOURCE_XML_REQUIRED");
  if (Number(upload.sizeBytes) > 2_000_000) throw Error("REP_SOURCE_XML_TOO_LARGE");
  const [xml] = await admin.storage().bucket().file(upload.storagePath).download();
  const payload = buildFacturamaRep(xml.toString("utf8"), app, pago, source.invoiceUuid, `REP-${job.id.slice(0, 24)}`);
  if (text(company.rfc).toUpperCase() !== payload.Issuer.Rfc.toUpperCase()) throw Error("REP_ISSUER_RFC_MISMATCH");
  return payload;
}
export async function emitFacturamaComplement(payload: any): Promise<string> {
  const result = await facturama("/api-lite/3/cfdis", { method: "POST", body: JSON.stringify(payload) });
  const id = text(result?.Id);
  if (!id) throw Error("REP_FACTURAMA_ID_MISSING");
  return id;
}
export async function importFacturamaComplement(id: string, source: any) {
  const [xml, pdf] = await Promise.all([facturama(`/api/Cfdi/xml/issuedLite/${encodeURIComponent(id)}`), facturama(`/api/Cfdi/pdf/issuedLite/${encodeURIComponent(id)}`)]);
  return saveComplementDocuments(source, Buffer.from(text(xml.Content), "base64"), Buffer.from(text(pdf.Content), "base64"));
}
