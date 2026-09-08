// H4_D85_A10_A43_CANONICAL_IQ_CLIENT_SYNC
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import {
  db,
  getActivityAdminId,
  getMyUser,
  requireAuth,
  requireRole,
} from "../sharedCallables/helpers";
import {
  loginIqHttpDirect,
  toIqAuthContext,
} from "../iq/iqHttpAuth";
import {
  normalizeIqEntityName,
  resolveUniqueIqEntity,
  type IqEntityRow,
} from "../iq/iqEntityNameResolver";
import {
  IQ_PAYMENT_APPLICATION_SECRETS,
  resolveIqAccess,
} from "../paymentApplications/iqExecution";
import type { PaymentApplicationActor } from "../paymentApplications/service";

type IqClientRow = IqEntityRow & {
  id?: unknown;
  name?: unknown;
  rfc?: unknown;
  partner_name?: unknown;
  created_at?: unknown;
};

export type IqClientSyncResult = {
  ok: boolean;
  status:
    | "LINKED"
    | "PENDING_RFC"
    | "REVIEW_REQUIRED"
    | "ERROR";
  clientId: string;
  iqClientId: string;
  iqClientName: string;
  method: string;
  message: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g," ").trim();
}

function normalizeRfc(value: unknown): string {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,"");
}

function asRows(value: unknown): IqClientRow[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is IqClientRow =>
          Boolean(row) && typeof row === "object",
      )
    : [];
}

function toActor(params: {
  uid: string;
  rootId: string;
  user: any;
}): PaymentApplicationActor {
  const role = String(getUserRole(params.user) || "").trim().toLowerCase();
  return {
    uid: params.uid,
    rootId: params.rootId,
    role: role as PaymentApplicationActor["role"],
    adminId: getActivityAdminId(
      params.user,
      params.uid,
      params.rootId,
    ),
    displayName: cleanText(
      params.user?.displayName ||
      params.user?.name ||
      params.user?.email ||
      params.uid,
    ),
    username: cleanText(params.user?.username),
  };
}

async function fetchJson(params: {
  url: URL;
  token: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}) {
  const response = await fetch(params.url,{
    method: params.method || "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.token}`,
      ...(params.body
        ? {"Content-Type":"application/json"}
        : {}),
    },
    ...(params.body
      ? {body: JSON.stringify(params.body)}
      : {}),
  });

  const payload = await response.json().catch(()=>({}));

  return {
    response,
    payload,
  };
}

async function listIqClients(params: {
  apiOrigin: string;
  token: string;
  partnerName: string;
}): Promise<IqClientRow[]> {
  const all: IqClientRow[] = [];
  const limit = 100;

  for(let offset=0; offset<5000; offset+=limit){
    const url = new URL("/clients",params.apiOrigin);
    url.searchParams.set("limit",String(limit));
    url.searchParams.set("offset",String(offset));
    url.searchParams.set("order_by_field","id");
    url.searchParams.set("order_by_direction","asc");

    const {response,payload} = await fetchJson({
      url,
      token: params.token,
    });

    if(!response.ok){
      throw new Error(
        `IQ_CLIENT_LIST_HTTP_${response.status}`,
      );
    }

    const rows = asRows(payload);
    all.push(...rows);

    if(rows.length < limit) break;
  }

  const expectedPartner = normalizeIqEntityName(
    params.partnerName,
  );

  return all.filter(
    row =>
      !cleanText(row.partner_name) ||
      normalizeIqEntityName(row.partner_name) ===
        expectedPartner,
  );
}

function selectByName(
  rows: IqClientRow[],
  targetName: string,
) {
  try{
    return resolveUniqueIqEntity(rows,targetName);
  }catch(error:any){
    const code = cleanText(error?.message);
    if(
      code.startsWith("IQ_ENTITY_NOT_FOUND:") ||
      code.startsWith("IQ_ENTITY_LOW_CONFIDENCE:")
    ){
      return null;
    }
    throw error;
  }
}

