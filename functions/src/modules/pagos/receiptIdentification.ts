import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { getReceiptActorCorrectionState } from "./receiptLearning";
import { selectReceiptIdentity, matchReceiptIdentity, normalizeReceiptReference, receiptRegistrationReasons, type ReceiptCatalogItem, type ReceiptSignals } from "./receiptIdentificationDomain";

type Actor = { uid: string; rootId: string; role: "superadmin" | "admin" | "operador" };
const clean = (value: unknown) => String(value ?? "").trim();
export type ReceiptIdentificationResult = {
  id: string; status: "READY" | "REQUIRES_REVIEW" | "REGISTERED";
  reasons: string[]; evidence: { client: string[]; company: string[] };
  createPayload: Record<string, any> | null; pagoId: string | null;
  receiptPending?: boolean;
  verifiedMatches?: { client: ReceiptIdentityOption | null; company: ReceiptIdentityOption | null };
  candidates?: { client: ReceiptIdentityOption[]; company: ReceiptIdentityOption[] };
};
type ReceiptIdentityOption = { id: string; name: string; despachoId?: string; evidence: string[]
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
export async function identifyParsedReceipt(input: { db: Firestore; actor: Actor; receipt: ReceiptSignals; contentSha256: string; operationTypeKey?: string; analysisId?: string; readerVersion?: string; semanticReceipt?: Record<string, unknown>; selectedClientId?: string; selectedCompanyId?: string; correctionVersion?: number }): Promise<ReceiptIdentificationResult> {
  const { db, actor, receipt } = input;
  const operationTypeKey = clean(input.operationTypeKey).toUpperCase();
  if (operationTypeKey.includes("/") || operationTypeKey.length > 100) throw new HttpsError("invalid-argument", "Tipo de operación inválido.");
  const id = createHash("sha256").update([actor.rootId, actor.uid, input.contentSha256].join("|")).digest("hex");
  const ref = db.doc(`pagoReceiptIdentifications/${id}`);
  const [clients, companies] = await Promise.all([
    db.collection("clients").where("rootId", "==", actor.rootId).limit(501).get(),
    db.collection("companies").where("rootId", "==", actor.rootId).limit(501).get(),
  ]);
  const clientItems = clients.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  const companyItems = companies.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  const clientSignals = { name: receipt.senderName, rfc: receipt.payerRfc, account: receipt.account };
  const companySignals = { name: receipt.beneficiaryName, rfc: receipt.beneficiaryRfc, account: receipt.destinationAccount };
  // Authorize the entire offered catalog before either matching or exposing names.
  const authorizedClients: ReceiptCatalogItem[] = [];
  for (const candidate of clientItems) {
    if (candidate.rootId !== actor.rootId || candidate.active === false || candidate.isActive === false) continue;
    try {
      await requireClientOperationalAccess({ ...actor, clientId: candidate.id, client: candidate, permission: "operatePagos" });
      authorizedClients.push(candidate);
    } catch (error: any) { if (error?.code !== "permission-denied") throw error; }
  }
  const authorizedCompanies: ReceiptCatalogItem[] = [];
  for (const candidate of companyItems) {
    if (candidate.isActive !== false && await allowedCompany(db, actor, candidate)) authorizedCompanies.push(candidate);
  }
  const clientSelection = selectReceiptIdentity(authorizedClients, clientSignals, clean(input.selectedClientId), { party: "CLIENT" });
  const companySelection = selectReceiptIdentity(authorizedCompanies, companySignals, clean(input.selectedCompanyId), { party: "COMPANY" });
  const clientMatch = clientSelection.match, companyMatch = companySelection.match;
  const reasons = [...receiptRegistrationReasons(receipt, operationTypeKey), ...clientMatch.reasons.map(reason => `CLIENT_${reason}`), ...companyMatch.reasons.map(reason => `COMPANY_${reason}`)];
  if (clients.size > 500 || companies.size > 500) reasons.push("CATALOG_REQUIRES_REVIEW");
  const client = authorizedClients.find(item => item.id === clientMatch.id);
  const company = authorizedCompanies.find(item => item.id === companyMatch.id);
  if (clientMatch.id && !client) reasons.push("CLIENT_ACCESS_REQUIRES_REVIEW");
  if (companyMatch.id && !company) reasons.push("COMPANY_ACCESS_REQUIRES_REVIEW");
  const option = (item: ReceiptCatalogItem, kind: "client" | "company"): ReceiptIdentityOption => ({
    id: item.id, name: clean(item.razonSocial || item.name || item.nombre || item.displayName),
    ...(kind === "company" ? { despachoId: clean(item.despachoId) } : {}),
    evidence: [...new Set(["AUTHORIZED_CATALOG_ENTRY", ...(kind === "client" && clientMatch.id === item.id ? clientMatch.evidence : kind === "company" && companyMatch.id === item.id ? companyMatch.evidence : matchReceiptIdentity([item], kind === "client" ? clientSignals : companySignals, { party: kind === "client" ? "CLIENT" : "COMPANY" }).evidence)])],
  });
  const candidates = { client: clientSelection.candidates.map(item => option(item, "client")), company: companySelection.candidates.map(item => option(item, "company")) };
  const verifiedMatches = { client: client ? option(client, "client") : null, company: company ? option(company, "company") : null };
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
    receiptAnalysisId: clean(input.analysisId), receiptReaderVersion: clean(input.readerVersion),
    receiptSemantic: input.semanticReceipt || null,
  } : null;
  const evidence = { client: clientMatch.evidence, company: companyMatch.evidence };
  return db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (input.analysisId && input.correctionVersion !== undefined) {
      const analysis = await tx.get(db.doc(`pagoReceiptAnalyses/${input.analysisId}`));
      if (!analysis.exists || analysis.get("rootId") !== actor.rootId || getReceiptActorCorrectionState(analysis.data() || {}, actor.uid).version !== input.correctionVersion) {
        throw new HttpsError("aborted", "El comprobante cambió; vuelve a validar los datos actuales.");
      }
    }
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
        verifiedMatches, candidates, createPayload: null, pagoId: pagoId || null, receiptPending: !!receiptPending };
    }
    const status = ready ? "READY" : "REQUIRES_REVIEW";
    tx.set(ref, { schemaVersion: 1, rootId: actor.rootId, actorUid: actor.uid, source: "RECEIPT", contentSha256: input.contentSha256,
      status, reasons, evidence, verifiedMatches, candidates, correctionVersion: input.correctionVersion ?? 0, createPayload, stage: ready ? "IDENTIFIED" : "REQUIRES_REVIEW",
      analysisId: clean(input.analysisId) || null, readerVersion: clean(input.readerVersion) || null,
      updatedAt: FieldValue.serverTimestamp(), ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      attempts: FieldValue.increment(1), metricDetected: true, metricIdentifiedAutomatically: ready, metricRequiresReview: !ready,
    }, { merge: true });
    return { id, status, reasons, evidence, verifiedMatches, candidates, createPayload, pagoId: null };
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
