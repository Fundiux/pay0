import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { assertXml, cents, hash, text, xmlAttribute, xmlTags } from "./complementPolicy";

export function validateRep(xml: Buffer, source: any) {
  const data = xml.toString("utf8"); assertXml(data);
  const top = xmlTags(data, "Comprobante")[0], stamp = xmlTags(data, "TimbreFiscalDigital")[0] || "";
  const uuid = xmlAttribute(stamp, "UUID").toUpperCase();
  if (xmlAttribute(top, "TipoDeComprobante") !== "P" || !/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(uuid)) throw Error("REP_NOT_STAMPED_PAYMENT");
  const matches = xmlTags(data, "DoctoRelacionado").filter(tag => xmlAttribute(tag, "IdDocumento").toUpperCase() === source.invoiceUuid.toUpperCase() && Number(xmlAttribute(tag, "NumParcialidad")) === source.installment);
  if (matches.length !== 1 || cents(xmlAttribute(matches[0], "ImpPagado")) !== source.amountMinor || cents(xmlAttribute(matches[0], "ImpSaldoAnt")) !== cents(source.balanceBefore) || cents(xmlAttribute(matches[0], "ImpSaldoInsoluto")) !== cents(source.balanceAfter)) throw Error("REP_APPLICATION_MISMATCH");
  if (source.currency && xmlAttribute(matches[0], "MonedaDR") !== source.currency) throw Error("REP_DOCUMENT_CURRENCY_MISMATCH");
  return uuid;
}

export async function saveComplementDocuments(source: any, xml: Buffer, pdf: Buffer) {
  const uuid = validateRep(xml, source);
  if (pdf.subarray(0, 5).toString() !== "%PDF-" || pdf.length > 10_000_000) throw Error("REP_PDF_INVALID");
  const solicitud = (await db.doc(`solicitudes/${source.solicitudId}`).get()).data();
  if (!solicitud || solicitud.rootId !== source.rootId) throw Error("REP_DOCUMENT_SCOPE");
  const ids: string[] = [];
  for (const [extension, buffer, contentType] of [["xml", xml, "application/xml"], ["pdf", pdf, "application/pdf"]] as const) {
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const type = `COMPLEMENTO_PAGO_${extension.toUpperCase()}`, id = hash(`${source.rootId}:${source.solicitudId}:${uuid}:${type}`);
    const ref = db.doc(`uploads/${id}`), previous = await ref.get();
    if (previous.exists) {
      if (previous.data()?.status !== "READY" || previous.data()?.active !== true || previous.data()?.sha256 !== sha256) throw Error("REP_DOCUMENT_CONFLICT");
      ids.push(id); continue;
    }
    const filename = `REP-${uuid}.${extension}`, storagePath = `roots/${source.rootId}/solicitudes/${source.solicitudId}/docs/${type}/${id}-${filename}`;
    // Same server-owned init/save/finalize lifecycle as issued invoices. No
    // client-controlled path or replacement of previous partialities.
    await admin.storage().bucket().file(storagePath).save(buffer, { resumable: false, contentType });
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) return;
      await finalizeSolicitudDocumentVersionTx({ tx, db, rootId: source.rootId, solicitudId: source.solicitudId,
        documentType: type, uploadId: id, uploadRef: ref, mode: "create", complementKey: uuid,
        readyPatch: { rootId: source.rootId, adminId: solicitud.adminId || source.rootId, clienteId: solicitud.clienteId,
          companyId: solicitud.companyId, solicitudId: source.solicitudId, solicitudFolio: solicitud.folio || null,
          entityType: "solicitudes", entityId: source.solicitudId, documentType: type, documentTypeLabel: `Complemento de pago ${extension.toUpperCase()}`,
          complementKey: uuid, applicationId: source.applicationId, pagoId: source.pagoId, originalName: filename, filename, storagePath,
          contentType, sizeBytes: buffer.length, sha256, integrityHashAlgorithm: "SHA-256", integritySealStatus: "HASH_SERVER_VERIFIED", createdAt: FieldValue.serverTimestamp(), createdBy: "SYSTEM" } });
    });
    ids.push(id);
  }
  return { uuid, xmlUploadId: ids[0], pdfUploadId: ids[1] };
}
