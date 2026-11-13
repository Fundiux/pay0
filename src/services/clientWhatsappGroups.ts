import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ClientWhatsAppGroupOption = { chatId: string; name: string };
export type ClientWhatsAppGroupAssignment = { clientId: string; groupChatId: string; groupName: string };

/** agentId "hugo": only the groups Hugo sees, the ones he can send client documents to. */
export async function getClientWhatsAppGroups(options: { agentId?: "hugo" } = {}): Promise<{
  ok: boolean;
  senderConnected?: boolean;
  groups: ClientWhatsAppGroupOption[];
  assignments: ClientWhatsAppGroupAssignment[];
}> {
  const fn = httpsCallable(functions, "getClientWhatsAppGroups");
  const res: any = await fn(options.agentId ? { agentId: options.agentId } : {});
  return res.data;
}

export async function assignWhatsAppGroupToClients(input: {
  action: "ASSIGN" | "UNASSIGN";
  groupChatId: string;
  clienteIds: string[];
}): Promise<{
  ok: boolean;
  action: string;
  doneCount: number;
  done: string[];
  failed: { clientId: string; message: string }[];
  message: string;
}> {
  const fn = httpsCallable(functions, "assignWhatsAppGroupToClients");
  const res: any = await fn(input);
  return res.data;
}
