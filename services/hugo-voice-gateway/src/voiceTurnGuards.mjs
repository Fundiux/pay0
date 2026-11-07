// Guards for turns the model should not act on: audio the transcriber barely understood and hang-ups nobody asked for.
const END_CALL_PHRASE = /\b(cuelga|colgar|cuelgue|termina(r|mos)?( la)?( llamada| conversaci[oó]n)?|cierra(r)?( la)?( llamada| conversaci[oó]n)?|adi[oó]s|hasta luego|nos vemos|bye|es todo|eso es todo|nada m[aá]s|ya (es|fue) todo|ya termin[eé]|ya acab[eé])\b/i;
const MIN_PHANTOM_CONFIDENCE = 0.4;

export function userAskedToEndCall(transcript) {
  return typeof transcript === "string" && END_CALL_PHRASE.test(transcript);
}

// Mean token probability from the realtime transcription logprobs; null when the API sent none.
export function transcriptConfidence(logprobs) {
  if (!Array.isArray(logprobs) || !logprobs.length) return null;
  const values = logprobs.map(entry => Number(entry?.logprob)).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + Math.exp(value), 0) / values.length;
}

// Empty, one-word-fragment or low-confidence transcripts usually come from echo or room noise, not from the caller.
export function isPhantomTranscript(transcript, logprobs) {
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return true;
  const confidence = transcriptConfidence(logprobs);
  return confidence !== null && confidence < MIN_PHANTOM_CONFIDENCE;
}
