import { getApp } from "firebase-admin/app";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { db, getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { reconcileAgent007Recommendations } from "./reconciliation";
import { executeRequestIqComplement, requestedComplementAction } from "./capabilities";

const clean = (value: unknown, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

const conversationIdFor = (rootId: string, uid: string) => `${rootId}_${uid}`;

function timestampMillis(value: any): number {
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function displayName(user: any): string {
  return clean(user?.displayName || user?.name || user?.nombre || user?.firstName || user?.email?.split?.("@")[0] || "", 80) || "usuario";
}

async function recentRows(collection: string, rootId: string, limit = 20) {
  const snap = await db.collection(collection).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as any))
    .sort((a, b) => timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt));
}

function extractFolio(message: string): string | null {
  const match = message.toUpperCase().match(/\b[SP]\d[A-Z0-9]{4,19}\b/);
  return match?.[0] || null;
}

async function operationalContext(rootId: string, message: string) {
  await reconcileAgent007Recommendations(db, rootId);
  const folio = extractFolio(message);
  const byFolio = async (collection: string) => {
    const snap = await db.collection(collection).where("rootId", "==", rootId).where("folio", "==", folio).limit(3).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
  };
  const [solicitudes, pagos, recommendations, rules, complements] = await Promise.all([
    folio ? byFolio("solicitudes") : recentRows("solicitudes", rootId, 40),
    folio ? byFolio("pagos") : recentRows("pagos", rootId, 30),
    recentRows("agent007Recommendations", rootId, 20),
    recentRows("agent007LearnedRules", rootId, 20),
    recentRows("paymentComplementRequests", rootId, 30),
  ]);
  const selectedSolicitudes = folio
    ? solicitudes.filter((row) => clean(row.folio || row.folioIq, 60).toUpperCase() === folio).slice(0, 3)
    : solicitudes.slice(0, 8);
  const selectedPagos = folio
    ? pagos.filter((row) => clean(row.folio || row.folioIq, 60).toUpperCase() === folio).slice(0, 3)
    : pagos.slice(0, 6);
  const complementConfig = (await db.doc(`paymentComplementConfigs/${rootId}`).get()).data();
  return {
    alcanceContexto: "Muestra reciente y búsqueda exacta por folio, no un inventario completo.",
    capacidadesIq: { altaBeneficiario: "NO_CONECTADA", solicitudComplemento: complementConfig?.iqEnabled === true ? "AUTOMATICA_PPD_NUEVAS_CONFIRMADAS_REVISION_19H" : "PAUSADA", complementoFacturama: complementConfig?.facturamaEnabled === true ? "AUTOMATICO_CON_VALIDACION_FISCAL" : "PAUSADO", dispersion: "TRANSFERENCIA_Y_TDC_CON_VALIDACIONES" },
    complementosPendientes: complements.filter(row => row.status !== "VOIDED" && row.status !== "RECEIVED" && (!folio || row.solicitudFolio === folio || row.pagoFolio === folio)).map(row => ({ solicitud: row.solicitudFolio, pago: row.pagoFolio, estado: row.automationStatus || row.status, error: row.automationError || null, proveedor: row.provider, enviadoAlProveedor: row.externalRequestSent === true })),
    folioConsultado: folio,
    solicitudes: selectedSolicitudes.map((row) => ({
      folio: row.folio || null,
      folioIq: row.folioIq || null,
      cliente: row.clientName || row.clienteNombre || row.cliente || null,
      empresa: row.companyName || row.empresaNombre || row.empresa || null,
      monto: Number(row.amount || row.monto || row.total || 0),
      estado: row.status || row.estatus || null,
      factura: row.factura || row.invoiceNumber || null,
      facturamaStatus: row.facturamaStatus || null,
      claveSat: row.satProductCode || row.ocFiscalMetadata?.productCode || null,
      unidadSat: row.satUnitCode || row.ocFiscalMetadata?.unitCode || null,
    })),
    pagos: selectedPagos.map((row) => ({
      folio: row.folio || null,
      folioIq: row.folioIq || null,
      cliente: row.clientName || row.clienteNombre || row.cliente || null,
      monto: Number(row.amount || row.monto || row.total || 0),
      estado: row.status || row.estatus || null,
    })),
    dudasPendientes: recommendations.filter((row) => row.status === "PENDING_REVIEW").slice(0, 8).map((row) => ({
      tipo: row.kind,
      caso: row.caseId,
      propuesta: row.proposal,
      confianza: row.confidence,
    })),
    reglasConfirmadas: rules.filter((row) => Number(row.approvals || 0) > Number(row.rejections || 0)).slice(0, 10).map((row) => ({
      tipo: row.kind,
      regla: row.proposal,
      correccion: row.correction || null,
      aprobaciones: row.approvals || 0,
    })),
  };
}

