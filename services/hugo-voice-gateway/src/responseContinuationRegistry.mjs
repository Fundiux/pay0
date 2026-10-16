export class ResponseContinuationRegistry {
  #responses = new Map();

  #get(responseId) {
    if (!this.#responses.has(responseId)) this.#responses.set(responseId, { expected: null, delivered: new Set(), continued: false });
    return this.#responses.get(responseId);
  }

  observeDone(responseId, toolCallIds) {
    const state = this.#get(responseId);
    state.expected = new Set(toolCallIds);
    return this.#takeIfReady(state);
  }

  outputDelivered(responseId, toolCallId) {
    const state = this.#get(responseId);
    state.delivered.add(toolCallId);
    return this.#takeIfReady(state);
  }

  #takeIfReady(state) {
    if (state.continued || !state.expected || state.expected.size === 0) return false;
    if (![...state.expected].every(id => state.delivered.has(id))) return false;
    state.continued = true;
    return true;
  }
}
