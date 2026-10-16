import test from "node:test";
import assert from "node:assert/strict";
import { HUGO_VOICE, HUGO_VOICE_INSTRUCTIONS, HUGO_VOICE_SPEED, REALTIME_MODEL, VOICE_AUDITION, VOICE_AUDITION_TEXT } from "../src/voiceConfig.mjs";

test("gateway pins the approved final voice server-side", () => {
  assert.equal(REALTIME_MODEL, "gpt-realtime-2.1");
  assert.equal(HUGO_VOICE, "marin");
  assert.equal(HUGO_VOICE_SPEED, 1.0);
  assert.match(HUGO_VOICE_INSTRUCTIONS, /espanol neutro/);
  assert.match(HUGO_VOICE_INSTRUCTIONS, /PAY0/);
  assert.match(HUGO_VOICE_INSTRUCTIONS, /extremadamente natural, relajada, suave/);
  assert.match(HUGO_VOICE_INSTRUCTIONS, /Conversa directamente con Eliut/);
  assert.match(HUGO_VOICE_INSTRUCTIONS, /respiracion comoda, pequenas pausas naturales/);
  assert.doesNotMatch(HUGO_VOICE_INSTRUCTIONS, /Mexico|mexican/i);
});

test("blind audition has three distinct voices and one identical neutral phrase", () => {
  assert.deepEqual(Object.keys(VOICE_AUDITION), ["A", "B", "C"]);
  assert.equal(new Set(Object.values(VOICE_AUDITION)).size, 3);
  assert.ok(!Object.values(VOICE_AUDITION).includes("marin"));
  assert.equal(VOICE_AUDITION_TEXT, "Buenos dias. Soy Hugo. PAY0 esta operando con normalidad. Dime que necesitas revisar y lo consulto.");
});
