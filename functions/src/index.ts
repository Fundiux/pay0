
import {
  buildPagoCoverageApplyPatch,
  buildPagoFoundationOnConciliation,
  buildPagoFoundationOnCreate,
  getPagoCoverageState,
} from "./modules/deposits/foundation";
import { postCanonicalPagoFinancials } from "./modules/deposits/financial";
import { buildPagoIqTerminalLockPatchH4D58H } from "./modules/iq/pagoDepositCallables";
import { canTransitionPagoStatus, normalizePagoStatus } from "./modules/pagos/domain";
import {
  preparePagoFinancialPosting as preparePagoFinancialPostingCore,
  resolvePagoOperationPreview,
  resolvePagoOperationPreviewDebug,
} from "./modules/deposits/context";
import { diagnosePagoFinancialContext as diagnosePagoFinancialContextCore } from "./modules/deposits/diagnose";
import { assertAuthorized, normalizeRole, getUserRole } from "./utils/authGuard";
import { getDefaultModules } from "./modules/users/defaultModules";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { logActivity, logActivityTx } from "./utils/logActivity";
import { setGlobalOptions } from "firebase-functions/v2";
import { FieldValue, FieldPath, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { nextSequenceTx, buildCanonicalFolio } from "./modules/sequences/service";
import {
  resolveCanonicalBusinessFolioContext,
  buildCanonicalBusinessFolioParts,
} from "./modules/sequences/businessFolioContext";
import { normalizeSolicitudBackendStatus, canTransitionSolicitudBackendStatus, normalizeSatCancelCode, isSolicitudBackendTerminalStatus, canRejectSolicitudBackendStatus, canCancelSolicitudBackendStatus, type SolicitudBackendStatus } from "./modules/solicitudes/domain";
import { canCancelSolicitudWithAbonos, needsUuidOrRelatedForSatCancel01, needsUuidOrRelatedForEnSustitucion, getSolicitudStatusEventMeta, getSolicitudRechazadaEventMeta } from "./utils/solicitudStatusHandlerRules";
import { buildSolicitudCanceladaPatch, buildSolicitudEnSustitucionPatch, getSolicitudCanceladaEventMeta, getSolicitudEnSustitucionEventMeta } from "./utils/solicitudStatusPatches";
import { requestSolicitudIqCancellationCore, IQ_CANCELLATION_CREDENTIALS_KEY } from "./modules/iq/solicitudCancellationService";
import { normalizeClientAccessPermissions } from "./modules/clientDelegations/access";
import { recordOperationalMetric } from "./modules/operationalMetrics/service";
import { linkSolicitudToMaterialityOperationCore } from "./modules/materiality/service";
import { ensureAutomaticFacturamaDraftForSolicitud } from "./modules/facturama/service";

function normalizeStatus(input: any): SolicitudBackendStatus {
  return normalizeSolicitudBackendStatus(input);
}

function canTransitionSolicitudStatus(
  currentStatus: SolicitudBackendStatus,
  nextStatus: SolicitudBackendStatus
) {
  return canTransitionSolicitudBackendStatus(currentStatus, nextStatus);
}

setGlobalOptions({ region: "us-central1" });

import { addClientBeneficiaryMethod, createClientBeneficiary, deleteClientBeneficiary, deleteClientBeneficiaryMethod, toggleClientBeneficiaryActive, toggleClientBeneficiaryMethodActive, updateClientBeneficiary, updateClientBeneficiaryMethod, replaceClientBeneficiaryMethod } from "./modules/beneficiaries/callables";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function requireAuth(request: any) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  return request.auth.uid as string;
}

async function getRootId(uid: string) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");
  const data = snap.data() || {};
  return String(data.rootId || uid);
}

async function getActiveClientDelegationAccess(
  uid: string,
  clienteId: string,
  requiredPermission: "operateSolicitudes" | "operatePagos"
) {
  const accessSnap = await db.doc(`userClientAccess/${uid}/clients/${clienteId}`).get();
  if (!accessSnap.exists) return null;

  const data: any = accessSnap.data() || {};
  if (data?.active !== true) return null;
  const permissions = normalizeClientAccessPermissions(data?.permissions, true);
  if (permissions.view !== true || permissions[requiredPermission] !== true) return null;

  return {
    id: accessSnap.id,
    path: accessSnap.ref.path,
    data,
  };
}

export { logAuthEventCallable, logUnauthorizedRouteAttempt, redeemMySecurityUnlockCode } from "./modules/activityLog/callables";

