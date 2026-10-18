import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { matchReceiptIdentity, normalizeReceiptReference, receiptRegistrationReasons, type ReceiptCatalogItem, type ReceiptSignals } from "./receiptIdentificationDomain";

type Actor = { uid: string; rootId: string; role: "superadmin" | "admin" | "operador" };
const clean = (value: unknown) => String(value ?? "").trim();
export type ReceiptIdentificationResult = {
  id: string; status: "READY" | "REQUIRES_REVIEW" | "REGISTERED";
  reasons: string[]; evidence: { client: string[]; company: string[] };
  createPayload: Record<string, any> | null; pagoId: string | null;
  receiptPending?: boolean;
};

async function allowedCompany(db: Firestore, actor: Actor, company: ReceiptCatalogItem) {
  if (company.rootId !== actor.rootId || !company.despachoId || company.active === false) return false;
  const dispatch = await db.doc(`despachos/${company.despachoId}`).get();
  if (!dispatch.exists || dispatch.get("active") === false || (dispatch.get("rootId") && dispatch.get("rootId") !== actor.rootId)) return false;
  if (actor.role === "superadmin") return true;
  const direct = await db.doc(`userCompanyAccess/${actor.uid}/companies/${company.id}`).get();
  if (direct.exists && direct.get("active") === true) return true;
  const [access, membership] = await Promise.all([
    db.doc(`userDespachoAccess/${actor.uid}/despachos/${company.despachoId}`).get(),
    db.doc(`dispatchCompanyAccess/${company.despachoId}/companies/${company.id}`).get(),
  ]);
  return access.get("active") === true && membership.get("active") === true;
}

/** Called only with bytes and parsed signals obtained by the server parser. */
export async function identifyParsedReceipt(input: { db: Firestore; actor: Actor; receipt: ReceiptSignals; contentSha256: string; operationTypeKey?: string }): Promise<ReceiptIdentificationResult> {
  const { db, actor, receipt } = input;
  const operationTypeKey = clean(input.operationTypeKey).toUpperCase();
  if (operationTypeKey.includes("/") || operationTypeKey.length > 100) throw new HttpsError("invalid-argument", "Tipo de operación inválido.");
  const id = createHash("sha256").update([actor.rootId, actor.uid, input.contentSha256].join("|")).digest("hex");
  const ref = db.doc(`pagoReceiptIdentifications/${id}`);
  const [clients, companies] = await Promise.all([
    db.collection("clients").where("rootId", "==", actor.rootId).limit(501).get(),
    db.collection("companies").where("rootId", "==", actor.rootId).limit(501).get(),
  ]);
  const clientMatch = matchReceiptIdentity(clients.docs.map(doc => ({ ...doc.data(), id: doc.id })), { name: receipt.senderName, rfc: receipt.payerRfc, account: receipt.account });
  const companyMatch = matchReceiptIdentity(companies.docs.map(doc => ({ ...doc.data(), id: doc.id })), { name: receipt.beneficiaryName, rfc: receipt.beneficiaryRfc, account: receipt.destinationAccount });
  const reasons = [...receiptRegistrationReasons(receipt, operationTypeKey), ...clientMatch.reasons.map(reason => `CLIENT_${reason}`), ...companyMatch.reasons.map(reason => `COMPANY_${reason}`)];
  if (clients.size > 500 || companies.size > 500) reasons.push("CATALOG_REQUIRES_REVIEW");
  const client = clients.docs.find(doc => doc.id === clientMatch.id), companyDoc = companies.docs.find(doc => doc.id === companyMatch.id);
  const company = companyDoc ? { ...companyDoc.data(), id: companyDoc.id } as ReceiptCatalogItem : null;
  if (client) {
    try { await requireClientOperationalAccess({ ...actor, clientId: client.id, client: client.data(), permission: "operatePagos" }); }
    catch (error: any) { if (error?.code !== "permission-denied") throw error; reasons.push("CLIENT_ACCESS_REQUIRES_REVIEW"); }
  }
  if (company && !await allowedCompany(db, actor, company)) reasons.push("COMPANY_ACCESS_REQUIRES_REVIEW");
  if (operationTypeKey) {
    const operation = await db.doc(`operationTypes/${operationTypeKey}`).get();
    if (!operation.exists || operation.get("active") === false) reasons.push("OPERATION_TYPE_REQUIRES_REVIEW");
  }
  const ready = reasons.length === 0 && !!client && !!company;
  const createPayload = ready ? {
    clienteId: client!.id, companyId: company!.id, despachoId: clean(company!.despachoId),
    empresaNombre: clean(company!.razonSocial || company!.name || company!.nombre), operationTypeKey,
    montoTotal: Number(receipt.amount), fechaPago: clean(receipt.date), paymentTime: clean(receipt.time) || "12:00:00",
    paymentForm: receipt.paymentForm, referencia: clean(receipt.reference), concepto: clean(receipt.concept).slice(0, 1000), moneda: "MXN", notaInicial: "",
    detectedBankName: clean(receipt.bankName), detectedSenderName: clean(receipt.senderName), detectedBeneficiaryName: clean(receipt.beneficiaryName),
    detectedSourceAccount: clean(receipt.account), detectedDestinationAccount: clean(receipt.destinationAccount),
    detectedPayerRfc: clean(receipt.payerRfc), detectedBeneficiaryRfc: clean(receipt.beneficiaryRfc),
    operatorSelectedBankName: clean(company!.bankName || company!.banco), operatorSelectedAccount: clean(company!.bankClabe || company!.clabe || company!.cuenta),
    receiptIdentificationId: id,
  } : null;
  const evidence = { client: clientMatch.evidence, company: companyMatch.evidence };
  return db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists && existing.get("status") === "REGISTERED") {
      const pagoId = clean(existing.get("pagoId"));
      const pago = pagoId ? await tx.get(db.doc(`pagos/${pagoId}`)) : null;
      const recoveryIdentityReady = reasons.filter(reason => reason !== "MISSING_OPERATION_TYPE").length === 0 && !!client && !!company;
      const receiptPending = recoveryIdentityReady && existing.get("rootId") === actor.rootId && existing.get("actorUid") === actor.uid &&
        existing.get("contentSha256") === input.contentSha256 && existing.get("stage") === "REGISTERED_AWAITING_RECEIPT" &&
        pago?.get("rootId") === actor.rootId && pago?.get("createdBy") === actor.uid && pago?.get("receiptIdentificationId") === id &&
        pago?.get("clienteId") === client?.id && pago?.get("companyId") === company?.id &&
        pago?.get("operationTypeKey") === existing.get("createPayload.operationTypeKey") &&
        (!operationTypeKey || pago?.get("operationTypeKey") === operationTypeKey);
      return { id, status: "REGISTERED", reasons: [receiptPending ? "RECEIPT_UPLOAD_PENDING" : "DUPLICATE"], evidence,
        createPayload: null, pagoId: pagoId || null, receiptPending: !!receiptPending };
    }
    const status = ready ? "READY" : "REQUIRES_REVIEW";
    tx.set(ref, { schemaVersion: 1, rootId: actor.rootId, actorUid: actor.uid, source: "RECEIPT", contentSha256: input.contentSha256,
      status, reasons, evidence, createPayload, stage: ready ? "IDENTIFIED" : "REQUIRES_REVIEW",
      updatedAt: FieldValue.serverTimestamp(), ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      attempts: FieldValue.increment(1), metricDetected: true, metricIdentifiedAutomatically: ready, metricRequiresReview: !ready,
    }, { merge: true });
    return { id, status, reasons, evidence, createPayload, pagoId: null };
  });
}