function fallbackReply(message: string, name: string, context: any): string {
  const normalized = message.toLocaleLowerCase("es-MX");
  if (/^(hola|buen(os|as)?\s+(dias|tardes|noches)|qué tal|que tal)[!.\s]*$/.test(normalized)) {
    return `Hola, ${name}. Estoy atento. Puedo revisar contigo solicitudes, pagos, facturación y las dudas que vaya detectando.`;
  }
  if (context.folioConsultado && context.solicitudes.length) {
    const item = context.solicitudes[0];
    const amount = Number(item.monto || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    return `Revisé ${item.folio}. Está en ${item.estado || "estado no especificado"}, por ${amount}${item.facturamaStatus ? ` y su estado fiscal es ${item.facturamaStatus}` : ""}. Si quieres, dime qué parte revisamos con más detalle.`;
  }
  if (/complement|beneficiari|dispersion|dispersión/.test(normalized)) {
    return `En el contexto reciente veo ${context.complementosPendientes.length} complementos pendientes. Automatización IQ: ${context.capacidadesIq.solicitudComplemento}; Facturama: ${context.capacidadesIq.complementoFacturama}. IQ se revisa a las 19:00 y se avisa tras 10 días sin recibirlo. Registrar un pendiente no significa que el proveedor lo recibió. El alta de beneficiarios en IQ aún no está conectada. No he enviado ninguna operación desde este chat.`;
  }
  if (/qué (pasó|hiciste)|que (paso|hiciste)|resumen|último|ultimo/.test(normalized)) {
    return `Veo ${context.solicitudes.length} solicitudes recientes, ${context.pagos.length} pagos en el contexto actual y ${context.dudasPendientes.length} dudas pendientes. Puedo revisar un folio concreto si me lo indicas.`;
  }
  return `Entendido, ${name}. Guardé tu mensaje en esta conversación. Todavía no tengo evidencia suficiente para afirmarlo como una regla; cuando vea un caso relacionado te lo señalaré para que lo confirmemos.`;
}

async function vertexReply(message: string, name: string, context: any, history: any[]): Promise<string | null> {
  try {
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) return null;
    const credential: any = getApp().options.credential;
    if (!credential?.getAccessToken) return null;
    const token = await credential.getAccessToken();
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system";
    const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
    const system = [
      "Eres Hugo, asistente operativo interno de PAY0.",
      `Conversas exclusivamente con ${name}, superadministrador de su raíz.`,
      "Responde en español natural, cálido y breve. No suenes robótico.",
      "Usa solamente los datos del contexto; si falta evidencia, dilo claramente.",
      "Puedes observar, explicar y proponer. Nunca afirmes haber emitido, pagado, transferido, cancelado o modificado algo.",
      "No solicites contraseñas, CSD, tokens ni secretos. No expongas datos bancarios completos salvo que el usuario los pida expresamente.",
      "Cuando detectes una corrección o enseñanza, explica en una frase qué entendiste y que requiere confirmación antes de convertirse en regla.",
    ].join(" ");
    const historyText = history.slice(-10).map((row) => `${row.role === "assistant" ? "Hugo" : name}: ${clean(row.text, 1200)}`).join("\n");
    const prompt = `${historyText ? `CONVERSACIÓN RECIENTE:\n${historyText}\n\n` : ""}CONTEXTO OPERATIVO DE SOLO LECTURA:\n${JSON.stringify(context)}\n\nMENSAJE DE ${name.toUpperCase()}: ${message}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.45, maxOutputTokens: 500 },
      }),
    });
    if (!response.ok) {
      console.warn("[Hugo] Vertex response", response.status);
      return null;
    }
    const payload: any = await response.json();
    return clean(payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join(" "), 3000) || null;
  } catch (error) {
    console.warn("[Hugo] Vertex unavailable");
    return null;
  }
}

async function actor(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  return { uid, user, rootId: clean(user?.rootId || uid, 128) };
}

export const recordAgent007Observation = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, user, rootId } = await actor(request);
    const caseType = clean(request.data?.caseType, 40).toUpperCase();
    const caseId = clean(request.data?.caseId, 128);
    const intent = clean(request.data?.intent, 500);
    const humanDecision = clean(request.data?.humanDecision, 500);
    const outcome = clean(request.data?.outcome, 500);
    if (!caseType || !caseId || !intent || !humanDecision || !outcome) {
      throw new HttpsError("invalid-argument", "Caso, intención, decisión humana y resultado son obligatorios.");
    }
    const ref = db.collection("agent007Observations").doc();
    await ref.create({
      rootId, agentId: "AGENTE_007", phase: "OBSERVATION", caseType, caseId, intent, humanDecision, outcome,
      actorUid: uid, actorRole: String(getUserRole(user)), authorization: { role: String(getUserRole(user)), scope: "rootId", rootId },
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), expiresAt: null,
    });
    await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: ref.id, referenceType: "agent007Observation", relatedEntityId: caseId, relatedEntityType: caseType, description: `Hugo registró observación supervisada: ${intent}` });
    return { ok: true, observationId: ref.id };
  }
);

export const listAgent007Observations = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    const snapshot = await db.collection("agent007Observations").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(50).get();
    return { ok: true, observations: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
  }
);

export const listAgent007Recommendations = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    await reconcileAgent007Recommendations(db, rootId);
    const snapshot = await db.collection("agent007Recommendations").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(50).get();
    return { ok: true, recommendations: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) };
  },
);

export const resolveAgent007Recommendation = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, user, rootId } = await actor(request);
    const recommendationId = clean(request.data?.recommendationId, 160);
    const decision = clean(request.data?.decision, 16).toUpperCase();
    const correction = clean(request.data?.correction, 500);
    if (!recommendationId || !["APPROVED", "REJECTED"].includes(decision)) throw new HttpsError("invalid-argument", "Recomendacion o decision invalida.");
    const ref = db.collection("agent007Recommendations").doc(recommendationId);
    const snap = await ref.get(); const row: any = snap.data() || {};
    if (!snap.exists || clean(row.rootId, 128) !== rootId) throw new HttpsError("not-found", "Recomendacion no encontrada.");
    if (row.status !== "PENDING_REVIEW") return { ok: true, alreadyResolved: true };
    const ruleRef = db.collection("agent007LearnedRules").doc(`${rootId}_${clean(row.kind, 50)}_${clean(row.proposal, 120)}`.replace(/[^A-Za-z0-9_-]/g, "_"));
    const resolved = await db.runTransaction(async (tx) => {
      const latest = await tx.get(ref);
      if (!latest.exists || latest.data()?.rootId !== rootId) throw new HttpsError("not-found", "Recomendación no encontrada.");
      if (latest.data()?.status !== "PENDING_REVIEW") return false;
      const rule = await tx.get(ruleRef); const current: any = rule.data() || {};
      tx.set(ref, { status: decision, correction: correction || null, resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ruleRef, { rootId, agentId: "AGENTE_007", phase: "SUPERVISED_ASSISTANCE", kind: row.kind, proposal: row.proposal, correction: correction || null, approvals: Number(current.approvals || 0) + (decision === "APPROVED" ? 1 : 0), rejections: Number(current.rejections || 0) + (decision === "REJECTED" ? 1 : 0), lastDecision: decision, updatedAt: FieldValue.serverTimestamp(), createdAt: current.createdAt || FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!resolved) return { ok: true, alreadyResolved: true };
    await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: recommendationId, referenceType: "agent007Recommendation", relatedEntityId: clean(row.caseId, 128), relatedEntityType: clean(row.caseType, 40), description: `Hugo Fase 2: recomendacion ${decision.toLowerCase()}` });
    return { ok: true };
  },
);

export const listAgent007Messages = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, rootId } = await actor(request);
    const conversationId = conversationIdFor(rootId, uid);
    const snapshot = await db.collection("agent007Messages")
      .where("conversationId", "==", conversationId)
      .where("rootId", "==", rootId)
      .orderBy("createdAt", "desc")
      .limit(80)
      .get();
    const messages = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as any))
      .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt))
      .slice(-80);
    return { ok: true, conversationId, messages };
  },
);

export const markAgent007MessagesRead = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, rootId } = await actor(request);
    const conversationId = conversationIdFor(rootId, uid);
    const snapshot = await db.collection("agent007Messages").where("conversationId", "==", conversationId).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(80).get();
    const batch = db.batch();
    const unread = snapshot.docs.filter((doc) => {
      const row = doc.data();
      return row.recipientUid === uid && row.read === false;
    });
    unread.forEach((doc) => batch.set(doc.ref, { read: true, readAt: FieldValue.serverTimestamp() }, { merge: true }));
    if (unread.length) await batch.commit();
    return { ok: true, marked: unread.length };
  },
);

export const sendAgent007Message = onCall(
  { region: "us-central1", timeoutSeconds: 90, memory: "512MiB" },
  async (request) => {
    const { uid, user, rootId } = await actor(request);
    const text = clean(request.data?.text, 2000);
    if (!text) throw new HttpsError("invalid-argument", "Escribe un mensaje para Hugo.");
    const conversationId = conversationIdFor(rootId, uid);
    const conversationRef = db.collection("agent007Conversations").doc(conversationId);
    const messagesRef = db.collection("agent007Messages");
    const prior = await messagesRef.where("conversationId", "==", conversationId).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(12).get();
    const history = prior.docs
      .map((doc) => doc.data() as any)
      .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt))
      .slice(-12);
    const context = await operationalContext(rootId, text);
    const name = displayName(user);
    const capability = requestedComplementAction(text)
      ? await executeRequestIqComplement({ db, rootId, uid, message: text })
      : null;
    const aiReply = capability ? null : await vertexReply(text, name, context, history);
    const reply = capability?.reply || aiReply || fallbackReply(text, name, context);
    const userMessage = messagesRef.doc();
    const assistantMessage = messagesRef.doc();
    const now = Timestamp.now();
    const batch = db.batch();
    batch.set(conversationRef, {
      rootId, ownerUid: uid, participantUids: [uid], status: "ACTIVE",
      lastMessage: reply, lastMessageAt: now, updatedAt: now,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.create(userMessage, {
      rootId, conversationId, role: "user", text, senderUid: uid,
      source: "USER", read: true, createdAt: now,
    });
    batch.create(assistantMessage, {
      rootId, conversationId, role: "assistant", text: reply, recipientUid: uid,
      source: aiReply ? "VERTEX_AI" : "HUGO_ENGINE", read: true,
      capability: capability ? "REQUEST_IQ_PAYMENT_COMPLEMENT" : null,
      capabilityExecuted: capability?.executed === true,
      contextSummary: { folioConsultado: context.folioConsultado, solicitudes: context.solicitudes.length, pagos: context.pagos.length, dudas: context.dudasPendientes.length },
      createdAt: Timestamp.fromMillis(now.toMillis() + 1),
    });
    await batch.commit();
    return { ok: true, conversationId, message: { id: assistantMessage.id, role: "assistant", text: reply, source: aiReply ? "VERTEX_AI" : "HUGO_ENGINE", createdAt: now } };
  },
);
