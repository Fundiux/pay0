import test from "node:test";
import assert from "node:assert/strict";
import { ELIUT_TEAM_VOICE_URL, ELIUT_VOICE_UID, selectHugoVoiceGateway } from "../../src/lib/hugoVoiceGateway.mjs";

test("the tagged team gateway is exclusive to Eliut's authenticated identity", () => {
  const defaultUrl = "https://hugo-voice-gateway-canary-o4tesftjlq-uc.a.run.app/voice";
  assert.equal(selectHugoVoiceGateway(ELIUT_VOICE_UID, defaultUrl), ELIUT_TEAM_VOICE_URL);
  assert.equal(selectHugoVoiceGateway("another-user", defaultUrl), defaultUrl);
  assert.equal(selectHugoVoiceGateway(null, defaultUrl), null);
  assert.equal(selectHugoVoiceGateway("", defaultUrl), null);
});
