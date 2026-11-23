// Monthly measurement of each agent in each group. Pure aggregation over reply records and mode events.

export type ReplyMetricRow = {
  agentId: string; chatId: string; groupName: string; kind: string; subject: string | null;
  responseMs: number; aiTokens: number; escalated: boolean; humanCorrection: boolean; monthKey: string;
};
export type ModeEventRow = { agentId: string; chatId: string; groupName: string; mode: "OBSERVER" | "ACTING"; reason: string | null; monthKey: string };

export type MetricsBucket = {
  agentId: string; chatId: string | null; groupName: string | null;
  replies: number; byKind: Record<string, number>; humanCorrections: number; escalations: number;
  avgResponseMs: number | null; aiTokens: number; returnsToObserver: number; returnReasons: string[]; actingChanges: number;
};

const emptyBucket = (agentId: string, chatId: string | null, groupName: string | null): MetricsBucket => ({
  agentId, chatId, groupName, replies: 0, byKind: {}, humanCorrections: 0, escalations: 0, avgResponseMs: null, aiTokens: 0, returnsToObserver: 0, returnReasons: [], actingChanges: 0,
});

/** One bucket per agent and group, plus one total bucket per agent (chatId null). Sorted by agent, then group. */
export function summarizeReplyMetrics(replies: ReplyMetricRow[], events: ModeEventRow[], monthKey: string): MetricsBucket[] {
  const buckets = new Map<string, MetricsBucket>();
  const sums = new Map<string, number>();
  const bucket = (agentId: string, chatId: string | null, groupName: string | null) => {
    const key = `${agentId}|${chatId ?? ""}`;
    if (!buckets.has(key)) buckets.set(key, emptyBucket(agentId, chatId, groupName));
    return buckets.get(key)!;
  };
  for (const row of replies) {
    if (row.monthKey !== monthKey) continue;
    for (const target of [bucket(row.agentId, row.chatId, row.groupName), bucket(row.agentId, null, null)]) {
      target.replies += 1;
      target.byKind[row.kind] = (target.byKind[row.kind] || 0) + 1;
      if (row.humanCorrection) target.humanCorrections += 1;
      if (row.escalated) target.escalations += 1;
      target.aiTokens += Math.max(0, Number(row.aiTokens) || 0);
      const sumKey = `${target.agentId}|${target.chatId ?? ""}`;
      sums.set(sumKey, (sums.get(sumKey) || 0) + Math.max(0, Number(row.responseMs) || 0));
    }
  }
  for (const event of events) {
    if (event.monthKey !== monthKey) continue;
    for (const target of [bucket(event.agentId, event.chatId, event.groupName), bucket(event.agentId, null, null)]) {
      if (event.mode === "OBSERVER") { target.returnsToObserver += 1; if (event.reason) target.returnReasons.push(event.reason); }
      else target.actingChanges += 1;
    }
  }
  for (const [key, target] of buckets) target.avgResponseMs = target.replies ? Math.round((sums.get(key) || 0) / target.replies) : null;
  return [...buckets.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || String(a.chatId ?? "").localeCompare(String(b.chatId ?? "")));
}

export function mexicoMonthKey(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit" }).formatToParts(new Date(ms));
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
}
