import { FieldValue, getFirestore } from "firebase-admin/firestore";

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
  const rfc = normalizeRfc(client?.rfc || client?.RFC || solicitud?.clienteRfc || solicitud?.clientRfc);
  const fiscalRegime = text(client?.fiscalRegime || client?.regimenFiscal || client?.regimenFiscalReceptor, 3);
  const postalCode = text(client?.postalCode || client?.codigoPostal || client?.cp || client?.zipCode, 5);
  const cfdiUse = text(client?.cfdiUse || client?.usoCfdi || client?.usoCFDI || "G03", 3).toUpperCase();
  return {
    rfc,
    name: pickName(client, text(solicitud?.clienteNombre || solicitud?.clientName || clienteId, 254)),
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
      .limit(1)
      .get(),
  ]);
  if (!companySnap.exists || !clientSnap.exists) return { ok: false, skipped: true, reason: "RELATION_NOT_FOUND" };
  if (!existingSnap.empty) {
    const invoiceId = existingSnap.docs[0].id;
    await solicitudSnap.ref.set({
      facturamaAutoDraftStatus: "EXISTS",
      facturamaInvoiceId: invoiceId,
      facturamaSyncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, skipped: false, reused: true, invoiceId };
  }

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
  const amount = money(solicitud.monto || solicitud.total || solicitud.amount);
  const invoiceRef = db.collection("facturamaInvoices").doc();
  const idempotencyKey = `auto-solicitud-${rootId}-${solicitudId}`;
  const status = complete ? "AUTO_DRAFT" : "AUTO_DRAFT_NEEDS_FISCAL_DATA";
  const conceptDescription = text(
    solicitud.operationTypeName ||
    solicitud.operationTypeKey ||
    "Servicio operativo segun Orden de Compra",
    1000,
  );

  await invoiceRef.create({
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
    concepts: [{
      productCode: "84111506",
      description: conceptDescription,
      unitCode: "E48",
      unit: "Unidad de servicio",
      quantity: 1,
      unitPrice: amount,
      taxObject: "02",
    }],
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
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await solicitudSnap.ref.set({
    facturamaAutoDraftStatus: status,
    facturamaInvoiceId: invoiceRef.id,
    facturamaReceiverDataComplete: complete,
    financialCycleStatus: "INCOME_REQUIRES_EXPENSE",
    expenseProposalStatus: "PENDING_RULES",
    facturamaSyncUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, skipped: false, reused: false, invoiceId: invoiceRef.id, status };
}
