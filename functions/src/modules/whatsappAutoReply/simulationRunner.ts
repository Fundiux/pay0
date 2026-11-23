import * as admin from "firebase-admin";
import { getApp } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { mexicoDayStartMs } from "../documentDelivery/whatsappDeliveryDomain";
import { OWNER_WORKING_HOURS, type RequestLookup, type StatusSubject } from "./domain";
import { mexicoMonthKey } from "./metrics";
import { maskPhrase } from "./lessons";
import type { InboundRow } from "./planner";
import { PLAYBOOK } from "./playbook";
import { buildDraftPrompt, DRAFT_SYSTEM, findSimulationCandidates, guardDraft, SIMULATED_REPLIES, SIMULATION_CONFIGS, SIM_DAILY_CAP_PER_GROUP, SIM_MAX_PER_RUN, simulatedReplyId, type DraftStatus } from "./simulation";
import { statusSubject } from "./domain";

const FieldValue = admin.firestore.FieldValue;
const clean = (value: unknown, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export type DraftModel = (input: { system: string; prompt: string }) => Promise<{ text: string | null; tokens: number; error?: string }>;

/** Vertex Gemini with the same credentials as Hugo's adapter, but with this stage's own tight system prompt. Disabled in emulators. */
export const vertexDraftModel: DraftModel = async ({ system, prompt }) => {
  try {
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) return { text: null, tokens: 0, error: "EMULATOR_DISABLED" };
    const credential: any = getApp().options.credential;
    if (!credential?.getAccessToken) return { text: null, tokens: 0, error: "CREDENTIAL_UNAVAILABLE" };
    const token = await credential.getAccessToken();
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system";
    const response = await fetch(`https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`, {
      method: "POST", headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 400 } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { text: null, tokens: 0, error: `HTTP_${response.status}` };
    const payload: any = await response.json();
    const candidate = payload?.candidates?.[0];
    const text = clean(candidate?.content?.parts?.map((part: any) => part?.text || "").join(" "), 2000);
    const usage = payload?.usageMetadata;
    return { text: text && clean(candidate?.finishReason, 20).toUpperCase() === "STOP" ? text : null, tokens: Number(usage?.totalTokenCount) || 0 };
  } catch (error) { return { text: null, tokens: 0, error: error instanceof Error ? error.name : "ERROR" }; }
};

let activeModel: DraftModel = vertexDraftModel;
/** Test seam: the emulator suite injects a fake model so no provider is ever called. */
export function setSimulationModelForTests(model: DraftModel | null) { activeModel = model ?? vertexDraftModel; }

export const simulationConfigId = (rootId: string) => `${rootId}__hugo`;
export async function readSimulationEnabled(db: Firestore, rootId: string): Promise<boolean> {
  return (await db.doc(`${SIMULATION_CONFIGS}/${simulationConfigId(rootId)}`).get()).get("enabled") === true;
}

export type SimulationContext = {
  db: Firestore;
  rootId: string;
  nowMs: number;
  messages: InboundRow[];
  /** Acting groups with an owner user (the only groups Hugo may ever reply in). */
  ownerByChat: Record<string, string>;
  groupNameByChat: Record<string, string>;
  operatorHashes: ReadonlySet<string>;
  handledIds: ReadonlySet<string>;
  lookupByChat: Record<string, Partial<Record<StatusSubject, RequestLookup>>>;
};

/**
 * Drafts free-text replies for groups with an approved, running playbook and stores them as simulations.
 * Never touches documentDeliveryJobs: a simulated reply is only ever read by the owner.
 */
export async function runReplySimulation(ctx: SimulationContext): Promise<{ stored: number }> {
  const { db, rootId, nowMs } = ctx;
  if (!(await readSimulationEnabled(db, rootId))) return { stored: 0 };

  const approved = await db.collection(PLAYBOOK).where("rootId", "==", rootId).where("status", "==", "APPROVED").limit(200).get();
  const guidanceByChat: Record<string, { ids: string[]; texts: string[] }> = {};
  for (const doc of approved.docs) {
    const chatId = clean(doc.get("chatId"), 200), ends = Number(doc.get("simulationEndsAtMs")) || 0, guidance = clean(doc.get("guidance"), 400);
    if (!chatId || !guidance || ends <= nowMs || !ctx.ownerByChat[chatId]) continue;
    const slot = guidanceByChat[chatId] ||= { ids: [], texts: [] };
    if (slot.ids.length < 3) { slot.ids.push(doc.id); slot.texts.push(guidance); }
  }
  const simulatedChats = new Set(Object.keys(guidanceByChat));
  if (!simulatedChats.size) return { stored: 0 };

  const candidateIds = ctx.messages.filter(row => simulatedChats.has(row.chatId)).map(row => row.id);
  const known = new Set<string>();
  if (candidateIds.length) {
    const docs = await db.getAll(...candidateIds.map(id => db.doc(`${SIMULATED_REPLIES}/${simulatedReplyId(rootId, id)}`)));
    docs.forEach((doc, index) => { if (doc.exists) known.add(candidateIds[index]); });
  }
  const candidates = findSimulationCandidates({ messages: ctx.messages, simulatedChats, operatorHashes: ctx.operatorHashes, handledIds: ctx.handledIds, knownIds: known, nowMs, workingHours: OWNER_WORKING_HOURS });

  const dayKey = String(mexicoDayStartMs(nowMs));
  const usedToday: Record<string, number> = {};
  let stored = 0;
  for (const candidate of candidates) {
    if (stored >= SIM_MAX_PER_RUN) break;
    if (usedToday[candidate.chatId] === undefined) {
      usedToday[candidate.chatId] = (await db.collection(SIMULATED_REPLIES).where("rootId", "==", rootId).where("chatId", "==", candidate.chatId).where("dayKey", "==", dayKey).limit(SIM_DAILY_CAP_PER_GROUP).get()).size;
    }
    if (usedToday[candidate.chatId] >= SIM_DAILY_CAP_PER_GROUP) continue;

    const subject = statusSubject(candidate.body);
    const lookup: RequestLookup = ctx.lookupByChat[candidate.chatId]?.[subject] ?? "UNKNOWN";
    const ref = db.doc(`${SIMULATED_REPLIES}/${simulatedReplyId(rootId, candidate.messageId)}`);
    const group = guidanceByChat[candidate.chatId];
    // The placeholder is created first, so a retry never calls the model twice for the same message.
    const base = {
      rootId, agentId: "hugo", chatId: candidate.chatId, groupName: ctx.groupNameByChat[candidate.chatId] || "", messageId: candidate.messageId, playbookEntryIds: group.ids,
      clientPhrase: maskPhrase(candidate.body), lookup, dayKey, monthKey: mexicoMonthKey(nowMs), sentToClient: false,
    };
    try { await ref.create({ ...base, status: "PENDING", draft: null, usable: false, guardReasons: [], tokens: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }); }
    catch { continue; }
    usedToday[candidate.chatId]++;

    let status: DraftStatus, draft: string | null = null, guardReasons: string[] = [], tokens = 0, rejectedDraft: string | null = null;
    try {
      const output = await activeModel({ system: DRAFT_SYSTEM, prompt: buildDraftPrompt(group.texts, candidate.body, lookup) });
      tokens = output.tokens;
      if (!output.text) status = "MODEL_UNAVAILABLE";
      else {
        const verdict = guardDraft(output.text, lookup);
        if (verdict.ok) { status = "SIMULATED"; draft = clean(output.text, 400); }
        else { status = "REJECTED_BY_GUARD"; guardReasons = verdict.reasons; rejectedDraft = clean(output.text, 400); }
      }
    } catch { status = "MODEL_UNAVAILABLE"; }
    // A rejected draft is kept apart from `draft`, so nothing that failed the guard can ever be read as usable.
    await ref.update({ status, draft, usable: status === "SIMULATED", guardReasons, tokens, ...(rejectedDraft ? { rejectedDraft } : {}), updatedAt: FieldValue.serverTimestamp() });
    stored++;
  }
  return { stored };
}
