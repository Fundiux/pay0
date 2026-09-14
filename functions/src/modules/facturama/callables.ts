import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { db, getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { isOwnInvoiceIssuerCompany } from "./service";

const FACTURAMA_SANDBOX_USERNAME = defineSecret("FACTURAMA_SANDBOX_USERNAME");
const FACTURAMA_SANDBOX_PASSWORD = defineSecret("FACTURAMA_SANDBOX_PASSWORD");

type DraftConcept = {
  productCode: string;
  description: string;
  unitCode: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  taxObject: string;
};

function text(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1000000) / 1000000 : NaN;
}

function assertFacturacionAccess(request: any, user: any) {
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
}

function normalizeDraft(data: any) {
  const receiver = {
    rfc: text(data?.receiver?.rfc, 13).toUpperCase(),
    name: text(data?.receiver?.name, 254),
    fiscalRegime: text(data?.receiver?.fiscalRegime, 3),
    postalCode: text(data?.receiver?.postalCode, 5),
    cfdiUse: text(data?.receiver?.cfdiUse, 3).toUpperCase(),
  };
  if (!/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(receiver.rfc)) {
    throw new HttpsError("invalid-argument", "RFC del receptor invalido.");
  }
  if (!receiver.name || !/^\d{3}$/.test(receiver.fiscalRegime) || !/^\d{5}$/.test(receiver.postalCode) || !/^[A-Z]\d{2}$/.test(receiver.cfdiUse)) {
    throw new HttpsError("invalid-argument", "Completa regimen fiscal, codigo postal y uso CFDI del receptor.");
  }

  const concepts: DraftConcept[] = Array.isArray(data?.concepts) ? data.concepts.map((item: any): DraftConcept => ({
    productCode: text(item?.productCode, 8),
    description: text(item?.description, 1000),
    unitCode: text(item?.unitCode, 3).toUpperCase(),
    unit: text(item?.unit, 80),
    quantity: number(item?.quantity),
    unitPrice: number(item?.unitPrice),
    taxObject: text(item?.taxObject || "02", 2),
  })) : [];
  if (!concepts.length || concepts.length > 50) throw new HttpsError("invalid-argument", "Agrega entre 1 y 50 conceptos.");
  concepts.forEach((concept: DraftConcept, index: number) => {
    if (!/^\d{8}$/.test(concept.productCode) || !concept.description || !/^[A-Z0-9]{2,3}$/.test(concept.unitCode) || !concept.unit || !(concept.quantity > 0) || !(concept.unitPrice >= 0) || !["01", "02", "03"].includes(concept.taxObject)) {
      throw new HttpsError("invalid-argument", `Concepto ${index + 1} incompleto o invalido.`);
    }
  });
  const subtotal = Math.round(concepts.reduce((sum: number, item: DraftConcept) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;
  return {
    receiver,
    concepts,
    paymentForm: text(data?.paymentForm || "03", 2),
    paymentMethod: text(data?.paymentMethod || "PUE", 3).toUpperCase(),
    currency: text(data?.currency || "MXN", 3).toUpperCase(),
    subtotal,
  };
}

export const getFacturamaSandboxStatus = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB", secrets: [FACTURAMA_SANDBOX_USERNAME, FACTURAMA_SANDBOX_PASSWORD] },
  async (request) => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    assertFacturacionAccess(request, user);
    return {
      ok: true,
      environment: "SANDBOX",
      configured: Boolean(text(FACTURAMA_SANDBOX_USERNAME.value(), 500) && text(FACTURAMA_SANDBOX_PASSWORD.value(), 500)),
      productionEnabled: false,
    };
  }
);

export const saveFacturamaDraft = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    assertFacturacionAccess(request, user);
    const rootId = text(user?.rootId || uid, 128);
    const companyId = text(request.data?.companyId, 128);
    const idempotencyKey = text(request.data?.idempotencyKey, 128);
    if (!companyId) throw new HttpsError("invalid-argument", "Selecciona la empresa emisora.");
    if (idempotencyKey.length < 16) throw new HttpsError("invalid-argument", "La llave de idempotencia es requerida.");
    const invoice = normalizeDraft(request.data);
    if (!/^[0-9]{2}$/.test(invoice.paymentForm) || !["PUE", "PPD"].includes(invoice.paymentMethod) || invoice.currency !== "MXN") {
      throw new HttpsError("invalid-argument", "Forma/metodo de pago o moneda invalida.");
    }

    const companySnap = await db.doc(`companies/${companyId}`).get();
    if (!companySnap.exists) throw new HttpsError("not-found", "Empresa emisora no encontrada.");
    const company: any = companySnap.data() || {};
    if (text(company.rootId, 128) !== rootId || company.active === false) {
      throw new HttpsError("permission-denied", "Empresa emisora fuera de tu alcance o inactiva.");
    }
    if (!isOwnInvoiceIssuerCompany(company)) {
      throw new HttpsError("failed-precondition", "Solo las empresas propias pueden emitir o preparar CFDI desde PAY0.");
    }
    const companyRfc = text(company.rfc, 13).toUpperCase();
    if (!companyRfc) throw new HttpsError("failed-precondition", "La empresa emisora no tiene RFC configurado.");

    const existing = await db.collection("facturamaInvoices")
      .where("rootId", "==", rootId).where("idempotencyKey", "==", idempotencyKey).limit(1).get();
    if (!existing.empty) return { ok: true, invoiceId: existing.docs[0].id, reused: true, status: existing.docs[0].data()?.status || "DRAFT" };

    const invoiceRef = db.collection("facturamaInvoices").doc();
    await invoiceRef.create({
      rootId,
      companyId,
      issuer: { name: text(company.nombre, 254), rfc: companyRfc },
      environment: "SANDBOX",
      status: "DRAFT",
      idempotencyKey,
      receiver: invoice.receiver,
      concepts: invoice.concepts,
      paymentForm: invoice.paymentForm,
      paymentMethod: invoice.paymentMethod,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      createdBy: uid,
      updatedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logActivity({
      event: "FACTURA_BORRADOR_CREADO", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid,
      actorName: text(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: invoiceRef.id,
      referenceType: "factura", amount: invoice.subtotal, description: `Borrador CFDI creado para ${invoice.receiver.rfc}`,
    });
    return { ok: true, invoiceId: invoiceRef.id, reused: false, status: "DRAFT" };
  }
);

export const listFacturamaInvoices = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    assertFacturacionAccess(request, user);
    const rootId = text(user?.rootId || uid, 128);
    const companyId = text(request.data?.companyId, 128);
    const limit = Math.min(Math.max(Math.trunc(number(request.data?.limit) || 20), 1), 50);
    let query: FirebaseFirestore.Query = db.collection("facturamaInvoices").where("rootId", "==", rootId);
    if (companyId) query = query.where("companyId", "==", companyId);
    const snapshot = await query.orderBy("createdAt", "desc").limit(limit).get();
    return {
      ok: true,
      invoices: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    };
  }
);
