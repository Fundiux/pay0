const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const admin = require("../../functions/node_modules/firebase-admin");

async function main() {
  assert(process.env.FIRESTORE_EMULATOR_HOST, "Esta prueba solo puede ejecutarse contra Firestore Emulator");
  if (!admin.apps.length) admin.initializeApp({ projectId: "pay-0-system", storageBucket: "pay-0-system.appspot.com" });
  const db = admin.firestore();
  const uid = "qa-superadmin";
  const rootId = uid;
  const companyId = "qa-trostre";
  const clientId = "qa-transunisa";
  const solicitudId = "qa-s1c35u1e28";
  const preferredInvoiceId = "qa-invoice-current";
  const staleInvoiceId = "qa-invoice-stale";
  const xlsxPath = process.argv[2];
  assert(xlsxPath, "Indica la ruta de la OC XLSX");
  const { parseOcFiscalMetadataBuffer } = require("../../functions/lib/modules/solicitudDocuments/service.js");
  const metadata = await parseOcFiscalMetadataBuffer(readFileSync(xlsxPath));
  assert(metadata, "La OC debe producir metadatos fiscales");

  await Promise.all([
    db.doc(`users/${uid}`).set({ role: "superadmin", rootId, username: "QA" }),
    db.doc(`companies/${companyId}`).set({
      rootId, nombre: "TROSTRE", rfc: "TRO230717L64", active: true, isOwnCompany: true,
      depositAccounts: [{ id: "bbva", clabe: "012903001215700991", accountNumber: "0121570099", bankName: "BBVA MEXICO", status: "ACTIVA" }],
      depositClabes: ["012903001215700991"],
    }),
    db.doc(`clients/${clientId}`).set({ rootId, nombre: "TERMINALES MARITIMAS TRANSUNISA", rfc: "TMT840611IP1", active: true }),
    db.doc(`solicitudes/${solicitudId}`).set({
      rootId, adminId: rootId, createdBy: uid, companyId, clienteId: clientId, clienteNombre: "TERMINALES MARITIMAS TRANSUNISA",
      empresaNombre: "TROSTRE", folio: "S1C35U1E28", monto: 14893.62, tipoFactura: "PUE", status: "PROCESANDO",
      facturamaInvoiceId: preferredInvoiceId, satProductCode: metadata.productCode, satUnitCode: metadata.unitCode,
      ocConceptDescription: metadata.description, ocQuantity: metadata.quantity, ocClientName: metadata.clientName,
      ocClientRfc: metadata.clientRfc, ocClientAddress: metadata.clientAddress, ocDeliveryLocation: metadata.deliveryLocation,
      ocItems: metadata.items, cfdiUse: metadata.cfdiUse, regimenFiscalReceptor: metadata.fiscalRegime,
      postalCode: metadata.postalCode, paymentMethod: metadata.paymentMethod, currency: metadata.currency,
    }),
    db.doc(`companyInvoiceCatalogs/${companyId}`).set({
      rootId, companyId, companyRfc: "TRO230717L64", version: "qa", sourceSha256: "qa", status: "ACTIVE",
      entries: [{ productCode: "72101510", satDescription: "Mantenimiento y reparacion", type: "SERVICIO", unitCode: "E48", unit: "Unidad de servicio", commercialDescription: "Reparacion de plomeria", family: "Mantenimiento", csfSupport: "QA", corporatePurposeSupport: "QA", retentionRequired: "NO", status: "AUTORIZADO", notes: "" }],
    }),
    db.doc("satCatalogState/current").set({ activeImportId: "qa-sat" }),
    db.doc("satProductServiceCatalog/72101510").set({ active: true, sourceVersionId: "qa-sat" }),
    db.doc("satUnitCatalog/E48").set({ active: true, sourceVersionId: "qa-sat" }),
    db.doc(`facturamaInvoices/${preferredInvoiceId}`).set({ rootId, sourceSolicitudId: solicitudId, status: "AUTO_DRAFT_NEEDS_RECEIVER_DATA", createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    db.doc(`facturamaInvoices/${staleInvoiceId}`).set({ rootId, sourceSolicitudId: solicitudId, status: "AUTO_DRAFT_NEEDS_RECEIVER_DATA", createdAt: admin.firestore.FieldValue.serverTimestamp() }),
  ]);

  const { ensureAutomaticFacturamaDraftForSolicitud } = require("../../functions/lib/modules/facturama/service.js");
  const result = await ensureAutomaticFacturamaDraftForSolicitud({ auth: { uid, token: {} }, solicitudId, source: "OC_UPLOAD" });
  assert.equal(result.ok, true);
  const [solicitudSnap, invoiceSnap] = await Promise.all([db.doc(`solicitudes/${solicitudId}`).get(), db.doc(`facturamaInvoices/${preferredInvoiceId}`).get()]);
  const solicitud = solicitudSnap.data();
  const invoice = invoiceSnap.data();
  assert.equal(solicitud.ocConceptDescription, "SERVICIO DE REPARACION DE SISTEMAS DE PLOMERIA");
  assert.equal(solicitud.ocDeliveryLocation.includes("GUADALAJARA"), true);
  assert.equal(solicitud.facturamaInvoiceId, preferredInvoiceId);
  assert.equal(solicitud.facturamaAutoDraftStatus, "AUTO_DRAFT_FISCAL_VALIDATED");
  assert.equal(invoice.status, "AUTO_DRAFT_FISCAL_VALIDATED");
  assert.equal(invoice.concepts[0].description, "SERVICIO DE REPARACION DE SISTEMAS DE PLOMERIA");
  console.log(JSON.stringify({ ok: true, result, solicitud: { description: solicitud.ocConceptDescription, deliveryLocation: solicitud.ocDeliveryLocation, draftStatus: solicitud.facturamaAutoDraftStatus }, invoiceId: preferredInvoiceId }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
