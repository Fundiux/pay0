import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ClientWhatsAppGroupOption = { chatId: string; name: string };
export type ClientWhatsAppGroupOwner = { adminId: string; name: string; internalGroup: ClientWhatsAppGroupOption | null };
export type ClientWhatsAppGroupAssignment = { clientId: string; groupChatId: string; groupName: string };

/** agentId "hugo": only the groups Hugo sees, the ones he can send client documents to. */
export async function getClientWhatsAppGroups(options: { agentId?: "hugo" } = {}): Promise<{
  ok: boolean;
  senderConnected?: boolean;
  /** The superadmin and each admin of the root, with the internal group each one marked. */
  owners?: ClientWhatsAppGroupOwner[];
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

/**
 * An owner's internal group, where Hugo reports that owner's clients without a group or groups missing an agent.
 * An admin sets its own; the superadmin passes ownerAdminId to set another owner's. Empty groupChatId clears it.
 */
export async function setWhatsAppInternalGroup(groupChatId: string, ownerAdminId?: string): Promise<{ ok: boolean; ownerAdminId: string; groupChatId: string | null; groupName: string | null; message: string }> {
  const fn = httpsCallable(functions, "setWhatsAppInternalGroup");
  const res: any = await fn(ownerAdminId ? { groupChatId, ownerAdminId } : { groupChatId });
  return res.data;
}
