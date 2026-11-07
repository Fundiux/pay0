import test from "node:test";
import assert from "node:assert/strict";
import { isPhantomTranscript, transcriptConfidence, userAskedToEndCall } from "../src/voiceTurnGuards.mjs";

test("hang-up needs an explicit user phrase", () => {
  for (const text of ["cuelga", "Ya es todo, gracias", "termina la llamada", "adiós Hugo", "nada más"]) assert.equal(userAskedToEndCall(text), true, text);
  for (const text of ["", "Exclusión", "dime los pagos de octubre", undefined, null]) assert.equal(userAskedToEndCall(text), false, String(text));
});

test("confidence is the mean token probability", () => {
  assert.equal(transcriptConfidence(undefined), null);
  assert.equal(transcriptConfidence([]), null);
  assert.ok(Math.abs(transcriptConfidence([{ logprob: 0 }, { logprob: Math.log(0.5) }]) - 0.75) < 1e-9);
});

test("empty, fragment and low-confidence transcripts are phantom", () => {
  assert.equal(isPhantomTranscript("", undefined), true);
  assert.equal(isPhantomTranscript(" . ", undefined), true);
  assert.equal(isPhantomTranscript("Exclusión", [{ logprob: Math.log(0.1) }]), true);
  assert.equal(isPhantomTranscript("Hola Hugo", [{ logprob: Math.log(0.9) }, { logprob: Math.log(0.8) }]), false);
  assert.equal(isPhantomTranscript("Hola Hugo", undefined), false);
});
