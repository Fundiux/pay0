"use strict";
// Controlled adapter for the recovered WhatsApp Web client. No Admin credentials,
// .env, default connector, historic session import, timers or browser at import.
const { createAuthorityTransport } = require("./connectorAuthority.cjs");
const readChats = require("./readChats.cjs");
// Cada lote cabe holgadamente en el límite canónico de 64 KB del servidor.
const MENTION_TOKEN = "{{MENCION}}"; // same placeholder as functions/src/modules/whatsappAutoReply/mention.ts
const MAX_BATCH_MESSAGES = 25, MAX_BATCH_BYTES = 40000, MAX_BUFFERED_MESSAGES = 1000;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const NOT_READY_LIMIT_MS = 5 * 60 * 1000, DESTROY_TIMEOUT_MS = 15000;
// WhatsApp stops rotating an unscanned QR after a few minutes and goes idle: restart for a fresh one.
const QR_IDLE_LIMIT_MS = 4 * 60 * 1000;
// Auto-update: how often the connector compares its own code on disk with the code it started with.
const CODE_CHECK_MS = 3 * 60 * 1000;
// History recovery on reconnect: what a group received while the connector was away. Bounded window, per-chat and total caps, reads spaced out.
const HISTORY_MAX_WINDOW_MS = 24 * 60 * 60 * 1000, HISTORY_MARGIN_MS = 60 * 1000, HISTORY_MIN_GAP_MS = 2 * 60 * 1000;
const HISTORY_PER_CHAT = 100, HISTORY_TOTAL = 600, HISTORY_SPACING_MS = 1500, HISTORY_CALL_TIMEOUT_MS = 20000;
// Since 2026-11 WhatsApp Web shows its QR as a link; phones no longer accept the bare payload whatsapp-web.js 1.34.8 emits.
const LINKED_DEVICES_QR_PREFIX = "https://wa.me/settings/linked_devices#";
const linkedDevicesQr = qr => /^https?:\/\//i.test(String(qr)) ? String(qr) : LINKED_DEVICES_QR_PREFIX + String(qr);
async function runEnrolledConnector({ transport, client, encodeQr, resetLocalSession, setTimer = setInterval, clearTimer = clearInterval, captureGroups = false,
  sendDocuments = false, fetchFile, createMedia, onStopped, now = Date.now, notReadyLimitMs = NOT_READY_LIMIT_MS, destroyTimeoutMs = DESTROY_TIMEOUT_MS, qrIdleLimitMs = QR_IDLE_LIMIT_MS, codeFingerprint, codeCheckMs = CODE_CHECK_MS,
  historySpacingMs = HISTORY_SPACING_MS, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!transport?.getBinding() || !client || typeof resetLocalSession !== "function") throw Error("ENROLLED_DEPENDENCIES_REQUIRED");
  if (sendDocuments && (typeof fetchFile !== "function" || typeof createMedia !== "function")) throw Error("SEND_DEPENDENCIES_REQUIRED");
  let ready = false, busy = false, stopped = false, pendingResetId = null, delivering = false;
  // Self-recovery: a connector that cannot keep working closes and reports why, so the
  // supervisor relaunches it. A pending QR waits for a person, so it never counts as stuck.
  let awaitingQr = false, notReadySince = null, lastQrAt = null;
  // The QR stays on the page while it waits: every heartbeat repeats it, so the 10 s heartbeat never hides it as DISCONNECTED.
  let pendingQr = null;
  // Solo se retienen mensajes de grupos que el servidor autorizó para este agente (observedChats del latido).
  let observedChats = new Set(), addressedOnly = new Set(), watchedInternal = -1, internalCaptured = 0;
  const buffer = [];
  const timers = [];
  async function close(reason = "CONNECTOR_FAILED") {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearTimer(timer);
    // A hung browser (for example a detached frame) can block destroy forever.
    let timeout;
    await Promise.race([client.destroy().catch(() => undefined), new Promise(resolve => { timeout = setTimeout(resolve, destroyTimeoutMs); })]);
    clearTimeout(timeout);
    if (typeof onStopped === "function") onStopped(typeof reason === "string" && /^[A-Z0-9_]{1,60}$/.test(reason) ? reason : "CONNECTOR_FAILED");
  }
  const event = handler => (...args) => Promise.resolve().then(() => handler(...args)).catch(() => close("EVENT_FAILED"));
  const status = async data => transport.operate("HEARTBEAT", { ready, poll: false, ...data });
  async function synchronize(commandId) {
    if (!ready || stopped) throw Error("CLIENT_NOT_READY");
    return transport.synchronize(await readChats(client), commandId);
  }
  async function poll() {
    if (busy || stopped) return;
    busy = true;
    try {
      const response = await transport.operate("HEARTBEAT", { ready, poll: true, ...(awaitingQr && pendingQr ? { status: "QR_REQUIRED", ...pendingQr } : {}) });
      observedChats = new Set(Array.isArray(response.observedChats) ? response.observedChats.filter(chat => typeof chat === "string") : []);
      addressedOnly = new Set(Array.isArray(response.addressedOnlyChats) ? response.addressedOnlyChats.filter(chat => typeof chat === "string") : []);
      // Once per process, as soon as the client is ready and the observed groups are known: read what was missed while away (in the background).
      if (ready && captureGroups && !historyStarted && observedChats.size > 0) { historyStarted = true; recoverHistory().catch(() => undefined); }
      // Diagnostic (counts only): how many internal groups this connector was told to watch, logged when the number changes.
      if (addressedOnly.size !== watchedInternal) { watchedInternal = addressedOnly.size; console.log(JSON.stringify({ status: "INTERNAL_GROUPS_WATCHED", count: watchedInternal, observedGroups: observedChats.size, captureGroups })); }
      const command = response.command;
      if (!command) return;
      if (command.type === "SYNC_CHATS") await synchronize(command.id);
      else if (command.type === "NEW_QR") {
        const receipt = await transport.operate("NEW_QR", { commandId: command.id });
        if (receipt.resetAuthorized !== true || receipt.commandId !== command.id) throw Error("RESET_RECEIPT_REQUIRED");
        // No marker or automatic retry: a lost authorization/reset result stays
        // reconcilable on the server. A fresh startup never repeats this effect.
        ready = false;
        notReadySince = now();
        await client.destroy();
        await resetLocalSession(transport.getBinding().id);
        pendingResetId = command.id;
        await client.initialize();
      } else if (command.type === "RESTART") {
        // A restart asked from the page: confirm it (the server records it once), then close. The launcher exits 75 and the supervisor relaunches
        // with the code on disk. The WhatsApp session is NOT reset: only the process restarts.
        const receipt = await transport.operate("RESTART_ACK", { commandId: command.id });
        if (receipt.restartAcknowledged !== true || receipt.commandId !== command.id) throw Error("RESTART_RECEIPT_REQUIRED");
        await close("RESTART_REQUESTED");
      } else throw Error("UNKNOWN_SERVER_COMMAND");
    } catch (error) {
      // Any rejected/unknown transport outcome closes local activity. Do not
      // continue with a cached heartbeat, root, binding or stale command.
      await close("HEARTBEAT_FAILED");
      throw error;
    } finally { busy = false; }
  }
  // Auto-update: when the connector's own files change on disk it restarts itself, but only when idle (nothing being sent, synced or reset),
  // only for a change that stays the same on two consecutive checks (a file still being written is not a release), and once per change:
  // the process that restarts takes the new code as its baseline.
  const startedCode = typeof codeFingerprint === "function" ? (() => { try { return codeFingerprint() || null; } catch { return null; } })() : null;
  let changedCode = null, updateHandled = false;
  async function checkCodeUpdate() {
    if (startedCode === null || stopped || updateHandled) return "SKIPPED";
    let current;
    try { current = codeFingerprint(); } catch { return "UNREADABLE"; }
    if (!current || current === startedCode) { changedCode = null; return "UNCHANGED"; }
    if (changedCode !== current) { changedCode = current; return "CHANGE_SEEN"; }
    if (busy || delivering || pendingResetId !== null) return "BUSY";
    updateHandled = true;
    await close("CODE_UPDATED");
    return "RESTARTING";
  }
  client.on("qr", event(async raw => { const qr = linkedDevicesQr(raw); awaitingQr = true; lastQrAt = now(); pendingQr = { qrText: qr, qrDataUrl: await encodeQr(qr) }; await status({ status: "QR_REQUIRED", ...pendingQr, error: null,
    ...(pendingResetId ? { resetCommandId: pendingResetId } : {}) }); pendingResetId = null; }));
  client.on("authenticated", event(async () => { awaitingQr = false; pendingQr = null; notReadySince = now(); return status({ status: "AUTHENTICATED", qrText: null, qrDataUrl: null, error: null }); }));
  client.on("ready", event(async () => { ownIds = null; ready = true; notReadySince = null; await status({ status: "CONNECTED", qrText: null, qrDataUrl: null, error: null }); if (!busy) { busy = true; try { await synchronize(); } finally { busy = false; } } }));
  client.on("auth_failure", event(async () => { ready = false; await status({ status: "ERROR", error: "AUTHENTICATION_FAILED" }); await close("AUTHENTICATION_FAILED"); }));
  // whatsapp-web.js does not reconnect by itself: close so the supervisor starts a fresh client.
  client.on("disconnected", event(async () => { ready = false; await status({ status: "DISCONNECTED" }).catch(() => undefined); await close("DISCONNECTED"); }));
  // Preserve the recovered client's no inbound-response policy. Sending and
  // document/complement polling remain outside this enrolled control entry.
  client.on("message", async () => undefined);
  // Captura opcional (apagada por defecto): solo grupos autorizados, sin responder ni enviar nada.
  // Is this message a WhatsApp mention of this very account? A mention may carry the linked-device id (@lid) while client.info
  // holds the phone id (@c.us), so every known id of the account is compared, and an unknown @lid is resolved to its contact.
  // Capture counters (counts only, never ids or text): they show whether WhatsApp delivers messages for the observed groups at all.
  const captureStats = { events: 0, groupEvents: 0, notObserved: 0, buffered: 0, lastLogged: -1 };
  const capturedChats = new Set();
  function logCaptureStats() {
    if (captureStats.events === captureStats.lastLogged) return null;
    captureStats.lastLogged = captureStats.events;
    const line = { status: "CAPTURE_STATS", events: captureStats.events, groupEvents: captureStats.groupEvents, notObserved: captureStats.notObserved, buffered: captureStats.buffered, observedGroups: observedChats.size, groupsWithMessages: capturedChats.size, ready };
    console.log(JSON.stringify(line));
    return line;
  }
  // History recovery state. baselineMs = when this connector was last ready before this start, from the server's first answer.
  let baselineMs = null, historyStarted = false;
  const bufferedIds = new Set();
  let ownIds = null;
  const idOf = value => String((value && value._serialized) || value || "");
  const numberOf = id => id.split("@")[0].split(":")[0];
  async function loadOwnIds() {
    if (ownIds) return ownIds;
    const ids = new Set(), add = value => { const id = idOf(value); if (id) ids.add(id); };
    add(client?.info?.wid); add(client?.info?.lid); add(client?.info?.me?.lid);
    try {
      const own = idOf(client?.info?.wid);
      if (own && typeof client.getContactLidAndPhone === "function") for (const row of (await client.getContactLidAndPhone([own])) || []) { add(row?.lid); add(row?.pn); }
    } catch { /* an older client does not expose it */ }
    if (ids.size) ownIds = ids;
    return ids;
  }
  async function mentionsThisAccount(message) {
    const mentioned = Array.isArray(message?.mentionedIds) ? message.mentionedIds.map(idOf).filter(Boolean) : [];
    if (!mentioned.length) return false;
    const own = await loadOwnIds(), ownNumbers = new Set([...own].filter(id => id.endsWith("@c.us")).map(numberOf));
    if (mentioned.some(id => own.has(id) || (id.endsWith("@c.us") && ownNumbers.has(numberOf(id))))) return true;
    for (const id of mentioned.filter(id => id.endsWith("@lid"))) {
      try {
        const contact = typeof client.getContactById === "function" ? await client.getContactById(id) : null;
        const resolved = [idOf(contact?.id), contact?.number ? contact.number + "@c.us" : ""].filter(Boolean);
        if (resolved.some(value => own.has(value) || ownNumbers.has(numberOf(value)))) return true;
      } catch { /* an unresolved id is simply not a mention of this account */ }
    }
    return false;
  }
  // Captures one message (live, or recovered from history with backfill = true). Returns true when it was buffered.
  async function capture(message, backfill = false) {
    if (!captureGroups || stopped) return false;
    try {
      const fromMe = !!message?.fromMe, chatId = String((fromMe ? message?.to : message?.from) || "");
      const messageId = String(message?.id?._serialized || ""), timestampMs = Number(message?.timestamp) * 1000;
      if (!backfill) {
        captureStats.events++;
        if (chatId.endsWith("@g.us")) { captureStats.groupEvents++; if (!observedChats.has(chatId)) captureStats.notObserved++; }
      }
      if (!chatId.endsWith("@g.us") || !observedChats.has(chatId) || !messageId || !Number.isSafeInteger(timestampMs) || timestampMs < 1) return false;
      // A recovered message that was already captured live (or recovered) is not buffered twice, and recovery never pushes live messages out.
      if (backfill && (bufferedIds.has(messageId) || buffer.length >= MAX_BUFFERED_MESSAGES)) return false;
      const type = String(message?.type || "chat").slice(0, 40), author = message?.author || (fromMe ? "" : message?.from);
      if (!backfill && buffer.length >= MAX_BUFFERED_MESSAGES) buffer.shift();
      // A WhatsApp mention of this very account. In the team's internal group nothing leaves the phone unless it addresses Hugo (his mention or his name).
      // Only a message that mentions someone needs the lookup; every other message is buffered without waiting.
      let mentioned = Array.isArray(message?.mentionedIds) && message.mentionedIds.length > 0 ? await mentionsThisAccount(message) : false;
      // Answering (quoting) one of this account's own messages is addressing it, same as a mention.
      if (!mentioned && !fromMe && message?.hasQuotedMsg === true && typeof message.getQuotedMessage === "function") {
        try { mentioned = (await message.getQuotedMessage())?.fromMe === true; } catch { /* no quoted message, not addressed */ }
      }
      const text = type === "chat" && typeof message?.body === "string" ? message.body.slice(0, 1000) : "";
      if (addressedOnly.has(chatId) && !(mentioned || /\bhugo\b/i.test(text.normalize("NFD").replace(/[̀-ͯ]/g, "")))) return false;
      if (addressedOnly.has(chatId)) { internalCaptured++; console.log(JSON.stringify({ status: "INTERNAL_ADDRESSED_CAPTURED", total: internalCaptured, mentioned })); }
      if (!backfill) captureStats.buffered++;
      capturedChats.add(chatId);
      if (bufferedIds.size > 5000) bufferedIds.clear();
      bufferedIds.add(messageId);
      buffer.push({ messageId, chatId, fromMe, timestampMs, type, ...(author ? { authorId: String(author).slice(0, 200) } : {}),
        body: text, ...(mentioned ? { mentionsMe: true } : {}) });
      return true;
    } catch { /* un mensaje ilegible nunca detiene el conector */ return false; }
  }
  client.on("message_create", message => capture(message));
  // Reads, group by group and spaced out, what the observed groups received while this connector was away (since it was last ready,
  // at most a day). Everything goes through the same filters as live capture and the same idempotent INBOUND_GROUP; nothing here sends or replies.
  async function recoverHistory() {
    const withTimeout = promise => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("HISTORY_TIMEOUT")), HISTORY_CALL_TIMEOUT_MS); })]).finally(() => clearTimeout(timer)); };
    const counts = { status: "HISTORY_BACKFILL", skipped: null, chats: 0, chatsRead: 0, seen: 0, buffered: 0, errors: 0, windowMinutes: 0, capped: false };
    const nowMs = now();
    if (baselineMs === null) { counts.skipped = "NO_BASELINE"; console.log(JSON.stringify(counts)); return counts; }
    if (nowMs - baselineMs < HISTORY_MIN_GAP_MS) { counts.skipped = "SHORT_GAP"; console.log(JSON.stringify(counts)); return counts; }
    const since = Math.max(baselineMs - HISTORY_MARGIN_MS, nowMs - HISTORY_MAX_WINDOW_MS);
    const chats = [...observedChats];
    counts.chats = chats.length; counts.windowMinutes = Math.round((nowMs - since) / 60000);
    for (const chatId of chats) {
      if (stopped || !ready) break;
      if (counts.buffered >= HISTORY_TOTAL) { counts.capped = true; break; }
      await wait(historySpacingMs);
      try {
        if (typeof client.getChatById !== "function") throw Error("HISTORY_UNAVAILABLE");
        const chat = await withTimeout(client.getChatById(chatId));
        const messages = await withTimeout(chat.fetchMessages({ limit: HISTORY_PER_CHAT }));
        counts.chatsRead++;
        for (const message of Array.isArray(messages) ? messages : []) {
          const at = Number(message?.timestamp) * 1000;
          if (!Number.isSafeInteger(at) || at < since) continue;
          counts.seen++;
          if (counts.buffered >= HISTORY_TOTAL) { counts.capped = true; break; }
          if (await capture(message, true)) counts.buffered++;
        }
      } catch { counts.errors++; }
    }
    console.log(JSON.stringify(counts));
    return counts;
  }
  // Every minute: a ready client must still read its chats (a detached frame fails here),
  // and a client that never becomes ready without waiting for a QR is restarted.
  async function watchdog() {
    if (stopped) return;
    if (!ready) {
      if (!awaitingQr && notReadySince !== null && now() - notReadySince >= notReadyLimitMs) await close("NOT_READY_TIMEOUT");
      else if (awaitingQr && lastQrAt !== null && now() - lastQrAt >= qrIdleLimitMs) await close("QR_IDLE");
      return;
    }
    if (busy) return;
    busy = true;
    try { await synchronize(); } catch { busy = false; await close("SYNC_FAILED"); } finally { busy = false; }
  }
  async function flush() {
    if (!captureGroups || busy || stopped || !ready || buffer.length === 0) return;
    busy = true;
    const batch = [];
    try {
      let bytes = 0;
      while (buffer.length && batch.length < MAX_BATCH_MESSAGES) {
        const size = Buffer.byteLength(JSON.stringify(buffer[0]), "utf8");
        if (batch.length && bytes + size > MAX_BATCH_BYTES) break;
        bytes += size; batch.push(buffer.shift());
      }
      await transport.operate("INBOUND_GROUP", { messages: batch });
    } catch {
      // El servidor es idempotente por mensaje: se reintenta en el siguiente ciclo con un nonce nuevo.
      buffer.unshift(...batch);
    } finally { busy = false; }
  }
  // Envio de documentos (solo el conector de Hugo, con sendDocuments). Un documento nunca se envia dos veces:
  // 1) CLAIM: el servidor presta UNA entrega y URLs firmadas de vida corta.
  // 2) Se descargan los archivos y se arma el mensaje ANTES de pedir permiso de envio.
  // 3) ATTEMPT: sin esta autorizacion no se envia nada; si la respuesta se pierde, tampoco.
  // 4) sendMessage y reporte SENT. Un fallo durante el envio se reporta UNCERTAIN y espera a una persona.
  // "Buen día @cliente": the text carries a placeholder and the id of the client's message. The author is resolved here, from that message,
  // so the server never has the number. If it cannot be resolved the placeholder is dropped and the greeting goes without the mention.
  async function buildTextMessage(d) {
    if (!d.text.includes(MENTION_TOKEN)) return { content: d.text, options: {} };
    const plain = d.text.replace(/,?\s*\{\{MENCION\}\}/g, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
    const messageId = d.mention && typeof d.mention.messageId === "string" ? d.mention.messageId : "";
    if (!messageId || messageId.length > 200 || typeof client.getMessageById !== "function" || !plain) return { content: plain || d.text, options: {} };
    try {
      const source = await client.getMessageById(messageId);
      const author = source && !source.fromMe ? String(source.author || source.from || "") : "";
      // Only a person of the same group: never a number from another chat.
      if (!source || String(source.from || "") !== d.chatId || !/^\d{5,20}(:\d+)?@(c\.us|lid)$/.test(author)) return { content: plain, options: {} };
      return { content: d.text.split(MENTION_TOKEN).join("@" + author.split("@")[0].split(":")[0]), options: { mentions: [author] } };
    } catch { return { content: plain, options: {} }; }
  }
  // Delivery log (counts and stable codes only: never ids, names or text), so what went out can be verified from this machine without the database.
  const deliveryCounts = { sent: 0, error: 0, uncertain: 0 };
  let lastIdleReason = null;
  function logDeliveryReport(outcome, kind, code) {
    deliveryCounts[outcome === "SENT" ? "sent" : outcome === "ERROR" ? "error" : "uncertain"]++;
    console.log(JSON.stringify({ status: "DELIVERY_REPORTED", outcome, kind: kind === "TEXT" ? "TEXT" : "DOCUMENTS", ...(typeof code === "string" && /^[A-Z0-9_]{1,60}$/.test(code) ? { code } : {}), ...deliveryCounts }));
  }
  async function deliver() {
    if (!sendDocuments || delivering || stopped || !ready) return;
    delivering = true;
    try {
      const response = await transport.operate("CLAIM_DELIVERY", {});
      const d = response.delivery;
      if (!d) {
        // Why nothing is going out (off hours, switch off, nothing waiting), logged only when it changes.
        const reason = typeof response.reason === "string" && /^[A-Z0-9_]{1,40}$/.test(response.reason) ? response.reason : "NOTHING_TO_SEND";
        if (reason !== lastIdleReason) { lastIdleReason = reason; console.log(JSON.stringify({ status: "DELIVERY_IDLE", reason })); }
        return;
      }
      lastIdleReason = null;
      const report = async (outcome, extra = {}) => {
        const result = await transport.operate("REPORT_DELIVERY", { jobId: d.jobId, deliveryId: d.deliveryId, leaseId: d.leaseId, outcome, ...extra });
        if (outcome === "SENT" || outcome === "ERROR" || outcome === "UNCERTAIN") logDeliveryReport(outcome, d.kind, extra.errorCode);
        return result;
      };
      let messages;
      try {
        if (typeof d.chatId !== "string" || !/@(g|c)\.us$/.test(d.chatId)) throw Error("DESTINATION_INVALID");
        if (d.kind === "TEXT") {
          if (typeof d.text !== "string" || !d.text) throw Error("TEXT_MISSING");
          messages = [await buildTextMessage(d)];
        } else {
          if (!Array.isArray(d.documents) || d.documents.length === 0) throw Error("DOCUMENTS_MISSING");
          messages = [];
          for (const [index, doc] of d.documents.entries()) {
            if (typeof doc.url !== "string" || !doc.url.startsWith("https://")) throw Error("DOCUMENT_URL_INVALID");
            const bytes = await fetchFile(doc.url);
            if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) throw Error("DOCUMENT_DOWNLOAD_FAILED");
            messages.push({ content: createMedia(String(doc.contentType || "application/octet-stream"), bytes.toString("base64"), String(doc.fileName || "documento")),
              options: { sendMediaAsDocument: true, ...(index === 0 && d.caption ? { caption: String(d.caption) } : {}) } });
          }
        }
      } catch (error) {
        // Nothing reached WhatsApp: a definite, retryable failure.
        const code = /^[A-Z0-9_]{1,60}$/.test(String(error && error.message || "")) ? error.message : "PRE_SEND_FAILED";
        await report("ERROR", { errorCode: code }).catch(() => undefined);
        return;
      }
      const attempt = await report("ATTEMPT");
      if (attempt.attemptAuthorized !== true) return;
      const messageIds = [];
      try {
        for (const message of messages) {
          const sent = await client.sendMessage(d.chatId, message.content, message.options);
          if (sent && sent.id && sent.id._serialized) messageIds.push(String(sent.id._serialized).slice(0, 200));
        }
      } catch {
        await report("UNCERTAIN", { errorCode: "SEND_FAILED_DURING_ATTEMPT" }).catch(() => undefined);
        return;
      }
      // A lost SENT report becomes uncertain on the server when the lease expires; never resend here.
      await report("SENT", { messageIds }).catch(() => undefined);
    } catch {
      // Claim or attempt rejected, or transport failure: nothing was sent; the next cycle asks again.
    } finally { delivering = false; }
  }
  // Verify live server ownership/revocation BEFORE initializing WhatsApp. The answer also says when this connector was last ready.
  const firstAnswer = await status({ status: "DISCONNECTED" });
  baselineMs = Number.isSafeInteger(firstAnswer?.previousReadyAtMs) ? firstAnswer.previousReadyAtMs : null;
  notReadySince = now();
  await client.initialize();
  timers.push(setTimer(() => poll().catch(() => undefined), 10000));
  if (captureGroups) timers.push(setTimer(() => flush().catch(() => undefined), 15000));
  if (captureGroups) timers.push(setTimer(() => { logCaptureStats(); }, 10 * 60 * 1000));
  if (sendDocuments) timers.push(setTimer(() => deliver().catch(() => undefined), 10000));
  timers.push(setTimer(() => watchdog().catch(() => undefined), 60000));
  if (startedCode !== null) timers.push(setTimer(() => checkCodeUpdate().catch(() => undefined), codeCheckMs));
  return { poll, synchronize, flush, deliver, watchdog, checkCodeUpdate, logCaptureStats, recoverHistory, stop: async () => { stopped = true; for (const timer of timers) clearTimer(timer); await client.destroy(); } };
}

