import { FieldValue } from "firebase-admin/firestore";
import { executeEarningsReportTool } from "./reportConnector";
import { earningsReportRequest, formatEarningsReport, isEarningsReportComparison, isEarningsReportQuestion } from "./hugoCore/reportSemantics";
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
import { persistVoiceConversationCorrection } from "./voiceConversationCorrections";
import { beginVoiceReportTurn, completeVoiceReportTurn, saveVoiceCoreReferenceState } from "./voiceReportContext";
import { classifyHugoProfile, classifyHugoRoutingSignals } from "./hugoCore/runtimeContract";
import { PlatformReadConnector } from "./platformReadConnector";
import { canonicalErrorCategory, formatAuthorizedCapabilities, formatLatestSolicitud, formatSystemCatalog, normalizePay0Brand } from "./hugoCore/interactionSemantics";

const clean = (value: unknown, max = 2000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const dataStore = new FirestoreHugoDataStore(db);
const learningStore = new FirestoreHugoLearningStore(db);
const VOICE_PLATFORM_TOOLS = new Set(["getEarningsByClientReport", "getAuthorizedCapabilities", "getSystemCatalog", "countClientsForUser", "getLatestSolicitudForUser", "getLatestPagoForUser", "countClientsForCurrentUser", "getLatestSolicitud", "searchReceivedPagos", "getPagoById", "getPaymentComplementStatus", "getSessionContext", "getLastOperationDiagnostic"]);

type VoiceDirectTool = "getEarningsByClientReport" | "getAuthorizedCapabilities" | "getSystemCatalog" | "countClientsForUser" | "getLatestSolicitudForUser" | "getLatestPagoForUser" | "countClientsForCurrentUser" | "getLatestSolicitud" | "searchReceivedPagos" | "getPagoById" | "getPaymentComplementStatus" | "getSessionContext" | "getLastOperationDiagnostic";
const paymentStatusesConciliated = new Set(["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"]);
const money = (value: unknown, currency = "MXN") => Number(value || 0).toLocaleString("es-MX", { style: "currency", currency });
const actorRef = (uid: string) => createHash("sha256").update(`hugo-voice:${uid}`).digest("hex").slice(0, 24);
const safeAuditTool = (tool: string) => tool === "VOICE_SESSION" ? tool : VOICE_PLATFORM_TOOLS.has(tool) ? tool : tool ? "UNRECOGNIZED_VOICE_TOOL" : "VOICE_SESSION";
export const safeVoiceSourceTrace = (trace: any) => ({ tool: clean(trace?.tool, 80) || null, sourceSystem: clean(trace?.sourceSystem, 40) || null, latencyMs: Math.max(0, Number(trace?.latencyMs) || 0), completeness: clean(trace?.completeness, 30) || null, result: clean(trace?.result, 30) || null });
async function recordSecurityBlock(uid: string, tool: string, restrictionType: string, reason: string) {
  await db.collection("agent007VoiceSecurityAudit").add({ actorRef: actorRef(uid), restrictionType: clean(restrictionType, 60), tool: safeAuditTool(tool), reason: clean(reason, 80) || "DENIED", channel: "VOICE", sensitiveResourceStored: false, createdAt: FieldValue.serverTimestamp() });
}
async function assertVoiceAuthorized(request: any, user: any, uid: string, tool: string) {
  try { return assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] }); }
  catch (error: any) { await recordSecurityBlock(uid, tool, "CANONICAL_AUTHORIZATION", error?.code === "unauthenticated" ? "UNAUTHENTICATED" : "ROLE_OR_SCOPE_DENIED").catch(() => undefined); throw error; }
}
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
  if (tool === "getEarningsByClientReport") return formatEarningsReport(data);
  if (tool === "countClientsForUser") {
    if (data?.matchStatus === "EXACT") return `${data.user?.displayName || "El usuario"} tiene ${Number(data.clientCount || 0)} clientes activos visibles en PAY0.`;
    if (data?.matchStatus === "CONFIRM_CURRENT_USER") return `¿Te refieres a ${data.suggestedDisplayName || "tu usuario actual"}, tu usuario actual?`;
    if (data?.matchStatus === "AMBIGUOUS") return "Encontré más de un usuario con esa referencia dentro de tu alcance. Necesito que indiques el nombre completo o correo.";
    return "No encontré un usuario visible con ese identificador dentro de tu alcance autorizado.";
  }
  if (tool === "getLatestSolicitudForUser" || tool === "getLatestPagoForUser") {
    if (data?.matchStatus === "AMBIGUOUS") return "Encontré más de un usuario con esa referencia; indica el nombre completo o correo.";
    if (data?.matchStatus !== "EXACT") return "No encontré ese usuario dentro del root PAY0 autorizado; esto no es una denegación de permisos.";
    if (!data.item) return `No encontré ${tool === "getLatestPagoForUser" ? "pagos" : "solicitudes"} creadas por ${data.user?.displayName || "ese usuario"} con ese filtro.`;
    return `La ${tool === "getLatestPagoForUser" ? "operación de pago" : "solicitud"} más reciente de ${data.user?.displayName || "ese usuario"} es ${data.item.folio || "sin folio"}, cliente ${data.item.cliente || "no registrado"}, estado ${data.item.estado || "no registrado"}.`;
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
    const role = await assertVoiceAuthorized(request, user, uid, "VOICE_SESSION");
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
    const requestedTool = clean(request.data?.toolName, 80);
    await assertVoiceAuthorized(request, user, uid, requestedTool);
    const rootId = clean(user?.rootId || uid, 128), message = clean(request.data?.request);
    const directTool = VOICE_PLATFORM_TOOLS.has(requestedTool) ? requestedTool as VoiceDirectTool : null;
    const sessionId = clean(request.data?.sessionId, 180), turnId = clean(request.data?.turnId, 180);
    const responseId = clean(request.data?.responseId, 180), delegationId = clean(request.data?.delegationId, 180);
    const toolCallId = clean(request.data?.toolCallId || delegationId, 180);
    if (!message || !sessionId || !turnId || !delegationId) throw new HttpsError("invalid-argument", "Delegacion de voz incompleta.");
    if (request.data?.recordResponseCorrection === true) {
      if (requestedTool) throw new HttpsError("invalid-argument", "La corrección no puede ejecutar una consulta.");
      const origin = request.data?.responseCorrection || {};
      const correction = await persistVoiceConversationCorrection(db, { uid, rootId, gatewayCallId: sessionId,
        sessionId: origin.sessionId, turnId: origin.turnId, responseId: origin.responseId,
        correctionTurnId: turnId, correction: origin.correction, expectedVersion: origin.expectedVersion });
      return { ok: true, delegationId, route: "SESSION_CORRECTION", ...correction,
        text: "Guardé tu corrección para esta sesión. La usaré como indicación tuya, sin cambiar datos ni permisos.",
        cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 } };
    }
    if (requestedTool && !directTool) { await recordSecurityBlock(uid, requestedTool, "TOOL_ALLOWLIST", "TOOL_NOT_ALLOWED").catch(() => undefined); throw new HttpsError("invalid-argument", "Herramienta de voz no permitida."); }
    const normalizedMessage = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const resetReport = /^(?:hola(?:\s+(?:maria|hugo))?|buenos dias|buenas tardes|buenas noches)[\s!?.]*$/.test(normalizedMessage)
      || /\b(nueva conversacion|empezar de nuevo|cambiando de tema|otro tema)\b/.test(normalizedMessage);
    const reportQuestion = directTool === "getEarningsByClientReport" || isEarningsReportQuestion(message);
    const reportComparison = !directTool && isEarningsReportComparison(message) && !/\b(pagos?|solicitudes?|folios?)\b/.test(normalizedMessage)
      && (reportQuestion || /\b(comparalo|comparala|periodos?|mes|semana|ano|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|\b\d{4}-\d{2}-\d{2}\b/.test(normalizedMessage));
    const reportTurn = await beginVoiceReportTurn(db, { uid, rootId, sessionId }, { reset: resetReport, invalidate: reportQuestion || reportComparison });
    const classified = classifyVoiceRoute(message);
    const { profile, signals } = classified, route = directTool || reportComparison ? "DETERMINISTIC_TOOL" : classified.route;
    if (route === "ECONOMIC_VOICE") return { ok: true, delegationId, route, text: "Puedo responder este turno directamente en la sesion de voz.", cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 } };
    if (reportComparison && !reportTurn.previous && !earningsReportRequest(message)) {
      return { ok: true, delegationId, route, text: "Indica ambos periodos en formato AAAA-MM-DD y, si corresponde, el cliente. No hay un reporte reciente inequívoco de esta sesión para comparar.",
        cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 }, usage: null };
    }

    const identity = { uid, rootId, role: "superadmin" as const };
    const safeUserRef = createHash("sha256").update(`${rootId}:${uid}`).digest("hex").slice(0, 20);
    const pay0 = new Pay0Connector(db, identity);
    const platform = new PlatformReadConnector(db, request.auth, user, identity);
    const router = new HugoToolRouter(identity, {
      getEarningsByClientReport: async input => {
        const result = await executeEarningsReportTool(request, input);
        const saved = await completeVoiceReportTurn(db, reportTurn.ticket, input, result);
        if (!saved.current) throw new HttpsError("failed-precondition", "Esa consulta fue reemplazada por otra más reciente. Usa el último reporte.");
        return result;
      },
      getSolicitud: ({ folio }) => pay0.getSolicitud(folio), searchSolicitudes: ({ limit }) => pay0.searchSolicitudes(limit), getLatestSolicitud: () => pay0.getLatestSolicitud(),
      getPago: ({ folio }) => pay0.getPago(folio), searchPagos: ({ limit }) => pay0.searchPagos(limit),
      searchReceivedPagos: ({ limit, beforePaymentId }) => pay0.searchReceivedPagos({ limit, beforePaymentId }), getPagoById: ({ paymentId }) => pay0.getPagoById(paymentId),
      getPaymentComplementStatus: ({ folio }) => pay0.getPaymentComplementStatus(folio),
      getPay0OperationalSummary: () => pay0.getPay0OperationalSummary(), getIqCapabilities: () => pay0.getIqCapabilities(),
      getAuthorizedCapabilities: () => platform.getAuthorizedCapabilities(), getSystemCatalog: () => platform.getSystemCatalog(),
      countClientsForUser: ({ query }) => platform.countClientsForUser(query),
      getLatestSolicitudForUser: ({ query, period, limit }) => platform.getLatestOperationForUser(query, "SOLICITUD", period, limit),
      getLatestPagoForUser: ({ query, period, limit }) => platform.getLatestOperationForUser(query, "PAGO", period, limit),
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
        authorization: { role: identity.role, rootId }, tool: directTool, sourceSystem: result.sourceSystem, sourceTrace: safeVoiceSourceTrace(result.trace),
        createdAt: FieldValue.serverTimestamp() };
      await db.collection("agent007CostLedger").doc(`${sessionId}_${delegationId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 500)).set(ledger, { merge: true });
      return { ok: true, delegationId, route, tool: directTool, sourceSystem: result.sourceSystem,
        text: formatVoicePlatformResult(directTool, result.data), cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 }, usage: null };
      } catch (error) {
        const safe = voiceError(error);
        if (safe.errorCategory === "PERMISSION_DENIED") await recordSecurityBlock(uid, directTool, "CANONICAL_AUTHORIZATION", "TOOL_SCOPE_DENIED").catch(() => undefined);
        await dataStore.saveVoiceOperationalState({ rootId, uid, diagnostic: { conversationId: `${rootId}_${uid}_global`, sessionId, safeUserRef, system: "PAY0", intent, requestedOperation: intent, selectedCapability: directTool, capability: directTool, status: "ERROR", ...safe, authorization: safe.errorCategory === "PERMISSION_DENIED" ? "DENIED" : "ALLOWED", scope: "CURRENT_AUTHORIZED_ROOT", fallbackUsed: false, attemptCount: 1, latencyMs: Date.now() - started, resultCount: 0, timestamp: new Date().toISOString() } }).catch(() => undefined);
        throw error;
      }
    }
    const priorReport = reportComparison ? reportTurn.previous : null;
    if (priorReport) {
      // Re-query the canonical handler before injecting old filters. This also
      // rechecks present report/client access; no prior result is used as a fact.
      const current = await executeEarningsReportTool(request, priorReport.query);
      if (["AMBIGUOUS", "NOT_FOUND"].includes(current.data?.clientResolution?.status)) {
        return { ok: true, delegationId, route, text: "Confirma el cliente y ambos periodos antes de comparar; el contexto anterior ya no identifica un reporte autorizado inequívoco.",
          cost: { delegatedModelCostUsd: 0, externalToolCostUsd: 0, transcriptionCostUsd: 0 }, usage: null };
      }
    }
    const scopedStore = Object.create(dataStore) as FirestoreHugoDataStore;
    scopedStore.loadConversationState = async (actor, conversationId) => {
      const state = await dataStore.loadConversationState(actor, conversationId);
      const cleanState: any = { ...(reportTurn.referenceState || state.conversationState) };
      // Chat and another voice socket are not an authority for this RTC's report.
      delete cleanState.lastEarningsReport; delete cleanState.pendingEarningsReport;
      if (priorReport) cleanState.lastEarningsReport = { rootId, query: priorReport.query,
        resolvedAt: priorReport.resolvedAt, resolvedTurn: cleanState.turn };
      return { ...state, conversationState: cleanState };
    };
    scopedStore.saveTurn = async input => {
      if (input.conversationState) {
        const saved = await saveVoiceCoreReferenceState(db, reportTurn.ticket, input.conversationState, reportQuestion || reportComparison);
        if (!saved.current) throw new HttpsError("failed-precondition", "Esa consulta fue reemplazada por otra más reciente. Usa el último reporte.");
      }
      // The shared Store may replace this whole map. Its TEXT report fields are
      // preserved by the authorized leaf/CAS write above, not a stale merge.
      const { conversationState: _voiceState, ...safe } = input;
      return dataStore.saveTurn(safe);
    };
    const started = Date.now(), modelRouter = new HugoModelRouter();
    const result = await new HugoConversationCore(router, route === "BRAIN_MODEL" ? modelRouter : null, scopedStore, learningStore).respond({
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