export const upsertUser = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const email = request.data?.email ? String(request.data.email) : null;

    const ref = db.doc(`users/${uid}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError(
        "permission-denied",
        "Tu usuario no tiene un perfil PAY0 autorizado. Solicita acceso a un administrador."
      );
    }

    await ref.set(
      {
        email,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, created: false };
  }
);

export const createSolicitud = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB", minInstances: 1 },
  async (request) => {
    const __perfStartedAt = Date.now();
    const __perf: Record<string, number> = {};
    let __perfMarkAt = __perfStartedAt;
    const __mark = (name: string) => {
      const nowMs = Date.now();
      __perf[name] = nowMs - __perfMarkAt;
      __perfMarkAt = nowMs;
    };

    const uid = requireAuth(request);
    const [caller, rootId] = await Promise.all([
      getMyUser(uid),
      getRootId(uid),
    ]);
    const role = requireRole(caller, ["superadmin", "admin", "operador"]);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "create" });
    const adminId = getActivityAdminId(caller, uid, rootId);
    __mark("auth_user_root");

    const {
      clientId,
      clienteId: clienteIdRaw,
      companyId,
      despachoId: despachoIdRaw,
      operationTypeKey,
      monto,
      tipoFactura,
      comentario,
      clienteNombre,
      empresaNombre,
      replacementOfSolicitudId,
      replacementReason,
    } = request.data || {};

    const clienteId = String(clienteIdRaw || clientId || "").trim();
    const companyIdValue = String(companyId || "").trim();
    const incomingDespachoId = String(despachoIdRaw || "").trim();
    const operationTypeKeyValue = String(operationTypeKey || "").trim().toUpperCase();
    const replacementSourceId = String(replacementOfSolicitudId || "").trim();

    if (!clienteId || !companyIdValue) {
      throw new HttpsError("invalid-argument", "clienteId y companyId son obligatorios.");
    }

    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      throw new HttpsError("invalid-argument", "monto invalido.");
    }

    if (!tipoFactura) {
      throw new HttpsError("invalid-argument", "tipoFactura es obligatorio.");
    }

    if (!operationTypeKeyValue) {
      throw new HttpsError(
        "failed-precondition",
        "No se puede crear la solicitud sin tipo de operacion. Asigna tipo de operacion y costo del cliente."
      );
    }

    const [clientSnap, companySnap] = await Promise.all([
      db.doc(`clients/${clienteId}`).get(),
      db.doc(`companies/${companyIdValue}`).get(),
    ]);

    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Cliente no existe.");
    }

    __mark("client_company_reads");

    const clientData: any = clientSnap.data() || {};
    if (clientData?.active === false) {
      throw new HttpsError("failed-precondition", "Cliente inactivo.");
    }
    if (clientData?.rootId && String(clientData.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
    }

    const delegatedClientAccess =
      role === "superadmin"
        ? null
        : await getActiveClientDelegationAccess(uid, clienteId, "operateSolicitudes");
    const hasDelegatedClientAccess = !!delegatedClientAccess;

    if (role === "admin" && !hasDelegatedClientAccess) {
      const clientAdminId = String(clientData?.adminId || "").trim();
      if (clientAdminId && clientAdminId !== uid) {
        throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
      }
    }

    if (role === "operador" && !hasDelegatedClientAccess) {
      const clientManagedBy = String(clientData?.managedByUserId || "").trim();
      const clientAdminId = String(clientData?.adminId || "").trim();

      if (clientManagedBy && clientManagedBy !== uid) {
        throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
      }

      if (clientAdminId && clientAdminId !== adminId) {
        throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
      }
    }

    if (!companySnap.exists) {
      throw new HttpsError("not-found", "Empresa no existe.");
    }

    const companyData: any = companySnap.data() || {};
    if (companyData?.active === false) {
      throw new HttpsError("failed-precondition", "Empresa inactiva.");
    }
    if (companyData?.rootId && String(companyData.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado para usar esta empresa.");
    }

    if (role !== "superadmin") {
      let companyAllowed = false;

      const directAccessSnap = await db.doc(`userCompanyAccess/${uid}/companies/${companyIdValue}`).get();
      if (directAccessSnap.exists && directAccessSnap.data()?.active === true) {
        companyAllowed = true;
      }

      if (!companyAllowed) {
        const assignedDespachosSnap = await db
          .collection(`userDespachoAccess/${uid}/despachos`)
          .where("active", "==", true)
          .get();

        const assignedDespachoIds = assignedDespachosSnap.docs
          .map((despachoDoc) => String(despachoDoc.id || "").trim())
          .filter(Boolean);

        if (assignedDespachoIds.length > 0) {
          const despachoAccessSnaps = await Promise.all(
            assignedDespachoIds.map((despachoId) =>
              db.doc(`dispatchCompanyAccess/${despachoId}/companies/${companyIdValue}`).get()
            )
          );

          companyAllowed = despachoAccessSnaps.some(
            (despachoAccessSnap) =>
              despachoAccessSnap.exists &&
              despachoAccessSnap.data()?.active === true
          );
        }
      }

      if (!companyAllowed) {
        throw new HttpsError("permission-denied", "No autorizado para usar esta empresa.");
      }
    }

    __mark("authorization_and_access");

    const companyDespachoId = String(companyData?.despachoId || "").trim();
    if (!companyDespachoId) {
      throw new HttpsError(
        "failed-precondition",
        "No se puede crear la solicitud sin despacho. Asigna despacho y costo del cliente."
      );
    }

    if (incomingDespachoId && incomingDespachoId !== companyDespachoId) {
      throw new HttpsError(
        "failed-precondition",
        "La empresa seleccionada no coincide con el despacho esperado para esta solicitud."
      );
    }

    const resolvedClienteNombre = String(
      clientData?.nombre ||
      clientData?.clienteNombre ||
      clientData?.name ||
      clientData?.razonSocial ||
      clientData?.alias ||
      clienteId
    ).trim();

    const resolvedEmpresaNombre = String(
      companyData?.nombre ||
      companyData?.empresaNombre ||
      companyIdValue
    ).trim();

    // H4_D82_A3_A6_A4_A4_A3_OPERATIONAL_OWNER
    // La delegaciÃƒÆ’Ã‚Â³n permite administrar, pero no transfiere propiedad,
    // numeraciÃƒÆ’Ã‚Â³n PAY0 ni cuenta IQ.
    const operationalOwnerId = String(
      clientData?.operadorId ||
      clientData?.managedByUserId ||
      clientData?.ownerId ||
      clientData?.adminId ||
      clientData?.createdBy ||
      ""
    ).trim();

    if (!operationalOwnerId) {
      throw new HttpsError(
        "failed-precondition",
        "El cliente no tiene propietario operativo configurado."
      );
    }

    const [despachoSnap, resolvedClientAssignedRate, operationalOwnerSnap] =
      await Promise.all([
        db.doc(`despachos/${companyDespachoId}`).get(),
        resolveClientAssignedCostRate({
          clienteId,
          despachoId: companyDespachoId,
          operationTypeKey: operationTypeKeyValue,
        }),
        db.doc(`users/${operationalOwnerId}`).get(),
      ]);

    if (!despachoSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Despacho de la empresa no existe."
      );
    }

    const despachoData: any = despachoSnap.data() || {};
    if (despachoData?.active === false) {
      throw new HttpsError("failed-precondition", "Despacho inactivo.");
    }

    if (resolvedClientAssignedRate <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "El cliente no tiene costo configurado para este tipo de operacion y despacho. Asigna el costo del cliente antes de crear la solicitud."
      );
    }

    if (!operationalOwnerSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "El propietario operativo del cliente no existe."
      );
    }

    __mark("despacho_rate_owner");

    const operationalOwnerData: any =
      operationalOwnerSnap.data() || {};

    if (operationalOwnerData?.active === false) {
      throw new HttpsError(
        "failed-precondition",
        "El propietario operativo del cliente está inactivo."
      );
    }

    const operationalOwnerRootId = String(
      operationalOwnerData?.rootId || rootId
    ).trim();

    if (
      operationalOwnerRootId &&
      operationalOwnerRootId !== rootId
    ) {
      throw new HttpsError(
        "permission-denied",
        "El propietario operativo del cliente está fuera de la empresa raíz."
      );
    }

    const operationalOwnerName = String(
      operationalOwnerData?.name ||
      operationalOwnerData?.displayName ||
      operationalOwnerData?.username ||
      "Usuario operativo"
    ).trim();

    const businessFolioContext =
      await resolveCanonicalBusinessFolioContext({
        db,
        rootId,
        clientId: clienteId,
        actorUid: uid,
        actorRole: role as any,
      });

    const clientNumber = businessFolioContext.clientNumber;
    const userNumber = businessFolioContext.ownerUserNumber;
    const companyNumber = Number(companyData?.companyNumber ?? companyData?.numeroEmpresa ?? companyData?.sequenceNumber ?? 0);

    if (!Number.isFinite(clientNumber) || clientNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de cliente faltante. Repara numeracion de clientes antes de crear solicitudes.");
    }

    if (!Number.isFinite(userNumber) || userNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de usuario faltante. Repara numeracion de usuarios antes de crear solicitudes.");
    }

    if (!Number.isFinite(companyNumber) || companyNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de empresa faltante. Repara numeracion de empresas antes de crear solicitudes.");
    }

    const now = FieldValue.serverTimestamp();
    const solicitudRef = db.collection("solicitudes").doc();

    let replacementSourceRef: FirebaseFirestore.DocumentReference | null = null;
    let replacementSource: any = null;
    if (replacementSourceId) {
      const sourceSnap = await db.doc(`solicitudes/${replacementSourceId}`).get();
      if (!sourceSnap.exists) throw new HttpsError("not-found", "La solicitud original a sustituir no existe.");
      replacementSource = sourceSnap.data() || {};
      if (String(replacementSource.rootId || "") !== rootId) throw new HttpsError("permission-denied", "La solicitud original esta fuera de alcance.");
      if (String(replacementSource.facturamaEnvironment || "").toUpperCase() !== "PRODUCTION" || !String(replacementSource.facturamaInvoiceId || "").trim()) {
        throw new HttpsError("failed-precondition", "Esta sustitucion automatica solo aplica a CFDI productivo emitido por Facturama.");
      }
      if (String(replacementSource.relatedSolicitudId || "").trim()) throw new HttpsError("already-exists", "La solicitud original ya tiene una sustitucion relacionada.");
      if (!String(replacementSource.facturaUuid || replacementSource.uuidCfdi || "").trim()) throw new HttpsError("failed-precondition", "La solicitud original no tiene UUID productivo para sustituir.");
      if (String(replacementSource.companyId || "") !== companyIdValue || String(replacementSource.clienteId || replacementSource.clientId || "") !== clienteId) {
        throw new HttpsError("failed-precondition", "La sustitucion debe conservar emisor y receptor de la solicitud original.");
      }
      replacementSourceRef = sourceSnap.ref;
    }

    let folio = "";
    let solicitudSequenceNumber = 0;
    let solicitudSequenceCounterPath = "";

    await db.runTransaction(async (tx) => {
      const seq = await nextSequenceTx({
        db,
        tx,
        rootId,
        scope: "solicitudes",
            scopeKey: `cliente_${clienteId}__usuario_${businessFolioContext.ownerUid}__empresa_${companyIdValue}`,
      });

      solicitudSequenceNumber = seq.sequenceNumber;
      solicitudSequenceCounterPath = seq.counterPath;
      folio = buildCanonicalFolio(
        "S",
        solicitudSequenceNumber,
        buildCanonicalBusinessFolioParts({
          clientNumber,
          ownerUserNumber: userNumber,
          companyNumber,
          delegateUserNumber: businessFolioContext.delegateUserNumber,
        }),
      );

      tx.set(solicitudRef, {
        rootId,
        adminId,
        createdBy: uid,
        ownerId: operationalOwnerId,
        operationalOwnerId,
        operationalOwnerName,
        iqOwnerId: operationalOwnerId,
        actorUid: uid,
        actorRole: role,
        accessSource: businessFolioContext.accessSource,
        delegatedClientAccessPath: businessFolioContext.delegatedClientAccessPath,
        clienteId,
        clientId: clienteId,
        companyId: companyIdValue,
        despachoId: companyDespachoId,
        operationTypeKey: operationTypeKeyValue,
        finalClientRate: resolvedClientAssignedRate,
        clienteNombre: resolvedClienteNombre || null,
        empresaNombre: resolvedEmpresaNombre || null,
        folio,
        folioVersion: 1,
        sequenceNumber: solicitudSequenceNumber,
        sequenceScope: `solicitudes:${rootId}:C${clientNumber}:U${userNumber}:E${companyNumber}`,
        sequenceCounterPath: solicitudSequenceCounterPath,
        clientNumber,
        userNumber,
        companyNumber,
        monto: montoNum,
        tipoFactura,
        status: "PROCESANDO",
        totalAbonado: 0,

        motivoRechazo: null,
        motivoRechazoDetalle: null,

        motivoCancelacionSAT: null,
        motivoCancelacionDetalle: null,

        uuidCfdi: null,
        // The original UUID is known before the replacement CFDI is issued.
        // Preserve it on both records with its fiscal meaning, never as an
        // ambiguous "UUID sustituto".
        uuidCfdiSustituido: replacementSource ? String(replacementSource.facturaUuid || replacementSource.uuidCfdi || "").trim().toUpperCase() || null : null,
        uuidCfdiSustituto: null,
        sustitucionStatus: null,
        relatedSolicitudId: null,
        replacementOfSolicitudId: replacementSourceId || null,
        replacementOfSolicitudFolio: replacementSource?.folio || null,
        replacementOfUuid: replacementSource ? String(replacementSource.facturaUuid || replacementSource.uuidCfdi || "").trim().toUpperCase() : null,
        originalFacturaFecha: replacementSource?.facturaFecha || null,
        originalFacturaFolio: replacementSource?.facturaDisplay || replacementSource?.facturaFolio || replacementSource?.numFactura || null,
        cfdiRelationType: replacementSourceId ? "04" : null,
        replacementReason: replacementSourceId ? String(replacementReason || "").trim().slice(0, 500) || null : null,
        replacementRequiresOc: !!replacementSourceId,
        replacementOcStatus: replacementSourceId ? "PENDING_UPLOAD" : null,

        isDeleted: false,
        deletedBy: null,
        deletedAt: null,

        createdAt: now,
        updatedAt: now,
      });
      if (replacementSourceRef) {
        tx.set(replacementSourceRef, {
          status: "EN_SUSTITUCION",
          motivoCancelacionSAT: "01",
          motivoCancelacionDetalle: String(replacementReason || "").trim().slice(0, 500) || null,
          relatedSolicitudId: solicitudRef.id,
          relatedSolicitudFolio: folio,
          sustitucionStatus: "ESPERANDO_NUEVO_CFDI",
          updatedAt: now,
        }, { merge: true });
      }
    });

    __mark("folio_transaction");

    const comentarioText = String(comentario || "").trim();

    const postCreateTasks: Promise<unknown>[] = [
      logActivity({
        event: "SOLICITUD_CREADA",
        rootId,
        adminId,
        actorUid: uid,
        actorName:
          String((caller as any)?.username || "") ||
          String((caller as any)?.displayName || "") ||
          String((caller as any)?.name || ""),
        actorUsername: String((caller as any)?.username || ""),
        actorRole: role,
        referenceId: solicitudRef.id,
        referenceFolio: folio,
        referenceType: "solicitud",
        relatedEntityId: "",
        relatedEntityType: "",
        amount: montoNum,
        description: `Nueva solicitud ${folio} por ${montoNum}`,
      }),
    ];

    if (comentarioText) {
      postCreateTasks.push(
        solicitudRef.collection("notas").add({
          rootId,
          adminId,
          createdBy: uid,
          text: comentarioText,
          createdAt: now,
        }),
        solicitudRef.update({
          hasUnreadMsg: true,
          updatedAt: now,
        })
      );
    }

    postCreateTasks.push(
      linkSolicitudToMaterialityOperationCore({
        auth: request.auth,
        data: { solicitudId: solicitudRef.id },
      }).catch((error) =>
        solicitudRef.set(
          {
            materialitySyncStatus: "ERROR",
            materialitySyncLastError: String(error?.message || error || "No se pudo crear el expediente de Materialidad."),
            materialitySyncUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      ),
    );

    postCreateTasks.push(
      ensureAutomaticFacturamaDraftForSolicitud({
        auth: request.auth,
        solicitudId: solicitudRef.id,
        source: "SOLICITUD_CREATE",
      }).catch((error) =>
        solicitudRef.set(
          {
            facturamaAutoDraftStatus: "ERROR",
            facturamaAutoDraftLastError: String(error?.message || error || "No se pudo preparar el borrador CFDI automatico."),
            facturamaSyncUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      ),
    );

    await Promise.all(postCreateTasks);
    await recordOperationalMetric({
      rootId,
      stage: "RECEIVED",
      channel: "PAY0",
      caseType: "SOLICITUD",
      correlationId: solicitudRef.id,
      adminId,
      clientId: clienteId,
      actorUid: uid,
      source: "HUMAN",
      outcome: "CREATED",
    }).catch(() => undefined);
    __mark("post_create");

    const __perfTotalMs = Date.now() - __perfStartedAt;
    console.log("[PAY0_PERF_CREATE_SOLICITUD]", JSON.stringify({
      folio,
      solicitudId: solicitudRef.id,
      totalMs: __perfTotalMs,
      stages: __perf,
    }));

    return {
      ok: true,
      solicitudId: solicitudRef.id,
      folio,
      _perf: {
        totalMs: __perfTotalMs,
        stages: __perf,
      },
    };
  }
);
export const cancelSolicitud = onCall(
  { cors: true, secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const nextRequest = {
      ...request,
      data: {
        ...(request.data || {}),
        newStatus: "CANCELADA",
      },
    };

    return await changeSolicitudStatusHandler(nextRequest);
  }
);

export const changeSolicitudStatus = onCall(
  { cors: true, secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    return await changeSolicitudStatusHandler(request);
  }
);

// H4_D67_A9_GENERIC_UPLOAD_DISABLED
export const initUpload = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async () => {
    throw new HttpsError(
      "permission-denied",
      "Carga generica deshabilitada. Usa el flujo de documentos de la entidad."
    );
  }
);

export const finalizeUpload = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async () => {
    throw new HttpsError(
      "permission-denied",
      "Finalizacion generica deshabilitada. Usa el flujo de documentos de la entidad."
    );
  }
);

/**
 * =========================
 * FASE 2: Usuarios y Roles
 * =========================
 */

async function getMyUser(uid: string) {
  const a = await db.doc(`users/${uid}`).get();
  if (a.exists) return (a.data() as any);

  const b = await db.doc(`usuarios/${uid}`).get();
  if (b.exists) return (b.data() as any);

  return null;
}
function getActivityAdminId(user: any, uid: string, rootId: string) {
  const role = getUserRole(user);
  let adminId = uid;

  if (role === "admin") {
    adminId = uid;
  } else if (["operador", "operator"].includes(role)) {
    if (String(user?.parentRole || "") === "admin") {
      adminId = String(user?.parentUserId || "");
    } else {
      adminId = rootId;
    }
  } else {
    adminId = uid;
  }

  return String(adminId || rootId || uid);
}

function requireRole(user: any, roles: Array<"superadmin" | "admin" | "operador">) {
  const r = getUserRole(user);
  if (!roles.includes(r as any)) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }
  return r;
}

/**
 * bootstrapSuperAdmin
 * Promueve AL USUARIO LOGUEADO a superadmin, validando que su email coincida.
 * Uso: logueado como tu cuenta -> llamar con { email: "tu@email.com" }
 */

async function seedUserAccessByDespacho(params: {
  uid: string;
  despachoId?: string | null;
  createdBy: string;
}) {
  const uid = String(params.uid || "");
  const despachoId = params.despachoId ? String(params.despachoId) : "";
  const createdBy = String(params.createdBy || "");

  if (!uid || !despachoId) return;

  const now = FieldValue.serverTimestamp();

  await db.doc(`userDespachoAccess/${uid}/despachos/${despachoId}`).set(
    {
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy,
    },
    { merge: true }
  );

  const dispatchSnap = await db
    .collection(`dispatchCompanyAccess/${despachoId}/companies`)
    .where("active", "==", true)
    .get();

  const batch = db.batch();

  dispatchSnap.docs.forEach((d) => {
    batch.set(
      db.doc(`userCompanyAccess/${uid}/companies/${d.id}`),
      {
        active: true,
        despachoId,
        createdAt: now,
        updatedAt: now,
        createdBy,
      },
      { merge: true }
    );
  });

  await batch.commit();
}

/**
 * createAdmin_v2 (solo superadmin)
 */
export const createAdmin = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "usuarios", requiredAction: "create" });
    requireRole(caller, ["superadmin"]);

    const email = (request.data?.email || "").toString().trim().toLowerCase();
    const password = (request.data?.password || "").toString();
    const displayName = request.data?.displayName ? String(request.data.displayName) : null;
    const despachoId = String(request.data?.despachoId || "").trim() || null;

    if (!email || password.length < 6) {
      throw new HttpsError("invalid-argument", "email requerido y password minimo 6 caracteres.");
    }

    let u: admin.auth.UserRecord;
    try {
      u = await admin.auth().createUser({
        email,
        password,
        displayName: displayName || undefined,
        disabled: false,
      });
    } catch (err: any) {
      const code = err?.errorInfo?.code || err?.code || "";
      if (code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "El email ya esta en uso.");
      }
      throw err;
    }

    const now = FieldValue.serverTimestamp();
    const rootId = String(caller?.rootId || callerUid);
    const userRef = db.doc(`users/${u.uid}`);
    let userNumber = 0;
    let userSequenceCounterPath = "";

    await db.runTransaction(async (tx) => {
      const seq = await nextSequenceTx({
        db,
        tx,
        rootId,
        scope: "users",
        scopeKey: "global",
      });

      userNumber = seq.sequenceNumber;
      userSequenceCounterPath = seq.counterPath;

      tx.set(
        userRef,
        {
          email,
          displayName: displayName || null,
          role: "admin",
          modules: getDefaultModules("admin"),        rootId,
          parentUserId: callerUid,
          parentRole: "superadmin",
          despachoId,
          isActive: true,
          isDeleted: false,
          userNumber,
          numeroUsuario: userNumber,
          sequenceNumber: userNumber,
          sequenceScope: `users:${rootId}`,
          sequenceCounterPath: userSequenceCounterPath,
          updatedAt: now,
          createdAt: now,
          createdBy: callerUid,
        },
        { merge: true }
      );
    });

    if (despachoId) {
      await seedUserAccessByDespacho({
        uid: u.uid,
        despachoId,
        createdBy: callerUid,
      });
    }

    return {
      ok: true,
      uid: u.uid,
      userNumber,
      userFolio: `U${String(userNumber).padStart(2, "0")}`,
      role: "admin",
      rootId,
      parentUserId: callerUid,
      parentRole: "superadmin",
      despachoId,
    };
  }
);

/**
 * createOperador_v2 (admin o superadmin)
 */
export const createOperador = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "create" });
    const callerRole = requireRole(caller, ["admin", "superadmin"]);

    const email = (request.data?.email || "").toString().trim().toLowerCase();
    const password = (request.data?.password || "").toString();
    const displayName = request.data?.displayName ? String(request.data.displayName) : null;

    if (!email || password.length < 6) {
      throw new HttpsError("invalid-argument", "email requerido y password minimo 6 caracteres");
    }

    let rootId = "";
    let parentUserId = "";
    let parentRole: "admin" | "superadmin" = "admin";
    let despachoId: string | null = null;

    if (callerRole === "admin") {
      rootId = String(caller?.rootId || callerUid);
      parentUserId = callerUid;
      parentRole = "admin";
      despachoId = String(caller?.despachoId || "").trim() || null;
    } else {
      const requestedParentUserId = String(request.data?.parentUserId || "").trim();
      const requestedParentRole = String(request.data?.parentRole || "").trim().toLowerCase();

      if (!requestedParentUserId) {
        throw new HttpsError("invalid-argument", "parentUserId requerido para superadmin.");
      }

      if (requestedParentRole !== "admin" && requestedParentRole !== "superadmin") {
        throw new HttpsError("invalid-argument", "parentRole debe ser admin o superadmin.");
      }

      const parentSnap = await db.doc(`users/${requestedParentUserId}`).get();
      if (!parentSnap.exists) {
        throw new HttpsError("not-found", "El usuario padre no existe.");
      }

      const parentData: any = parentSnap.data() || {};
      const parentDataRole = normalizeRole(parentData?.role ?? parentData?.supervisorRole);
      const callerRootId = String(caller?.rootId || callerUid);
      const parentRootId = String(parentData?.rootId || requestedParentUserId);

      if (parentDataRole !== requestedParentRole) {
        throw new HttpsError("failed-precondition", "El parentRole no coincide con el usuario padre.");
      }

      if (parentRootId !== callerRootId) {
        throw new HttpsError("permission-denied", "No puedes crear operadores fuera de tu root.");
      }

      rootId = parentRootId;
      parentUserId = requestedParentUserId;
      parentRole = requestedParentRole as "admin" | "superadmin";

      if (parentRole === "admin") {
        despachoId = String(parentData?.despachoId || "").trim() || null;
      } else {
        despachoId = request.data?.despachoId ? String(request.data.despachoId) : null;
      }
    }

    let u: admin.auth.UserRecord;
    try {
      u = await admin.auth().createUser({
        email,
        password,
        displayName: displayName || undefined,
        disabled: false,
      });
    } catch (err: any) {
      const code = err?.errorInfo?.code || err?.code || "";
      if (code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "El email ya esta en uso.");
      }
      throw err;
    }

    const now = FieldValue.serverTimestamp();
    const userRef = db.doc(`users/${u.uid}`);
    let userNumber = 0;
    let userSequenceCounterPath = "";

    await db.runTransaction(async (tx) => {
      const seq = await nextSequenceTx({
        db,
        tx,
        rootId,
        scope: "users",
        scopeKey: "global",
      });

      userNumber = seq.sequenceNumber;
      userSequenceCounterPath = seq.counterPath;

      tx.set(
        userRef,
        {
          email,
          displayName: displayName || null,
          role: "operador",
          rootId,
          parentUserId,
          parentRole,
          despachoId,
          isActive: true,
          isDeleted: false,
          modules: getDefaultModules("operador"),
          userNumber,
          numeroUsuario: userNumber,
          sequenceNumber: userNumber,
          sequenceScope: `users:${rootId}`,
          sequenceCounterPath: userSequenceCounterPath,
          updatedAt: now,
          createdAt: now,
          createdBy: callerUid,
        },
        { merge: true }
      );
    });

    if (despachoId) {
      await seedUserAccessByDespacho({
        uid: u.uid,
        despachoId,
        createdBy: callerUid,
      });
    }

    return {
      ok: true,
      uid: u.uid,
      userNumber,
      userFolio: `U${String(userNumber).padStart(2, "0")}`,
      role: "operador",
      rootId,
      parentUserId,
      parentRole,
      despachoId,
    };
  }
);

async function resolveSolicitudRelacion(rootId: string, rawValue: any, currentSolicitudId: string) {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  const directRef = db.doc(`solicitudes/${value}`);
  const directSnap = await directRef.get();

  if (directSnap.exists) {
    const directData = directSnap.data() || {};
    if (directData.rootId !== rootId) {
      throw new HttpsError("permission-denied", "La solicitud relacionada no pertenece a tu empresa raiz.");
    }
    if (directSnap.id === currentSolicitudId) {
      throw new HttpsError("invalid-argument", "La solicitud no puede relacionarse consigo misma.");
    }
    return {
      id: directSnap.id,
      folio: directData.folio ? String(directData.folio) : null,
    };
  }

  const folioSnap = await db
    .collection("solicitudes")
    .where("rootId", "==", rootId)
    .where("folio", "==", value)
    .limit(1)
    .get();

  if (!folioSnap.empty) {
    const doc = folioSnap.docs[0];
    const docData = doc.data() || {};
    if (doc.id === currentSolicitudId) {
      throw new HttpsError("invalid-argument", "La solicitud no puede relacionarse consigo misma.");
    }
    return {
      id: doc.id,
      folio: docData.folio ? String(docData.folio) : value,
    };
  }

  throw new HttpsError("not-found", "Solicitud relacionada no encontrada. Captura ID o folio real.");
}

const changeSolicitudStatusHandler = async (request: any) => {
  const uid = requireAuth(request);
  const rootId = await getRootId(uid);
  const me = await getMyUser(uid);
  assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "cancel" });

  const actorRole = String(me?.role || "unknown");
  const actorId = String(me?.name || me?.displayName || me?.email || uid);
  const adminId = getActivityAdminId(me, uid, rootId);

  const {
    solicitudId,
    newStatus,
    ocultar,
    hasUnreadMsg,
    motivo,
    motivoRechazo,
    motivoRechazoDetalle,
    motivoCancelacionSAT,
    motivoCancelacionDetalle,
    relatedSolicitudId,
    uuidCfdiSustituido,
    uuidCfdiSustituto,
  } = request.data || {};

  if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");

  const ref = db.doc(`solicitudes/${solicitudId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Solicitud no existe.");

  const data = snap.data()!;
  const solicitudActivityRef =
    String(data.folio || data.solicitudFolio || data.folioSolicitud || solicitudId).trim() || solicitudId;

  if (data.rootId !== rootId) throw new HttpsError("permission-denied", "No autorizado.");

    const actorRoleNorm = String(actorRole || "").trim().toLowerCase();
  const solicitudAdminId = String(data.adminId || "").trim();
  const solicitudCreatedBy = String(data.createdBy || "").trim();

  const canManageSolicitud =
    actorRoleNorm === "superadmin" ||
    solicitudAdminId === uid ||
    solicitudAdminId === rootId ||
    solicitudCreatedBy === uid;

  if (!canManageSolicitud) {
    throw new HttpsError("permission-denied", "No autorizado para modificar esta solicitud.");
  }

  const totalAbonadoActual = toSafeMoneyNumber(data.totalAbonado);

  const patch: any = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  let event = "";
  let description = "";
  let responseMeta: Record<string, unknown> = {};

  if (typeof ocultar === "boolean") patch.oculto = ocultar;
  if (typeof hasUnreadMsg === "boolean") patch.hasUnreadMsg = hasUnreadMsg;

  if (newStatus) {
    const currentStatus = normalizeStatus(data.status || "PROCESANDO");
    const ns = normalizeStatus(newStatus);
    const satCode = normalizeSatCancelCode(motivoCancelacionSAT);
    const relatedSolicitud = await resolveSolicitudRelacion(rootId, relatedSolicitudId, solicitudId);
    if (relatedSolicitud) {
      const relatedSnap = await db.doc(`solicitudes/${relatedSolicitud.id}`).get();

      if (!relatedSnap.exists) {
        throw new HttpsError("not-found", "La solicitud relacionada ya no existe.");
      }

      const relatedData = relatedSnap.data() || {};
      if (relatedData.rootId !== rootId) {
        throw new HttpsError("permission-denied", "La solicitud relacionada no pertenece a tu root.");
      }

      const currentClientId = String(data.clientId || data.clienteId || "").trim();
      const relatedClientId = String(relatedData.clientId || relatedData.clienteId || "").trim();
      const currentClientName = String(data.clienteNombre || data.clientName || "").trim().toLowerCase();
      const relatedClientName = String(relatedData.clienteNombre || relatedData.clientName || "").trim().toLowerCase();

      if (currentClientId && relatedClientId) {
        if (currentClientId !== relatedClientId) {
          throw new HttpsError("failed-precondition", "La solicitud relacionada debe ser del mismo cliente.");
        }
      } else if (currentClientName && relatedClientName) {
        if (currentClientName !== relatedClientName) {
          throw new HttpsError("failed-precondition", "La solicitud relacionada debe ser del mismo cliente.");
        }
      } else {
        throw new HttpsError("failed-precondition", "No se pudo validar el cliente de la solicitud relacionada.");
      }

      const currentCompanyId = String(data.companyId || "").trim();
      const relatedCompanyId = String(relatedData.companyId || "").trim();
      const currentCompanyName = String(data.empresaNombre || data.companyName || "").trim().toLowerCase();
      const relatedCompanyName = String(relatedData.empresaNombre || relatedData.companyName || "").trim().toLowerCase();

      if (currentCompanyId && relatedCompanyId) {
        if (currentCompanyId !== relatedCompanyId) {
          throw new HttpsError("failed-precondition", "La solicitud relacionada debe ser de la misma empresa.");
        }
      } else if (currentCompanyName && relatedCompanyName) {
        if (currentCompanyName !== relatedCompanyName) {
          throw new HttpsError("failed-precondition", "La solicitud relacionada debe ser de la misma empresa.");
        }
      } else {
        throw new HttpsError("failed-precondition", "No se pudo validar la empresa de la solicitud relacionada.");
      }
    }
    if (motivoCancelacionSAT && !satCode) {
      throw new HttpsError("invalid-argument", "motivoCancelacionSAT invalido.");
    }

    if (!canTransitionSolicitudStatus(currentStatus, ns)) {
      throw new HttpsError("failed-precondition", `Transicion no permitida de ${currentStatus} a ${ns}.`);
    }

    if (currentStatus !== ns) {
      patch.status = ns;

      if (ns === "RECHAZADA") {
        if (!canRejectSolicitudBackendStatus(currentStatus)) {
          throw new HttpsError("failed-precondition", `No se puede rechazar una solicitud en estado ${currentStatus}.`);
        }

        const aplicacionesSnap = await db
          .collection("pagoAplicaciones")
          .where("rootId", "==", rootId)
          .where("solicitudId", "==", solicitudId)
          .limit(1)
          .get();

        if (totalAbonadoActual > 0 || !aplicacionesSnap.empty) {
          throw new HttpsError("failed-precondition", "No se puede rechazar una solicitud que ya tiene pagos o abonos aplicados.");
        }
        patch.motivoRechazo = String(motivoRechazo || motivo || "").trim() || null;
        patch.motivoRechazoDetalle = motivoRechazoDetalle ? String(motivoRechazoDetalle) : null;
        const rechazoMeta = getSolicitudRechazadaEventMeta(solicitudActivityRef, patch.motivoRechazo);
        event = rechazoMeta.event;
        description = rechazoMeta.description;
      } else if (ns === "CANCELADA") {
        if (!canCancelSolicitudBackendStatus(currentStatus) && currentStatus !== "EN_SUSTITUCION") {
          throw new HttpsError("failed-precondition", `No se puede cancelar una solicitud en estado ${currentStatus}.`);
        }

        if (!canCancelSolicitudWithAbonos(totalAbonadoActual, satCode)) {
          throw new HttpsError("failed-precondition", "La solicitud con abonos solo puede cancelarse por sustitucion (SAT 01).");
        }

        if (needsUuidOrRelatedForSatCancel01(satCode, uuidCfdiSustituto, relatedSolicitud)) {
          throw new HttpsError("invalid-argument", "Para motivo SAT 01 captura UUID sustituto o solicitud relacionada.");
        }

        const activeIqFolio = String(data.iqFolio ?? data.iqId ?? "").trim();
        const existingCancellationStatus = String(data.iqCancellationStatus ?? "").trim().toUpperCase();
        const existingCancellationFolio = String(data.iqCancellationFolio ?? "").trim();

        const cancellationAlreadyPending =
          Boolean(activeIqFolio) &&
          existingCancellationFolio === activeIqFolio &&
          (existingCancellationStatus === "REQUESTED" ||
            existingCancellationStatus === "OUTCOME_UNKNOWN");

        if (cancellationAlreadyPending) {
          delete patch.status;

          responseMeta = {
            status: currentStatus,
            cancellationChannel: "IQ",
            cancellationStatus: existingCancellationStatus,
            iqFolio: activeIqFolio,
            alreadyRequested: true,
          };
        } else {
          const iqCancellation = await requestSolicitudIqCancellationCore({
            solicitud: data,
            rootId,
          });

          if (!iqCancellation.appliesToIq) {
            throw new HttpsError(
              "failed-precondition",
              "La cancelacion externa para este despacho aun no esta configurada en PAY0."
            );
          }

          if (!iqCancellation.http.ok && iqCancellation.http.outcome === "HTTP_REJECTED") {
            const errorCode =
              iqCancellation.http.status >= 500
                ? "unavailable"
                : "failed-precondition";

            throw new HttpsError(
              errorCode,
              iqCancellation.http.message ||
                `IQ rechazo la solicitud de cancelacion con HTTP ${iqCancellation.http.status}.`
            );
          }

          delete patch.status;

          patch.iqCancellationFolio = iqCancellation.iqFolio;
          patch.iqCancellationRequestedBy = uid;
          patch.iqCancellationLastAttemptAt = FieldValue.serverTimestamp();
          patch.iqCancellationHttpStatus = iqCancellation.http.status;
          patch.iqCancellationMessage = iqCancellation.http.message || null;
          patch.cancelReason = String(motivo || "").trim() || null;
          patch.motivoCancelacionSAT = satCode || null;
          patch.motivoCancelacionDetalle = motivoCancelacionDetalle
            ? String(motivoCancelacionDetalle)
            : null;

          if (uuidCfdiSustituto) {
            patch.uuidCfdiSustituto = String(uuidCfdiSustituto).trim();
          }

          if (relatedSolicitud) {
            patch.relatedSolicitudId = String(relatedSolicitud.id || "").trim() || null;
            patch.relatedSolicitudFolio = String(relatedSolicitud.folio || "").trim() || null;
          }

          if (iqCancellation.http.ok) {
            patch.iqCancellationStatus = "REQUESTED";
            patch.iqCancellationRequestedAt = FieldValue.serverTimestamp();

            event = "SOLICITUD_CANCELACION_IQ_SOLICITADA";
            description = `Cancelacion solicitada a IQ para ${solicitudActivityRef}. FOLIO IQ: ${iqCancellation.iqFolio}. Pendiente de confirmacion.`;

            responseMeta = {
              status: currentStatus,
              cancellationChannel: "IQ",
              cancellationStatus: "REQUESTED",
              iqFolio: iqCancellation.iqFolio,
            };
          } else {
            patch.iqCancellationStatus = "OUTCOME_UNKNOWN";

            event = "SOLICITUD_CANCELACION_IQ_RESULTADO_INCIERTO";
            description = `No se pudo confirmar el resultado de la solicitud de cancelacion IQ para ${solicitudActivityRef}. FOLIO IQ: ${iqCancellation.iqFolio}.`;

            responseMeta = {
              status: currentStatus,
              cancellationChannel: "IQ",
              cancellationStatus: "OUTCOME_UNKNOWN",
              iqFolio: iqCancellation.iqFolio,
            };
          }
        }
      } else if (ns === "EN_SUSTITUCION") {
        if (needsUuidOrRelatedForEnSustitucion(uuidCfdiSustituto, relatedSolicitud)) {
          throw new HttpsError("invalid-argument", "Para sustitucion captura UUID sustituto o solicitud relacionada.");
        }

        Object.assign(
          patch,
          buildSolicitudEnSustitucionPatch({
            satCode,
            uuidCfdiSustituido,
            uuidCfdiSustituto,
            relatedSolicitud,
            serverTimestamp: FieldValue.serverTimestamp(),
          })
        );
        const sustitucionMeta = getSolicitudEnSustitucionEventMeta(solicitudActivityRef);
        event = sustitucionMeta.event;
        description = sustitucionMeta.description;
      } else {
        if (ns === "ELIMINADA") {
          patch.isDeleted = true;
          patch.deletedBy = uid;
          patch.deletedAt = FieldValue.serverTimestamp();
        }

        const statusMeta = getSolicitudStatusEventMeta(currentStatus, ns, solicitudActivityRef);
        event = statusMeta.event;
        description = statusMeta.description;
      }
    }

    if (currentStatus === ns && ns === "EN_SUSTITUCION") {
      let enriched = false;

      const incomingUuidCfdiSustituto = String(uuidCfdiSustituto || "").trim();
      const currentUuidCfdiSustituto = String(data.uuidCfdiSustituto || "").trim();

      if (incomingUuidCfdiSustituto) {
        if (currentUuidCfdiSustituto && currentUuidCfdiSustituto !== incomingUuidCfdiSustituto) {
          throw new HttpsError("failed-precondition", "El UUID sustituto ya existe y no puede modificarse.");
        }

        if (!currentUuidCfdiSustituto) {
          patch.uuidCfdiSustituto = incomingUuidCfdiSustituto;
          enriched = true;
        }
      }

      if (relatedSolicitud) {
        const currentRelatedId = String(data.relatedSolicitudId || "").trim();
        const currentRelatedFolio = String(data.relatedSolicitudFolio || "").trim();
        const nextRelatedId = String(relatedSolicitud.id || "").trim();
        const nextRelatedFolio = String(relatedSolicitud.folio || "").trim();

        if (currentRelatedId && currentRelatedId !== nextRelatedId) {
          throw new HttpsError("failed-precondition", "La solicitud relacionada ya existe y no puede modificarse.");
        }

        if (currentRelatedFolio && nextRelatedFolio && currentRelatedFolio !== nextRelatedFolio) {
          throw new HttpsError("failed-precondition", "El folio relacionado ya existe y no puede modificarse.");
        }

        if (!currentRelatedId && nextRelatedId) {
          patch.relatedSolicitudId = nextRelatedId;
          enriched = true;
        }

        if (!currentRelatedFolio && nextRelatedFolio) {
          patch.relatedSolicitudFolio = nextRelatedFolio;
          enriched = true;
        }
      }

      if (!enriched) {
        throw new HttpsError("invalid-argument", "No hay informacion nueva para agregar a la sustitucion.");
      }

      patch.updatedAt = FieldValue.serverTimestamp();
      patch.updatedBy = uid;
      patch.motivoCancelacionSAT = normalizeSatCancelCode(data.motivoCancelacionSAT) || satCode || "01";
      patch.sustitucionStatus = String(data.sustitucionStatus || "EN_PROCESO");

      event = "SOLICITUD_SUSTITUCION_ACTUALIZADA";
      description = `Solicitud en sustitucion actualizada ${solicitudActivityRef}`;
 }
  }

  await ref.update(patch);

  if (event) {
    await logActivity({
      event,
      rootId,
      adminId,
      actorUid: uid,
      actorName: actorId,
      actorUsername: String((me as any)?.username || ""),
      actorRole,
      referenceId: solicitudId,
      referenceType: "solicitud",
      relatedEntityId: "",
      relatedEntityType: "",
      amount: null,
      description,
    });
  }

  const resolvedStatus = String(patch.status || "").trim();
  if (["COMPLETADA", "RECHAZADA", "CANCELADA"].includes(resolvedStatus)) {
    await recordOperationalMetric({
      rootId,
      stage: "RESOLVED",
      channel: "PAY0",
      caseType: "SOLICITUD",
      correlationId: String(solicitudId),
      adminId,
      clientId: String(data.clienteId || data.clientId || ""),
      actorUid: uid,
      source: "HUMAN",
      outcome: resolvedStatus,
    }).catch(() => undefined);
  }

  return { ok: true, ...responseMeta };
}

export const applyAbono = onCall(async (_request) => {
  throw new HttpsError(
    "failed-precondition",
    "Abono directo deshabilitado. Usa pagos registrados y conciliados desde el modulo Pagos."
  );
});
export { updateUserModules } from "./modules/users/modules";

export { updateUserActive } from "./modules/users/active";
export { listUsers } from "./modules/users/list";
export { saveClientCallable, toggleClientActiveCallable, repairClientNumbersByAdminCallable, listClientsCanonical, getClientCanonical } from "./modules/clients/callables";

export { softDeleteUser, restoreUser, setUserCompanyAccess } from "./modules/users/access";
export { getUserClientAccessConfig, setUserClientAccess } from "./modules/clientDelegations/callables";



function toSafeMoneyNumber(value: any) {
  const cleaned = String(value ?? 0).replace(/[$,\s]/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

type PagoFinancialCostSnapshot = {
  sourcePath: string;
  active: boolean;
  rate: number;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode: "PERCENT" | "FIXED";
  operationTypeName: string;
};

type PagoFinancialAssignmentSnapshot = {
  version: "H4_D65_A2_V1";
  capturedAt: admin.firestore.Timestamp;
  despachoId: string;
  adminId: string | null;
  operadorId: string | null;
  operationTypeKey: string;
  operationTypeName: string;
  operationFlags: {
    generatesClientBalance: boolean;
    generatesUserEarnings: boolean;
    allowsDispersion: boolean;
  };
  clientCost: PagoFinancialCostSnapshot;
  despachoCost: PagoFinancialCostSnapshot;
  adminCost: PagoFinancialCostSnapshot | null;
  operadorCost: PagoFinancialCostSnapshot | null;
};

function normalizePagoFinancialBaseType(value: any): "TOTAL" | "SUBTOTAL" {
  return String(value || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
    ? "SUBTOTAL"
    : "TOTAL";
}

function normalizePagoFinancialPricingMode(value: any): "PERCENT" | "FIXED" {
  return String(value || "PERCENT").trim().toUpperCase() === "FIXED"
    ? "FIXED"
    : "PERCENT";
}

function pagoFinancialAmountFromCost(
  grossAmount: number,
  cost: PagoFinancialCostSnapshot,
) {
  const gross = Math.round((Number(grossAmount) + Number.EPSILON) * 100) / 100;
  const rate = Math.round((Number(cost.rate) + Number.EPSILON) * 100) / 100;
  if (cost.pricingMode === "FIXED") return rate;
  const base = cost.calculationBaseType === "SUBTOTAL"
    ? Math.round(((gross / 1.16) + Number.EPSILON) * 100) / 100
    : gross;
  return Math.round(((base * (rate / 100)) + Number.EPSILON) * 100) / 100;
}

async function resolvePagoFinancialCostSnapshot(params: {
  candidatePaths: string[];
  rateKeys: string[];
  operationTypeName: string;
}): Promise<PagoFinancialCostSnapshot | null> {
  for (const docPath of params.candidatePaths) {
    const snap = await db.doc(docPath).get();
    if (!snap.exists) continue;

    const data: any = snap.data() || {};
    let rate = 0;
    for (const key of params.rateKeys) {
      const value = toSafeMoneyNumber(data[key]);
      if (value > 0) {
        rate = Math.round((value + Number.EPSILON) * 100) / 100;
        break;
      }
    }

    return {
      sourcePath: docPath,
      active: data.active !== false,
      rate,
      calculationBaseType: normalizePagoFinancialBaseType(data.calculationBaseType),
      pricingMode: normalizePagoFinancialPricingMode(data.pricingMode),
      operationTypeName: String(data.operationTypeName || params.operationTypeName || "").trim(),
    };
  }

  return null;
}

function assertPagoFinancialCostUsable(
  cost: PagoFinancialCostSnapshot | null,
  label: string,
  required: boolean,
) {
  if (!cost) {
    if (required) {
      throw new HttpsError("failed-precondition", `No existe costo ${label} para la fotografia financiera.`);
    }
    return;
  }

  if (cost.active === false) {
    throw new HttpsError("failed-precondition", `El costo ${label} esta inactivo.`);
  }

  if (!(cost.rate > 0)) {
    throw new HttpsError("failed-precondition", `El costo ${label} no tiene monto o porcentaje valido.`);
  }
}

function assertPagoFinancialRateHierarchy(params: {
  grossAmount: number;
  clientCost: PagoFinancialCostSnapshot;
  despachoCost: PagoFinancialCostSnapshot;
  adminCost: PagoFinancialCostSnapshot | null;
  operadorCost: PagoFinancialCostSnapshot | null;
}) {
  const levels: Array<{ label: string; amount: number }> = [
    {
      label: "despacho",
      amount: pagoFinancialAmountFromCost(params.grossAmount, params.despachoCost),
    },
  ];

  if (params.adminCost) {
    levels.push({
      label: "admin",
      amount: pagoFinancialAmountFromCost(params.grossAmount, params.adminCost),
    });
  }

  if (params.operadorCost) {
    levels.push({
      label: "operador",
      amount: pagoFinancialAmountFromCost(params.grossAmount, params.operadorCost),
    });
  }

  levels.push({
    label: "cliente",
    amount: pagoFinancialAmountFromCost(params.grossAmount, params.clientCost),
  });

  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1];
    const current = levels[index];
    if (previous.amount > current.amount) {
      throw new HttpsError(
        "failed-precondition",
        `Jerarquia financiera invalida: ${previous.label} ${previous.amount} excede ${current.label} ${current.amount}.`,
      );
    }
  }
}

async function resolveClientAssignedCostRate(params: {
  clienteId: string;
  despachoId: string;
  operationTypeKey: string;
}) {
  const clienteId = String(params.clienteId || "").trim();
  const despachoId = String(params.despachoId || "").trim();
  const operationTypeKey = String(params.operationTypeKey || "").trim().toUpperCase();
  if (!clienteId || !despachoId || !operationTypeKey) return 0;

  const cost = await resolvePagoFinancialCostSnapshot({
    candidatePaths: [
      `clients/${clienteId}/costos/${despachoId}__${operationTypeKey}`,
      `clients/${clienteId}/costos/${operationTypeKey}`,
    ],
    rateKeys: ["assignedCost", "baseCost"],
    operationTypeName: operationTypeKey,
  });

  if (!cost || cost.active === false || !(cost.rate > 0)) return 0;
  return cost.rate;
}

export const createPago = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const __perfStartedAt = Date.now();
    const __perf: Record<string, number> = {};
    let __perfMarkAt = __perfStartedAt;

    const __mark = (name: string) => {
      const nowMs = Date.now();
      __perf[name] = nowMs - __perfMarkAt;
      __perfMarkAt = nowMs;
    };

    const uid = requireAuth(request);
    const meSnap = await db.doc(`users/${uid}`).get();

    if (!meSnap.exists) {
      throw new HttpsError("not-found", "Usuario no encontrado.");
    }

    const me: any = meSnap.data() || {};
    const rootId = String(me.rootId || uid);

    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "create" });

    const role = String(me?.role || "").trim().toLowerCase();
    if (!["superadmin", "admin", "operador", "operator"].includes(role)) {
      throw new HttpsError("permission-denied", "No autorizado para registrar pagos.");
    }
    __mark("auth_user_root");

    const {
      clienteId,
      companyId,
      empresaNombre,
      montoTotal,
      fechaPago,
      paymentTime,
      paymentForm,
      referencia,
      moneda,
      notaInicial,
      detectedBankName,
      detectedSenderName,
      detectedBeneficiaryName,
      detectedSourceAccount,
      detectedDestinationAccount,
      detectedPayerRfc,
      detectedBeneficiaryRfc,
      operatorSelectedBankName,
      operatorSelectedAccount,
      despachoId,
      asociadoId,
      operationTypeKey,
    } = request.data || {};

    const montoTotalNum = toSafeMoneyNumber(montoTotal);

    const costGuardOperationTypeKey = String(operationTypeKey || "").trim().toUpperCase();
    const costGuardDespachoId = String(despachoId || "").trim();

    if (!costGuardOperationTypeKey) {
      throw new HttpsError(
        "failed-precondition",
        "No se puede crear el pago sin tipo de operacion. Asigna tipo de operacion y costo del cliente."
      );
    }

    if (!costGuardDespachoId) {
      throw new HttpsError(
        "failed-precondition",
        "No se puede crear el pago sin despacho. Asigna despacho y costo del cliente."
      );
    }

    const operationTypeKeyValue = String(operationTypeKey || "").trim().toUpperCase();

    if (!clienteId) throw new HttpsError("invalid-argument", "clienteId requerido.");
    if (!companyId) throw new HttpsError("invalid-argument", "companyId requerido.");
    if (!Number.isFinite(montoTotalNum) || montoTotalNum <= 0) {
      throw new HttpsError("invalid-argument", "montoTotal invalido.");
    }

    if (!operationTypeKeyValue) {
      throw new HttpsError("invalid-argument", "operationTypeKey requerido.");
    }

    const [operationTypeSnap, clientSnap, companySnap, delegatedClientAccess, directCompanyAccessSnap] = await Promise.all([
      db.doc(`operationTypes/${operationTypeKeyValue}`).get(),
      db.doc(`clients/${clienteId}`).get(),
      db.doc(`companies/${companyId}`).get(),
      role === "superadmin"
        ? Promise.resolve(null)
        : getActiveClientDelegationAccess(
            uid,
            String(clienteId || "").trim(),
            "operatePagos"
          ),
      role === "superadmin"
        ? Promise.resolve(null)
        : db.doc(`userCompanyAccess/${uid}/companies/${companyId}`).get(),
    ]);
        __mark("catalog_reads");
    if (!operationTypeSnap.exists) {
      throw new HttpsError("failed-precondition", "Tipo de operacion no existe.");
    }
    const operationTypeData: any = operationTypeSnap.data() || {};
    if (operationTypeData.active === false) {
      throw new HttpsError("failed-precondition", "Tipo de operacion inactivo.");
    }


    if (!clientSnap.exists) throw new HttpsError("not-found", "Cliente no existe.");

    const clientData = clientSnap.data()!;
    if (clientData?.active === false) {
      throw new HttpsError("failed-precondition", "Cliente inactivo.");
    }
    if (clientData.rootId && clientData.rootId !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
    }

    const adminId = getActivityAdminId(me, uid, rootId);
    const hasDelegatedClientAccess = !!delegatedClientAccess;

    if (role === "admin" && !hasDelegatedClientAccess) {
      const clientAdminId = String(clientData?.adminId || "").trim();
      if (clientAdminId && clientAdminId !== uid) {
        throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
      }
    }

    if ((role === "operador" || role === "operator") && !hasDelegatedClientAccess) {
      const clientManagedBy = String(clientData?.managedByUserId || "").trim();
      const clientAdminId = String(clientData?.adminId || "").trim();

      if (clientManagedBy && clientManagedBy !== uid) {
        throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
      }

      if (clientAdminId && clientAdminId !== adminId) {
        throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
      }
    }


    if (!companySnap.exists) throw new HttpsError("not-found", "Empresa no existe.");

    const companyData: any = companySnap.data() || {};
    if (companyData?.active === false) {
      throw new HttpsError("failed-precondition", "Empresa inactiva.");
    }
    if (companyData?.rootId && String(companyData.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado para usar esta empresa.");
    }

    const companyDespachoId = String(companyData?.despachoId || "").trim();
    if (!companyDespachoId) {
      throw new HttpsError("failed-precondition", "La empresa no tiene despacho asignado.");
    }

    if (costGuardDespachoId !== companyDespachoId) {
      throw new HttpsError(
        "failed-precondition",
        "El despacho enviado no coincide con el despacho asignado a la empresa."
      );
    }

    if (role !== "superadmin") {
      let companyAllowed = false;

      if (directCompanyAccessSnap?.exists && directCompanyAccessSnap.data()?.active === true) {
        companyAllowed = true;
      }

      if (!companyAllowed) {
        const [userDespachoSnap, despachoCompanySnap] = await Promise.all([
          db.doc(`userDespachoAccess/${uid}/despachos/${companyDespachoId}`).get(),
          db.doc(`dispatchCompanyAccess/${companyDespachoId}/companies/${companyId}`).get(),
        ]);

        companyAllowed =
          userDespachoSnap.exists &&
          userDespachoSnap.data()?.active === true &&
          despachoCompanySnap.exists &&
          despachoCompanySnap.data()?.active === true;
      }

      if (!companyAllowed) {
        throw new HttpsError("permission-denied", "No autorizado para usar esta empresa.");
      }
    }
    __mark("authorization_and_access");


    const operationTypeName = String(
      operationTypeData.name || operationTypeData.nombre || operationTypeKeyValue
    ).trim();

    const financialAdminId =
      String(clientData?.adminId || adminId || "").trim() || null;
    const financialOperadorId =
      String(clientData?.operadorId || clientData?.managedByUserId || "").trim() || null;

    const [
      clientCostSnapshot,
      despachoCostSnapshot,
      adminCostSnapshot,
      operadorCostSnapshot,
    ] = await Promise.all([
      resolvePagoFinancialCostSnapshot({
        candidatePaths: [
          `clients/${String(clienteId).trim()}/costos/${companyDespachoId}__${costGuardOperationTypeKey}`,
          `clients/${String(clienteId).trim()}/costos/${costGuardOperationTypeKey}`,
        ],
        rateKeys: ["assignedCost", "baseCost"],
        operationTypeName,
      }),

      resolvePagoFinancialCostSnapshot({
        candidatePaths: [
          `despachos/${companyDespachoId}/costos/${costGuardOperationTypeKey}`,
        ],
        rateKeys: ["baseCost", "assignedCost"],
        operationTypeName,
      }),

      financialAdminId && financialAdminId !== rootId
        ? resolvePagoFinancialCostSnapshot({
            candidatePaths: [
              `users/${financialAdminId}/costos/${companyDespachoId}__${costGuardOperationTypeKey}`,
              `users/${financialAdminId}/costos/${costGuardOperationTypeKey}`,
            ],
            rateKeys: ["assignedCost", "baseCost"],
            operationTypeName,
          })
        : Promise.resolve(null),

      financialOperadorId
        ? resolvePagoFinancialCostSnapshot({
            candidatePaths: [
              `users/${financialOperadorId}/costos/${companyDespachoId}__${costGuardOperationTypeKey}`,
              `users/${financialOperadorId}/costos/${costGuardOperationTypeKey}`,
            ],
            rateKeys: ["assignedCost", "baseCost"],
            operationTypeName,
          })
        : Promise.resolve(null),
    ]);

    assertPagoFinancialCostUsable(clientCostSnapshot, "cliente", true);
    assertPagoFinancialCostUsable(despachoCostSnapshot, "despacho", true);
    assertPagoFinancialCostUsable(adminCostSnapshot, "admin", false);
    assertPagoFinancialCostUsable(operadorCostSnapshot, "operador", false);

    const financialAssignmentSnapshot: PagoFinancialAssignmentSnapshot = {
      version: "H4_D65_A2_V1",
      capturedAt: admin.firestore.Timestamp.now(),
      despachoId: companyDespachoId,
      adminId: financialAdminId,
      operadorId: financialOperadorId,
      operationTypeKey: operationTypeKeyValue,
      operationTypeName,
      operationFlags: {
        generatesClientBalance:
          typeof operationTypeData.generatesClientBalance === "boolean"
            ? operationTypeData.generatesClientBalance
            : true,
        generatesUserEarnings:
          typeof operationTypeData.generatesUserEarnings === "boolean"
            ? operationTypeData.generatesUserEarnings
            : true,
        allowsDispersion:
          typeof operationTypeData.allowsDispersion === "boolean"
            ? operationTypeData.allowsDispersion
            : true,
      },
      clientCost: clientCostSnapshot!,
      despachoCost: despachoCostSnapshot!,
      adminCost: adminCostSnapshot,
      operadorCost: operadorCostSnapshot,
    };

    assertPagoFinancialRateHierarchy({
      grossAmount: montoTotalNum,
      clientCost: financialAssignmentSnapshot.clientCost,
      despachoCost: financialAssignmentSnapshot.despachoCost,
      adminCost: financialAssignmentSnapshot.adminCost,
      operadorCost: financialAssignmentSnapshot.operadorCost,
    });
    __mark("financial_validation");


    const clienteNombre = String(
      clientData.nombre ||
      clientData.clienteNombre ||
      clientData.name ||
      clientData.razonSocial ||
      clientData.alias ||
      clienteId
    ).trim();

    let fechaPagoValue: any = null;
    const paymentFormValue = String(paymentForm || "").trim();
    if (paymentFormValue && !/^(01|02|03|04|05|06|08|12|13|14|15|17|23|24|25|26|27|28|29|30|31)$/.test(paymentFormValue)) throw new HttpsError("invalid-argument", "Forma SAT del pago inválida.");
    if (fechaPago) {
      const d = new Date(fechaPago);
      if (Number.isNaN(d.getTime())) {
        throw new HttpsError("invalid-argument", "fechaPago invalida.");
      }
      fechaPagoValue = admin.firestore.Timestamp.fromDate(d);
    }
    const paymentTimeValue = String(paymentTime || "12:00:00").trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(paymentTimeValue)) throw new HttpsError("invalid-argument", "Hora del pago inválida.");


    const referenciaValue = String(referencia || "").trim();
    const detectedBankNameValue = String(detectedBankName || "").trim().slice(0, 120);
    const detectedSenderNameValue = String(detectedSenderName || "").trim().slice(0, 180);
    const detectedBeneficiaryNameValue = String(detectedBeneficiaryName || "").trim().slice(0, 180);
    const detectedSourceAccountValue = String(detectedSourceAccount || "").trim().slice(0, 80);
    const detectedDestinationAccountValue = String(detectedDestinationAccount || "").trim().slice(0, 80);
    const detectedPayerRfcValue = String(detectedPayerRfc || "").trim().toUpperCase().replace(/[^A-ZÑ&0-9]/g, "");
    const detectedBeneficiaryRfcValue = String(detectedBeneficiaryRfc || "").trim().toUpperCase().replace(/[^A-ZÑ&0-9]/g, "");
    const clientRfcValue = String(clientData?.rfc || "").trim().toUpperCase().replace(/[^A-ZÑ&0-9]/g, "");
    const companyRfcValue = String(companyData?.rfc || "").trim().toUpperCase().replace(/[^A-ZÑ&0-9]/g, "");
    if (detectedPayerRfcValue && detectedPayerRfcValue !== clientRfcValue) throw new HttpsError("failed-precondition", "El RFC del ordenante del comprobante no coincide con el cliente facturado.");
    if (detectedBeneficiaryRfcValue && detectedBeneficiaryRfcValue !== companyRfcValue) throw new HttpsError("failed-precondition", "El RFC beneficiario del comprobante no coincide con la empresa emisora.");
    const operatorSelectedBankNameValue = String(operatorSelectedBankName || "").trim().slice(0, 120);
    const operatorSelectedAccountValue = String(operatorSelectedAccount || "").trim().slice(0, 80);

    const referenciaNormalized = referenciaValue
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    const fechaPagoKey = fechaPagoValue
      ? fechaPagoValue.toDate().toISOString().slice(0, 10)
      : "";

    const receiptDuplicateKey =
      referenciaNormalized && fechaPagoKey
        ? [
            rootId,
            String(clienteId),
            String(companyId),
            fechaPagoKey,
            referenciaNormalized,
          ].join("__")
        : "";

    const receiptDuplicateId = receiptDuplicateKey
      ? createHash("sha256")
          .update(receiptDuplicateKey)
          .digest("hex")
      : "";

    const receiptDuplicateRef = receiptDuplicateId
      ? db.doc(`pagoReceiptDedup/${receiptDuplicateId}`)
      : null;

    const actorRole = String(me?.role || "unknown");
    const actorId = String(me?.name || me?.displayName || me?.email || uid);

    const businessFolioContextPago =
      await resolveCanonicalBusinessFolioContext({
        db,
        rootId,
        clientId: String(clienteId),
        actorUid: uid,
        actorRole: role as "superadmin" | "admin" | "operador" | "operator",
      });

    const clientNumber = businessFolioContextPago.clientNumber;
    const userNumber = businessFolioContextPago.ownerUserNumber;
    const companyNumber = Number(companyData?.companyNumber ?? companyData?.numeroEmpresa ?? companyData?.sequenceNumber ?? 0);

    if (!Number.isFinite(clientNumber) || clientNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de cliente faltante. Repara numeracion de clientes antes de crear pagos.");
    }

    if (!Number.isFinite(userNumber) || userNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de usuario faltante. Repara numeracion de usuarios antes de crear pagos.");
    }

    if (!Number.isFinite(companyNumber) || companyNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de empresa faltante. Repara numeracion de empresas antes de crear pagos.");
    }

    const ref = db.collection("pagos").doc();

    let folio = "";
    let pagoSequenceNumber = 0;
    let pagoSequenceCounterPath = "";

    await db.runTransaction(async (tx) => {
      if (receiptDuplicateRef) {
        const duplicateSnap = await tx.get(receiptDuplicateRef);

        if (duplicateSnap.exists) {
          throw new HttpsError(
            "already-exists",
            "Comprobante ya registrado.",
            {
              code: "PAGO_RECEIPT_DUPLICATE",
              pagoId: String(duplicateSnap.data()?.pagoId || "") || null,
            },
          );
        }
      }

      const seq = await nextSequenceTx({
        db,
        tx,
        rootId,
        scope: "pagos",
            scopeKey: `cliente_${clienteId}__usuario_${businessFolioContextPago.ownerUid}__empresa_${companyId}`,
      });

      pagoSequenceNumber = seq.sequenceNumber;
      pagoSequenceCounterPath = seq.counterPath;
      folio = buildCanonicalFolio(
        "P",
        pagoSequenceNumber,
        buildCanonicalBusinessFolioParts({
          clientNumber,
          ownerUserNumber: userNumber,
          companyNumber,
          delegateUserNumber: businessFolioContextPago.delegateUserNumber,
        }),
      );

      tx.set(ref, {
        rootId,
        adminId,
        actorUid: uid,
        actorRole,
        accessSource: businessFolioContextPago.accessSource,
        delegatedClientAccessPath: businessFolioContextPago.delegatedClientAccessPath,
        clienteId: String(clienteId),
        clienteNombre,
        companyId: String(companyId),
        empresaNombre: String(empresaNombre || "").trim() || null,
        despachoId: companyDespachoId || null,
        asociadoId: String(asociadoId || "").trim() || null,
        operationTypeKey: operationTypeKeyValue,
        operationTypeName,
        saleTypeKey: financialAssignmentSnapshot.clientCost.calculationBaseType,
        pricingMode: financialAssignmentSnapshot.clientCost.pricingMode,
        calculationBaseType: financialAssignmentSnapshot.clientCost.calculationBaseType,
        finalClientRate: financialAssignmentSnapshot.clientCost.rate,
        financialAssignmentSnapshot,
        financialRateSnapshot: {
          version: financialAssignmentSnapshot.version,
          despachoRate: financialAssignmentSnapshot.despachoCost.rate,
          adminRate: financialAssignmentSnapshot.adminCost?.rate || null,
          operadorRate: financialAssignmentSnapshot.operadorCost?.rate || null,
          finalClientRate: financialAssignmentSnapshot.clientCost.rate,
          calculationBaseType: financialAssignmentSnapshot.clientCost.calculationBaseType,
          pricingMode: financialAssignmentSnapshot.clientCost.pricingMode,
        },
        operationGeneratesClientBalance:
          financialAssignmentSnapshot.operationFlags.generatesClientBalance,
        operationGeneratesUserEarnings:
          financialAssignmentSnapshot.operationFlags.generatesUserEarnings,
        operationAllowsDispersion:
          financialAssignmentSnapshot.operationFlags.allowsDispersion,
        folio,
        folioVersion: 1,
        sequenceNumber: pagoSequenceNumber,
        sequenceScope: `pagos:${rootId}:C${clientNumber}:U${userNumber}:E${companyNumber}`,
        sequenceCounterPath: pagoSequenceCounterPath,
        clientNumber,
        userNumber,
        companyNumber,
        montoTotal: montoTotalNum,
        ...buildPagoFoundationOnCreate(montoTotalNum),
        status: "CONCILIACION_PENDIENTE",
        fechaPago: fechaPagoValue,
        paymentTime: paymentTimeValue,
        paymentDateTimeLocal: fechaPagoValue ? `${fechaPagoKey}T${paymentTimeValue}` : null,
        paymentForm: paymentFormValue || null,
        // Fecha canónica para consultas de reportes. Si el usuario capturó la
        // fecha del pago se conserva; de lo contrario se usa la creación real.
        reportDateAt: fechaPagoValue || FieldValue.serverTimestamp(),
        referencia: referenciaValue || null,
        referenciaNormalized: referenciaNormalized || null,
        receiptLearningSignals: {
          detectedBankName: detectedBankNameValue || null,
          detectedSenderName: detectedSenderNameValue || null,
          detectedBeneficiaryName: detectedBeneficiaryNameValue || null,
          detectedSourceAccount: detectedSourceAccountValue || null,
          detectedDestinationAccount: detectedDestinationAccountValue || null,
          detectedPayerRfc: detectedPayerRfcValue || null,
          detectedBeneficiaryRfc: detectedBeneficiaryRfcValue || null,
          clientRfcSnapshot: clientRfcValue || null,
          companyRfcSnapshot: companyRfcValue || null,
          operatorSelectedBankName: operatorSelectedBankNameValue || null,
          operatorSelectedAccount: operatorSelectedAccountValue || null,
          bankIdentificationNeedsReview:
            !!operatorSelectedBankNameValue &&
            detectedBankNameValue.toUpperCase() !== operatorSelectedBankNameValue.toUpperCase(),
        },
        receiptDuplicateId: receiptDuplicateId || null,
        moneda: String(moneda || "MXN"),
        comprobantes: [],
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        conciliatedBy: null,
        conciliatedAt: null,
        conciliationNote: "",
        hasUnreadMsg: !!String(notaInicial || "").trim(),
      });

      if (receiptDuplicateRef) {
        tx.set(receiptDuplicateRef, {
          rootId,
          clienteId: String(clienteId),
          companyId: String(companyId),
          fechaPagoKey,
          referencia: referenciaValue,
          referenciaNormalized,
          pagoId: ref.id,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      const noteText = String(notaInicial || "").trim();

      if (noteText) {
        const noteRef = ref.collection("notas").doc();

        tx.set(noteRef, {
          rootId,
          text: noteText,
          createdBy: uid,
          createdByName: actorId,
          createdByRole: actorRole,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      logActivityTx(tx, db, {
        event: "PAGO_CREADO",
        rootId,
        adminId,
        actorUid: uid,
        actorName: actorId,
        actorUsername: String((me as any)?.username || ""),
        actorRole,
        referenceId: ref.id,
        referenceType: "pago",
        relatedEntityId: String(clienteId || ""),
        relatedEntityType: "cliente",
        amount: montoTotalNum,
        description: `Pago creado ${folio} para cliente ${clienteNombre} por ${montoTotalNum}`,
        extra: {
          source: "pagos",
          detectedBankName: detectedBankNameValue || null,
          detectedSenderName: detectedSenderNameValue || null,
          detectedBeneficiaryName: detectedBeneficiaryNameValue || null,
          detectedSourceAccount: detectedSourceAccountValue || null,
          detectedDestinationAccount: detectedDestinationAccountValue || null,
          operatorSelectedBankName: operatorSelectedBankNameValue || null,
          operatorSelectedAccount: operatorSelectedAccountValue || null,
          bankIdentificationNeedsReview:
            !!operatorSelectedBankNameValue &&
            detectedBankNameValue.toUpperCase() !== operatorSelectedBankNameValue.toUpperCase(),
        },
      });
    });


    __mark("folio_transaction");

    await recordOperationalMetric({
      rootId,
      stage: "RECEIVED",
      channel: "PAY0",
      caseType: "PAGO",
      correlationId: ref.id,
      adminId,
      clientId: String(clienteId),
      actorUid: uid,
      source: "HUMAN",
      outcome: "CREATED",
    }).catch(() => undefined);

    const __perfTotalMs = Date.now() - __perfStartedAt;

    console.log("[PAY0_PERF_CREATE_PAGO]", JSON.stringify({
      folio,
      pagoId: ref.id,
      totalMs: __perfTotalMs,
      stages: __perf,
    }));

    return {
      ok: true,
      pagoId: ref.id,
      folio,
      _perf: {
        totalMs: __perfTotalMs,
        stages: __perf,
      },
    };
  }
);

export const listPagos = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const meSnap = await db.doc(`users/${uid}`).get();
    if (!meSnap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");

    const me: any = meSnap.data() || {};
    const rootId = String(me.rootId || uid);
    assertAuthorized(request.auth, me, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "pagos",
      requiredAction: "view",
    });

    const role = String(me.role || "").trim().toLowerCase();
    const requestedLimit = Number(request.data?.limit || 100);
    const pageSize = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 1), 100);
    const fromMillis = Number(request.data?.fromMillis || 0);
    const toMillis = Number(request.data?.toMillis || 0);
    const cursorSeconds = Number(request.data?.cursorSeconds || 0);
    const cursorNanoseconds = Number(request.data?.cursorNanoseconds || 0);
    const cursorId = String(request.data?.cursorId || "").trim();

    let queryRef: FirebaseFirestore.Query = db.collection("pagos").where("rootId", "==", rootId);
    if (role === "admin") queryRef = queryRef.where("adminId", "==", uid);
    if (["operador", "operator"].includes(role)) queryRef = queryRef.where("createdBy", "==", uid);

    if (fromMillis > 0) queryRef = queryRef.where("createdAt", ">=", Timestamp.fromMillis(fromMillis));
    if (toMillis > 0) queryRef = queryRef.where("createdAt", "<=", Timestamp.fromMillis(toMillis));
    queryRef = queryRef.orderBy("createdAt", "desc").orderBy(FieldPath.documentId()).limit(pageSize + 1);
    if (cursorSeconds > 0 && cursorId) {
      queryRef = queryRef.startAfter(new Timestamp(cursorSeconds, cursorNanoseconds), cursorId);
    }

    const snap = await queryRef.get();
    const docs = snap.docs.slice(0, pageSize);
    const last = docs[docs.length - 1];
    const lastCreatedAt: any = last?.get("createdAt");

    return {
      items: docs.map((doc) => {
        const data: any = doc.data();
        const createdAt: any = data.createdAt;
        return {
          id: doc.id,
          ...data,
          createdAt: createdAt && typeof createdAt.seconds === "number"
            ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds || 0 }
            : null,
        };
      }),
      hasMore: snap.docs.length > pageSize,
      nextCursor: last ? {
        seconds: typeof lastCreatedAt?.seconds === "number" ? lastCreatedAt.seconds : 0,
        nanoseconds: typeof lastCreatedAt?.nanoseconds === "number" ? lastCreatedAt.nanoseconds : 0,
        id: last.id,
      } : null,
    };
  }
);