async function persistLinked(params: {
  clientRef: FirebaseFirestore.DocumentReference;
  clientId: string;
  actor: PaymentApplicationActor;
  partner: {id:string;name:string};
  resolved: {id:string;name:string;method:string;score?:number};
}) {
  const now = FieldValue.serverTimestamp();

  await params.clientRef.set(
    {
      iqLink: {
        status: "LINKED",
        clientId: params.resolved.id,
        clientName: params.resolved.name,
        partnerId: params.partner.id,
        partnerName: params.partner.name,
        source: params.resolved.method,
        score: Number(params.resolved.score || 0),
        active: true,
        linkedAt: now,
        linkedBy: params.actor.uid,
        linkedByName: params.actor.displayName,
        updatedAt: now,
        reviewReason: FieldValue.delete(),
        candidates: FieldValue.delete(),
      },
      iqClientId: params.resolved.id,
      iqClientName: params.resolved.name,
      updatedAt: now,
      updatedBy: params.actor.uid,
      updatedByName: params.actor.displayName,
    },
    {merge:true},
  );

  await logActivity({
    event:"CLIENT_IQ_LINK",
    rootId:params.actor.rootId,
    adminId:params.actor.adminId,
    actorUid:params.actor.uid,
    actorName:params.actor.displayName,
    actorUsername:params.actor.username,
    actorRole:String(params.actor.role),
    referenceId:params.clientId,
    referenceType:"client",
    description:
      `Cliente vinculado con IQ ${params.resolved.name} (${params.resolved.id})`,
  });
}

async function persistReview(params: {
  clientRef: FirebaseFirestore.DocumentReference;
  actor: PaymentApplicationActor;
  reason: string;
  candidates?: IqClientRow[];
}) {
  const now = FieldValue.serverTimestamp();

  await params.clientRef.set(
    {
      iqLink: {
        status: "REVIEW_REQUIRED",
        active: false,
        reviewReason: params.reason,
        candidates: (params.candidates || [])
          .slice(0,10)
          .map(row=>({
            clientId: cleanText(row.id),
            clientName: cleanText(row.name),
            rfc: normalizeRfc(row.rfc),
          })),
        updatedAt: now,
      },
      updatedAt: now,
      updatedBy: params.actor.uid,
      updatedByName: params.actor.displayName,
    },
    {merge:true},
  );
}

