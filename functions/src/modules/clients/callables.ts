import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { nextSequenceTx } from "../sequences/service";
import { db, getActivityAdminId, getMyUser, requireAuth, requireRole } from "../sharedCallables/helpers";
import { resolveClientOperationalAccess } from "../clientDelegations/access";
import { assertValidClientIdentity, getCanonicalClientDisplayName, normalizeClientIdentity } from "./domain";
import { buildClientActivePatch, buildClientIdentityPatch, buildClientSequenceFields, resolveClientSaveAdminId, resolveClientToggleAdminId } from "./service";
import { IQ_PAYMENT_APPLICATION_SECRETS } from "../paymentApplications/iqExecution";
import { syncIqClientById } from "./iqLinkCallable";
import { isIqAutomationFlowEnabled } from "../iq/automationRuntime";
import type { PaymentApplicationActor } from "../paymentApplications/service";
import { upsertClientKycRfcIntake } from "../clientKyc/service";
import {
  bindClientCsfIntake,
  getClientCsfIntakeForSave,
} from "./csfService";





export const saveClientCallable = onCall(
  {
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: IQ_PAYMENT_APPLICATION_SECRETS,
  },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    requireRole(caller, ["superadmin", "admin", "operador"]);

    const callerRole = String(getUserRole(caller) || "");
    const callerRootId = String((caller as any)?.rootId || callerUid);

    const iqClientAutomationEnabled =
      await isIqAutomationFlowEnabled(
        callerRootId,
        "crearCliente",
      );

    const requestedAdminId = String(request.data?.adminId || "").trim();

    const effectiveAdminId = resolveClientSaveAdminId({ role: callerRole, callerUid, callerAdminId: (caller as any)?.adminId, requestedAdminId });

    if (!effectiveAdminId) {
      throw new HttpsError("failed-precondition", "adminId no resuelto.");
    }

    const editingId = String(request.data?.editingId || "").trim();
    assertAuthorized(request.auth, caller, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "clientes",
      requiredAction: editingId ? "edit" : "create",
    });
    const managedByUserId = String(request.data?.managedByUserId || callerUid).trim() || callerUid;
    const identity = normalizeClientIdentity(request.data);
    const { name, rfc, email, whatsapp } = identity;
    const csfIntakeId = String(request.data?.csfIntakeId || "").trim();
    const csfIntake = csfIntakeId
      ? await getClientCsfIntakeForSave({
          intakeId: csfIntakeId,
          uid: callerUid,
          rootId: callerRootId,
        })
      : null;

    if (
      csfIntake?.parsed?.rfc &&
      String(csfIntake.parsed.rfc).trim().toUpperCase() !==
        String(rfc || "").trim().toUpperCase()
    ) {
      throw new HttpsError(
        "invalid-argument",
        "El RFC capturado no coincide con la Constancia de Situacion Fiscal."
      );
    }

    if (
      csfIntake?.parsed?.razonSocial &&
      String(csfIntake.parsed.razonSocial).trim() !== String(name || "").trim()
    ) {
      throw new HttpsError(
        "invalid-argument",
        "La razon social capturada no coincide con la Constancia de Situacion Fiscal."
      );
    }

    
    const callerUsernameForClient = String((caller as any)?.username || "").trim();
    const callerNameForClient = String(
      (caller as any)?.displayName ||
      (caller as any)?.name ||
      (caller as any)?.email ||
      callerUsernameForClient ||
      ""
    ).trim();
