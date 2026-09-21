import { CALLABLES } from "@/lib/callableNames";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { db, functions } from "@/lib/firebaseClient";

export type UserDoc = {
  email: string | null;
  rootId?: string;
  role?: string;
  parentUserId?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

export async function upsertUser(email?: string | null) {
  const fn = httpsCallable(functions, CALLABLES.upsertUser);
  const res: any = await fn({ email: email ?? null });
  return res?.data;
}

export async function getUserDoc(uid: string): Promise<UserDoc | null> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any) : null;
}


export async function listUsers(payload?: Record<string, any>) {
  const fn = httpsCallable(functions, "listUsers");
  const res: any = await fn(payload ?? {});
  return res?.data;
}
export async function createAdminUser(payload: Record<string, any>) {
  const fn = httpsCallable(functions, CALLABLES.createAdmin);
  const res: any = await fn(payload);
  return res?.data;
}
export async function createOperadorUser(payload: Record<string, any>) {
  const fn = httpsCallable(functions, CALLABLES.createOperador);
  const res: any = await fn(payload);
  return res?.data;
}
export async function updateUserActive(uid: string, isActive: boolean) {
  const fn = httpsCallable(functions, CALLABLES.updateUserActive);
  const res: any = await fn({ uid, isActive });
  return res?.data;
}
export async function softDeleteUserById(uid: string) {
  const fn = httpsCallable(functions, CALLABLES.softDeleteUser);
  const res: any = await fn({ uid });
  return res?.data;
}
export async function restoreUserById(uid: string) {
  const fn = httpsCallable(functions, CALLABLES.restoreUser);
  const res: any = await fn({ uid });
  return res?.data;
}
export async function getUserClientAccessConfig(targetUid: string) {
  const fn = httpsCallable(functions, CALLABLES.getUserClientAccessConfig);
  const res: any = await fn({ targetUid });
  return res?.data;
}

export type UserClientAccessPermissionMap = {
  view: boolean;
  operate: boolean;
  viewBasic?: boolean;
  operateSolicitudes?: boolean;
  operatePagos?: boolean;
  operateBeneficiarios?: boolean;
  operateDispersiones?: boolean;
  viewBalanceInDispersion?: boolean;
  requestDispersionIncidents?: boolean;
  commentDispersionNotes?: boolean;
};

export type UserClientAccessItemPayload = {
  clientId: string;
  active: boolean;
  permissions: UserClientAccessPermissionMap;
  mode?: "PERMANENT" | "TEMPORARY";
  startsAt?: any | null;
  expiresAt?: any | null;
  grantReason?: string | null;
};

export async function saveUserClientAccess(
  targetUid: string,
  clientIdsOrItems: string[] | UserClientAccessItemPayload[]
) {
  const fn = httpsCallable(functions, CALLABLES.setUserClientAccess);

  const isAccessItems =
    Array.isArray(clientIdsOrItems) &&
    clientIdsOrItems.some((item: any) => item && typeof item === "object" && "permissions" in item);

  const accessItems = isAccessItems ? (clientIdsOrItems as UserClientAccessItemPayload[]) : [];
  const clientIds = isAccessItems
    ? accessItems.filter((item) => item.active !== false).map((item) => item.clientId)
    : (clientIdsOrItems as string[]);

  const payload = isAccessItems
    ? { targetUid, accessItems, clientIds }
    : { targetUid, clientIds };

  const res: any = await fn(payload);
  return res?.data;
}


export async function saveUserModules(
  targetUid: string,
  modules: Record<string, Record<string, boolean>>,
  systemAccess?: { assets: boolean },
) {
  const fn = httpsCallable(functions, CALLABLES.updateUserModules);
  const res: any = await fn({ targetUid, modules, ...(systemAccess ? { systemAccess } : {}) });
  return res?.data;
}




export async function repairUserNumbersByRoot() {
  const fn = httpsCallable(functions, "repairUserNumbersByRootCallable");
  const res: any = await fn({});
  return res?.data;
}
