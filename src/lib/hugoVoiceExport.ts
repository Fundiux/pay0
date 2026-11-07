import { getHugoVoiceSession, type HugoVoiceEvent, type HugoVoiceSession, type HugoVoiceTurn } from "@/services/agent007";

export type HugoVoiceExport = { exportedAt: string; session: HugoVoiceSession | null; turns: HugoVoiceTurn[]; events: HugoVoiceEvent[]; note: string };

// Reads every page of one call through the same authorized callable the history screen uses. Audio is never stored, so none is exported.
export async function collectHugoVoiceExport(sessionId: string): Promise<HugoVoiceExport> {
  const turns = new Map<string, HugoVoiceTurn>(), events = new Map<string, HugoVoiceEvent>();
  let session: HugoVoiceSession | null = null, turnCursor: string | undefined, eventCursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await getHugoVoiceSession({ sessionId, turnCursor, eventCursor, limit: 200 });
    session = result.session || session;
    for (const turn of result.turns) turns.set(turn.id, turn);
    for (const event of result.events) events.set(event.id, event);
    turnCursor = result.nextTurnCursor || undefined; eventCursor = result.nextEventCursor || undefined;
    if (!turnCursor && !eventCursor) break;
  }
  return {
    exportedAt: new Date().toISOString(), session,
    turns: [...turns.values()].sort((a, b) => a.timestampMs - b.timestampMs),
    events: [...events.values()].sort((a, b) => a.timestampMs - b.timestampMs),
    note: "Incluye transcripción, confianza de transcripción y eventos de la llamada. No incluye audio.",
  };
}

export async function downloadHugoVoiceExport(sessionId: string) {
  const data = await collectHugoVoiceExport(sessionId);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `llamada-hugo-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}
