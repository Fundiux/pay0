import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export async function saveDespachoMutation(input: {
  editingId?: string | null;
  rootId: string;
  uid: string;
  nombre: string;
}) {
  const fn = httpsCallable(functions, "saveDespachoCallable");
  const res: any = await fn(input);
  return res?.data;
}