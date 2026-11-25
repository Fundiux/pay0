import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FieldPath, FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { AGENTS, isCustomerFacingAgent } from "../agentOperations/contract";
import { getMyUser, getRootId, requireAuth } from "../sharedCallables/helpers";
import { assertEnrollmentProof, assertPublicKey, assertWorkerEnvelope, canonicalDataHash, Binding, Enrollment, EnrollmentProof, SENDING_WORKER_ACTIONS, WorkerEnvelope } from "./whatsappConnectorPolicy";
import { WhatsAppDocumentSender, type DocumentSenderOptions } from "./whatsappDeliverySender";
import { DOCUMENT_SENDER_AGENT_ID } from "./whatsappDeliveryDomain";
import { logActivity } from "../../utils/logActivity";

const id = (s: unknown): string => {
  if (typeof s !== "string" || !s || s.length > 180 || /[\/\x00-\x1f]/.test(s)) throw new HttpsError("invalid-argument", "Identidad inválida.");
  return s;
};
function fail(code = "permission-denied"): never { throw new HttpsError(code as any, "El vínculo del conector no está autorizado."); }
/** Vínculo histórico (un solo conector por superadmin). Los vínculos por agente usan el id del agente. */
export const LEGACY_CONNECTOR_AGENT = "pay0";
const RESTART_COMMAND_TTL_MS = 10 * 60 * 1000;
const agentLabel = (agentId: unknown) => AGENTS.find(agent => agent.id === agentId)?.name || String(agentId || "");
const INBOUND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export function connectorAgentOf(value: unknown): string {
  if (value === undefined || value === null || value === "" || value === LEGACY_CONNECTOR_AGENT) return LEGACY_CONNECTOR_AGENT;
  if (typeof value !== "string" || !AGENTS.some(agent => agent.id === value)) throw new HttpsError("invalid-argument", "Agente desconocido.");
  return value;
}
export async function requireWhatsAppSuperadmin(request: any) {
  const uid = requireAuth(request), user = await getMyUser(uid);
  assertAuthorized({ uid }, user, { allowedRoles: ["superadmin"] });
  const rootId = id(await getRootId(uid));
  return { uid, rootId, user };
}
export class WhatsAppConnectorAuthority {
  private readonly sender: WhatsAppDocumentSender;
  constructor(private readonly db: Firestore, senderOptions: DocumentSenderOptions = {}, private readonly audit: (entry: Parameters<typeof logActivity>[0]) => Promise<unknown> = logActivity) {
    this.sender = new WhatsAppDocumentSender(db, senderOptions);
  }
  private owner(rootId: string, uid: string, agentId = LEGACY_CONNECTOR_AGENT) { return this.db.doc(`whatsappQrConnectorOwners/${Buffer.from(JSON.stringify(agentId === LEGACY_CONNECTOR_AGENT ? [rootId, uid] : [rootId, uid, agentId])).toString("base64url")}`); }
  private async actor(tx: any, ownerUid: string, rootId: string) {
    const snap = await tx.get(this.db.doc(`users/${id(ownerUid)}`)), user = snap.data();
    assertAuthorized({ uid: ownerUid }, user, { allowedRoles: ["superadmin"] });
    if (!user || String(user.rootId || ownerUid) !== rootId) fail();
  }
  async create(request: any) {
    const actor = await requireWhatsAppSuperadmin(request), publicKeyPem = request.data?.publicKeyPem, agentId = connectorAgentOf(request.data?.agentId);
    // Only agents that talk to customers get a WhatsApp connection; the legacy owner connection is unaffected.
    if (agentId !== LEGACY_CONNECTOR_AGENT && !isCustomerFacingAgent(agentId)) throw new HttpsError("failed-precondition", "Este agente es interno y no se conecta a WhatsApp.");
    assertPublicKey(publicKeyPem);
    const enrollmentId = randomUUID(), challenge = randomBytes(32).toString("hex");
    return this.db.runTransaction(async tx => {
      await this.actor(tx, actor.uid, actor.rootId);
      const ownerRef = this.owner(actor.rootId, actor.uid, agentId), owner = (await tx.get(ownerRef)).data();
      const previous = owner?.bindingId ? (await tx.get(this.db.doc(`whatsappQrConnectorBindings/${id(owner.bindingId)}`))).data() : null;
      if (previous?.state === "ACTIVE") fail("failed-precondition");
      const now = Date.now();
      const enrollment: Enrollment = { id: enrollmentId, ownerUid: actor.uid, rootId: actor.rootId, publicKeyPem, challenge,
        createdAtMs: now, expiresAtMs: now + 600000, state: "PENDING" };
      if (owner?.pendingId) tx.set(this.db.doc(`whatsappQrConnectorEnrollments/${id(owner.pendingId)}`), { state: "REVOKED" }, { merge: true });
      tx.create(this.db.doc(`whatsappQrConnectorEnrollments/${enrollmentId}`), { ...enrollment, agentId });
      tx.set(ownerRef, { ownerUid: actor.uid, rootId: actor.rootId, agentId, pendingId: enrollmentId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, enrollment, externalAccountVerified: false };
    });
  }
  async consume(proof: EnrollmentProof) {
    id(proof?.enrollmentId);
    return this.db.runTransaction(async tx => {
      const ref = this.db.doc(`whatsappQrConnectorEnrollments/${proof.enrollmentId}`), stored = (await tx.get(ref)).data();
      if (!stored) fail();
      const enrollment: Enrollment = { id: stored.id, ownerUid: stored.ownerUid, rootId: stored.rootId, publicKeyPem: stored.publicKeyPem,
        challenge: stored.challenge, createdAtMs: stored.createdAtMs, expiresAtMs: stored.expiresAtMs, state: stored.state };
      await this.actor(tx, enrollment.ownerUid, enrollment.rootId);
      const agentId = connectorAgentOf(stored.agentId);
      const ownerRef = this.owner(enrollment.rootId, enrollment.ownerUid, agentId), owner = (await tx.get(ownerRef)).data();
      if (enrollment.state === "CONSUMED") {
        // One enrollment creates one binding. An exact originally verified proof
        // can recover its public receipt after a lost response/local disk failure.
        // It never consumes again, changes owner/root/key, or revives a generation.
        if (stored.consumedProofHash !== canonicalDataHash(proof) || owner?.bindingId !== enrollment.id) fail();
        const row = (await tx.get(this.db.doc(`whatsappQrConnectorBindings/${enrollment.id}`))).data();
        if (!row || row.state !== "ACTIVE" || row.generation !== 1 || row.ownerUid !== enrollment.ownerUid || row.rootId !== enrollment.rootId || row.publicKeyPem !== enrollment.publicKeyPem) fail();
        const binding: Binding = { id: row.id, ownerUid: row.ownerUid, rootId: row.rootId, publicKeyPem: row.publicKeyPem, generation: row.generation, state: row.state };
        return { ok: true, binding, externalAccountVerified: false, recoveredReceipt: true };
      }
      if (owner?.pendingId !== enrollment.id) fail();
      assertEnrollmentProof(enrollment, proof, Date.now());
      const binding: Binding = { id: enrollment.id, ownerUid: enrollment.ownerUid, rootId: enrollment.rootId,
        publicKeyPem: enrollment.publicKeyPem, generation: 1, state: "ACTIVE" };
      tx.create(this.db.doc(`whatsappQrConnectorBindings/${binding.id}`), { ...binding, agentId, createdAt: FieldValue.serverTimestamp(), externalAccountVerified: false });
      tx.update(ref, { state: "CONSUMED", consumedProofHash: canonicalDataHash(proof), consumedAt: FieldValue.serverTimestamp() });
      tx.set(ownerRef, { pendingId: null, bindingId: binding.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, binding, externalAccountVerified: false };
    });
  }
  async revoke(request: any) {
    const actor = await requireWhatsAppSuperadmin(request), bindingId = id(request.data?.bindingId);
    return this.db.runTransaction(async tx => {
      await this.actor(tx, actor.uid, actor.rootId);
      const ref = this.db.doc(`whatsappQrConnectorBindings/${bindingId}`), binding = (await tx.get(ref)).data();
      if (!binding || binding.ownerUid !== actor.uid || binding.rootId !== actor.rootId) fail();
      if (binding.state !== "REVOKED") tx.update(ref, { state: "REVOKED", generation: binding.generation + 1, revokedAt: FieldValue.serverTimestamp() });
      return { ok: true, revoked: true };
    });
  }
  async getOwned(request: any) {
    const actor = await requireWhatsAppSuperadmin(request);
    return this.db.runTransaction(async tx => {
      await this.actor(tx, actor.uid, actor.rootId);
      const owner = (await tx.get(this.owner(actor.rootId, actor.uid, connectorAgentOf(request.data?.agentId)))).data();
      const binding = owner?.bindingId ? (await tx.get(this.db.doc(`whatsappQrConnectorBindings/${id(owner.bindingId)}`))).data() : null;
      if (binding && (binding.ownerUid !== actor.uid || binding.rootId !== actor.rootId)) fail();
      return { ok: true, binding: binding ? { id: binding.id, agentId: connectorAgentOf(binding.agentId), rootId: binding.rootId, ownerUid: binding.ownerUid, generation: binding.generation, state: binding.state, externalAccountVerified: false } : null };
    });
  }
  async enqueue(request: any, type: "SYNC_CHATS" | "NEW_QR" | "RESTART") {
    const actor = await requireWhatsAppSuperadmin(request), commandRef = this.db.collection("whatsappQrConnectorCommands").doc();
    const result = await this.db.runTransaction(async tx => {
      await this.actor(tx, actor.uid, actor.rootId);
      const owner = (await tx.get(this.owner(actor.rootId, actor.uid, connectorAgentOf(request.data?.agentId)))).data();
      if (!owner?.bindingId) fail("failed-precondition");
      const binding = (await tx.get(this.db.doc(`whatsappQrConnectorBindings/${id(owner.bindingId)}`))).data();
      if (!binding || binding.state !== "ACTIVE" || binding.ownerUid !== actor.uid || binding.rootId !== actor.rootId) fail();
      // A restart already waiting for the connector is the same restart: pressing the button twice must not restart it twice.
      if (type === "RESTART") {
        const waiting = await tx.get(this.db.collection("whatsappQrConnectorCommands").where("bindingId", "==", binding.id).where("status", "==", "PENDING").limit(5));
        const same = waiting.docs.find((doc: any) => doc.data().type === "RESTART" && doc.data().requestedByUid === actor.uid && doc.data().generation === binding.generation);
        if (same) return { ok: true, commandId: same.id, type, status: "PENDING", duplicate: true, message: "El reinicio ya estaba solicitado; el conector lo hará en unos segundos.", binding };
      }
      tx.create(commandRef, { bindingId: binding.id, generation: binding.generation, connectorId: "default", rootId: actor.rootId,
        requestedByUid: actor.uid, type, status: "PENDING", createdAt: FieldValue.serverTimestamp() });
      tx.set(this.db.doc(`whatsappQrConnectors/${binding.id}`), { bindingId: binding.id, rootId: actor.rootId, ownerUid: actor.uid,
        lastCommandId: commandRef.id, lastCommandType: type, lastCommandStatus: "PENDING", lastCommandMessage: "Solicitud pendiente del conector autorizado.",
        lastCommandAt: FieldValue.serverTimestamp(), lastCommandFinishedAt: null,
        ...(type === "NEW_QR" ? { qrText: null, qrDataUrl: null } : {}) }, { merge: true });
      return { ok: true, commandId: commandRef.id, type, status: "PENDING", message: type === "RESTART" ? "Reinicio solicitado; el conector lo hará en unos segundos y conserva la sesión de WhatsApp." : "Solicitud enviada al conector autorizado.", binding };
    });
    const { binding, ...visible } = result as any;
    if (type === "RESTART" && !visible.duplicate) {
      await this.audit({ event: "WHATSAPP_CONECTOR_REINICIO_SOLICITADO", rootId: actor.rootId, actorUid: actor.uid, actorName: actor.user?.displayName || actor.user?.nombreUsuario || null, actorRole: actor.user?.role || "superadmin",
        referenceId: visible.commandId, referenceType: "whatsappQrConnectorCommand", entityId: binding.id, entityType: "whatsapp_connector",
        description: `Se solicitó reiniciar el conector de WhatsApp de ${connectorAgentOf(binding.agentId) === LEGACY_CONNECTOR_AGENT ? "PAY0" : agentLabel(binding.agentId)}.` }).catch(() => undefined);
    }
    return visible;
  }
  /** Lista todos los vínculos del superadmin (uno por agente) con su estado visible. */
  async listOwned(request: any) {
    const actor = await requireWhatsAppSuperadmin(request);
    const bindings = await this.db.collection("whatsappQrConnectorBindings").where("rootId", "==", actor.rootId).where("ownerUid", "==", actor.uid).limit(50).get();
    const connectors = await Promise.all(bindings.docs.map(doc => this.db.doc(`whatsappQrConnectors/${doc.id}`).get()));
    return { ok: true, connectors: bindings.docs.map((doc, index) => {
      const row = doc.data(), live = connectors[index].data() || {};
      return { bindingId: doc.id, agentId: connectorAgentOf(row.agentId), state: row.state, generation: row.generation,
        status: live.status || null, lastSeenAtMs: live.lastSeenAt?.toMillis?.() || null, qrDataUrl: row.state === "ACTIVE" && live.status === "QR_REQUIRED" ? live.qrDataUrl || null : null, error: live.error || null };
    }) };
  }
  /** Every signed operation revalidates the owner and generation, with nonce consumption in the SAME transaction as writes/command claim. */
  async operate(envelope: WorkerEnvelope, data: any) {
    const bindingId = id(envelope?.bindingId);
    return this.db.runTransaction(async tx => {
      const bindingRef = this.db.doc(`whatsappQrConnectorBindings/${bindingId}`), row = (await tx.get(bindingRef)).data();
      if (!row) fail();
      const binding: Binding = { id: row.id, ownerUid: row.ownerUid, rootId: row.rootId, publicKeyPem: row.publicKeyPem, generation: row.generation, state: row.state };
      await this.actor(tx, binding.ownerUid, binding.rootId);
      assertWorkerEnvelope(binding, envelope, data, Date.now());
      const nonceRef = bindingRef.collection("nonces").doc(`${binding.generation}_${envelope.nonce}`);
      if ((await tx.get(nonceRef)).exists) fail("already-exists");
      let result: any;
      // Sending to clients is reserved to the customer-facing agent Hugo's binding.
      if (SENDING_WORKER_ACTIONS.includes(envelope.action) && connectorAgentOf(row.agentId) !== DOCUMENT_SENDER_AGENT_ID) fail();
      if (envelope.action === "CLAIM_DELIVERY") result = { claim: await this.sender.claimTx(tx, binding, data) };
      else if (envelope.action === "REPORT_DELIVERY") result = await this.sender.reportTx(tx, binding, data);
      else if (envelope.action === "HEARTBEAT") result = await this.heartbeat(tx, binding, data, connectorAgentOf(row.agentId));
      else if (envelope.action === "INBOUND_GROUP") result = await this.inbound(tx, binding, row, data);
      else if (envelope.action === "SYNC_CHATS") result = await this.sync(tx, bindingRef, row, data);
      else if (envelope.action === "RESTART_ACK") result = await this.restartAck(tx, binding, data);
      else result = await this.newQr(tx, binding, data);
      tx.create(nonceRef, { generation: binding.generation, action: envelope.action, createdAt: FieldValue.serverTimestamp() });
      return { ok: true, bindingId, generation: binding.generation, rootId: binding.rootId, binding, ...result };
    }).then(async ({ binding, claim, ...result }: any) => {
      // File URLs are signed after the lease commits; Storage calls never run inside the transaction.
      if (envelope.action === "CLAIM_DELIVERY") return { ...result, ...(await this.sender.finishClaim(binding, claim)) };
      if (envelope.action === "RESTART_ACK") {
        await this.audit({ event: "WHATSAPP_CONECTOR_REINICIADO", rootId: binding.rootId, actorUid: "SYSTEM", actorName: "Conector de WhatsApp", actorRole: "system", referenceId: String(result.commandId), referenceType: "whatsappQrConnectorCommand",
          entityId: binding.id, entityType: "whatsapp_connector", description: `El conector de WhatsApp de ${agentLabel(binding.agentId)} confirmó el reinicio solicitado y se está reiniciando (la sesión se conserva).` }).catch(() => undefined);
      }
      return result;
    });
  }
  private async heartbeat(tx: any, binding: Binding, data: any, agentId = LEGACY_CONNECTOR_AGENT) {
    if (!data || Object.keys(data).some(k => !["ready", "poll", "status", "qrText", "qrDataUrl", "error", "resetCommandId"].includes(k)) || typeof data.ready !== "boolean" || typeof data.poll !== "boolean") fail("invalid-argument");
    if (data.status !== undefined && !["CONNECTED", "DISCONNECTED", "QR_REQUIRED", "AUTHENTICATED", "ERROR"].includes(data.status)) fail("invalid-argument");
    for (const key of ["qrText", "qrDataUrl", "error"]) if (data[key] !== undefined && data[key] !== null && (typeof data[key] !== "string" || data[key].length > (key === "qrDataUrl" ? 32000 : 4000))) fail("invalid-argument");
    const pending = data.poll ? await tx.get(this.db.collection("whatsappQrConnectorCommands").where("bindingId", "==", binding.id).where("status", "==", "PENDING").limit(5)) : null;
    // El conector solo recibe los grupos que su agente tiene autorizados; el resto nunca sale del teléfono.
    const observed = data.poll && agentId !== LEGACY_CONNECTOR_AGENT ? await tx.get(this.db.collection("whatsappAgentObservers").where("rootId", "==", binding.rootId).where("active", "==", true).limit(200)) : null;
    const internalGroups = observed && agentId === "hugo" ? await tx.get(this.db.collection("whatsappInternalGroups").where("rootId", "==", binding.rootId).limit(50)) : null;
    const observedChats: string[] = observed ? observed.docs.map((doc: any) => doc.data() || {}).filter((config: any) => typeof config.ownerUserUid === "string" && config.ownerUserUid !== "" && (config.observers || []).some((o: any) => o?.agentId === agentId)).map((config: any) => String(config.groupChatId)) : [];
    // When a ready connector last spoke (before this beat): a connector that comes back uses it to read what it missed.
    const previousLive = (await tx.get(this.db.doc(`whatsappQrConnectors/${binding.id}`))).data();
    const previousReadyAtMs = Number.isSafeInteger(previousLive?.lastReadyAtMs) ? previousLive.lastReadyAtMs : null;
    let resetRef: any = null;
    if (data.resetCommandId !== undefined) {
      resetRef = this.db.doc(`whatsappQrConnectorCommands/${id(data.resetCommandId)}`);
      const reset = (await tx.get(resetRef)).data();
      if (!reset || reset.bindingId !== binding.id || reset.generation !== binding.generation || reset.rootId !== binding.rootId || reset.requestedByUid !== binding.ownerUid ||
          reset.type !== "NEW_QR" || reset.status !== "RESET_AUTHORIZED" || data.status !== "QR_REQUIRED" || !data.qrText || !data.qrDataUrl) fail();
    }
    let command: any = null;
    const rows = (pending?.docs || []).map((doc: any) => ({ doc, c: doc.data() }));
    for (const { c } of rows) if (c.rootId !== binding.rootId || c.requestedByUid !== binding.ownerUid || c.generation !== binding.generation || !["SYNC_CHATS", "NEW_QR", "RESTART"].includes(c.type)) fail();
    // A restart nobody picked up for ten minutes is stale (the connector was away): it is closed, never run later by surprise.
    const stale = (row: any) => row.c.type === "RESTART" && typeof row.c.createdAt?.toMillis === "function" && Date.now() - row.c.createdAt.toMillis() > RESTART_COMMAND_TTL_MS;
    for (const row of rows.filter(stale)) tx.update(row.doc.ref, { status: "EXPIRED", finishedAt: FieldValue.serverTimestamp() });
    const eligible = rows.filter((row: any) => !stale(row) && !(row.c.type === "SYNC_CHATS" && !data.ready));
    // A restart goes first: a connector that is stuck must not be kept waiting behind other requests.
    const pick = eligible.find((row: any) => row.c.type === "RESTART") || eligible[0];
    if (pick) {
      command = { id: pick.doc.id, type: pick.c.type };
      tx.update(pick.doc.ref, { status: "PROCESSING", processingBindingId: binding.id, startedAt: FieldValue.serverTimestamp() });
    }
    if (resetRef) tx.update(resetRef, { status: "DONE", finishedAt: FieldValue.serverTimestamp(), outcome: "LOCAL_QR_AVAILABLE_NOT_ACCOUNT_OWNERSHIP" });
    tx.set(this.db.doc(`whatsappQrConnectors/${binding.id}`), { bindingId: binding.id, rootId: binding.rootId, ownerUid: binding.ownerUid,
      generation: binding.generation, status: data.status || (data.ready ? "CONNECTED" : "DISCONNECTED"),
      ...(command ? { lastCommandId: command.id, lastCommandType: command.type, lastCommandStatus: "PROCESSING", lastCommandMessage: "El conector autorizado está procesando la solicitud." } : {}),
      ...(resetRef ? { lastCommandId: resetRef.id, lastCommandType: "NEW_QR", lastCommandStatus: "DONE", lastCommandMessage: "QR local disponible para escaneo humano.", lastCommandFinishedAt: FieldValue.serverTimestamp() } : {}),
      ...(data.qrText !== undefined ? { qrText: data.qrText } : {}), ...(data.qrDataUrl !== undefined ? { qrDataUrl: data.qrDataUrl } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}), lastSeenAt: FieldValue.serverTimestamp(), ...(data.ready ? { lastReadyAtMs: Date.now() } : {}), externalAccountVerified: false }, { merge: true });
    // The team's internal group is watched too, but only messages that address Hugo leave the phone and are stored (see inbound).
    const addressedOnlyChats: string[] = [];
    if (internalGroups) for (const doc of internalGroups.docs) { const chatId = String(doc.get("groupChatId") || ""); if (doc.get("rootId") === binding.rootId && chatId.endsWith("@g.us") && !observedChats.includes(chatId)) { observedChats.push(chatId); addressedOnlyChats.push(chatId); } }
    return { command, observedChats, previousReadyAtMs, ...(addressedOnlyChats.length ? { addressedOnlyChats } : {}) };
  }
  private async command(tx: any, binding: Binding, commandId: unknown, type: string) {
    const ref = this.db.doc(`whatsappQrConnectorCommands/${id(commandId)}`), command = (await tx.get(ref)).data();
    if (!command || command.bindingId !== binding.id || command.generation !== binding.generation || command.rootId !== binding.rootId ||
        command.requestedByUid !== binding.ownerUid || command.processingBindingId !== binding.id || command.status !== "PROCESSING" || command.type !== type) fail();
    return ref;
  }
  private async newQr(tx: any, binding: Binding, data: any) {
    if (!data || Object.keys(data).length !== 1) fail("invalid-argument");
    const ref = await this.command(tx, binding, data.commandId, "NEW_QR");
    // A reset lease is consumed once. Lost responses require human reconciliation, never automatic replay.
    tx.update(ref, { status: "RESET_AUTHORIZED", finishedAt: FieldValue.serverTimestamp() });
    tx.set(this.db.doc(`whatsappQrConnectors/${binding.id}`), { lastCommandId: ref.id, lastCommandType: "NEW_QR", lastCommandStatus: "PROCESSING",
      lastCommandMessage: "Reinicio local autorizado; se espera un QR nuevo.", qrText: null, qrDataUrl: null }, { merge: true });
    return { resetAuthorized: true, commandId: ref.id, externalAccountVerified: false };
  }
  /** The connector confirms it will restart. The lease is consumed once; the session is never reset by a restart. */
  private async restartAck(tx: any, binding: Binding, data: any) {
    if (!data || Object.keys(data).length !== 1) fail("invalid-argument");
    const ref = await this.command(tx, binding, data.commandId, "RESTART");
    tx.update(ref, { status: "DONE", finishedAt: FieldValue.serverTimestamp(), outcome: "RESTART_ACKNOWLEDGED_SESSION_KEPT" });
    tx.set(this.db.doc(`whatsappQrConnectors/${binding.id}`), { lastCommandId: ref.id, lastCommandType: "RESTART", lastCommandStatus: "DONE",
      lastCommandMessage: "El conector confirmó el reinicio y vuelve en unos segundos; la sesión de WhatsApp se conserva.", lastCommandFinishedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { restartAcknowledged: true, commandId: ref.id };
  }
  private async sync(tx: any, bindingRef: any, row: any, data: any) {
    if (!data || !["BEGIN", "UPSERT", "FINISH"].includes(data.phase)) fail("invalid-argument");
    const binding = row as Binding, syncId = id(data.syncId), now = Date.now();
    const agentChats = connectorAgentOf(row.agentId) !== LEGACY_CONNECTOR_AGENT;
    const chatsCollection = agentChats ? "whatsappAgentChats" : "whatsappQrChats";
    const chatDocId = (safeDocId: string) => agentChats ? `${binding.id}__${safeDocId}` : safeDocId;
    if (data.phase === "BEGIN") {
      if (Object.keys(data).some(k => !["phase", "syncId", "commandId"].includes(k))) fail("invalid-argument");
      const commandRef = data.commandId ? await this.command(tx, binding, data.commandId, "SYNC_CHATS") : null;
      if (row.sync?.state && row.sync.state !== "COMPLETE" && now - row.sync.startedAtMs < 600000) fail("failed-precondition");
      tx.update(bindingRef, { sync: { id: syncId, state: "UPSERT", startedAtMs: now, cursor: null, commandId: commandRef?.id || null } });
      return { syncId, phase: "UPSERT" };
    }
    if (row.sync?.id !== syncId || now - row.sync.startedAtMs >= 600000) fail("failed-precondition");
    if (data.phase === "UPSERT") {
      if (row.sync.state !== "UPSERT" || Object.keys(data).some(k => !["phase", "syncId", "chats"].includes(k)) || !Array.isArray(data.chats) || data.chats.length > 100) fail("invalid-argument");
      const seen = new Set<string>();
      const chats = data.chats.map((chat: any) => {
        if (!chat || Object.keys(chat).some(k => !["chatId", "name", "isGroup", "archived", "pinned"].includes(k))) fail("invalid-argument");
        const chatId = id(chat.chatId), safeDocId = encodeURIComponent(chatId);
        if (safeDocId.length > 1000 || seen.has(safeDocId) || typeof chat.name !== "string" || chat.name.length > 500 ||
            [chat.isGroup, chat.archived, chat.pinned].some(v => typeof v !== "boolean")) fail("invalid-argument");
        seen.add(safeDocId);return { ...chat, chatId, safeDocId };
      });
      const existing = await Promise.all(chats.map((c: any) => tx.get(this.db.doc(`${chatsCollection}/${chatDocId(c.safeDocId)}`))));
      let written = 0, quarantined = 0;
      for (let i = 0; i < chats.length; i++) {
        const old = existing[i].data(), chat = chats[i];
        if (old && (old.rootId !== binding.rootId || old.bindingId !== binding.id)) { quarantined++;continue; }
        tx.set(existing[i].ref, { ...chat, connectorId: "default", bindingId: binding.id, rootId: binding.rootId, ownerUid: binding.ownerUid,
          active: true, lastSyncId: syncId, lastSyncedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });written++;
      }
      return { syncId, written, quarantined };
    }
    if (!["UPSERT", "PRUNING"].includes(row.sync.state) || Object.keys(data).some(k => !["phase", "syncId"].includes(k))) fail("invalid-argument");
    let query: any = this.db.collection(chatsCollection).where("bindingId", "==", binding.id).where("rootId", "==", binding.rootId).orderBy(FieldPath.documentId()).limit(100);
    if (row.sync.cursor) query = query.startAfter(row.sync.cursor);
    const page = await tx.get(query);
    const commandRef = row.sync.commandId ? await this.command(tx, binding, row.sync.commandId, "SYNC_CHATS") : null;
    for (const doc of page.docs) if (doc.data().lastSyncId !== syncId) tx.update(doc.ref, { active: false, staleAt: FieldValue.serverTimestamp() });
    const done = page.size < 100;
    tx.update(bindingRef, { sync: { ...row.sync, state: done ? "COMPLETE" : "PRUNING", cursor: page.docs[page.docs.length - 1]?.id || row.sync.cursor } });
    if (done) {
      if (commandRef) tx.update(commandRef, { status: "DONE", finishedAt: FieldValue.serverTimestamp() });
      tx.set(this.db.doc(`whatsappQrConnectors/${binding.id}`), { lastChatsSyncedAt: FieldValue.serverTimestamp(),
        ...(commandRef ? { lastCommandId: commandRef.id, lastCommandType: "SYNC_CHATS", lastCommandStatus: "DONE",
          lastCommandMessage: "Sincronización autorizada completada.", lastCommandFinishedAt: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    }
    return { syncId, done };
  }
  /** Mensajes de grupos autorizados para el agente de este vínculo. Idempotente por mensaje; lo no autorizado se descarta. */
  private async inbound(tx: any, binding: Binding, row: any, data: any) {
    const agentId = connectorAgentOf(row.agentId);
    if (agentId === LEGACY_CONNECTOR_AGENT || !data || Object.keys(data).length !== 1 || !Array.isArray(data.messages) || data.messages.length < 1 || data.messages.length > 25) fail("invalid-argument");
    const seen = new Set<string>();
    const messages = data.messages.map((m: any) => {
      if (!m || Object.keys(m).some(k => !["messageId", "chatId", "authorId", "fromMe", "timestampMs", "type", "body", "mentionsMe"].includes(k))) fail("invalid-argument");
      const messageId = id(m.messageId), chatId = id(m.chatId);
      if (!chatId.endsWith("@g.us") || typeof m.fromMe !== "boolean" || !Number.isSafeInteger(m.timestampMs) || m.timestampMs < 1 || typeof m.type !== "string" || m.type.length > 40 ||
          (m.body !== undefined && (typeof m.body !== "string" || m.body.length > 1000)) || (m.authorId !== undefined && (typeof m.authorId !== "string" || m.authorId.length > 200)) || (m.mentionsMe !== undefined && typeof m.mentionsMe !== "boolean")) fail("invalid-argument");
      const docId = `${binding.id}__${encodeURIComponent(messageId)}`;
      if (seen.has(docId)) fail("invalid-argument");
      seen.add(docId);
      return { ...m, messageId, chatId, docId };
    });
    const chatIds: string[] = [...new Set<string>(messages.map((m: any) => m.chatId))];
    const configs = await Promise.all(chatIds.map(chatId => tx.get(this.db.doc(`whatsappAgentObservers/${binding.rootId}__${encodeURIComponent(chatId)}`))));
    // A group is only read when it is assigned to a PAY0 user: nothing is stored without knowing whose group it is.
    const ownerByChat = new Map<string, string>();
    chatIds.forEach((chatId, index) => {
      const config = configs[index].data();
      if (config && config.rootId === binding.rootId && config.active === true && Array.isArray(config.observers) && config.observers.some((o: any) => o?.agentId === agentId) &&
          typeof config.ownerUserUid === "string" && config.ownerUserUid !== "") ownerByChat.set(chatId, config.ownerUserUid);
    });
    // The team's internal group: nothing is kept except messages that address Hugo (his mention or his name). Its owner is the group's admin.
    const internalOwnerByChat = new Map<string, string>();
    if (agentId === "hugo" && chatIds.some(chatId => !ownerByChat.has(chatId))) {
      const internal = await tx.get(this.db.collection("whatsappInternalGroups").where("rootId", "==", binding.rootId).limit(50));
      for (const doc of internal.docs) {
        const chatId = String(doc.get("groupChatId") || ""), owner = String(doc.get("ownerAdminId") || "");
        if (chatId && owner && doc.get("rootId") === binding.rootId && chatIds.includes(chatId) && !ownerByChat.has(chatId)) internalOwnerByChat.set(chatId, owner);
      }
    }
    const addressesHugo = (m: any) => m.mentionsMe === true || /\bhugo\b/i.test(String(m.body ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""));
    const allowed = new Set(ownerByChat.keys());
    const existing = await Promise.all(messages.map((m: any) => tx.get(this.db.collection("whatsappInboundMessages").doc(m.docId))));
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
    let stored = 0, discarded = 0, duplicates = 0;
    // Diagnostics for the internal group: counts only, never ids or text.
    const diag = { received: messages.length, internalGroupsKnown: internalOwnerByChat.size, internalChatsInBatch: chatIds.filter(chatId => internalOwnerByChat.has(chatId)).length, internalMessages: 0, accepted: 0, rejectedFromMe: 0, rejectedNotAddressed: 0, duplicates: 0, unknownChat: 0 };
    messages.forEach((m: any, index: number) => {
      const internalOwner = internalOwnerByChat.get(m.chatId);
      if (internalOwner) diag.internalMessages++;
      if (internalOwner && m.fromMe) diag.rejectedFromMe++;
      else if (internalOwner && !addressesHugo(m)) diag.rejectedNotAddressed++;
      if (internalOwner && !m.fromMe && addressesHugo(m)) {
        if (existing[index].exists) { duplicates++; diag.duplicates++; return; }
        tx.create(existing[index].ref, { rootId: binding.rootId, bindingId: binding.id, agentId, ownerUserUid: internalOwner, internalGroup: true, mentionsMe: m.mentionsMe === true, chatId: m.chatId, messageId: m.messageId, fromMe: false,
          authorHash: m.authorId ? createHash("sha256").update(`${binding.rootId}|${m.authorId}`).digest("hex").slice(0, 32) : null,
          timestampMs: m.timestampMs, type: m.type, body: m.body ?? "", reportDay: dayKey.format(new Date(m.timestampMs)),
          expiresAt: new Date(Date.now() + INBOUND_RETENTION_MS), createdAt: FieldValue.serverTimestamp() });
        stored++; diag.accepted++;
        return;
      }
      if (!allowed.has(m.chatId)) { discarded++; if (agentId === "hugo" && !internalOwner) diag.unknownChat++; return; }
      if (existing[index].exists) { duplicates++; return; }
      tx.create(existing[index].ref, { rootId: binding.rootId, bindingId: binding.id, agentId, ownerUserUid: ownerByChat.get(m.chatId), chatId: m.chatId, messageId: m.messageId, fromMe: m.fromMe,
        authorHash: m.authorId ? createHash("sha256").update(`${binding.rootId}|${m.authorId}`).digest("hex").slice(0, 32) : null,
        timestampMs: m.timestampMs, type: m.type, body: m.body ?? "", reportDay: dayKey.format(new Date(m.timestampMs)),
        expiresAt: new Date(Date.now() + INBOUND_RETENTION_MS), createdAt: FieldValue.serverTimestamp() });
      stored++;
    });
    // One line only when the internal group is involved, or when Hugo discarded a chat nobody assigned (the usual reason an internal group is silent).
    if (agentId === "hugo" && (diag.internalMessages > 0 || diag.unknownChat > 0)) console.log("WHATSAPP_INTERNAL_INBOUND", JSON.stringify(diag));
    return { stored, discarded, duplicates };
  }
}
