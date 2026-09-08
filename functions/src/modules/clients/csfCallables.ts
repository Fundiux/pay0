// H4_D85_A10_A45_CSF_CALLABLES
import { onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import {
  getMyUser,
  requireAuth,
} from "../sharedCallables/helpers";
import {
  finalizeClientCsfIntake,
  parseAndCreateClientCsfIntake,
} from "./csfService";

function actorName(user:any,uid:string){
  return String(
    user?.username ||
    user?.displayName ||
    user?.name ||
    user?.email ||
    uid
  ).trim();
}

export const parseClientCsfCallable = onCall(
  {
    cors:true,
    region:"us-central1",
    timeoutSeconds:60,
    memory:"512MiB",
  },
  async request=>{
    const uid=requireAuth(request);
    const user=await getMyUser(uid);
    assertAuthorized(request.auth,user,{
      allowedRoles:["superadmin","admin","operador"],
      requiredModule:"clientes",
      requiredAction:"create",
    });

    return parseAndCreateClientCsfIntake({
      fileBase64:String(request.data?.fileBase64||""),
      fileName:String(request.data?.fileName||""),
      uid,
      rootId:String(user?.rootId||uid),
    });
  },
);

export const finalizeClientCsfIntakeCallable = onCall(
  {
    cors:true,
    region:"us-central1",
    timeoutSeconds:60,
    memory:"256MiB",
  },
  async request=>{
    const uid=requireAuth(request);
    const user=await getMyUser(uid);
    assertAuthorized(request.auth,user,{
      allowedRoles:["superadmin","admin","operador"],
      requiredModule:"clientes",
      requiredAction:"edit",
    });

    return finalizeClientCsfIntake({
      intakeId:String(request.data?.intakeId||""),
      clientId:String(request.data?.clientId||""),
      entityDocumentId:String(request.data?.entityDocumentId||""),
      uid,
      rootId:String(user?.rootId||uid),
      actorName:actorName(user,uid),
    });
  },
);
