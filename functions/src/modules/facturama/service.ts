import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { resolveSolicitudFiscalClassification } from "./companyCatalog";

const db = getFirestore();

function text(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function normalizeRfc(value: unknown) {
  return text(value, 13).toUpperCase();
}

function isValidRfc(value: string) {
  return /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(value);
}

function isValidFiscalRegime(value: string) {
  return /^\d{3}$/.test(value);
}

function isValidPostalCode(value: string) {
  return /^\d{5}$/.test(value);
}

function isValidCfdiUse(value: string) {
  return /^[A-Z]\d{2}$/.test(value);
}

function operationalDescription(solicitud: any) {
  const candidates = [
    solicitud?.ocConceptDescription,
    solicitud?.ordenCompraConcepto,
    solicitud?.concepto,
    solicitud?.descripcion,
    solicitud?.operationTypeName,
  ];
  const selected = candidates.map((value) => text(value, 1000)).find((value) => value && !/^(FACTURA[_ -]?SUBTOTAL|SUBTOTAL|TOTAL)$/i.test(value));
  return selected || "Servicio operativo según Orden de Compra";
}

export function isOwnInvoiceIssuerCompany(company: any): boolean {
  const rfc = normalizeRfc(company?.rfc);
  return (
    company?.isOwnCompany === true ||
    company?.ownedByRoot === true ||
    company?.pay0OwnCompany === true ||
    text(company?.ownership || company?.companyOwnership || company?.companyType).toUpperCase() === "PROPIA" ||
    rfc === "TRO230717L64"
  );
}

function pickName(row: any, fallback: string) {
  return text(
    row?.razonSocial ||
    row?.nombreFiscal ||
    row?.nombre ||
    row?.name ||
    row?.clienteNombre ||
    row?.clientName ||
    fallback,
    254,
  );
}

function buildReceiver(client: any, solicitud: any, clienteId: string) {
  const fiscalProfile = client?.fiscalProfile || {};
  const rfc = normalizeRfc(client?.rfc || client?.RFC || solicitud?.ocClientRfc || solicitud?.clienteRfc || solicitud?.clientRfc);
  // La ficha del cliente prevalece. Los datos extraídos de una OC canónica
  // son el respaldo cuando esa ficha aún no ha sido completada.
  const fiscalRegime = text(client?.fiscalRegime || client?.regimenFiscal || client?.regimenFiscalReceptor || fiscalProfile?.regimenFiscal || solicitud?.regimenFiscalReceptor, 3);
  const postalCode = text(client?.postalCode || client?.codigoPostal || client?.cp || client?.zipCode || fiscalProfile?.codigoPostal || solicitud?.postalCode, 5);
  const cfdiUse = text(client?.cfdiUse || client?.usoCfdi || client?.usoCFDI || solicitud?.cfdiUse || solicitud?.usoCfdi || "G03", 3).toUpperCase();
  return {
    rfc,
    name: pickName(client, text(solicitud?.ocClientName || solicitud?.clienteNombre || solicitud?.clientName || clienteId, 254)),
    fiscalRegime,
    postalCode,
    cfdiUse,
  };
}

function receiverIsComplete(receiver: ReturnType<typeof buildReceiver>) {
  return (
    isValidRfc(receiver.rfc) &&
    receiver.name &&
    isValidFiscalRegime(receiver.fiscalRegime) &&
    isValidPostalCode(receiver.postalCode) &&
    isValidCfdiUse(receiver.cfdiUse)
  );
}

export async function ensureAutomaticFacturamaDraftForSolicitud(input: {
  auth: any;
  solicitudId: string;
  source: "SOLICITUD_CREATE" | "OC_UPLOAD";
}) {
  const uid = text(input.auth?.uid, 128);
  const solicitudId = text(input.solicitudId, 128);
  if (!uid || !solicitudId) return { ok: false, skipped: true, reason: "MISSING_CONTEXT" };

  const [userSnap, solicitudSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("solicitudes").doc(solicitudId).get(),
  ]);
  if (!userSnap.exists || !solicitudSnap.exists) return { ok: false, skipped: true, reason: "NOT_FOUND" };

  const user = userSnap.data() || {};
  const rootId = text(user.rootId || uid, 128);
  const solicitud: any = solicitudSnap.data() || {};
  if (text(solicitud.rootId, 128) !== rootId) return { ok: false, skipped: true, reason: "ROOT_MISMATCH" };

  const companyId = text(solicitud.companyId || solicitud.empresaId, 128);
  const clienteId = text(solicitud.clienteId || solicitud.clientId, 128);
  if (!companyId || !clienteId) return { ok: false, skipped: true, reason: "MISSING_RELATIONS" };

  const [companySnap, clientSnap, existingSnap] = await Promise.all([
    db.collection("companies").doc(companyId).get(),
    db.collection("clients").doc(clienteId).get(),
    db.collection("facturamaInvoices")
      .where("rootId", "==", rootId)
      .where("sourceSolicitudId", "==", solicitudId)
      .limit(20)
      .get(),
  ]);
  if (!companySnap.exists || !clientSnap.exists) return { ok: false, skipped: true, reason: "RELATION_NOT_FOUND" };
  const company: any = companySnap.data() || {};
  const client: any = clientSnap.data() || {};
  if (text(company.rootId, 128) !== rootId || company.active === false || !isOwnInvoiceIssuerCompany(company)) {
    await solicitudSnap.ref.set({
      facturamaAutoDraftStatus: "SKIPPED_NOT_OWN_ISSUER",
      facturamaSyncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, skipped: true, reason: "NOT_OWN_ISSUER" };
  }

  const receiver = buildReceiver(client, solicitud, clienteId);
  const complete = receiverIsComplete(receiver);
  // Solicitud.monto is the gross operational total. CFDI concept unit price
  // must be the pre-tax amount when ObjetoImp is 02.
  const totalAmount = money(solicitud.total || solicitud.monto || solicitud.amount);
  const amount = Math.round((totalAmount / 1.16) * 100) / 100;
  const fiscal = await resolveSolicitudFiscalClassification({ rootId, companyId, solicitud });
  // La Solicitud puede existir antes de que llegue la OC. En ese caso se creó
  // un borrador incompleto y la OC debe actualizarlo, no congelarlo ni crear
  // una segunda factura.
  const linkedInvoiceId = text(solicitud.facturamaInvoiceId, 128);
  const statusPriority = (status: unknown) => {
    const value = String(status || "").toUpperCase();
    if (value.endsWith("_ISSUED") || value === "EMITTED") return 50;
    if (value === "AUTO_DRAFT_FISCAL_VALIDATED") return 40;
    if (value === "PRODUCTION_ERROR") return 30;
    if (value === "AUTO_DRAFT_FISCAL_REVIEW") return 20;
    if (value === "AUTO_DRAFT_NEEDS_RECEIVER_DATA") return 10;
    return 0;
  };
  const existingInvoice = existingSnap.empty ? null : [...existingSnap.docs].sort((left, right) => {
    if (left.id === linkedInvoiceId && right.id !== linkedInvoiceId) return -1;
    if (right.id === linkedInvoiceId && left.id !== linkedInvoiceId) return 1;
    return statusPriority(right.data()?.status) - statusPriority(left.data()?.status);
  })[0];
  // A finalized CFDI is immutable. A later OC upload may enrich documents, but
  // must never create another draft or downgrade an issued invoice.
  const existingInvoiceData: any = existingInvoice?.data() || {};
  if (existingInvoice && String(existingInvoiceData.status || "").toUpperCase().endsWith("_ISSUED")) {
    await solicitudSnap.ref.set({
      facturamaAutoDraftStatus: existingInvoiceData.status,
      facturamaInvoiceId: existingInvoice.ref.id,
      facturamaSyncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, skipped: false, reused: true, invoiceId: existingInvoice.ref.id, status: existingInvoiceData.status };
  }
  const invoiceRef = existingInvoice?.ref || db.collection("facturamaInvoices").doc();
  const idempotencyKey = `auto-solicitud-${rootId}-${solicitudId}`;
  const status = !complete
    ? "AUTO_DRAFT_NEEDS_RECEIVER_DATA"
    : fiscal.status === "VALID"
      ? "AUTO_DRAFT_FISCAL_VALIDATED"
      : "AUTO_DRAFT_FISCAL_REVIEW";
  const conceptDescription = operationalDescription(solicitud);

  await invoiceRef.set({
    rootId,
    companyId,
    issuer: { name: pickName(company, companyId), rfc: normalizeRfc(company.rfc) },
    environment: "SANDBOX",
    status,
    productionBlocked: true,
    idempotencyKey,
    source: input.source,
    sourceSolicitudId: solicitudId,
    sourceSolicitudFolio: solicitud.folio || null,
    sourceClienteId: clienteId,
    receiver,
    receiverDataComplete: complete,
    concepts: fiscal.entry ? [{
      productCode: fiscal.entry.productCode,
      satDescription: fiscal.entry.satDescription,
      description: conceptDescription,
      unitCode: fiscal.entry.unitCode,
      unit: fiscal.entry.unit,
      quantity: 1,
      unitPrice: amount,
      taxObject: "02",
    }] : [],
    fiscalValidation: {
      status: fiscal.status,
      reason: fiscal.reason || null,
      productCode: fiscal.productCode || null,
      unitCode: fiscal.unitCode || null,
      companyCatalogVersion: fiscal.companyCatalogVersion || null,
      companyCatalogSha256: fiscal.companyCatalogSha256 || null,
      evaluatedAt: FieldValue.serverTimestamp(),
    },
    paymentForm: text(solicitud.paymentForm || "03", 2),
    paymentMethod: text(solicitud.tipoFactura || solicitud.paymentMethod || "PUE", 3).toUpperCase() === "PPD" ? "PPD" : "PUE",
    currency: "MXN",
    subtotal: amount,
    materialityOperationId: solicitud.materialityOperationId || null,
    financialCycle: {
      kind: "INCOME_REQUIRES_EXPENSE",
      incomeCompanyId: companyId,
      incomeSolicitudId: solicitudId,
      incomeAmount: amount,
      expenseProposalStatus: "PENDING_RULES",
      expenseSolicitudId: null,
      note: "Ingreso de empresa propia; falta regla aprobada para proponer/crear gasto relacionado.",
    },
    createdBy: uid,
    updatedBy: uid,
    createdAt: existingInvoice ? existingInvoice.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await solicitudSnap.ref.set({
    facturamaAutoDraftStatus: status,
    facturamaInvoiceId: invoiceRef.id,
    facturamaReceiverDataComplete: complete,
    fiscalValidationStatus: fiscal.status,
    fiscalValidationReason: fiscal.reason || null,
    financialCycleStatus: "INCOME_REQUIRES_EXPENSE",
    expenseProposalStatus: "PENDING_RULES",
    facturamaSyncUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, skipped: false, reused: !!existingInvoice, invoiceId: invoiceRef.id, status };
}
