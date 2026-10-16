import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getUserRole } from "../../utils/authGuard";

const db = getFirestore();
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const REALTIME_MODEL = "gpt-realtime-2.1";
const REALTIME_VOICE = "cedar";
const REALTIME_SPEED = 1.0;

const clean = (value: unknown, max = 200) => String(value || "").trim().slice(0, max);

export const createHugoRealtimeSession = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB", secrets: [openAiApiKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesion.");

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists || getUserRole(userSnap.data()) !== "superadmin") {
      throw new HttpsError("permission-denied", "Hugo por voz esta disponible solo para superadministracion.");
    }

    const apiKey = clean(openAiApiKey.value(), 500);
    if (!apiKey) throw new HttpsError("failed-precondition", "La voz de Hugo aun no esta configurada.");

    const rootId = clean(userSnap.data()?.rootId || uid, 128);
    const safetyIdentifier = createHash("sha256").update(`${rootId}:${uid}`).digest("hex");
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: [
            "Eres Hugo, el asistente interno de PAY0.",
            "Habla siempre en espanol claro, breve y profesional.",
            "Habla en espanol de Mexico con voz masculina y madura, ritmo medio, pausas naturales y tono confiable, relajado, seguro y conversacional.",
            "Pronuncia PAY0 como pay cero y articula claramente nombres, RFC, siglas, cifras y folios.",
            "Evita entusiasmo artificial, dramatizacion, tono de locutor comercial y elevar sistematicamente la entonacion al final.",
            "Esta sesion de voz es conversacional y de solo consulta.",
            "No afirmes haber consultado datos operativos que no recibiste en esta sesion.",
            "No ejecutes pagos, solicitudes, dispersiones ni cambios en sistemas.",
            "Cuando una solicitud requiera datos de PAY0, una herramienta o razonamiento complejo, llama exactamente una vez a delegate_to_hugo_core y comunica unicamente su resultado.",
          ].join(" "),
          tools: [{
            type: "function",
            name: "delegate_to_hugo_core",
            description: "Delega a Hugo Core una consulta PAY0, accion deterministica autorizada o tarea cognitiva compleja.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                request: { type: "string", description: "Solicitud completa del usuario en espanol." },
                turn_id: { type: "string", description: "Identificador del turno Realtime." },
              },
              required: ["request", "turn_id"],
            },
          }],
          tool_choice: "auto",
          audio: {
            input: {
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: REALTIME_VOICE, speed: REALTIME_SPEED },
          },
        },
      }),
    });

    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.value) {
      console.error("Hugo Realtime session error", {
        status: response.status,
        code: clean(payload?.error?.code, 80) || null,
        type: clean(payload?.error?.type, 80) || null,
      });
      throw new HttpsError("unavailable", "No se pudo iniciar la voz de Hugo.");
    }

    return { ok: true, clientSecret: payload.value as string, expiresAt: payload.expires_at || null, model: REALTIME_MODEL, voice: REALTIME_VOICE, speed: REALTIME_SPEED };
  },
);
