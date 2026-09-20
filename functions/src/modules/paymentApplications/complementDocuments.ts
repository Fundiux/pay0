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
  const ids: string[] = [];
  for (const [extension, buffer, contentType] of [["xml", xml, "application/xml"], ["pdf", pdf, "application/pdf"]] as const) {
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const type = `COMPLEMENTO_PAGO_${extension.toUpperCase()}`, id = hash(`${source.rootId}:${source.pagoId}:${source.applicationId}:${uuid}:${type}:PAGO_V2`);
    const ref = db.doc(`uploads/${id}`), previous = await ref.get();
    if (previous.exists) {
      if (previous.data()?.status !== "READY" || previous.data()?.active !== true || previous.data()?.sha256 !== sha256) throw Error("REP_DOCUMENT_CONFLICT");
      ids.push(id); continue;
    }
    const filename = `REP-${uuid}.${extension}`, storagePath = `roots/${source.rootId}/pagos/${source.pagoId}/docs/${type}/${id}-${filename}`;
    // Same server-owned init/save/finalize lifecycle as issued invoices. No
    // client-controlled path or replacement of previous partialities.
    await admin.storage().bucket().file(storagePath).save(buffer, { resumable: false, contentType });
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) return;
      const active = await tx.get(db.collection("uploads")
        .where("rootId", "==", source.rootId)
        .where("pagoId", "==", source.pagoId)
        .where("documentType", "==", type)
        .where("active", "==", true));
      let maxVersion = 0;
      for (const document of active.docs) {
        maxVersion = Math.max(maxVersion, Number(document.data().version || 0));
        tx.set(document.ref, { active: false, status: "REPLACED", replacedByUploadId: id, replacedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      tx.create(ref, { rootId: source.rootId, adminId: pago.adminId || solicitud.adminId || source.rootId, clienteId: pago.clienteId || solicitud.clienteId,
        companyId: solicitud.companyId, solicitudId: source.solicitudId, solicitudFolio: solicitud.folio || null,
        entityType: "pagos", entityId: source.pagoId, pagoId: source.pagoId, pagoFolio: pago.folio || source.pagoFolio || null,
        documentType: type, documentTypeLabel: `Complemento de pago ${extension.toUpperCase()}`,
        complementKey: uuid, applicationId: source.applicationId, originalName: filename, filename, storagePath,
        contentType, sizeBytes: buffer.length, sha256, integrityHashAlgorithm: "SHA-256", integritySealStatus: "SEALED",
        status: "READY", active: true, version: maxVersion + 1, finalizedAt: FieldValue.serverTimestamp(), finalizedBy: "SYSTEM",
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: "SYSTEM" });
      logActivityTx(tx, db, { event: "DOCUMENTO_PAGO_SUBIDO", rootId: source.rootId, adminId: pago.adminId || source.rootId,
        actorUid: "SYSTEM", actorRole: "system", entityType: "pagos", entityId: source.pagoId,
        referenceId: source.pagoId, referenceFolio: pago.folio || source.pagoFolio || source.pagoId,
        referenceType: "pagoDocument", description: `Complemento de pago ${extension.toUpperCase()} vinculado al pago ${pago.folio || source.pagoId}.`,
        extra: { documentType: type, uploadId: id, applicationId: source.applicationId, complementUuid: uuid } });
    });
    ids.push(id);
  }
  return { uuid, xmlUploadId: ids[0], pdfUploadId: ids[1] };
}
