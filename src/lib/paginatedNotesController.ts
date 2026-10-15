export type VersionedNote = { id: string; updateSeconds: number; updateNanoseconds: number };
export type NoteDisplayDate = { kind: "NONE" } | { kind: "TIMESTAMP"; seconds: number; nanoseconds: number } | { kind: "SECONDS" | "MILLISECONDS"; value: number } | { kind: "STRING"; value: string };
export type NotesPage<N, C> = { items: N[]; nextCursor: C | null };
export type NotesState<N> = { notes: N[]; headNotes: N[]; retainedNotes: N[]; loading: boolean; canLoadOlder: boolean; error: string; hasMore: boolean; refreshPending: boolean; headObservedAt: number | null; windowObservedAt: number | null };
export const emptyNotesState = <N>(): NotesState<N> => ({ notes: [], headNotes: [], retainedNotes: [], loading: false, canLoadOlder: false, error: "", hasMore: false, refreshPending: false, headObservedAt: null, windowObservedAt: null });
export function noteDisplayDateToDate(value: NoteDisplayDate): Date | null {
  if (!value || value.kind === "NONE") return null;
  const operand = value.kind === "TIMESTAMP" ? value.seconds * 1000 + value.nanoseconds / 1e6 : value.kind === "SECONDS" ? value.value * 1000 : value.value;
  const date = new Date(operand);
  return Number.isFinite(date.getTime()) ? date : null;
}
export type NotesDependencies<N, C> = {
  fetch: (cursor?: C, limit?: number) => Promise<NotesPage<N, C>>;
  emit: (state: NotesState<N>) => void;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
  visible: () => boolean;
  now?: () => number;
  terminalError?: (error: unknown) => string | null;
};

