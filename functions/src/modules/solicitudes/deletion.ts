import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivityTx } from "../../utils/logActivity";
import { canTransitionSolicitudBackendStatus, normalizeSolicitudBackendStatus } from "./domain";

const text = (v: unknown) => String(v ?? "").trim();
const upper = (v: unknown) => text(v).toUpperCase();
export function isDeletedSolicitud(row: any): boolean {
  return row?.isDeleted === true || Boolean(row?.deletedAt) || ["ELIMINADA", "ELIMINADO"].includes(upper(row?.status));
}
function refuse(message: string): never { throw new HttpsError("failed-precondition", message); }
const risky = (row: any) => Boolean(row.iqId || row.iqFolio || row.solicitudIqFolio || row.facturamaCfdiId || row.uuid || row.facturaUuid || row.submitClicked || row.postStartedAt) ||
  ["PROCESSING", "RUNNING", "OUTCOME_UNKNOWN", "PENDING_RECONCILIATION", "CREATED", "SUCCEEDED"].some(state =>
    [row.status, row.iqCreationStatus, row.iqCreateQueueStatus, row.outcome].some(value => upper(value) === state));

/** Visibility and deletion share the canonical source transaction with IQ's claim.
 * No Storage deletion, Task execution or provider cancellation occurs here. */
