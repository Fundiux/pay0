export const ELIUT_VOICE_UID = "Ab4z0RttIqXbZFT0NuWsDjBkt6J2";
export const ELIUT_TEAM_VOICE_URL = "https://hosted-fbcfee6---hugo-voice-gateway-canary-o4tesftjlq-uc.a.run.app/voice";

export function selectHugoVoiceGateway(uid, defaultUrl) {
  if (!uid) return null;
  return uid === ELIUT_VOICE_UID ? ELIUT_TEAM_VOICE_URL : defaultUrl || null;
}