try { assertValidClientIdentity(identity); } catch (error: any) {
      throw new HttpsError("invalid-argument", String(error?.message || "cliente invalido."));
    }

    const payload: any = {
      rootId: callerRootId,
      adminId: effectiveAdminId,
      ownerId: callerUid,
      managedByUserId,
      ...buildClientIdentityPatch(identity),
      updatedBy: callerUid,
      updatedByName: callerNameForClient,
      updatedByUsername: callerUsernameForClient,
      updatedAt: FieldValue.serverTimestamp(),
      ...(csfIntake
        ? {
            fiscalProfile: {
              ...csfIntake.parsed,
              source: "CSF",
              csfIntakeId,
              sha256: csfIntake.sha256,
              updatedAt: FieldValue.serverTimestamp(),
            },
          }
        : {}),
    };

    if (editingId) {
      const clientRef = db.doc(`clients/${editingId}`);
      const clientSnap = await clientRef.get();

      if (!clientSnap.exists) {
        throw new HttpsError("not-found", "Cliente no existe.");
      }

      const clientData: any = clientSnap.data() || {};
      if (clientData?.rootId && String(clientData.rootId) !== callerRootId) {
        throw new HttpsError("permission-denied", "Cliente fuera de tu root.");
      }
      if (callerRole !== "superadmin" && clientData?.adminId && String(clientData.adminId) !== effectiveAdminId) {
        throw new HttpsError("permission-denied", "Cliente fuera de tu admin.");
      }

      await clientRef.set(payload, { merge: true });

      if (csfIntake) {
        await bindClientCsfIntake({
          intakeId: csfIntakeId,
          clientId: editingId,
        });
      }

      await upsertClientKycRfcIntake({
        clientId: editingId,
        rootId: callerRootId,
        clientName: name,
        rfc,
        source: csfIntake ? "CSF" : "CLIENT_CATALOG",
        sourceIntakeId: csfIntakeId || null,
        actorUid: callerUid,
        actorName: callerNameForClient,
      });

      await logActivity({
        event: "CLIENT_UPDATE",
        rootId: callerRootId,
        adminId: getActivityAdminId(caller, callerUid, callerRootId),
        actorUid: callerUid,
        actorName: String((caller as any)?.email || callerUid),
        actorUsername: String((caller as any)?.username || ""),
        actorRole: String(getUserRole(caller) || ""),
        referenceId: editingId,
        referenceType: "client",
        description: `Cliente ${getCanonicalClientDisplayName(request.data || {}, editingId)} actualizado`,
      });

      let iqSync: any = null;

      if (iqClientAutomationEnabled) {
        try {
        const actor: PaymentApplicationActor = {
          uid: callerUid,
          rootId: callerRootId,
          role: callerRole as PaymentApplicationActor["role"],
          adminId: getActivityAdminId(caller, callerUid, callerRootId),
          displayName: callerNameForClient,
          username: callerUsernameForClient,
        };
        iqSync = await syncIqClientById({
          clientId: editingId,
          actor,
        });
      } catch (error: any) {
        iqSync = {
          ok: false,
          status: "ERROR",
          message: String(
            error?.message ||
            "No se pudo sincronizar cliente con IQ.",
          ),
        };
        await clientRef.set(
          {
            iqLink: {
              status: "ERROR",
              active: false,
              reviewReason: iqSync.message,
              updatedAt: FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        );
      }
      }

      return { updated: true, id: editingId, iqSync };
    }

    const clientRef = db.collection("clients").doc();
    let numeroCliente = 0;

    await db.runTransaction(async (tx) => {
      const seq = await nextSequenceTx({
        db,
        tx,
        rootId: callerRootId,
        scope: "clients",
        scopeKey: effectiveAdminId,
      });

      numeroCliente = seq.sequenceNumber;

      tx.set(clientRef, {
        ...payload,
        active: true,
        ...buildClientSequenceFields({ number: numeroCliente, adminId: effectiveAdminId, counterPath: seq.counterPath }),
        createdBy: callerUid,
        createdByName: callerNameForClient,
        createdByUsername: callerUsernameForClient,
        ownerName: callerNameForClient,
        ownerUsername: callerUsernameForClient,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    if (csfIntake) {
      await bindClientCsfIntake({
        intakeId: csfIntakeId,
        clientId: clientRef.id,
      });
    }

    await upsertClientKycRfcIntake({
      clientId: clientRef.id,
      rootId: callerRootId,
      clientName: name,
      rfc,
      source: csfIntake ? "CSF" : "CLIENT_CATALOG",
      sourceIntakeId: csfIntakeId || null,
      actorUid: callerUid,
      actorName: callerNameForClient,
    });

    await logActivity({
      event: "CLIENT_CREATE",
      rootId: callerRootId,
      adminId: getActivityAdminId(caller, callerUid, callerRootId),
      actorUid: callerUid,
      actorName: String((caller as any)?.email || callerUid),
      actorUsername: String((caller as any)?.username || ""),
      actorRole: String(getUserRole(caller) || ""),
      referenceId: clientRef.id,
      referenceType: "client",
      description: `Cliente ${getCanonicalClientDisplayName(request.data || {}, clientRef.id)} creado`,
    });

    let iqSync: any = null;

    if (iqClientAutomationEnabled) {
      try {
      const actor: PaymentApplicationActor = {
        uid: callerUid,
        rootId: callerRootId,
        role: callerRole as PaymentApplicationActor["role"],
        adminId: getActivityAdminId(caller, callerUid, callerRootId),
        displayName: callerNameForClient,
        username: callerUsernameForClient,
      };
      iqSync = await syncIqClientById({
        clientId: clientRef.id,
        actor,
      });
    } catch (error: any) {
      iqSync = {
        ok: false,
        status: "ERROR",
        message: String(
          error?.message ||
          "No se pudo sincronizar cliente con IQ.",
        ),
      };
      await clientRef.set(
        {
          iqLink: {
            status: "ERROR",
            active: false,
            reviewReason: iqSync.message,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
    }
    }

    return {
      created: true,
      id: clientRef.id,
      numeroCliente,
      clientNumber: numeroCliente,
      iqSync,
    };
  }
);

export const toggleClientActiveCallable = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    requireRole(caller, ["superadmin", "admin", "operador"]);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "clientes", requiredAction: "edit" });

    const callerRole = String(getUserRole(caller) || "");
    const callerRootId = String((caller as any)?.rootId || callerUid);
    const effectiveAdminId = resolveClientToggleAdminId({ role: callerRole, callerUid, callerAdminId: (caller as any)?.adminId, requestedAdminId: request.data?.adminId });

    const id = String(request.data?.id || "").trim();
    const nextActive = Boolean(request.data?.nextActive);

    if (!id) {
      throw new HttpsError("invalid-argument", "id requerido.");
    }

    const clientRef = db.doc(`clients/${id}`);
    const clientSnap = await clientRef.get();

    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Cliente no existe.");
    }

    const clientData: any = clientSnap.data() || {};
    if (clientData?.rootId && String(clientData.rootId) !== callerRootId) {
      throw new HttpsError("permission-denied", "Cliente fuera de tu root.");
    }
    if (callerRole !== "superadmin" && clientData?.adminId && String(clientData.adminId) !== effectiveAdminId) {
      throw new HttpsError("permission-denied", "Cliente fuera de tu admin.");
    }

    await clientRef.set(
      buildClientActivePatch({ nextActive, updatedAt: FieldValue.serverTimestamp(), updatedBy: callerUid }),
      { merge: true }
    );

    await logActivity({
      event: "CLIENT_TOGGLE",
      rootId: callerRootId,
      adminId: getActivityAdminId(caller, callerUid, callerRootId),
      actorUid: callerUid,
      actorName: String((caller as any)?.email || callerUid),
      actorUsername: String((caller as any)?.username || ""),
      actorRole: String(getUserRole(caller) || ""),
      referenceId: id,
      referenceType: "client",
      description: `Cliente ${id} ${nextActive ? "activado" : "desactivado"}`,
    });

    return { id, active: nextActive };
  }
);

export const repairClientNumbersByAdminCallable = onCall(
  { cors: true, timeoutSeconds: 120, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    requireRole(caller, ["superadmin", "admin"]);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin"], requiredModule: "clientes", requiredAction: "edit" });

    const callerRole = String(getUserRole(caller) || "");
    const callerRootId = String((caller as any)?.rootId || callerUid);
    const requestedAdminId = String(request.data?.adminId || "").trim();

    const targetAdminId =
      callerRole === "superadmin"
        ? (requestedAdminId || callerUid)
        : callerUid;

    if (!targetAdminId) {
      throw new HttpsError("failed-precondition", "adminId no resuelto.");
    }

    const snap = await db
      .collection("clients")
      .where("adminId", "==", targetAdminId)
      .orderBy("createdAt", "asc")
      .get();

    const sequenceScope = `clients:${targetAdminId}`;
    const sequenceCounterPath = `counters/${callerRootId}/sequences/clients__${targetAdminId}`;
    const counterRef = db.doc(sequenceCounterPath);

    const batch = db.batch();
    let count = 1;

    snap.docs.forEach((d) => {
      const data: any = d.data() || {};
      if (data?.rootId && String(data.rootId) !== callerRootId) {
        return;
      }

      batch.update(d.ref, {
        numeroCliente: count,
        clientNumber: count,
        sequenceNumber: count,
        sequenceScope,
        sequenceCounterPath,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      });
      count++;
    });

    batch.set(
      counterRef,
      {
        rootId: callerRootId,
        scope: "clients",
        scopeKey: targetAdminId,
        value: count - 1,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    await logActivity({
      event: "CLIENT_REPAIR_NUMBERS",
      rootId: callerRootId,
      adminId: getActivityAdminId(caller, callerUid, callerRootId),
      actorUid: callerUid,
      actorName: String((caller as any)?.email || callerUid),
      actorUsername: String((caller as any)?.username || ""),
      actorRole: String(getUserRole(caller) || ""),
      referenceId: targetAdminId,
      referenceType: "admin",
      description: `Numeracion de clientes reparada para admin ${targetAdminId}`,
    });

    return { updated: count - 1 };
  }
);

type ClientReadPermission = "view" | "operate" | "viewBasic" | "operateSolicitudes" | "operatePagos" | "operateBeneficiarios" | "operateDispersiones" | "viewBalanceInDispersion" | "requestDispersionIncidents" | "commentDispersionNotes";
const CLIENT_READ_PERMISSIONS = new Set<ClientReadPermission>(["view","operate","viewBasic","operateSolicitudes","operatePagos","operateBeneficiarios","operateDispersiones","viewBalanceInDispersion","requestDispersionIncidents","commentDispersionNotes"]);
function normalizeClientReadPermission(value: unknown): ClientReadPermission { const key=String(value||"view").trim() as ClientReadPermission; return CLIENT_READ_PERMISSIONS.has(key)?key:"view"; }
function buildClientReadDto(id: string, data: any) { return { id, name:String(data?.name||""), rfc:String(data?.rfc||""), email:String(data?.email||""), whatsapp:String(data?.whatsapp||""), active:data?.active!==false, rootId:String(data?.rootId||""), adminId:String(data?.adminId||""), ownerId:String(data?.ownerId||""), managedByUserId:String(data?.managedByUserId||""), createdBy:String(data?.createdBy||""), numeroCliente:Number(data?.numeroCliente||data?.clientNumber||data?.sequenceNumber||0)||null, clientNumber:Number(data?.clientNumber||data?.numeroCliente||data?.sequenceNumber||0)||null, createdAt:data?.createdAt||null, iqLink:data?.iqLink&&typeof data.iqLink==="object"?{status:String(data.iqLink.status||""),clientId:String(data.iqLink.clientId||data.iqClientId||""),clientName:String(data.iqLink.clientName||data.iqClientName||""),partnerId:String(data.iqLink.partnerId||""),partnerName:String(data.iqLink.partnerName||""),source:String(data.iqLink.source||""),reviewReason:String(data.iqLink.reviewReason||""),candidates:Array.isArray(data.iqLink.candidates)?data.iqLink.candidates:[]}:null, iqClientId:String(data?.iqClientId||data?.iqLink?.clientId||""), iqClientName:String(data?.iqClientName||data?.iqLink?.clientName||"") }; }
function accessHasClientPermission(access: any, permission: ClientReadPermission) { if(permission==="view")return access?.permissions?.view===true;if(permission==="operate")return access?.permissions?.operate===true;return access?.permissions?.[permission]===true; }

export const listClientsCanonical = onCall({ cors:true,timeoutSeconds:60,memory:"256MiB" },async(request)=>{
 const callerUid=requireAuth(request),caller=await getMyUser(callerUid),role=String(getUserRole(caller)||"").trim().toLowerCase(),rootId=String((caller as any)?.rootId||callerUid),permission=normalizeClientReadPermission(request.data?.requiredPermission),requestedAdminId=String(request.data?.adminId||"").trim();
 assertAuthorized(request.auth,caller,{allowedRoles:["superadmin","admin","operador"],requiredModule:"clientes",requiredAction:"view"});
 const candidates=new Map<string,any>();
 if(role==="superadmin"){let q:FirebaseFirestore.Query=db.collection("clients").where("rootId","==",rootId);if(requestedAdminId)q=q.where("adminId","==",requestedAdminId);const snap=await q.get();snap.docs.forEach(d=>candidates.set(d.id,d.data()||{}));}
 else {const field=role==="admin"?"adminId":role==="operador"?"managedByUserId":null;if(field){const direct=await db.collection("clients").where(field,"==",callerUid).get();direct.docs.forEach(d=>candidates.set(d.id,d.data()||{}));}const delegated=await db.collection(`userClientAccess/${callerUid}/clients`).where("active","==",true).get();for(const d of delegated.docs){const snap=await db.doc(`clients/${d.id}`).get();if(snap.exists)candidates.set(snap.id,snap.data()||{});}}
 const clients=[] as any[];for(const [id,data] of candidates){if(data?.active===false)continue;const access=await resolveClientOperationalAccess({uid:callerUid,role:role as any,rootId,clientId:id,client:data});if(access.allowed&&accessHasClientPermission(access,permission))clients.push(buildClientReadDto(id,data));}clients.sort((a,b)=>a.name.localeCompare(b.name));return {ok:true,clients};
});

export const getClientCanonical = onCall({ cors:true,timeoutSeconds:60,memory:"256MiB" },async(request)=>{
 const callerUid=requireAuth(request),caller=await getMyUser(callerUid),role=String(getUserRole(caller)||"").trim().toLowerCase(),rootId=String((caller as any)?.rootId||callerUid),clientId=String(request.data?.clientId||"").trim(),permission=normalizeClientReadPermission(request.data?.requiredPermission);
 assertAuthorized(request.auth,caller,{allowedRoles:["superadmin","admin","operador"],requiredModule:"clientes",requiredAction:"view"});
 if(!clientId)throw new HttpsError("invalid-argument","clientId requerido.");const snap=await db.doc(`clients/${clientId}`).get();if(!snap.exists)return {ok:true,client:null};const data:any=snap.data()||{},access=await resolveClientOperationalAccess({uid:callerUid,role:role as any,rootId,clientId,client:data});if(!access.allowed||!accessHasClientPermission(access,permission))throw new HttpsError("permission-denied","Sin acceso al Cliente.");return {ok:true,client:buildClientReadDto(clientId,data)};
});
