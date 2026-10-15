"use client";
import { useEffect, useRef, useState } from "react";
import { listPagoNotes, type PagoNote, type PagoNoteCursor } from "@/services/pagos";
import { createPaginatedNotesController, emptyNotesState, noteDisplayDateToDate, type NotesState, type NotesDependencies } from "@/lib/paginatedNotesController";
type State = NotesState<PagoNote>;
const empty = () => emptyNotesState<PagoNote>();
export const pagoNoteDisplayDate = noteDisplayDateToDate;
export function createPagoNotesController(deps: NotesDependencies<PagoNote, PagoNoteCursor>) {
  return createPaginatedNotesController({ ...deps, terminalError: error => {
    const value = error as { code?: unknown; details?: { reason?: unknown } } | null;
    return String(value?.code || "").replace(/^functions\//, "") === "failed-precondition" && value?.details?.reason === "ROOT_SCOPE_UNVERIFIED"
      ? "No se puede verificar el acceso a estas notas. Solicita una revisión antes de continuar." : null;
  } });
}

export function usePagoNotes(uid: string, rootId: string, pagoId?: string, enabled = true) {
  const key = JSON.stringify([uid, rootId, pagoId || "", enabled]);
  const [snapshot, setSnapshot] = useState<{ key: string; state: State }>({ key, state: empty() });
  const controller = useRef<{ key: string; value: ReturnType<typeof createPagoNotesController> } | null>(null);
  useEffect(() => {
    setSnapshot({ key, state: empty() });
    if (!enabled || !uid || !rootId || !pagoId) return;
    const current = createPagoNotesController({
      fetch: (cursor, limit = 50) => listPagoNotes({ pagoId, limit, ...(cursor ? { cursor } : {}) }),
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
  }, [key, uid, rootId, pagoId, enabled]);
  return { ...(snapshot.key === key ? snapshot.state : empty()), refresh: () => { if (controller.current?.key === key) controller.current.value.refresh(); }, loadOlder: () => { if (controller.current?.key === key) controller.current.value.loadOlder(); }, reloadFromStart: () => { if (controller.current?.key === key) controller.current.value.reloadFromStart(); } };
}