async function startExplicitly(config) {
  // Caller-owned configuration is only transport/key/session location. It
  // grants no server root/owner authority; the first signed request must pass.
  const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js"), qrcode = require("qrcode");
  const fs = require("node:fs/promises"), path = require("node:path");
  const transport = createAuthorityTransport(config), binding = transport.getBinding();
  if (!binding || !/^[a-f0-9-]{36}$/.test(binding.id)) throw Error("SERVER_BINDING_REQUIRED");
  const sessionRoot = path.resolve(config.sessionRoot), sessionDir = path.resolve(sessionRoot, "session-" + binding.id);
  if (path.dirname(sessionDir) !== sessionRoot) throw Error("SESSION_BOUNDARY_REJECTED");
  // Optional pin of the WhatsApp Web version (from the local cache, strict): a new WhatsApp Web release can break the library's startup.
  const pinned = /^\d+\.\d+\.\d+$/.test(String(config.webVersion || "")) ? { webVersion: config.webVersion, webVersionCache: { type: "local", strict: true, path: path.resolve(config.webVersionCachePath || path.join(__dirname, ".wwebjs_cache")) } } : {};
  // With a pinned version, the profile's Service Worker would serve the newest WhatsApp Web it cached and the pin would never load:
  // tell Chrome to bypass it before the page opens (the login lives elsewhere in the profile and is kept).
  class PinnedLocalAuth extends LocalAuth { async afterBrowserInitialized() { await super.afterBrowserInitialized(); await this.client.pupPage.setBypassServiceWorker(true); console.log(JSON.stringify({ status: "PINNED_WEB_VERSION", webVersion: pinned.webVersion, serviceWorkerBypassed: true })); } }
  const Auth = pinned.webVersion ? PinnedLocalAuth : LocalAuth;
  // The files whose change means "new version": the connector itself, its launcher and helpers, and the signing policy it loads.
  const crypto = require("node:crypto"), fsSync = require("node:fs");
  const codeFiles = ["enrolledConnector.cjs", "enrolledLauncher.cjs", "connectorAuthority.cjs", "workerEnrollment.cjs", "readChats.cjs"].map(name => path.join(__dirname, name)).concat(config.policyModule ? [path.resolve(config.policyModule)] : []);
  const codeFingerprint = () => { const hash = crypto.createHash("sha256"); for (const file of codeFiles) hash.update(file).update(fsSync.readFileSync(file)); return hash.digest("hex"); };
  const client = new Client({ authStrategy: new Auth({ clientId: binding.id, dataPath: sessionRoot }), ...pinned,
    puppeteer: { headless: true, ...(config.executablePath ? { executablePath: config.executablePath } : {}) } });
  // Signed Storage URLs only: HTTPS, no redirects, bounded time and size.
  const fetchFile = async url => {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error("DOCUMENT_DOWNLOAD_FAILED");
    return Buffer.from(await response.arrayBuffer());
  };
  return runEnrolledConnector({ transport, client, codeFingerprint, captureGroups: config.captureGroups === true, sendDocuments: config.sendDocuments === true,
    onStopped: typeof config.onStopped === "function" ? config.onStopped : undefined,
    fetchFile, createMedia: (mimetype, data, filename) => new MessageMedia(mimetype, data, filename), encodeQr: qr => qrcode.toDataURL(qr, { margin: 1, width: 320 }),
    resetLocalSession: async id => { if (id !== binding.id) throw Error("SESSION_ID_MISMATCH"); await fs.rm(sessionDir, { recursive: true, force: true }); } });
}
module.exports = { linkedDevicesQr, LINKED_DEVICES_QR_PREFIX, runEnrolledConnector, startExplicitly };
