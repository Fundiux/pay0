import * as admin from "firebase-admin";
import JSZip from "jszip";
import { defineSecret } from "firebase-functions/params";
import { db } from "../sharedCallables/helpers";
import { getUserRole } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { loginIqHttpDirect } from "../iq/iqHttpAuth";
import { resolveIqAccess, IQ_PAYMENT_APPLICATION_CREDENTIALS_KEY } from "./iqExecution";
import { buildFacturamaRep, iqAvailability, text } from "./complementPolicy";
import { saveComplementDocuments, validateRep } from "./complementDocuments";

const USERNAME = defineSecret("FACTURAMA_SANDBOX_USERNAME"), PASSWORD = defineSecret("FACTURAMA_SANDBOX_PASSWORD");
export const COMPLEMENT_SECRETS = [IQ_PAYMENT_APPLICATION_CREDENTIALS_KEY, USERNAME, PASSWORD];
const IQ_ORIGIN = "https://iq-produccion-ccc570f75402.herokuapp.com";
export async function iqSession(job: any) {
  const user = (await db.doc(`users/${job.actorUid}`).get()).data();
  if (!user || text(user.rootId || job.actorUid) !== job.rootId || user.active === false || user.disabled === true) throw Error("REP_ACTOR_INVALID");
  const role = getUserRole(user);
  if (!role) throw Error("REP_ACTOR_INVALID");
  await requireClientOperationalAccess({ uid: job.actorUid, role, rootId: job.rootId, clientId: job.clientId, permission: "operatePagos" });
  const access = await resolveIqAccess({ uid: job.actorUid, rootId: job.rootId, adminId: job.rootId, role, displayName: "", username: "" });
  if (access.profileId !== job.profileId || access.apiOrigin !== IQ_ORIGIN) throw Error("REP_IQ_PROFILE_CHANGED");
  const session = await loginIqHttpDirect({ apiOrigin: IQ_ORIGIN, credentials: access, requiredPermissions: "NONE" });
  for (const action of ["create", "view"]) if (!session.permissions.some(p => p.entity === "deposits/complement" && p.action === action)) throw Error("REP_IQ_PERMISSION_REQUIRED");
  return session;
}
export async function requestIqComplement(job: any, session: any) {
  // No body: the route carries the deposit. Never replay an uncertain POST.
  const send = (auth: any) => fetch(`${IQ_ORIGIN}/deposits/${job.depositId}/complement`, { method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(30000) });
  let response = await send(session);
  // An explicit 401 is a rejected authentication, unlike a timeout/5xx.
  // Renew from the configured credential profile, never from pasted tokens.
  if (response.status === 401) response = await send(await iqSession(job));
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || body?.message !== "success") throw Error(`IQ_REP_REQUEST_HTTP_${response.status}`);
}
export async function preflightIqComplement(job: any, session: any): Promise<"REQUEST" | "AVAILABLE"> {
  for (let offset = 0; offset < 10000; offset += 100) {
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
      return "REQUEST";
    }
    if (rows.length < 100) break;
  }
  throw Error("IQ_REP_DEPOSIT_NOT_FOUND");
}
export async function availableIqComplement(job: any, session: any) {
  const response = await fetch(`${IQ_ORIGIN}/deposits/complement/${job.depositId}`, { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => null);
  return iqAvailability(response.status, body) === "PENDING" ? null : text(body.url);
}
async function boundedDownload(initial: string) {
  let url = new URL(initial);
  if (url.origin !== IQ_ORIGIN || !url.pathname.startsWith("/rails/active_storage/blobs/redirect/")) throw Error("REP_DOWNLOAD_ORIGIN_INVALID");
  for (let step = 0; step < 4; step++) {
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
export async function importIqComplement(url: string, sources: any[]) {
  const zip = await JSZip.loadAsync(await boundedDownload(url));
  const files = Object.values(zip.files).filter(file => !file.dir);
  if (files.length > 30 || files.some(file => Number((file as any)._data?.uncompressedSize || 0) > 10_000_000) || files.reduce((n, file) => n + Number((file as any)._data?.uncompressedSize || 0), 0) > 20_000_000) throw Error("REP_ZIP_LIMIT");
  const xmlFiles = files.filter(file => /\.xml$/i.test(file.name)), result = [];
  for (const source of sources) {
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
