// Pure rules for the per-agent chat view. No I/O so the privacy rule is testable.

export type AgentChatsSummary = {
  groups: { chatId: string; name: string; archived: boolean; pinned: boolean; lastSyncedAtMs: number | null }[];
  privateChats: number;
  truncated: boolean;
};

export type ChatRow = { chatId?: unknown; name?: unknown; isGroup?: unknown; active?: unknown; archived?: unknown; pinned?: unknown; lastSyncedAt?: { toMillis?: () => number } };

// Solo grupos con nombre. De los chats privados solo se cuenta cuántos hay: ni nombre ni número salen del servidor.
export function summarizeAgentChats(rows: ChatRow[], truncated = false): AgentChatsSummary {
  const groups: AgentChatsSummary["groups"] = [];
  let privateChats = 0;
  for (const row of rows) {
    if (row.active !== true) continue;
    if (row.isGroup !== true) { privateChats++; continue; }
    groups.push({
      chatId: String(row.chatId ?? "").slice(0, 200),
      name: String(row.name ?? "").trim().replace(/\s+/g, " ").slice(0, 160),
      archived: row.archived === true,
      pinned: row.pinned === true,
      lastSyncedAtMs: typeof row.lastSyncedAt?.toMillis === "function" ? row.lastSyncedAt.toMillis() : null,
    });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { groups, privateChats, truncated };
}