export async function syncIqClientById(params: {
  clientId: string;
  actor: PaymentApplicationActor;
}): Promise<IqClientSyncResult> {
  const clientId = cleanText(params.clientId);
  if(!clientId){
    throw new HttpsError(
      "invalid-argument",
      "clientId requerido.",
    );
  }

  const clientRef = db.doc(`clients/${clientId}`);
  const snap = await clientRef.get();

  if(!snap.exists){
    throw new HttpsError(
      "not-found",
      "Cliente PAY0 no existe.",
    );
  }

  const client:any = snap.data() || {};

  if(
    cleanText(client.rootId) &&
    cleanText(client.rootId) !== params.actor.rootId
  ){
    throw new HttpsError(
      "permission-denied",
      "Cliente fuera del root autorizado.",
    );
  }

  const existingIqId = cleanText(
    client?.iqLink?.clientId ||
    client?.iqClientId,
  );

  if(existingIqId){
    return {
      ok:true,
      status:"LINKED",
      clientId,
      iqClientId:existingIqId,
      iqClientName:cleanText(
        client?.iqLink?.clientName ||
        client?.iqClientName,
      ),
      method:"EXISTING_LINK",
      message:"Cliente ya vinculado con IQ.",
    };
  }

  const name = cleanText(client.name);
  const rfc = normalizeRfc(client.rfc);

  if(!rfc){
    await clientRef.set(
      {
        iqLink:{
          status:"PENDING_RFC",
          active:false,
          reviewReason:
            "RFC requerido para alta automatica segura en IQ.",
          updatedAt:FieldValue.serverTimestamp(),
        },
      },
      {merge:true},
    );

    return {
      ok:false,
      status:"PENDING_RFC",
      clientId,
      iqClientId:"",
      iqClientName:"",
      method:"RFC_REQUIRED",
      message:
        "Cliente guardado en PAY0; falta RFC para sincronizarlo con IQ.",
    };
  }

  const access = await resolveIqAccess(
    params.actor,
    {capability:"CLIENTS"},
  );

  const session = await loginIqHttpDirect({
    apiOrigin:access.apiOrigin,
    credentials:{
      username:access.username,
      password:access.password,
    },
  });

  const auth = toIqAuthContext(session);

  const partnerUrl = new URL(
    "/clients/new",
    auth.apiOrigin,
  );

  const {
    response:partnerResponse,
    payload:partnerPayload,
  } = await fetchJson({
    url:partnerUrl,
    token:auth.bearerToken,
  });

  if(!partnerResponse.ok){
    throw new Error(
      `IQ_CLIENT_NEW_HTTP_${partnerResponse.status}`,
    );
  }

  const partnerRows = asRows(
    (partnerPayload as any).partners,
  );

  const partner = resolveUniqueIqEntity(
    partnerRows,
    access.username,
  );

  let clients = await listIqClients({
    apiOrigin:auth.apiOrigin,
    token:auth.bearerToken,
    partnerName:partner.name,
  });

  const sameRfc = clients.filter(
    row => normalizeRfc(row.rfc) === rfc,
  );

  if(sameRfc.length === 1){
    const row = sameRfc[0];

    await persistLinked({
      clientRef,
      clientId,
      actor:params.actor,
      partner,
      resolved:{
        id:cleanText(row.id),
        name:cleanText(row.name),
        method:"RFC_UNIQUE",
        score:1000,
      },
    });

    return {
      ok:true,
      status:"LINKED",
      clientId,
      iqClientId:cleanText(row.id),
      iqClientName:cleanText(row.name),
      method:"RFC_UNIQUE",
      message:"Cliente IQ vinculado por RFC unico.",
    };
  }

  if(sameRfc.length > 1){
    try{
      const resolved = resolveUniqueIqEntity(
        sameRfc,
        name,
      );

      await persistLinked({
        clientRef,
        clientId,
        actor:params.actor,
        partner,
        resolved:{
          ...resolved,
          method:`RFC_DUPLICATE_${resolved.method}`,
        },
      });

      return {
        ok:true,
        status:"LINKED",
        clientId,
        iqClientId:resolved.id,
        iqClientName:resolved.name,
        method:`RFC_DUPLICATE_${resolved.method}`,
        message:
          "RFC repetido en IQ; cliente desambiguado por nombre.",
      };
    }catch(error:any){
      await persistReview({
        clientRef,
        actor:params.actor,
        reason:
          "RFC_DUPLICATE_AMBIGUOUS",
        candidates:sameRfc,
      });

      return {
        ok:false,
        status:"REVIEW_REQUIRED",
        clientId,
        iqClientId:"",
        iqClientName:"",
        method:"RFC_DUPLICATE_AMBIGUOUS",
        message:
          "El RFC existe varias veces en IQ y requiere revision.",
      };
    }
  }

  try{
    const byName = selectByName(
      clients,
      name,
    );

    if(byName){
      await persistLinked({
        clientRef,
        clientId,
        actor:params.actor,
        partner,
        resolved:byName,
      });

      return {
        ok:true,
        status:"LINKED",
        clientId,
        iqClientId:byName.id,
        iqClientName:byName.name,
        method:byName.method,
        message:
          "Cliente IQ vinculado por coincidencia fuerte de nombre.",
      };
    }
  }catch(error:any){
    await persistReview({
      clientRef,
      actor:params.actor,
      reason:"NAME_AMBIGUOUS",
    });

    return {
      ok:false,
      status:"REVIEW_REQUIRED",
      clientId,
      iqClientId:"",
      iqClientName:"",
      method:"NAME_AMBIGUOUS",
      message:
        "Hay mas de un cliente IQ compatible por nombre.",
    };
  }

  await clientRef.set(
    {
      iqLink:{
        status:"CREATE_IN_PROGRESS",
        active:false,
        createRequestedAt:
          FieldValue.serverTimestamp(),
        updatedAt:
          FieldValue.serverTimestamp(),
      },
    },
    {merge:true},
  );

  const createUrl = new URL(
    "/clients",
    auth.apiOrigin,
  );
  createUrl.searchParams.set(
    "partner_id",
    partner.id,
  );

  let createResponse;
  let createPayload;

  try{
    const result = await fetchJson({
      url:createUrl,
      token:auth.bearerToken,
      method:"POST",
      body:{
        name,
        rfc,
      },
    });
    createResponse = result.response;
    createPayload = result.payload;
  }catch(error:any){
    await persistReview({
      clientRef,
      actor:params.actor,
      reason:"IQ_CREATE_POST_UNCERTAIN",
    });

    return {
      ok:false,
      status:"REVIEW_REQUIRED",
      clientId,
      iqClientId:"",
      iqClientName:"",
      method:"IQ_CREATE_POST_UNCERTAIN",
      message:
        "No se pudo confirmar el resultado del alta IQ; no se reintentara automaticamente para evitar duplicados.",
    };
  }

  if(
    !createResponse.ok ||
    cleanText((createPayload as any)?.message)
      .toLowerCase() !== "success"
  ){
    await persistReview({
      clientRef,
      actor:params.actor,
      reason:
        `IQ_CREATE_HTTP_${createResponse.status}`,
    });

    return {
      ok:false,
      status:"REVIEW_REQUIRED",
      clientId,
      iqClientId:"",
      iqClientName:"",
      method:
        `IQ_CREATE_HTTP_${createResponse.status}`,
      message:
        "IQ rechazo el alta automatica del cliente.",
    };
  }

  clients = await listIqClients({
    apiOrigin:auth.apiOrigin,
    token:auth.bearerToken,
    partnerName:partner.name,
  });

  const afterCreate = clients.filter(
    row =>
      normalizeRfc(row.rfc) === rfc &&
      normalizeIqEntityName(row.name) ===
        normalizeIqEntityName(name),
  );

  if(afterCreate.length !== 1){
    await persistReview({
      clientRef,
      actor:params.actor,
      reason:"IQ_CREATE_ID_NOT_UNIQUE",
      candidates:afterCreate,
    });

    return {
      ok:false,
      status:"REVIEW_REQUIRED",
      clientId,
      iqClientId:"",
      iqClientName:"",
      method:"IQ_CREATE_ID_NOT_UNIQUE",
      message:
        "IQ confirmo el alta, pero PAY0 no pudo recuperar un ID unico.",
    };
  }

  const created = afterCreate[0];

  await persistLinked({
    clientRef,
    clientId,
    actor:params.actor,
    partner,
    resolved:{
      id:cleanText(created.id),
      name:cleanText(created.name),
      method:"CREATED_IN_IQ",
      score:1000,
    },
  });

  return {
    ok:true,
    status:"LINKED",
    clientId,
    iqClientId:cleanText(created.id),
    iqClientName:cleanText(created.name),
    method:"CREATED_IN_IQ",
    message:
      "Cliente creado automaticamente en IQ y vinculado con PAY0.",
  };
}

export const syncIqClientCallable = onCall(
  {
    cors:true,
    timeoutSeconds:120,
    memory:"512MiB",
    secrets:IQ_PAYMENT_APPLICATION_SECRETS,
  },
  async request=>{
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    requireRole(
      user,
      ["superadmin","admin","operador"],
    );
    assertAuthorized(
      request.auth,
      user,
      {
        allowedRoles:[
          "superadmin",
          "admin",
          "operador",
        ],
        requiredModule:"clientes",
        requiredAction:"edit",
      },
    );

    const rootId = cleanText(
      user?.rootId || uid,
    );

    return syncIqClientById({
      clientId:cleanText(
        request.data?.clientId,
      ),
      actor:toActor({
        uid,
        rootId,
        user,
      }),
    });
  },
);
