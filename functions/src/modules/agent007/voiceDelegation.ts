import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { Pay0Connector } from "./pay0Connector";
import { HugoToolRouter } from "./hugoCore/toolRouter";
import { HugoConversationCore } from "./hugoCore/conversationCore";
import { HugoModelRouter } from "./hugoModelRouter";
import { FirestoreHugoDataStore } from "./firestoreHugoDataStore";
import { FirestoreHugoLearningStore } from "./firestoreHugoLearningStore";
import { classifyHugoProfile, classifyHugoRoutingSignals } from "./hugoCore/runtimeContract";
import { PlatformReadConnector } from "./platformReadConnector";

const clean = (value: unknown, max = 2000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const dataStore = new FirestoreHugoDataStore(db);
const learningStore = new FirestoreHugoLearningStore(db);

export const authorizeHugoVoiceGatewaySession = onCall(
  { region: "us-central1", timeoutSeconds: 15, memory: "256MiB" },
  async request => {
    const uid = requireAuth(request), user = await getMyUser(uid);
    const role = assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    return { ok: true, uid, rootId: clean(user?.rootId || uid, 128), role };
  },
);

export function classifyVoiceRoute(message: string) {
  const profile = classifyHugoProfile(message), signals = classifyHugoRoutingSignals(message, profile);
  const route = signals.requiredCapabilities.includes("PAY0_READ") && signals.complexity !== "HIGH"
    ? "DETERMINISTIC_TOOL" : signals.complexity === "HIGH" ? "BRAIN_MODEL" : "ECONOMIC_VOICE";
  return { route, profile, signals } as const;
}

export const delegateHugoVoiceTurn = onCall(
  { region: "us-central1", timeoutSeconds: 90, memory: "512MiB" },
  async request => {
    const uid = requireAuth(request), user = await getMyUser(uid);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    const rootId = clean(user?.rootId || uid, 128), message = clean(request.data?.request);
    const sessionId = clean(request.data?.sessionId, 180), turnId = clean(request.data?.turnId, 180);
    const responseId = clean(request.data?.responseId, 180), delegationId = clean(request.data?.delegationId, 180);
    const toolCallId = clean(request.data?.toolCallId || delegationId, 180);
    if (!message || !sessionId || !turnId || !delegationId) throw new HttpsError("invalid-argument", "Delegacion de voz incompleta.");
    const { route, profile, signals } = classifyVoiceRoute(message);
    if (route === "ECONOMIC_VOICE") return { ok: true, delegationId, route, text: "Puedo responder este turno directamente en la sesion de voz.", cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 } };

    const identity = { uid, rootId, role: "superadmin" as const };
    const pay0 = new Pay0Connector(db, identity);
    const platform = new PlatformReadConnector(db, request.auth, user, identity);
    const router = new HugoToolRouter(identity, {
      getSolicitud: ({ folio }) => pay0.getSolicitud(folio), searchSolicitudes: ({ limit }) => pay0.searchSolicitudes(limit),
      getPago: ({ folio }) => pay0.getPago(folio), searchPagos: ({ limit }) => pay0.searchPagos(limit),
      getPaymentComplementStatus: ({ folio }) => pay0.getPaymentComplementStatus(folio),
      getPay0OperationalSummary: () => pay0.getPay0OperationalSummary(), getIqCapabilities: () => pay0.getIqCapabilities(),
      getAuthorizedCapabilities: () => platform.getAuthorizedCapabilities(), getSystemCatalog: () => platform.getSystemCatalog(),
      countClientsForUser: ({ query }) => platform.countClientsForUser(query),
    });
    const started = Date.now(), modelRouter = new HugoModelRouter();
    const result = await new HugoConversationCore(router, route === "BRAIN_MODEL" ? modelRouter : null, dataStore, learningStore).respond({
      channel: "VOICE", conversationId: `${rootId}_${uid}_global`, identity: { ...identity, role: "superadmin" as const }, name: clean(user?.displayName || user?.email || "usuario", 80),
      message, scope: "GLOBAL", profile, routingSignals: signals, promptVersion: "hugo-v2",
      modelCapability: route === "BRAIN_MODEL" ? "STRONG_EXTERNAL" : "FAST_EXTERNAL",
    });
    const usage = result.model?.tokenUsage || null;
    const ledger = { rootId, ownerUid: uid, sessionId, turnId, responseId: responseId || null, delegationId, toolCallId, route,
      voiceCostUsd: null, delegatedModelCostUsd: route === "DETERMINISTIC_TOOL" ? 0 : null, externalToolCostUsd: 0, transcriptionCostUsd: 0,
      provider: result.model?.provider || null, model: result.model?.model || null, tokenUsage: usage, latencyMs: Date.now() - started,
      authorization: { role: identity.role, rootId }, createdAt: FieldValue.serverTimestamp() };
    await db.collection("agent007CostLedger").doc(`${sessionId}_${delegationId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 500)).set(ledger, { merge: true });
    return { ok: true, delegationId, route, text: result.text, cost: { delegatedModelCostUsd: ledger.delegatedModelCostUsd, externalToolCostUsd: 0, transcriptionCostUsd: 0 }, usage };
  },
);