export const listSolicitudes = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const meSnap = await db.doc(`users/${uid}`).get();
    if (!meSnap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");
    const me: any = meSnap.data() || {};
    assertAuthorized(request.auth, me, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "solicitudes",
      requiredAction: "view",
    });

    const rootId = String(me.rootId || uid);
    const role = String(me.role || "").trim().toLowerCase();
    const requestedLimit = Number(request.data?.limit || 100);
    const pageSize = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 100, 1), 100);
    const fromMillisRaw = Number(request.data?.fromMillis || 0);
    const toMillisRaw = Number(request.data?.toMillis || 0);
    const cursorSeconds = Number(request.data?.cursorSeconds || 0);
    const cursorNanoseconds = Number(request.data?.cursorNanoseconds || 0);
    const cursorId = String(request.data?.cursorId || "").trim();
    const fromMillis = Number.isFinite(fromMillisRaw) && fromMillisRaw > 0 ? Math.trunc(fromMillisRaw) : 0;
    const toMillis = Number.isFinite(toMillisRaw) && toMillisRaw > 0 ? Math.trunc(toMillisRaw) : 0;

    if (fromMillis > 0 && toMillis > 0 && fromMillis > toMillis) {
      throw new HttpsError("invalid-argument", "Rango temporal invalido.");
    }

    let queryRef: FirebaseFirestore.Query = db.collection("solicitudes");
    if (role === "superadmin") queryRef = queryRef.where("rootId", "==", rootId);
    else if (role === "admin") queryRef = queryRef.where("adminId", "==", uid);
    else if (["operador", "operator"].includes(role)) queryRef = queryRef.where("createdBy", "==", uid);
    else throw new HttpsError("permission-denied", "Rol sin acceso a solicitudes.");

    if (fromMillis > 0) queryRef = queryRef.where("createdAt", ">=", Timestamp.fromMillis(fromMillis));
    if (toMillis > 0) queryRef = queryRef.where("createdAt", "<=", Timestamp.fromMillis(toMillis));
    queryRef = queryRef.orderBy("createdAt", "desc").orderBy(FieldPath.documentId()).limit(pageSize + 1);
    if (cursorSeconds > 0 && cursorId) {
      queryRef = queryRef.startAfter(new Timestamp(cursorSeconds, cursorNanoseconds), cursorId);
    }
    const snap = await queryRef.get();
    const docs = snap.docs.slice(0, pageSize);
    const last = docs[docs.length - 1];
    const createdAt: any = last?.get("createdAt");
    return {
      items: docs.map((entry) => {
        const data: any = entry.data();
        const entryCreatedAt: any = data.createdAt;
        return {
          id: entry.id,
          ...data,
          createdAt: entryCreatedAt && typeof entryCreatedAt.seconds === "number"
            ? { seconds: entryCreatedAt.seconds, nanoseconds: entryCreatedAt.nanoseconds || 0 }
            : null,
        };
      }),
      hasMore: snap.docs.length > pageSize,
      nextCursor: last ? {
        seconds: Number(createdAt?.seconds || 0),
        nanoseconds: Number(createdAt?.nanoseconds || 0),
        id: last.id,
      } : null,
    };
  },
);