export async function changeSolicitudVisibilityCore(request: any) {
  const uid = text(request.auth?.uid), id = text(request.data?.solicitudId);
  if (!uid) throw new HttpsError("unauthenticated", "No autenticado.");
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", "Solicitud invalida.");
  const deleting = normalizeSolicitudBackendStatus(request.data?.newStatus) === "ELIMINADA";
  if (!deleting && typeof request.data?.ocultar !== "boolean") throw new HttpsError("invalid-argument", "Accion requerida.");
  return db.runTransaction(async tx => {
    const [person, source] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`solicitudes/${id}`))]);
    const me = person.data();
    assertAuthorized(request.auth, me, {allowedRoles:["superadmin","admin","operador"],requiredModule:"solicitudes",requiredAction:"cancel"});
    if (!source.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const row = source.data()!, rootId = text(me?.rootId || uid), role = getUserRole(me);
    if (row.rootId !== rootId || !(role === "superadmin" || (role === "admin" && row.adminId === uid) || row.createdBy === uid))
      throw new HttpsError("permission-denied", "Solicitud fuera de alcance.");
    const now = FieldValue.serverTimestamp();
    const audit = (event: string, description: string, extra: any = {}) => logActivityTx(tx, db, {
      event, sourceSystem:"PAY0", rootId, adminId:text(row.adminId || rootId), actorUid:uid,
      actorName:text(me?.displayName || me?.name || me?.username), actorUsername:text(me?.username), actorRole:role,
      referenceId:id, referenceFolio:text(row.folio), referenceType:"solicitud", description, extra,
    });
    if (!deleting) {
      if (isDeletedSolicitud(row)) refuse("Una solicitud eliminada no puede volver a mostrarse como activa.");
      const oculto = request.data.ocultar;
      if (Boolean(row.oculto) === oculto) return {ok:true,solicitudId:id,oculto,reused:true};
      tx.update(source.ref,{oculto,visibilityUpdatedBy:uid,visibilityUpdatedAt:now,updatedAt:now});
      audit(oculto ? "SOLICITUD_OCULTADA" : "SOLICITUD_MOSTRADA", `${oculto ? "Ocultada" : "Mostrada"} solicitud ${row.folio || id}.`);
      return {ok:true,solicitudId:id,oculto,reused:false};
    }
    if (isDeletedSolicitud(row)) return {ok:true,solicitudId:id,status:"ELIMINADA",isDeleted:true,reused:true};
    if (!canTransitionSolicitudBackendStatus(normalizeSolicitudBackendStatus(row.status),"ELIMINADA")) refuse("El estado requiere otro procedimiento autorizado.");
    if (risky(row) || Number(row.totalAbonado || row.totalAplicado || 0) > 0) refuse("Existen movimientos o envio IQ iniciado; utiliza el procedimiento autorizado.");
    const collections = ["uploads","pagoAplicaciones","pagos","iqCreateJobs","iqJobs","iqStatusJobs","iqInvoiceJobs","operationRecoveryJobs","paymentComplementRequests","paymentComplementJobs","pagoApplicationIqPlanItems","pagoApplicationIqLocks","documentDeliveryJobs","telegramClientNotificationEvents","signatureRequests","recognizedExpenses"];
    const queries = await Promise.all(collections.map(col => tx.get(db.collection(col).where("solicitudId","==",id).limit(101))));
    const [materiality, creation, directJob, invoices, linkedInvoice] = await Promise.all([
      tx.get(db.doc(`materialityOperations/${id}`)),tx.get(db.doc(`iqSolicitudCreations/${id}`)),tx.get(db.doc(`iqCreateJobs/${id}`)),
      tx.get(db.collection("facturamaInvoices").where("sourceSolicitudId","==",id).limit(101)),
      row.facturamaInvoiceId ? tx.get(db.doc(`facturamaInvoices/${row.facturamaInvoiceId}`)) : Promise.resolve(null),
    ]);
    if (row.facturamaInvoiceId && (!linkedInvoice?.exists || !invoices.docs.some(d=>d.id===linkedInvoice.id))) refuse("El vinculo fiscal requiere revision autorizada.");
    const groups = new Map(collections.map((col,i)=>[col,queries[i].docs]));
    if (queries.some(q=>q.size>100) || invoices.size>100 || queries.reduce((n,q)=>n+q.size,0)+invoices.size>350) refuse("Demasiadas dependencias; requiere revision autorizada.");
    const dependents = [...queries.flatMap(q=>q.docs),...invoices.docs,...(materiality.exists?[materiality]:[]),...(creation.exists?[creation]:[]),...(directJob.exists?[directJob]:[])];
    if (dependents.some(d=>d.get("rootId") && d.get("rootId")!==rootId)) refuse("Dependencia fuera de alcance; requiere revision.");
    for (const col of ["pagoAplicaciones","pagos","recognizedExpenses","signatureRequests","documentDeliveryJobs","telegramClientNotificationEvents","pagoApplicationIqPlanItems","pagoApplicationIqLocks","paymentComplementRequests","paymentComplementJobs","iqJobs","iqStatusJobs","iqInvoiceJobs"])
      if (groups.get(col)!.length) refuse(`Existen dependencias ${col}; utiliza el procedimiento autorizado.`);
    if ((creation.exists && risky(creation.data())) || (directJob.exists && risky(directJob.data())) || groups.get("iqCreateJobs")!.some(d=>risky(d.data()))) refuse("Existe envio IQ iniciado o incierto; no se elimina.");
    if (groups.get("operationRecoveryJobs")!.some(d=>["RUNNING","PROCESSING"].includes(upper(d.get("status"))))) refuse("Existe recovery en ejecucion; vuelve a comprobar su resultado.");
    if (invoices.docs.some(d=>!upper(d.get("status")).startsWith("AUTO_DRAFT_") || risky(d.data()) || d.get("facturamaAttemptedAt"))) refuse("Existe emision fiscal iniciada o un CFDI; requiere procedimiento autorizado.");
    const summary = {uploads:groups.get("uploads")!.length,createJobs:groups.get("iqCreateJobs")!.length,recoveryJobs:groups.get("operationRecoveryJobs")!.length,drafts:invoices.size,materiality:materiality.exists};
    tx.update(source.ref,{status:"ELIMINADA",isDeleted:true,deletedAt:now,deletedBy:uid,oculto:true,updatedAt:now,deletionVersion:1,deletionDependencies:summary});
    const jobs = new Map([...groups.get("iqCreateJobs")!,...groups.get("operationRecoveryJobs")!,...(directJob.exists?[directJob]:[])].map(d=>[d.ref.path,d]));
    for (const d of jobs.values()) {
      const terminal = ["COMPLETED","RESOLVED_EXTERNALLY","SUPERSEDED","CANCELLED_DELETED"].includes(upper(d.get("status")));
      tx.update(d.ref,{sourceDeleted:true,...(!terminal?{status:"CANCELLED_DELETED",deletionPreviousStatus:d.get("status") || null,nextRunAt:FieldValue.delete(),nextAttemptAt:FieldValue.delete()}:{}),updatedAt:now});
    }
    if (creation.exists) tx.update(creation.ref,{status:"CANCELLED_DELETED",sourceDeleted:true,updatedAt:now});
    for (const d of groups.get("uploads")!) tx.update(d.ref,{sourceDeleted:true,...(upper(d.get("status"))==="PENDING"?{status:"CANCELLED_DELETED",active:false}:{}),updatedAt:now});
    if (materiality.exists) tx.update(materiality.ref,{sourceDeleted:true,solicitudStatus:"ELIMINADA",updatedAt:now});
    for (const d of invoices.docs) tx.update(d.ref,{sourceDeleted:true,updatedAt:now});
    audit("SOLICITUD_ELIMINADA",`Eliminada logicamente solicitud ${row.folio || id}; historial conservado.`,summary);
    return {ok:true,solicitudId:id,status:"ELIMINADA",isDeleted:true,reused:false,dependencies:summary};
  });
}
