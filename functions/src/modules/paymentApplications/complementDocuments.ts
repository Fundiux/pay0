import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
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
  const pago = (await db.doc(`pagos/${source.pagoId}`).get()).data();
  if (!pago || pago.rootId !== source.rootId) throw Error("REP_PAYMENT_DOCUMENT_SCOPE");
  const files = ([ ["xml", xml, "application/xml"], ["pdf", pdf, "application/pdf"] ] as const).map(([extension, buffer, contentType]) => {
    const type = `COMPLEMENTO_PAGO_${extension.toUpperCase()}`;
    const id = hash(`${source.rootId}:${source.pagoId}:${source.applicationId}:${uuid}:${type}:PAGO_V2`);
    const filename = `REP-${uuid}.${extension}`;
    return { extension, buffer, contentType, type, id, filename, ref: db.doc(`uploads/${id}`),
      sha256: createHash("sha256").update(buffer).digest("hex"),
      storagePath: `roots/${source.rootId}/pagos/${source.pagoId}/docs/${type}/${id}-${filename}` };
  });
  // A retry may leave blobs without metadata. Both blobs must be stored before
  // the single transaction publishes either READY document.
  for (const file of files) {
    const previous = await file.ref.get();
    if (previous.exists) {
      if (previous.data()?.status !== "READY" || previous.data()?.active !== true || previous.data()?.sha256 !== file.sha256) throw Error("REP_DOCUMENT_CONFLICT");
    } else await admin.storage().bucket().file(file.storagePath).save(file.buffer, { resumable: false, contentType: file.contentType });
  }
  await db.runTransaction(async tx => {
    const existing = await Promise.all(files.map(file => tx.get(file.ref)));
    const active = await Promise.all(files.map(file => tx.get(db.collection("uploads")
      .where("rootId", "==", source.rootId).where("pagoId", "==", source.pagoId)
      .where("documentType", "==", file.type).where("active", "==", true))));
    for (let index = 0; index < files.length; index++) {
      const file = files[index], previous = existing[index];
      if (previous.exists) {
        if (previous.data()?.status !== "READY" || previous.data()?.active !== true || previous.data()?.sha256 !== file.sha256) throw Error("REP_DOCUMENT_CONFLICT");
        continue;
      }
      let maxVersion = 0;
      for (const document of active[index].docs) {
        // Other applications, including other partialities of this payment,
        // retain their active XML and PDF.
        if (document.data().applicationId !== source.applicationId) continue;
        maxVersion = Math.max(maxVersion, Number(document.data().version || 0));
        tx.update(document.ref, { active: false, status: "REPLACED", replacedByUploadId: file.id,
          replacedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      }
      tx.create(file.ref, { rootId: source.rootId, adminId: pago.adminId || solicitud.adminId || source.rootId, clienteId: pago.clienteId || solicitud.clienteId,
        companyId: solicitud.companyId, solicitudId: source.solicitudId, solicitudFolio: solicitud.folio || null,
        entityType: "pagos", entityId: source.pagoId, pagoId: source.pagoId, pagoFolio: pago.folio || source.pagoFolio || null,
        documentType: file.type, documentTypeLabel: `Complemento de pago ${file.extension.toUpperCase()}`,
        complementKey: uuid, applicationId: source.applicationId, originalName: file.filename, filename: file.filename, storagePath: file.storagePath,
        contentType: file.contentType, sizeBytes: file.buffer.length, sha256: file.sha256, integrityHashAlgorithm: "SHA-256", integritySealStatus: "SEALED",
        status: "READY", active: true, version: maxVersion + 1, finalizedAt: FieldValue.serverTimestamp(), finalizedBy: "SYSTEM",
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: "SYSTEM" });
      logActivityTx(tx, db, { event: "DOCUMENTO_PAGO_SUBIDO", rootId: source.rootId, adminId: pago.adminId || source.rootId,
        actorUid: "SYSTEM", actorRole: "system", entityType: "pagos", entityId: source.pagoId,
        referenceId: source.pagoId, referenceFolio: pago.folio || source.pagoFolio || source.pagoId,
        referenceType: "pagoDocument", description: `Complemento de pago ${file.extension.toUpperCase()} vinculado al pago ${pago.folio || source.pagoId}.`,
        extra: { documentType: file.type, uploadId: file.id, applicationId: source.applicationId, complementUuid: uuid } });
    }
  });
  return { uuid, xmlUploadId: files[0].id, pdfUploadId: files[1].id };
}