/** Re-run against the transaction snapshot before the canonical payment write. */
export function assertReceiptCreation(snapshot: DocumentSnapshot, actor: { uid: string; rootId: string }, payload: Record<string, any>) {
  if (!snapshot.exists || snapshot.get("rootId") !== actor.rootId || snapshot.get("actorUid") !== actor.uid) throw new HttpsError("permission-denied", "Identificación de comprobante fuera de alcance.");
  if (snapshot.get("status") === "REGISTERED") throw new HttpsError("already-exists", "Comprobante ya registrado.", { code: "PAGO_RECEIPT_DUPLICATE", pagoId: snapshot.get("pagoId") || null });
  if (snapshot.get("status") !== "READY") throw new HttpsError("failed-precondition", "El comprobante requiere revisión antes de registrarlo.");
  const expected = snapshot.get("createPayload") || {};
  for (const field of ["clienteId", "companyId", "despachoId", "operationTypeKey", "fechaPago", "paymentTime", "paymentForm", "moneda", "concepto", "detectedSenderName", "detectedBeneficiaryName", "detectedSourceAccount", "detectedDestinationAccount", "detectedPayerRfc", "detectedBeneficiaryRfc"]) {
    if (clean(payload[field]) !== clean(expected[field])) throw new HttpsError("failed-precondition", "La identificación cambió; vuelve a revisar el comprobante.");
  }
  if (Math.round(Number(payload.montoTotal) * 100) !== Math.round(Number(expected.montoTotal) * 100) || normalizeReceiptReference(payload.referencia) !== normalizeReceiptReference(expected.referencia) || payload.acceptRfcMismatch === true || clean(payload.notaInicial)) throw new HttpsError("failed-precondition", "El pago no coincide con el comprobante identificado.");
}

export function receiptRegisteredPatch(pagoId: string) {
  return { status: "REGISTERED", stage: "REGISTERED_AWAITING_RECEIPT", pagoId, metricRegisteredAutomatically: true, registeredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
}