/** Scope-local controller. Native server order only; no display-date comparator. */
export function createPaginatedNotesController<N extends VersionedNote, C>(deps: NotesDependencies<N, C>) {
  type State = NotesState<N>;
  type Epoch = { rows: N[]; cursor: C | null; target: number };
  const empty = () => emptyNotesState<N>();
  let terminal = false;
  let live = true, busy = false, pendingRefresh = false, olderQueued = false, failures = 0, denied = false;
  let generation = 0, stagingGeneration = 0, desiredDepth = 50, activeOlder = false;
  let state = empty(), timer: unknown, historical: C | null = null;
  let published: N[] = [], head: N[] = [], epoch: Epoch | null = null;
  const now = deps.now || Date.now;
  function emit(patch: Partial<State> = {}) {
    const ids = new Set(head.map(row => row.id));
    const retainedNotes = published.filter(row => !ids.has(row.id));
    state = { ...state, headNotes: head, retainedNotes, notes: [...head, ...retainedNotes], hasMore: !!historical, canLoadOlder: live && !denied && !!historical && !olderQueued && !activeOlder, refreshPending: !!epoch, ...patch };
    deps.emit(state);
  }
  function reuse(items: N[]) {
    const known = new Map([...published, ...head, ...(epoch?.rows || [])].map(row => [row.id, row]));
    return items.map(row => { const prior = known.get(row.id); return prior && prior.updateSeconds === row.updateSeconds && prior.updateNanoseconds === row.updateNanoseconds ? prior : row; });
  }
  function complete() {
    if (!epoch || (epoch.rows.length < epoch.target && epoch.cursor)) return;
    published = epoch.rows; historical = epoch.cursor; epoch = null;
    state.windowObservedAt = now();
  }
  function schedule() {
    deps.clearTimer(timer);
    if (live && !denied && deps.visible()) timer = deps.setTimer(() => { void run(false); }, Math.min(60000, 5000 * 2 ** failures));
  }
  async function page(kind: "head" | "sweep" | "older", scope: number) {
    const stage = stagingGeneration;
    const cursor = kind === "head" ? undefined : kind === "older" ? historical || undefined : epoch?.cursor || undefined;
    const limit = kind === "sweep" && epoch ? Math.min(50, epoch.target - epoch.rows.length) : 50;
    const result = await deps.fetch(cursor, limit);
    if (!live || generation !== scope || stage !== stagingGeneration) return false;
    if (!Array.isArray(result.items) || result.items.length > limit || new Set(result.items.map(row => row.id)).size !== result.items.length || (!result.items.length && result.nextCursor)) throw { code: "failed-precondition" };
    const items = reuse(result.items);
    if (kind === "head") {
      head = items; state.headObservedAt = now();
      // Publish the initial byte-sized prefix and its real cursor immediately.
      if (!published.length && state.windowObservedAt === null) { published = [...items]; historical = result.nextCursor; }
      if (!epoch) epoch = { rows: [...items], cursor: result.nextCursor, target: desiredDepth };
    } else if (kind === "older") {
      const known = new Set(published.map(row => row.id));
      published = [...published, ...items.filter(row => !known.has(row.id))];
      historical = result.nextCursor; desiredDepth = Math.max(desiredDepth, published.length);
      epoch = null; stagingGeneration++; pendingRefresh = true;
    } else if (epoch) {
      const known = new Set(epoch.rows.map(row => row.id));
      if (items.some(row => known.has(row.id))) throw { code: "failed-precondition" };
      epoch.rows.push(...items); epoch.cursor = result.nextCursor;
    }
    complete(); emit(); return true;
  }
  async function run(older: boolean) {
    if (!live || !deps.visible()) return;
    if (busy) { if (!older) pendingRefresh = true; return; }
    if (older && !historical) return;
    busy = true; activeOlder = older; const scope = generation; const stage = stagingGeneration;
    deps.clearTimer(timer); emit({ loading: true, error: "" });
    try {
      const accepted = await page(older ? "older" : "head", scope);
      // One cycle: head, at most one continuation, then five seconds AFTER completion.
      if (accepted && !older && epoch && !olderQueued && deps.visible()) await page("sweep", scope);
      if (!live || generation !== scope) return;
      failures = 0; denied = false; emit({ loading: false });
    } catch (error: any) {
      if (!live || generation !== scope) return;
      const code = String(error?.code || "").replace(/^functions\//, "");
      const terminalMessage = deps.terminalError?.(error) || null;
      terminal = terminalMessage !== null;
      denied = terminal || ["permission-denied", "unauthenticated", "not-found"].includes(code);
      if (!denied && stage !== stagingGeneration) return;
      if (denied) { published = []; head = []; epoch = null; historical = null; olderQueued = false; pendingRefresh = false; state.headObservedAt = null; state.windowObservedAt = null; desiredDepth = 50; }
      if (code === "failed-precondition" && !terminal) {
        if (older) desiredDepth = Math.max(desiredDepth, published.length) + 50;
        epoch = null; stagingGeneration++;
      }
      failures = Math.min(failures + 1, 4);
      emit({ loading: false, error: terminalMessage || (denied ? "Ya no tienes acceso a estas notas." : older ? "No se pudieron cargar las notas anteriores. Intenta de nuevo." : "No se pudieron actualizar las notas. Intenta de nuevo."), refreshPending: !denied });
    } finally {
      busy = false; activeOlder = false;
      if (live) emit();
      if (live && !denied && deps.visible() && olderQueued) { olderQueued = false; void run(true); }
      else if (live && !denied && deps.visible() && pendingRefresh) { pendingRefresh = false; void run(false); }
      else schedule();
    }
  }
  return {
    refresh() { terminal = false; denied = false; void run(false); },
    loadOlder() {
      if (!live || denied || !historical || olderQueued || activeOlder) return;
      olderQueued = true; epoch = null; stagingGeneration++; deps.clearTimer(timer); emit();
      if (!busy) { olderQueued = false; void run(true); }
    },
    reloadFromStart() {
      if (!live) return;
      generation++; stagingGeneration++; published = []; head = []; epoch = null; historical = null; olderQueued = false;
      desiredDepth = 50; terminal = false; denied = false; failures = 0; state = empty();
      deps.clearTimer(timer); emit({ loading: true });
      if (busy) pendingRefresh = true; else void run(false);
    },
    visibilityChanged() { deps.clearTimer(timer); if (!terminal && deps.visible()) this.refresh(); },
    stop() { live = false; generation++; pendingRefresh = false; olderQueued = false; deps.clearTimer(timer); published = []; head = []; epoch = null; },
  };
}
