import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
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
import { canonicalErrorCategory, formatAuthorizedCapabilities, formatLatestSolicitud, formatSystemCatalog, normalizePay0Brand } from "./hugoCore/interactionSemantics";

const clean = (value: unknown, max = 2000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const dataStore = new FirestoreHugoDataStore(db);
const learningStore = new FirestoreHugoLearningStore(db);
const VOICE_PLATFORM_TOOLS = new Set(["getAuthorizedCapabilities", "getSystemCatalog", "countClientsForUser", "countClientsForCurrentUser", "getLatestSolicitud", "searchReceivedPagos", "getPagoById", "getPaymentComplementStatus", "getSessionContext", "getLastOperationDiagnostic"]);

type VoiceDirectTool = "getAuthorizedCapabilities" | "getSystemCatalog" | "countClientsForUser" | "countClientsForCurrentUser" | "getLatestSolicitud" | "searchReceivedPagos" | "getPagoById" | "getPaymentComplementStatus" | "getSessionContext" | "getLastOperationDiagnostic";
const paymentStatusesConciliated = new Set(["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"]);
const money = (value: unknown, currency = "MXN") => Number(value || 0).toLocaleString("es-MX", { style: "currency", currency });
function voiceError(error: unknown) {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : "INTERNAL_ERROR";
  const code = raw.match(/(AUTHORIZATION_DENIED|PERMISSION_DENIED|HUGO_TOOL_NOT_ALLOWED|HUGO_TOOL_UNKNOWN|HUGO_TOOL_INVALID_INPUT|PAY0_PAYMENT_REFERENCE_NOT_FOUND|DEADLINE_EXCEEDED|TIMEOUT|UNAVAILABLE|PAY0_READ_FAILED)/i)?.[1]?.toUpperCase() || "INTERNAL_ERROR";
  const category = canonicalErrorCategory(error);
  return { errorCategory: category, errorCode: code, retryable: ["TIMEOUT", "CONNECTOR_ERROR", "INTERNAL"].includes(category), connectorStatus: ["TIMEOUT", "CONNECTOR_ERROR"].includes(category) ? "UNAVAILABLE" : "HEALTHY" };
}
async function executeReadWithOneRetry(router: HugoToolRouter, request: { name: VoiceDirectTool; input: any }) {
  try { return { result: await router.execute(request), attemptCount: 1 }; }
  catch (error) {
    if (!voiceError(error).retryable) throw error;
    return { result: await router.execute(request), attemptCount: 2 };
  }
}

function formatVoicePlatformResultRaw(tool: string, data: any) {
  if (tool === "countClientsForUser") {
    if (data?.matchStatus === "EXACT") return `${data.user?.displayName || "El usuario"} tiene ${Number(data.clientCount || 0)} clientes activos visibles en PAY0.`;
    if (data?.matchStatus === "CONFIRM_CURRENT_USER") return `¿Te refieres a ${data.suggestedDisplayName || "tu usuario actual"}, tu usuario actual?`;
    if (data?.matchStatus === "AMBIGUOUS") return "Encontré más de un usuario con esa referencia dentro de tu alcance. Necesito que indiques el nombre completo o correo.";
    return "No encontré un usuario visible con ese identificador dentro de tu alcance autorizado.";
  }
  if (tool === "getAuthorizedCapabilities") {
    return formatAuthorizedCapabilities(data);
  }
  if (tool === "getSystemCatalog") {
    return formatSystemCatalog(data);
  }
  if (tool === "countClientsForCurrentUser") return `${Number(data?.clientCount || 0)}.`;
  if (tool === "getLatestSolicitud") return formatLatestSolicitud(data);
  if (tool === "searchReceivedPagos") {
    const rows = Array.isArray(data?.items) ? data.items : [];
    if (!rows.length) return "No hay pagos recibidos que coincidan con esa consulta dentro de tu alcance autorizado.";
    if (rows.length === 1) {
      const row = rows[0];
      return `El pago recibido más reciente es ${row.folio || "sin folio visible"}, por ${money(row.monto, row.moneda)}, de ${row.pagador || "pagador no registrado"}, con estado ${row.estado || "no registrado"}.`;
    }
    return rows.map((row: any, index: number) => `${index + 1}. ${row.folio || "sin folio"}, ${money(row.monto, row.moneda)}, ${row.pagador || "pagador no registrado"}, ${row.estado || "sin estado"}`).join(" ");
  }
  if (tool === "getPagoById") {
    if (!data) return "No encontré ese pago dentro de tu alcance autorizado.";
    const reconciled = paymentStatusesConciliated.has(String(data.estado || "").toUpperCase()) ? "Sí está conciliado" : "No está conciliado";
    return `${data.folio || "El pago"}: ${money(data.monto, data.moneda)}. Pagador: ${data.pagador || "no registrado"}. ${reconciled}; estado ${data.estado || "no registrado"}.`;
  }
  if (tool === "getPaymentComplementStatus") {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return "No encontré un complemento registrado para ese pago.";
    return `El pago tiene ${rows.length} registro${rows.length === 1 ? "" : "s"} de complemento. Estado: ${rows.map((row: any) => row.status || "no registrado").join(", ")}.`;
  }
  if (tool === "getSessionContext") {
    const entity = data?.lastResolvedEntity;
    return entity ? `Seguíamos revisando ${entity.type === "PAYMENT" ? `el pago ${entity.folio || "seleccionado"}` : "una operación"} en ${data.activeSystem || "PAY0"}.` : "No hay una operación reciente pendiente en esta sesión.";
  }
  if (tool === "getLastOperationDiagnostic") {
    if (!data) return "No hay un fallo operativo reciente registrado en esta sesión.";
    if (data.status === "OK") return `La última consulta terminó correctamente mediante ${data.capability || "la capacidad autorizada"}.`;
    if (data.errorCategory === "TIMEOUT") return "La consulta estaba autorizada, pero PAY0 no respondió antes del tiempo límite. Puedes reintentarla.";
    if (data.errorCategory === "PERMISSION_DENIED") return "La capacidad existe, pero esta sesión no está autorizada para esa consulta.";
    if (data.errorCategory === "CAPABILITY_NOT_AVAILABLE") return "Esa operación específica no está disponible en esta sesión; esto no implica que falte un permiso.";
    return `No pude completar la consulta porque ${data.connectorStatus === "UNAVAILABLE" ? "el conector de PAY0 no estuvo disponible" : "ocurrió un error interno"}${data.retryable ? ". Puedes reintentarla" : ""}.`;
  }
  throw Error("HUGO_VOICE_TOOL_UNSUPPORTED");
}

export function formatVoicePlatformResult(tool: string, data: any) {
  return normalizePay0Brand(formatVoicePlatformResultRaw(tool, data));
}

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
    const requestedTool = clean(request.data?.toolName, 80);
    const directTool = VOICE_PLATFORM_TOOLS.has(requestedTool) ? requestedTool as VoiceDirectTool : null;
    const sessionId = clean(request.data?.sessionId, 180), turnId = clean(request.data?.turnId, 180);
    const responseId = clean(request.data?.responseId, 180), delegationId = clean(request.data?.delegationId, 180);
    const toolCallId = clean(request.data?.toolCallId || delegationId, 180);
    if (!message || !sessionId || !turnId || !delegationId) throw new HttpsError("invalid-argument", "Delegacion de voz incompleta.");
    if (requestedTool && !directTool) throw new HttpsError("invalid-argument", "Herramienta de voz no permitida.");
    const classified = classifyVoiceRoute(message);
    const { profile, signals } = classified, route = directTool ? "DETERMINISTIC_TOOL" : classified.route;
    if (route === "ECONOMIC_VOICE") return { ok: true, delegationId, route, text: "Puedo responder este turno directamente en la sesion de voz.", cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 } };

    const identity = { uid, rootId, role: "superadmin" as const };
    const safeUserRef = createHash("sha256").update(`${rootId}:${uid}`).digest("hex").slice(0, 20);
    const pay0 = new Pay0Connector(db, identity);
    const platform = new PlatformReadConnector(db, request.auth, user, identity);
    const router = new HugoToolRouter(identity, {
      getSolicitud: ({ folio }) => pay0.getSolicitud(folio), searchSolicitudes: ({ limit }) => pay0.searchSolicitudes(limit), getLatestSolicitud: () => pay0.getLatestSolicitud(),
      getPago: ({ folio }) => pay0.getPago(folio), searchPagos: ({ limit }) => pay0.searchPagos(limit),
      searchReceivedPagos: ({ limit, beforePaymentId }) => pay0.searchReceivedPagos({ limit, beforePaymentId }), getPagoById: ({ paymentId }) => pay0.getPagoById(paymentId),
      getPaymentComplementStatus: ({ folio }) => pay0.getPaymentComplementStatus(folio),
      getPay0OperationalSummary: () => pay0.getPay0OperationalSummary(), getIqCapabilities: () => pay0.getIqCapabilities(),
      getAuthorizedCapabilities: () => platform.getAuthorizedCapabilities(), getSystemCatalog: () => platform.getSystemCatalog(),
      countClientsForUser: ({ query }) => platform.countClientsForUser(query),
      countClientsForCurrentUser: () => platform.countClientsForCurrentUser(), getSessionContext: () => platform.getSessionContext(),
      getLastOperationDiagnostic: () => platform.getLastOperationDiagnostic(),
    });
    if (directTool) {
      const toolInput: any = request.data?.toolInput && typeof request.data.toolInput === "object" ? { ...request.data.toolInput } : {};
      const started = Date.now();
      if (directTool === "searchReceivedPagos" && toolInput.position === "PREVIOUS" && !toolInput.beforePaymentId) {
        const prior = await platform.getSessionContext();
        toolInput.beforePaymentId = prior.data?.lastResolvedEntity?.type === "PAYMENT" ? prior.data.lastResolvedEntity.safeId : undefined;
        if (!toolInput.beforePaymentId) throw new HttpsError("failed-precondition", "No hay un pago anterior inequívoco en el contexto reciente.");
      }
      const intent = directTool === "searchReceivedPagos" ? (toolInput.position === "PREVIOUS" ? "PREVIOUS_RECEIVED_PAYMENT" : Number(toolInput.limit || 1) > 1 ? "LIST_RECEIVED_PAYMENTS" : "LATEST_RECEIVED_PAYMENT") : directTool;
      delete toolInput.position;
      try {
        const { result, attemptCount } = await executeReadWithOneRetry(router, { name: directTool, input: toolInput });
        const payment = directTool === "searchReceivedPagos" ? result.data?.items?.[0] : directTool === "getPagoById" ? result.data : null;
        const diagnostic = { conversationId: `${rootId}_${uid}_global`, sessionId, safeUserRef, system: "PAY0", intent, requestedOperation: intent, selectedCapability: directTool, capability: directTool, status: "OK", errorCategory: null, errorCode: null, retryable: false, authorization: "ALLOWED", connectorStatus: "HEALTHY", scope: "CURRENT_AUTHORIZED_ROOT", fallbackUsed: false, attemptCount, latencyMs: Date.now() - started, resultCount: Array.isArray(result.data?.items) ? result.data.items.length : result.data == null ? 0 : 1, timestamp: new Date().toISOString() };
        await dataStore.saveVoiceOperationalState({ rootId, uid, ...(payment ? { resumeContext: { activeSystem: "PAY0", activeIntent: intent, language: "es-MX", lastResolvedEntity: { system: "PAY0", type: "PAYMENT", safeId: payment.id, folio: payment.folio || null, operation: intent }, updatedAt: new Date().toISOString() } } : {}), diagnostic });
      const ledger = { rootId, ownerUid: uid, sessionId, turnId, responseId: responseId || null, delegationId, toolCallId, route,
        voiceCostUsd: null, delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0,
        provider: null, model: null, tokenUsage: null, latencyMs: Date.now() - started,
        authorization: { role: identity.role, rootId }, tool: directTool, sourceSystem: result.sourceSystem, sourceTrace: result.trace,
        createdAt: FieldValue.serverTimestamp() };
      await db.collection("agent007CostLedger").doc(`${sessionId}_${delegationId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 500)).set(ledger, { merge: true });
      return { ok: true, delegationId, route, tool: directTool, sourceSystem: result.sourceSystem, sourceTrace: result.trace,
        text: formatVoicePlatformResult(directTool, result.data), cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 }, usage: null };
      } catch (error) {
        const safe = voiceError(error);
        await dataStore.saveVoiceOperationalState({ rootId, uid, diagnostic: { conversationId: `${rootId}_${uid}_global`, sessionId, safeUserRef, system: "PAY0", intent, requestedOperation: intent, selectedCapability: directTool, capability: directTool, status: "ERROR", ...safe, authorization: safe.errorCategory === "PERMISSION_DENIED" ? "DENIED" : "ALLOWED", scope: "CURRENT_AUTHORIZED_ROOT", fallbackUsed: false, attemptCount: 1, latencyMs: Date.now() - started, resultCount: 0, timestamp: new Date().toISOString() } }).catch(() => undefined);
        throw error;
      }
    }
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
