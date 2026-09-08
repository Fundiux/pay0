import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export async function saveClientMutation(input: {
  editingId?: string | null;
  effectiveRootId: string;
  adminId: string;
  uid: string;
  managedByUserId?: string | null;
  name: string;
  rfc?: string;
  email?: string;
  whatsapp?: string;
  csfIntakeId?: string | null;
}) {
  const fn = httpsCallable(functions, "saveClientCallable");
  const res: any = await fn(input);
  return res?.data;
}

export async function toggleClientActiveMutation(id: string, nextActive: boolean) {
  const fn = httpsCallable(functions, "toggleClientActiveCallable");
  const res: any = await fn({ id, nextActive });
  return res?.data;
}

export async function repairClientNumbersByAdminMutation(adminId: string) {
  const fn = httpsCallable(functions, "repairClientNumbersByAdminCallable");
  const res: any = await fn({ adminId });
  return res?.data;
}

export async function syncIqClientMutation(
  clientId: string,
) {
  const fn = httpsCallable(
    functions,
    "syncIqClientCallable",
  );
  const res: any = await fn({ clientId });
  return res?.data;
}
