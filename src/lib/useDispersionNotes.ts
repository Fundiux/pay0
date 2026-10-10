"use client";
import { useEffect, useRef, useState } from "react";
import { listClientDispersionNotes, type DispersionNote, type DispersionNoteCursor, type DispersionNotePage } from "@/services/financing";

type State = { notes: DispersionNote[]; loading: boolean; error: string; hasMore: boolean };
const empty = (): State => ({ notes: [], loading: false, error: "", hasMore: false });
function compareIds(a: string, b: string) {
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
function compare(a: DispersionNote, b: DispersionNote) {
  return a.createdAt.seconds - b.createdAt.seconds || a.createdAt.nanoseconds - b.createdAt.nanoseconds || compareIds(a.id, b.id);
}
type Dependencies = {
  fetch: (cursor?: DispersionNoteCursor) => Promise<DispersionNotePage>;
  emit: (state: State) => void;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
  visible: () => boolean;
};

/** One controller per account/root/parent. No authorization is cached here. */
export function createDispersionNotesController(deps: Dependencies) {
  let live = true, busy = false, pendingRefresh = false, failures = 0, denied = false;
  let resetTraversal = false, generation = 0;
  let state = empty(), timer: unknown, historical: DispersionNoteCursor | null = null;
  const rows = new Map<string, DispersionNote>();
  const gaps: { cursor: DispersionNoteCursor; stop: DispersionNote }[] = [];
  function emit(patch: Partial<State> = {}) {
    state = { ...state, notes: [...rows.values()].sort(compare), hasMore: !!historical || gaps.length > 0, ...patch };
    deps.emit(state);
  }
  function schedule() {
    deps.clearTimer(timer);
    if (live && !denied && deps.visible()) timer = deps.setTimer(() => { void run(false); }, Math.min(60000, 5000 * 2 ** failures));
  }
  async function run(older: boolean) {
    if (!live || !deps.visible()) return;
    if (busy) { if (!older) pendingRefresh = true; return; }
    const gap = older ? gaps[0] : undefined;
    const cursor = older ? gap?.cursor || historical : undefined;
    if (older && !cursor) return;
    busy = true;
    const requestGeneration = generation;
    deps.clearTimer(timer);
    emit({ loading: true, error: "" });
    try {
      const page = await deps.fetch(cursor || undefined);
      if (!live || requestGeneration !== generation) return;
      const previousLatest = [...rows.values()].sort(compare).at(-1);
      if (!older && previousLatest && page.nextCursor && page.items.length && !page.items.some(row => rows.has(row.id))
        && compare(page.items[page.items.length - 1], previousLatest) > 0) {
        gaps.unshift({ cursor: page.nextCursor, stop: previousLatest });
      }
      if (!older && (!previousLatest || resetTraversal)) { historical = page.nextCursor; gaps.length = 0; resetTraversal = false; }
      if (older && gap) {
        if (!page.nextCursor || page.items.some(row => compare(row, gap.stop) <= 0)) gaps.shift();
        else gap.cursor = page.nextCursor;
      } else if (older) historical = page.nextCursor;
      if (!older) {
        const received = new Set(page.items.map(row => row.id));
        const oldest = page.items[page.items.length - 1];
        // Reconcile deletions only inside the range actually read. Older loaded
        // pages stay intact until explicitly reloaded, not inferred as deleted.
        for (const [id, row] of rows) if (!received.has(id) && (!page.nextCursor || (oldest && compare(row, oldest) >= 0))) rows.delete(id);
        if (!page.nextCursor) { historical = null; gaps.length = 0; }
      }
      for (const row of page.items) rows.set(row.id, row);
      denied = false; failures = 0;
      emit({ loading: false });
    } catch (error: any) {
      if (!live || requestGeneration !== generation) return;
      const code = String(error?.code || "").replace(/^functions\//, "");
      denied = ["permission-denied", "unauthenticated", "not-found"].includes(code);
      if (denied) { rows.clear(); gaps.length = 0; historical = null; }
      if (code === "failed-precondition") resetTraversal = true;
      failures = Math.min(failures + 1, 4);
      emit({ loading: false, error: denied ? "Ya no tienes acceso a estas notas." : "No se pudieron actualizar las notas. Intenta de nuevo." });
    } finally {
      busy = false;
      if (live && pendingRefresh && !denied) { pendingRefresh = false; void run(false); }
      else schedule();
    }
  }
  return {
    refresh() { denied = false; void run(false); },
    loadOlder() { void run(true); },
    reloadFromStart() {
      if (!live) return;
      generation++; rows.clear(); gaps.length = 0; historical = null; resetTraversal = false; denied = false; failures = 0;
      deps.clearTimer(timer); emit({ loading: true, error: "" });
      if (busy) pendingRefresh = true; else void run(false);
    },
    visibilityChanged() { deps.clearTimer(timer); if (deps.visible()) this.refresh(); },
    stop() { live = false; pendingRefresh = false; deps.clearTimer(timer); rows.clear(); gaps.length = 0; },
  };
}

export function useDispersionNotes(uid: string, rootId: string, dispersionId?: string) {
  const key = JSON.stringify([uid, rootId, dispersionId || ""]);
  const [snapshot, setSnapshot] = useState<{ key: string; state: State }>({ key, state: empty() });
  const controller = useRef<{ key: string; value: ReturnType<typeof createDispersionNotesController> } | null>(null);
  useEffect(() => {
    setSnapshot({ key, state: empty() });
    if (!uid || !rootId || !dispersionId) return;
    const current = createDispersionNotesController({
      fetch: cursor => listClientDispersionNotes({ dispersionId, limit: 50, ...(cursor ? { cursor } : {}) }),
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
