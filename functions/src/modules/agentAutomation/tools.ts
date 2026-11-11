import * as admin from "firebase-admin";
import { getApp } from "firebase-admin/app";
import { AUTOMATABLE_TOOL_LABEL, keywordTool } from "./domain";
import type { AutomationDeps } from "./service";

const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);

/** Hugo (Gemini) solo puede elegir entre las herramientas del catálogo; cualquier otra respuesta es "ninguna". */
async function askHugo(cause: string, actionText: string): Promise<string | null> {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) return null;
  const credential: any = getApp().options.credential;
  if (!credential?.getAccessToken) return null;
  const token = await credential.getAccessToken();
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system";
  const tools = Object.entries(AUTOMATABLE_TOOL_LABEL).map(([id, label]) => `${id}: ${label}`).join("\n");
  const prompt = `Incidencia: ${cause}\nLo que hizo la persona para resolverla: ${actionText}\n\nHerramientas automáticas disponibles:\n${tools}\n\nResponde SOLO con el identificador de la herramienta que reproduce exactamente lo que hizo la persona, o NINGUNA si ninguna lo reproduce.`;
  const response = await fetch(`https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`, {
    method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 40 } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const answer = text(((await response.json()) as any)?.candidates?.[0]?.content?.parts?.[0]?.text, 80);
  return Object.prototype.hasOwnProperty.call(AUTOMATABLE_TOOL_LABEL, answer) ? answer : null;
}

export function defaultAutomationDeps(): AutomationDeps {
  const db = admin.firestore();
  return {
    // Si el modelo no responde o no reconoce la acción, solo vale el respaldo determinista.
    classify: async ({ cause, actionText }) => (await askHugo(cause, actionText).catch(() => null)) ?? keywordTool(actionText),
    async execute(toolId, { runId, incident }) {
      if (toolId !== "quotation-recovery") throw Error("TOOL_NOT_AUTOMATABLE");
      // Carga perezosa: el módulo de cotizaciones es pesado y solo se necesita al ejecutar.
      const { enqueueQuotationForConfirmedIq } = await import("../cotizaciones/queueCallables");
      const solicitud: any = (await db.collection("solicitudes").doc(text(incident.entityId, 128)).get()).data() || {};
      if (text(solicitud.rootId) !== text(incident.rootId)) throw Error("SCOPE_MISMATCH");
      const requestedBy = text(solicitud.createdBy || solicitud.operationalOwnerId || solicitud.ownerId, 128);
      const iqFolio = text(solicitud.iqFolio || solicitud.iqId, 128);
      if (!requestedBy || !iqFolio) throw Error("SOLICITUD_WITHOUT_IQ_OR_OWNER");
      const queued = await enqueueQuotationForConfirmedIq({ solicitudId: text(incident.entityId, 128), iqFolio, requestedBy, source: "HUGO_RULE", regenerationKey: `hugo-rule-${runId}` });
      return { ref: queued.jobId };
    },
    async verify(toolId, ref) {
      if (toolId !== "quotation-recovery") return "FAILED";
      const status = text((await db.collection("solicitudQuotationJobs").doc(ref).get()).get("status")).toUpperCase();
      return status === "SUCCEEDED" ? "OK" : ["ESCALATED", "BLOCKED"].includes(status) ? "FAILED" : "PENDING";
    },
    now: () => Date.now(),
  };
}
