// Per-socket user feedback. This never establishes facts, permissions or global rules.
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const text = value => typeof value === "string" ? value.trim() : "";

export function createVoiceSessionCorrection() {
  const responses = new Map(), transcripts = new Map();
  const versions = new Map();
  let latestCompleted = null;
  const boundedSet = (map, key, value) => {
    map.set(key, value);
    while (map.size > 32) map.delete(map.keys().next().value);
  };
  return Object.freeze({
    observeAssistant({ turnId, responseId, transcript, completed }) {
      if (!id(turnId) || !id(responseId)) return;
      const previous = responses.get(responseId);
      if (previous && previous.turnId !== turnId) return;
      const value = { turnId, responseId, transcript: text(transcript) || previous?.transcript || "", completed: completed === true || previous?.completed === true };
      boundedSet(responses, responseId, value);
      if (!value.completed && value.transcript) latestCompleted = null;
      if (value.completed && value.transcript && value.transcript.length <= 8000) latestCompleted = value;
    },
    observeUser({ turnId, transcript }) {
      if (id(turnId) && text(transcript) && text(transcript).length <= 2000) boundedSet(transcripts, turnId, text(transcript));
    },
    prepare({ sessionId, turnId }) {
      if (!id(sessionId) || !id(turnId) || !transcripts.has(turnId) || !latestCompleted || !responses.has(latestCompleted.responseId)) throw Error("VOICE_CORRECTION_ORIGIN_UNAVAILABLE");
      if (transcripts.get(turnId).length > 1000) throw Error("VOICE_CORRECTION_TOO_LONG");
      return Object.freeze({ sourceKind: "VOICE", sessionId, turnId: latestCompleted.turnId, responseId: latestCompleted.responseId,
        correctionTurnId: turnId, correction: transcripts.get(turnId), expectedVersion: versions.get(latestCompleted.responseId) || 0 });
    },
    acknowledge(origin, result) {
      if (result?.persisted !== true || result.scope !== "SESSION" || !id(result.correctionId) ||
          result.sessionId !== origin.sessionId || result.turnId !== origin.turnId || result.responseId !== origin.responseId ||
          result.correctionTurnId !== origin.correctionTurnId || result.version !== origin.expectedVersion + 1 ||
          result.correction?.content !== origin.correction) throw Error("VOICE_CORRECTION_NOT_PERSISTED");
      boundedSet(versions, origin.responseId, result.version);
      return Object.freeze({ correctionId: result.correctionId, persisted: true, scope: "SESSION",
        confirmation: "Guardé tu corrección para esta sesión. La usaré como indicación tuya, sin cambiar datos ni permisos." });
    },
    clear() { responses.clear(); transcripts.clear(); versions.clear(); latestCompleted = null; },
  });
}
