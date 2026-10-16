"use client";
import { useEffect, useRef, useState } from "react";
import { listClientDispersionNotes, type DispersionNote, type DispersionNoteCursor } from "@/services/financing";

import { createPaginatedNotesController, emptyNotesState, noteDisplayDateToDate, type NotesState, type NotesDependencies } from "@/lib/paginatedNotesController";
type State = NotesState<DispersionNote>;
const empty = () => emptyNotesState<DispersionNote>();
export const dispersionNoteDisplayDate = noteDisplayDateToDate;
export function createDispersionNotesController(deps: NotesDependencies<DispersionNote, DispersionNoteCursor>) {
  return createPaginatedNotesController(deps);
}

export function useDispersionNotes(uid: string, rootId: string, dispersionId?: string) {
  const key = JSON.stringify([uid, rootId, dispersionId || ""]);
  const [snapshot, setSnapshot] = useState<{ key: string; state: State }>({ key, state: empty() });
  const controller = useRef<{ key: string; value: ReturnType<typeof createDispersionNotesController> } | null>(null);
  useEffect(() => {
    setSnapshot({ key, state: empty() });
    if (!uid || !rootId || !dispersionId) return;
    const current = createDispersionNotesController({
      fetch: (cursor, limit = 50) => listClientDispersionNotes({ dispersionId, limit, ...(cursor ? { cursor } : {}) }),
      emit: state => setSnapshot({ key, state }),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: timer => { if (typeof timer === "number") window.clearTimeout(timer); },
      visible: () => document.visibilityState === "visible",
    });
    controller.current = { key, value: current };
    const focus = () => current.visibilityChanged();
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    current.refresh();
    return () => {
      current.stop(); controller.current = null;
      document.removeEventListener("visibilitychange", focus); window.removeEventListener("focus", focus);
    };
  }, [key, uid, rootId, dispersionId]);
  return { ...(snapshot.key === key ? snapshot.state : empty()), refresh: () => { if (controller.current?.key === key) controller.current.value.refresh(); }, loadOlder: () => { if (controller.current?.key === key) controller.current.value.loadOlder(); }, reloadFromStart: () => { if (controller.current?.key === key) controller.current.value.reloadFromStart(); } };
}
