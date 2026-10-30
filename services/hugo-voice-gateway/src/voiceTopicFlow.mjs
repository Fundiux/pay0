import { validateVoiceTopicChallenge, validateVoiceTopicDurable, validateVoiceTopicSelection } from "./voiceTopicReceipts.mjs";

const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const normalize = value => value.trim().replace(/\s+/g, " ").normalize("NFC").toLocaleLowerCase("es-MX");
const labelFrom = (text, prefix) => {
  const match = typeof text === "string" ? text.trim().match(new RegExp(`^${prefix}:\\s*(.+)$`, "iu")) : null;
  const label = match?.[1]?.trim().replace(/\s+/g, " ").normalize("NFC");
  if (!label || label.length > 80 || /[\x00-\x1f]/.test(label)) throw Error("VOICE_TOPIC_DECLARATION_REQUIRED");
  return label;
};

/** Per socket only. Native transcripts are user statements, never independent audio/financial facts. */
export function createVoiceTopicFlow({ saveHistory, callable, reviewMemory, isCurrent = () => true, model, voice, gateway = null }) {
  const users = new Map(), responses = new Map();
  let sessionCorrection = null, pending = null, durable = null, busy = false;
  const bounded = (map, key, value) => { map.set(key, value); while (map.size > 32) map.delete(map.keys().next().value); };
  const current = signal => { if (signal?.aborted || !isCurrent()) throw Error("VOICE_TOPIC_SESSION_ENDED"); };
  const user = turnId => { const row = users.get(turnId); if (!id(turnId) || !row) throw Error("VOICE_TOPIC_DECLARATION_REQUIRED"); return row; };
  async function persist(context, turns) {
    current(context.signal);
    if (typeof saveHistory !== "function" || !id(context.nativeSessionId) || !id(context.gatewayCallId)) throw Error("VOICE_TOPIC_HISTORY_UNAVAILABLE");
    const receipt = await saveHistory(context.token, { sessionId: context.nativeSessionId, gatewayCallId: context.gatewayCallId,
      appendOnly: true, turns }, context.signal);
    current(context.signal);
    if (receipt?.ok !== true || receipt.appendOnly !== true || receipt.appended !== turns.length) throw Error("VOICE_TOPIC_HISTORY_UNAVAILABLE");
  }
  function payload(context, data) {
    return { request: "Procesar una declaración privada de tema de voz.", ...data, sessionId: context.gatewayCallId,
      turnId: context.turnId, delegationId: context.delegationId, toolCallId: context.toolCallId };
  }
  function domain(context, result, selection = false) {
    if (result?.ok !== true || result.delegationId !== context.delegationId || result.route !== (selection ? "VOICE_TOPIC_SELECTION" : "VOICE_TOPIC_CONFIRMATION"))
      throw Error("VOICE_TOPIC_RECEIPT_INVALID");
    return selection ? { scope: result.scope, selected: result.selected, topic: result.topic }
      : result.state === "PENDING" ? { state: result.state, challengeId: result.challengeId, durablePersisted: result.durablePersisted, confirmationText: result.confirmationText }
      : { state: result.state, challengeId: result.challengeId, durablePersisted: result.durablePersisted,
        transcriptAuthority: result.transcriptAuthority, correction: result.correction, topic: result.topic, created: result.created };
  }
  return Object.freeze({
    observeUser({ turnId, transcript }) {
      if (id(turnId) && typeof transcript === "string" && transcript.trim() && transcript.length <= 2000)
        bounded(users, turnId, { turnId, speaker: "USER", text: transcript.trim(), timestampMs: Date.now(), status: "COMPLETED", transcriptionStatus: "REALTIME_NATIVE", interrupted: false });
    },
    observeAssistant({ turnId, responseId, transcript, completed }) {
      if (!id(turnId) || !id(responseId)) return;
      const previous = responses.get(responseId);
      if (previous && previous.turnId !== turnId) return;
      bounded(responses, responseId, { turnId, responseId, speaker: "HUGO", text: (typeof transcript === "string" ? transcript.trim() : "") || previous?.text || "",
        timestampMs: previous?.timestampMs || Date.now(), status: completed === true ? "COMPLETED" : previous?.status || "PENDING", transcriptionStatus: "REALTIME_NATIVE", interrupted: false });
    },
    async persistSessionCorrection(origin, context) {
      const source = responses.get(origin.responseId), correction = user(origin.correctionTurnId);
      if (!source || source.turnId !== origin.turnId || source.status !== "COMPLETED" || !source.text || correction.text !== origin.correction)
        throw Error("VOICE_TOPIC_HISTORY_UNAVAILABLE");
      await persist({ ...context, nativeSessionId: origin.sessionId }, [source, correction]);
    },
    acknowledgeSession(origin, result) {
      // The existing SESSION validator must also run; do not accept an uncommitted/version-swapped correction.
      if (result?.persisted !== true || result.scope !== "SESSION" || result.version !== origin.expectedVersion + 1 ||
          result.correction?.content !== origin.correction || result.sessionId !== origin.sessionId || result.responseId !== origin.responseId ||
          result.turnId !== origin.turnId || result.correctionTurnId !== origin.correctionTurnId) throw Error("VOICE_CORRECTION_NOT_PERSISTED");
      sessionCorrection = Object.freeze({ ...origin, expectedVersion: result.version }); pending = null;
    },
    async persistCurrent(context) {
      await persist(context, users.has(context.turnId) ? [user(context.turnId)] : []);
    },
    async execute(action, context) {
      current(context.signal);
      if (busy) throw Error("VOICE_TOPIC_BUSY");
      busy = true;
      try {
        const declaration = user(context.turnId);
        if (action === "REQUEST") {
          if (!sessionCorrection || sessionCorrection.sessionId !== context.nativeSessionId || context.turnId === sessionCorrection.correctionTurnId)
            throw Error("VOICE_TOPIC_SESSION_CORRECTION_REQUIRED");
          const label = labelFrom(declaration.text, "Recuerda esta indicación para el tema");
          await persist(context, [declaration]);
          const origin = { ...sessionCorrection, label };
          const result = await callable(context.token, payload(context, { requestVoiceTopicConfirmation: true, voiceTopicConfirmation: origin }), context.signal);
          current(context.signal);
          const receipt = validateVoiceTopicChallenge({ label: origin.label, correction: origin.correction, expectedVersion: origin.expectedVersion }, domain(context, result));
          pending = Object.freeze({ ...origin, ...receipt });
          return { route: "VOICE_TOPIC_CONFIRMATION", text: receipt.confirmationText, durablePersisted: false };
        }
        if (action === "CONFIRM") {
          if (!pending || pending.sessionId !== context.nativeSessionId || context.turnId === pending.correctionTurnId ||
              normalize(declaration.text) !== normalize(pending.confirmationText)) throw Error("VOICE_TOPIC_DECLARATION_REQUIRED");
          await persist(context, [declaration]);
          const result = await callable(context.token, payload(context, { confirmVoiceTopic: true,
            voiceTopicConfirmation: { sessionId: context.nativeSessionId, challengeId: pending.challengeId } }), context.signal);
          current(context.signal);
          const receipt = validateVoiceTopicDurable({ challengeId: pending.challengeId, label: pending.label,
            correction: pending.correction, expectedVersion: pending.expectedVersion }, domain(context, result));
          durable = Object.freeze({ ...receipt, label: pending.label });
          // Keep the same challenge for reconciliation if the caller repeats this confirmed turn.
          return { route: "VOICE_TOPIC_DURABLE", text: receipt.confirmation, durablePersisted: true,
            userCorrection: { authority: "USER_STATEMENT_NOT_FACT", scope: "USER_TOPIC", content: pending.correction } };
        }
        if (action === "SELECT" || action === "CLEAR") {
          const clear = action === "CLEAR", label = clear ? undefined : labelFrom(declaration.text, "Usa el tema");
          if (clear && normalize(declaration.text) !== "quita el tema activo") throw Error("VOICE_TOPIC_DECLARATION_REQUIRED");
          await persist(context, [declaration]);
          const result = await callable(context.token, payload(context, { selectVoiceTopic: true,
            voiceTopicConfirmation: { sessionId: context.nativeSessionId, ...(clear ? { clear: true } : { label }) } }), context.signal);
          current(context.signal);
          const receipt = validateVoiceTopicSelection(clear ? { clear: true } : { label, clear: false }, domain(context, result, true));
          return { route: "VOICE_TOPIC_SELECTION", text: receipt.selected ? "Seleccioné tu tema privado para esta sesión." : "Quité el tema activo de esta sesión.", selected: receipt.selected };
        }
        if (action === "RETIRE") {
          if (!durable || typeof reviewMemory !== "function" || normalize(declaration.text) !== normalize(`Retira la indicación del tema: ${durable.label}`))
            throw Error("VOICE_TOPIC_DECLARATION_REQUIRED");
          await persist(context, [declaration]);
          const result = await reviewMemory(context.token, { memoryId: durable.memoryId, decision: "REJECT" }, context.signal);
          current(context.signal);
          const receipt = result?.retirement;
          if (result?.ok !== true || receipt?.memoryId !== durable.memoryId || receipt.status !== "REJECTED" || receipt.scope !== "USER_TOPIC") throw Error("VOICE_TOPIC_RECEIPT_INVALID");
          durable = null; pending = null;
          return { route: "VOICE_TOPIC_RETIREMENT", text: "Retiré esa indicación privada. Ya no la usaré para ese tema.", retired: true };
        }
        throw Error("VOICE_TOPIC_DECLARATION_REQUIRED");
      } finally { busy = false; }
    },
    clear() { users.clear(); responses.clear(); sessionCorrection = null; pending = null; durable = null; },
  });
}