export const changePagoStatus = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const rootId = await getRootId(uid);
    const me = await getMyUser(uid);
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "conciliate" });

    const role = String(me?.role || "").trim().toLowerCase();
    const isSuperadmin = role === "superadmin";


    const actorRole = String(me?.role || "unknown");
    const actorName = String(me?.name || me?.displayName || me?.email || uid);
    const adminId = getActivityAdminId(me, uid, rootId);
const { pagoId, newStatus, conciliationNote, hasUnreadMsg } = request.data || {};
    if (!pagoId) throw new HttpsError("invalid-argument", "pagoId requerido.");
    if (!newStatus && typeof hasUnreadMsg !== "boolean") {
      throw new HttpsError("invalid-argument", "newStatus o hasUnreadMsg requerido.");
    }

    const ref = db.doc(`pagos/${pagoId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Pago no existe.");

    const data = snap.data()!;

    if (data.rootId !== rootId) throw new HttpsError("permission-denied", "No autorizado.");
    const pagoAdminId = String(data.adminId || "").trim();     const pagoCreatedBy = String(data.createdBy || "").trim();      const canManagePagoScope =       isSuperadmin ||       pagoAdminId === uid ||       pagoAdminId === rootId ||       pagoCreatedBy === uid;      if (!canManagePagoScope) {       throw new HttpsError("permission-denied", "No autorizado para modificar este pago.");     }      const isUnreadOnly =       !newStatus &&       typeof hasUnreadMsg === "boolean" &&       hasUnreadMsg === false;      if (!isSuperadmin && !isUnreadOnly) {       throw new HttpsError("permission-denied", "Solo superadmin puede cambiar estado de pagos.");     }

    const patch: any = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (typeof hasUnreadMsg === "boolean") {
      patch.hasUnreadMsg = hasUnreadMsg;
    }

    if (!newStatus) {
      await ref.update(patch);
      return { ok: true };
    }

    const currentStatus = normalizePagoStatus(data.status || "REGISTRADO");
    const nextStatus = normalizePagoStatus(newStatus);

    if (currentStatus === nextStatus) {
      await ref.update(patch);
      return { ok: true };
    }

    if (!canTransitionPagoStatus(currentStatus, nextStatus)) {
      throw new HttpsError("failed-precondition", `No se puede cambiar de ${currentStatus} a ${nextStatus}.`);
    }

    const { total: montoTotalNum, applied: montoAplicadoSolicitudesNum } = getPagoCoverageState(data);

    patch.status = nextStatus;

    if (nextStatus === "CONCILIACION_PENDIENTE") {
      patch.conciliationNote = String(conciliationNote || "");
    }

    if (nextStatus === "CONCILIADO") {
      const operationTypeKeyValue = String(data.operationTypeKey || "").trim().toUpperCase();
      if (!operationTypeKeyValue) {
        throw new HttpsError(
          "failed-precondition",
          "No se puede conciliar un pago sin operationTypeKey. Configura el posteo financiero primero."
        );
      }

      patch.conciliatedBy = uid;
      patch.conciliatedAt = FieldValue.serverTimestamp();
      patch.conciliationNote = String(conciliationNote || "");
      Object.assign(patch, buildPagoFoundationOnConciliation(data));
    }

    if (nextStatus === "RECHAZADO" || nextStatus === "CANCELADO") {
      if (montoAplicadoSolicitudesNum > 0) {
        throw new HttpsError("failed-precondition", "No puedes cerrar o rechazar un pago que ya tiene aplicaciones.");
      }
      patch.montoDisponible = 0;
      patch.montoDisponibleSolicitudes = 0;
      const iqIdValue = String(data.iqDepositId || data.iqPagoDepositId || data.iqId || "").trim() || null;
      Object.assign(patch, buildPagoIqTerminalLockPatchH4D58H({
        pago: data,
        iqId: iqIdValue,
        operationStatus: nextStatus === "CANCELADO" ? "CANCELLED" : "REJECTED",
        reconciliationStatus: String(conciliationNote || (nextStatus === "CANCELADO" ? "Cancelado manualmente en PAY0" : "Rechazado manualmente en PAY0")),
        authUid: uid,
        source: "PAY0_MANUAL_STATUS_CHANGE",
      }));
    }

      await ref.update(patch);

      if (nextStatus === "CONCILIADO") {

        await postCanonicalPagoFinancials({
          db,
          rootId,
          pagoId: String(pagoId),
          actorUid: uid,
          actorUsername: String((me as any)?.username || actorName || uid),
          actorRole,
        });
      }


      await logActivity({
        event: "PAGO_STATUS_ACTUALIZADO",
        rootId,
        adminId,
        actorUid: uid,
        actorName,
        actorUsername: String((me as any)?.username || ""),
        actorRole,
        referenceId: pagoId,
        referenceType: "pago",
        relatedEntityId: pagoId,
        relatedEntityType: "pago",
        description: `Pago ${pagoId} cambio de ${currentStatus} a ${nextStatus}`,
      });
      if (["CONCILIADO", "RECHAZADO", "CANCELADO"].includes(nextStatus)) {
        await recordOperationalMetric({
          rootId,
          stage: "RESOLVED",
          channel: "PAY0",
          caseType: "PAGO",
          correlationId: String(pagoId),
          adminId,
          clientId: String(data.clienteId || data.clientId || ""),
          actorUid: uid,
          source: "HUMAN",
          outcome: nextStatus,
        }).catch(() => undefined);
      }
return { ok: true };
  }
);

export const preparePagoFinancialPosting = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin"], requiredModule: "pagos", requiredAction: "conciliate" });
    const actorRole = requireRole(me, ["superadmin"]);
    const rootId = await getRootId(uid);

    const { pagoId, operationTypeKey, postNow } = request.data || {};

    const pagoIdValue = String(pagoId || "").trim();
    const operationTypeKeyValue = String(operationTypeKey || "").trim().toUpperCase();

    if (!pagoIdValue) {
      throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
    }

    if (!operationTypeKeyValue) {
      throw new HttpsError("invalid-argument", "operationTypeKey es obligatorio.");
    }

    const actorUsername =
      String((me as any)?.username || "") ||
      String((me as any)?.displayName || "") ||
      String((me as any)?.name || "") ||
      uid;

    return await preparePagoFinancialPostingCore({
      db,
      rootId,
      pagoId: pagoIdValue,
      operationTypeKey: operationTypeKeyValue,
      postNow: postNow !== false,
      actorUid: uid,
      actorUsername,
      actorRole,
    });
  }
);

export const previewPagoFinancialPosting = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin"], requiredModule: "pagos", requiredAction: "conciliate" });
    requireRole(me, ["superadmin"]);
    const rootId = await getRootId(uid);

    const { pagoId, operationTypeKey, debug } = request.data || {};

    const pagoIdValue = String(pagoId || "").trim();
    const operationTypeKeyValue = String(operationTypeKey || "").trim().toUpperCase();

    if (!pagoIdValue) {
      throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
    }

    if (!operationTypeKeyValue) {
      throw new HttpsError("invalid-argument", "operationTypeKey es obligatorio.");
    }

    return debug
      ? await resolvePagoOperationPreviewDebug({
          db,
          rootId,
          pagoId: pagoIdValue,
          operationTypeKey: operationTypeKeyValue,
        })
      : await resolvePagoOperationPreview({
          db,
          rootId,
          pagoId: pagoIdValue,
          operationTypeKey: operationTypeKeyValue,
        });
  }
);

export const diagnosePagoFinancialContext = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin"], requiredModule: "pagos", requiredAction: "conciliate" });
    requireRole(me, ["superadmin"]);
    const rootId = await getRootId(uid);

    const { pagoId, operationTypeKey } = request.data || {};

    const pagoIdValue = String(pagoId || "").trim();
    const operationTypeKeyValue = String(operationTypeKey || "").trim().toUpperCase();

    if (!pagoIdValue) {
      throw new HttpsError("invalid-argument", "pagoId es obligatorio.");
    }

    if (!operationTypeKeyValue) {
      throw new HttpsError("invalid-argument", "operationTypeKey es obligatorio.");
    }

    return await diagnosePagoFinancialContextCore({
      db,
      rootId,
      pagoId: pagoIdValue,
      operationTypeKey: operationTypeKeyValue,
    });
  }
);

export {
  reservePagoApplicationBatch,
  applyPagoToSolicitudesAtomic,
  applyPagoToSolicitud,
  preparePagoApplicationIqPlan,
  resumePagoApplicationIqPlan,
  executePagoApplicationIqPlan,
  processPagoApplicationIqPlanOnDemandTask,
  processIqPaymentApplicationExecution,
  diagnosePagoApplicationIqMethods,
} from "./modules/paymentApplications/callables";

export { addSolicitudNota, addPagoNota } from "./modules/notes/callables";
export { repairUserNumbersByRootCallable } from "./modules/users/repairNumbers";
export { createCompany, toggleCompanyActive, setDispatchCompanies, listCompaniesCanonical, updateCompanyDepositIdentity } from "./modules/companies/callables";
export { saveDespachoCallable, setUserDespachos, toggleDespachoActive } from "./modules/dispatches/callables";
export { createManualAdjustment } from "./modules/balances/callables";
export { createClientDispersion, createClientDispersionsMassive, grantClientAdvance, listScopedClientDispersions } from "./modules/financing/callables";
export { previewClientDispersionPricing } from "./modules/financing/dispersionFinancialCallables";
export { createOperationType } from "./modules/rates/callables";
export { setDespachoOperationCost } from "./modules/rates/callables";
export { setUserOperationCost } from "./modules/rates/callables";

export { setClientOperationCost } from "./modules/rates/callables";

export { addClientBeneficiaryMethod, createClientBeneficiary, deleteClientBeneficiary, deleteClientBeneficiaryMethod, toggleClientBeneficiaryActive, toggleClientBeneficiaryMethodActive, updateClientBeneficiary, updateClientBeneficiaryMethod, replaceClientBeneficiaryMethod };
export { requestClientDispersionIncident } from "./modules/financing/callables";
export { resolveClientDispersionIncident } from "./modules/financing/callables";
export { addClientDispersionNota } from "./modules/financing/callables";
export { initSolicitudDocumentUpload, finalizeSolicitudDocumentUpload, deactivateSolicitudDocument, reprocessActiveSolicitudOc } from "./modules/solicitudDocuments/callables";
export { createSolicitudSignatureLink, getSolicitudSignatureRequest, submitSolicitudSignature } from "./modules/signatureLinks/callables";
export { generateSolicitudQuotation, getPublicQuotationVerification } from "./modules/cotizaciones/callables";
export { getPublicConstanciaVerification } from "./modules/constancias/service";
export { initPagoDocumentUpload, finalizePagoDocumentUpload, updateRejectedPagoAmountForRetry, deactivatePagoDocument } from "./modules/pagoDocuments/callables";
export { initDispersionDocumentUpload, finalizeDispersionDocumentUpload, deactivateDispersionDocument } from "./modules/dispersionDocuments/callables";

export { telegramWebhook } from "./modules/telegram/webhook";

export { createTelegramLinkToken, getMyTelegramLinkStatus, unlinkMyTelegramAccount, getMyTelegramNotificationPrefs, updateMyTelegramNotificationPrefs, sendMyTelegramTestNotification, createClientTelegramLinkToken, getClientTelegramLinkStatus, unlinkClientTelegramAccount } from "./modules/telegram/callables";

export { telegramDownloadAction } from "./modules/telegram/actionTokens";
export { setMaintenanceMode } from "./modules/system/maintenance";
export { getEarningsByClientReport } from "./modules/reports/callables";
export { getPaymentsFinancialPostingIssuesReport } from "./modules/reports/callables";
export { getOperationalIntelligenceReport } from "./modules/reports/callables";
export { getOperationalMetricsReport } from "./modules/reports/callables";
export { backfillPagoReportDates } from "./modules/reports/pagoReportDateBackfillCallables";
export { getControlCenterOverview, refreshControlCenterOverview } from "./modules/controlCenter/callables";
export { trackPaymentComplement, refreshComplementOnSolicitud, refreshComplementOnPago, listPaymentComplementFollowup, refreshPaymentComplementFollowup } from "./modules/paymentApplications/complementFollowup";
export { enqueueAutomaticPaymentComplement, executeAutomaticPaymentComplement, checkPaymentComplementsDaily, configurePaymentComplementAutomation, setComplementPaymentForm } from "./modules/paymentApplications/complementAutomation";
export { getControlCenterAnalytics, initializeControlCenterAnalytics, getControlCenterEvidence } from "./modules/controlCenter/analyticsCallables";
export { recognizeControlCenterExpense, reverseControlCenterExpense } from "./modules/expenses/callables";
export { queueOperationRecovery, reconcileOperationRecovery } from "./modules/controlCenter/recovery";
export { queueControlCenterApplications, queueControlCenterBalances, queueControlCenterMovements, queueControlCenterAdvances, queueControlCenterLearning, queueControlCenterRecovery, queueControlCenterExpenses } from "./modules/controlCenter/automation";
export { queueControlCenterIqInvoice, queueControlCenterIqCreate, queueControlCenterIqStatus, queueControlCenterIqReceipt, queueControlCenterIqDeposit, queueControlCenterWhatsapp, queueControlCenterTelegram } from "./modules/controlCenter/automation";
export {
  queueControlCenterSolicitud,
  queueControlCenterPago,
  queueControlCenterFacturama,
  queueControlCenterMateriality,
  queueControlCenterDispersion,
  queueControlCenterHugo,
  reconcileDirtyControlCenters,
} from "./modules/controlCenter/automation";
export { verifyTelegramMiniAppSession, getMatUserHome, getMatClientHome } from "./modules/telegramMiniApp/callables";
export { getClientBalanceSummary, getClientStatement, getUserBalanceSummary, getUserStatement, getClientOperationalBalanceSummary, getClientWalletOverview, getUserWalletOverview, getClientWalletAccountsOverview, getClientWalletDetailOverview } from "./modules/ledger/callables";
export { ensureMaterialityClientCompany, linkSolicitudToMaterialityOperation, getMaterialityOperation, getMaterialityClientCompanyOverview, getMaterialityDashboard } from "./modules/materiality/callables";
export { refreshMaterialityFromUpload } from "./modules/materiality/triggers";
export { initEntityDocumentUpload, finalizeEntityDocumentUpload, listEntityDocuments, deactivateEntityDocument, reactivateEntityDocument } from "./modules/entityDocuments/callables";
export {
  createIqCredentialProfile,
  updateIqCredentialProfile,
  listIqCredentialProfiles,
  deactivateIqCredentialProfile,
  updateUserIqAccess,
  removeUserIqAccess,
  listUserIqAccess,
  getCurrentUserIqAccess,
  resolveAssignedIqCredentialForModule,
  testIqConnection,
} from "./modules/iq/callables";

// H4_D87_A57_A73_R1_LEGACY_SOLICITUD_PREVALIDATE_PREPARE_UNEXPORTED
export { createSolicitudIq } from "./modules/iq/solicitudCreationCallables";
export { reconcileSolicitudIq } from "./modules/iq/solicitudReconciliationCallables";
export {
  getIqOperatingCalendar,
  updateIqOperatingCalendar,
  setIqAutomationMasterEnabled,
} from "./modules/iq/operatingCalendarCallables";
export {
  enqueueSolicitudIqCreation,
  processIqCreateOnDemandTask,
  processIqCreateQueue,
} from "./modules/iq/solicitudCreateQueueCallables";
export {
  syncIqSolicitudStatus,
// IQ2G_H4_D55A_INDEX_EXPORT_DISABLED processIqStatusMonitorQueue
} from "./modules/iq/solicitudStatusMonitorCallables";
export {
  syncIqSolicitudInvoice,
  enqueueExistingIqFolioInvoiceImports,
} from "./modules/iq/solicitudInvoiceImportCallables";
// H4_D67_A1_SOLICITUD_IQ_SCHEDULERS_REMOVED
export {
  debugFindPagoIqDepositCandidates,
  manualLinkPagoIqDeposit,
  manualLinkPagoIqDepositHttp,
  omitPagoIqDepositAutomation,
  omitPagoIqDepositAutomationHttp,
  reconcilePendingPagoIqDepositsNow,
  requestPagoIqSync,
  processIqPagoDepositOnDemandTask,
  // H4_D87_A58_PAGO_MANUAL_ON_DEMAND
  // La accion manual usa Cloud Task; la automatizacion usa schedulers.
} from "./modules/iq/pagoDepositCallables";
export { getIqAutomationDashboard } from "./modules/iq/automationDashboardCallables";
export { getIqDispersionDiagnostic } from "./modules/iq/dispersionDiagnosticCallables";
export { probeIqDispersionModule } from "./modules/iq/dispersionModuleProbeCallables";

// IQ2G_H4_D57B_EXPORT_OMIT_IQ_AUTOMATION_JOB
export { omitIqAutomationJob } from "./modules/iq/automationControlCallables";
export { precheckSimilarPay0Operation, confirmSimilarPay0OperationAsNew } from "./modules/iq/pay0SimilarOperationPrecheckCallables";
export { prepareDocumentDeliveryJob } from "./modules/documentDelivery/callables";

export {
  getWhatsAppQrDashboard,
  requestWhatsAppChatsSync,
  requestWhatsAppNewQr,
  assignWhatsAppJobDestination,
  saveWhatsAppDeliveryRoute,
  resolveWhatsAppJobDestinations,
} from "./modules/documentDelivery/whatsappQrCallables";

export { releaseWhatsAppJobDeliveries, retryWhatsAppJobErrors, omitWhatsAppJob } from "./modules/documentDelivery/whatsappReleaseCallables";
export { getWhatsAppAutomationConfig, setWhatsAppAutomationEnabled } from "./modules/documentDelivery/whatsappAutomationCallables";
export { processWhatsAppInvoiceAutomation } from "./modules/documentDelivery/whatsappAutomationTrigger";
export { releaseForwardOnlyDispersionReservationOnTerminal } from "./modules/dispatchBalances/forwardOnlyTriggers";
export {
  createClientDispersionIq,
  processIqDispersionCreate,
} from "./modules/iq/dispersionCreationCallables";


// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
export { processIqReconciliationQueue } from "./modules/iq/solicitudReconciliationCallables";
export {
  discoverIqWorkCandidates,
  processIqInvoiceImportQueue,
  syncTodayIqInvoicesNow,
} from "./modules/iq/solicitudInvoiceImportCallables";
export { processIqStatusMonitorQueue } from "./modules/iq/solicitudStatusMonitorCallables";
export {
  processIqPagoDepositCreateQueue,
  processIqPagoDepositReconciliationQueue,
} from "./modules/iq/pagoDepositCallables";
// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL_END


export { syncIqClientCallable } from "./modules/clients/iqLinkCallable";

export { parseClientCsfCallable, finalizeClientCsfIntakeCallable } from "./modules/clients/csfCallables";
export { parsePagoReceiptPdf } from "./modules/pagos/receiptPdfCallables";
export { getFacturamaSandboxStatus, getFacturamaProductionStatus, saveFacturamaDraft, listFacturamaInvoices, importCompanyInvoiceCatalog, initGlobalSatCatalogUpload, finalizeGlobalSatCatalogImport } from "./modules/facturama/callables";
export { saveFacturamaIssuerConfig, issueFacturamaSandboxInvoice, issueFacturamaProductionInvoice, reconcileFacturamaIssuedMetadata, cancelFacturamaProductionInvoice, refreshFacturamaProductionCancellationStatus, getFacturamaProductionCsdStatus, registerFacturamaProductionCsd } from "./modules/facturama/sandboxCallables";
export { recordAgent007Observation, listAgent007Observations, listAgent007Recommendations, resolveAgent007Recommendation, listAgent007Messages, markAgent007MessagesRead, sendAgent007Message } from "./modules/agent007/callables";
export { listAssetOverview, createAssetPosition, recordAssetMovement, closeAssetPosition, accrueAssetLoanInterest, previewAssetPaymentAllocation, linkPay0PaymentToAsset, createAssetDocumentDraft, initAssetDocumentUpload, finalizeAssetDocumentUpload, seedUproAssetPortfolio } from "./modules/assets/callables";
