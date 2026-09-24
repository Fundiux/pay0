export class ToolCallRegistry {
  #calls = new Map();
  begin(id, turnId) {
    if (this.#calls.has(id)) return { accepted: false, state: this.#calls.get(id) };
    const state = { id, turnId, status: "PENDING", irreversible: false };
    this.#calls.set(id, state); return { accepted: true, state };
  }
  running(id) { const state = this.#calls.get(id); if (state?.status === "PENDING") state.status = "RUNNING"; return state; }
  complete(id, irreversible = false) { const state = this.#calls.get(id); if (state) { state.status = "COMPLETED"; state.irreversible = irreversible; } return state; }
  fail(id) { const state = this.#calls.get(id); if (state && state.status !== "COMPLETED") state.status = "FAILED"; return state; }
  interrupt(turnId) {
    const cancelled = [], retained = [];
    for (const state of this.#calls.values()) if (state.turnId === turnId) {
      if (state.status === "PENDING") { state.status = "CANCELLED"; cancelled.push(state.id); }
      else retained.push({ id: state.id, status: state.status, irreversible: state.irreversible });
    }
    return { cancelled, retained };
  }
  canDeliver(id) { const state = this.#calls.get(id); return state?.status === "RUNNING" || state?.status === "COMPLETED"; }
}
