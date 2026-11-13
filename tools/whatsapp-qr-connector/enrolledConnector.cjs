"use strict";
// Controlled adapter for the recovered WhatsApp Web client. No Admin credentials,
// .env, default connector, historic session import, timers or browser at import.
const { createAuthorityTransport } = require("./connectorAuthority.cjs");
const readChats = require("./readChats.cjs");
// Cada lote cabe holgadamente en el límite canónico de 64 KB del servidor.
const MAX_BATCH_MESSAGES = 25, MAX_BATCH_BYTES = 40000, MAX_BUFFERED_MESSAGES = 1000;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
async function runEnrolledConnector({ transport, client, encodeQr, resetLocalSession, setTimer = setInterval, clearTimer = clearInterval, captureGroups = false,
  sendDocuments = false, fetchFile, createMedia }) {
  if (!transport?.getBinding() || !client || typeof resetLocalSession !== "function") throw Error("ENROLLED_DEPENDENCIES_REQUIRED");
  if (sendDocuments && (typeof fetchFile !== "function" || typeof createMedia !== "function")) throw Error("SEND_DEPENDENCIES_REQUIRED");
  let ready = false, busy = false, stopped = false, pendingResetId = null, delivering = false;
  // Solo se retienen mensajes de grupos que el servidor autorizó para este agente (observedChats del latido).
  let observedChats = new Set();
  const buffer = [];
  const timers = [];
  async function close() {
    stopped = true;
    for (const timer of timers) clearTimer(timer);
    await client.destroy().catch(() => undefined);
  }
  const event = handler => (...args) => Promise.resolve().then(() => handler(...args)).catch(close);
  const status = async data => transport.operate("HEARTBEAT", { ready, poll: false, ...data });
  async function synchronize(commandId) {
    if (!ready || stopped) throw Error("CLIENT_NOT_READY");
    return transport.synchronize(await readChats(client), commandId);
  }
  async function poll() {
    if (busy || stopped) return;
    busy = true;
    try {
      const response = await transport.operate("HEARTBEAT", { ready, poll: true });
      observedChats = new Set(Array.isArray(response.observedChats) ? response.observedChats.filter(chat => typeof chat === "string") : []);
      const command = response.command;
      if (!command) return;
      if (command.type === "SYNC_CHATS") await synchronize(command.id);
      else if (command.type === "NEW_QR") {
        const receipt = await transport.operate("NEW_QR", { commandId: command.id });
        if (receipt.resetAuthorized !== true || receipt.commandId !== command.id) throw Error("RESET_RECEIPT_REQUIRED");
        // No marker or automatic retry: a lost authorization/reset result stays
        // reconcilable on the server. A fresh startup never repeats this effect.
        ready = false;
        await client.destroy();
        await resetLocalSession(transport.getBinding().id);
        pendingResetId = command.id;
        await client.initialize();
      } else throw Error("UNKNOWN_SERVER_COMMAND");
    } catch (error) {
      // Any rejected/unknown transport outcome closes local activity. Do not
      // continue with a cached heartbeat, root, binding or stale command.
      await close();
      throw error;
    } finally { busy = false; }
  }
  client.on("qr", event(async qr => { await status({ status: "QR_REQUIRED", qrText: qr, qrDataUrl: await encodeQr(qr), error: null,
    ...(pendingResetId ? { resetCommandId: pendingResetId } : {}) }); pendingResetId = null; }));
  client.on("authenticated", event(async () => status({ status: "AUTHENTICATED", qrText: null, qrDataUrl: null, error: null })));
  client.on("ready", event(async () => { ready = true; await status({ status: "CONNECTED", qrText: null, qrDataUrl: null, error: null }); if (!busy) { busy = true; try { await synchronize(); } finally { busy = false; } } }));
  client.on("auth_failure", event(async () => { ready = false; await status({ status: "ERROR", error: "AUTHENTICATION_FAILED" }); }));
  client.on("disconnected", event(async () => { ready = false; await status({ status: "DISCONNECTED" }); }));
  // Preserve the recovered client's no inbound-response policy. Sending and
  // document/complement polling remain outside this enrolled control entry.
  client.on("message", async () => undefined);
  // Captura opcional (apagada por defecto): solo grupos autorizados, sin responder ni enviar nada.
  client.on("message_create", message => {
    if (!captureGroups || stopped) return;
    try {
      const fromMe = !!message?.fromMe, chatId = String((fromMe ? message?.to : message?.from) || "");
      const messageId = String(message?.id?._serialized || ""), timestampMs = Number(message?.timestamp) * 1000;
      if (!chatId.endsWith("@g.us") || !observedChats.has(chatId) || !messageId || !Number.isSafeInteger(timestampMs) || timestampMs < 1) return;
      const type = String(message?.type || "chat").slice(0, 40), author = message?.author || (fromMe ? "" : message?.from);
      if (buffer.length >= MAX_BUFFERED_MESSAGES) buffer.shift();
      buffer.push({ messageId, chatId, fromMe, timestampMs, type, ...(author ? { authorId: String(author).slice(0, 200) } : {}),
        body: type === "chat" && typeof message?.body === "string" ? message.body.slice(0, 1000) : "" });
    } catch { /* un mensaje ilegible nunca detiene el conector */ }
  });
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
  async function deliver() {
    if (!sendDocuments || delivering || stopped || !ready) return;
    delivering = true;
    try {
      const response = await transport.operate("CLAIM_DELIVERY", {});
      const d = response.delivery;
      if (!d) return;
      const report = (outcome, extra = {}) => transport.operate("REPORT_DELIVERY", { jobId: d.jobId, deliveryId: d.deliveryId, leaseId: d.leaseId, outcome, ...extra });
      let messages;
      try {
        if (typeof d.chatId !== "string" || !/@(g|c)\.us$/.test(d.chatId)) throw Error("DESTINATION_INVALID");
        if (d.kind === "TEXT") {
          if (typeof d.text !== "string" || !d.text) throw Error("TEXT_MISSING");
          messages = [{ content: d.text, options: {} }];
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
  // Verify live server ownership/revocation BEFORE initializing WhatsApp.
  await status({ status: "DISCONNECTED" });
  await client.initialize();
  timers.push(setTimer(() => poll().catch(() => undefined), 10000));
  if (captureGroups) timers.push(setTimer(() => flush().catch(() => undefined), 15000));
  if (sendDocuments) timers.push(setTimer(() => deliver().catch(() => undefined), 10000));
  timers.push(setTimer(async () => {
    if (busy || !ready || stopped) return;
    busy = true;
    try { await synchronize(); } catch { await close(); } finally { busy = false; }
  }, 60000));
  return { poll, synchronize, flush, deliver, stop: async () => { stopped = true; for (const timer of timers) clearTimer(timer); await client.destroy(); } };
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
  const client = new Client({ authStrategy: new LocalAuth({ clientId: binding.id, dataPath: sessionRoot }),
    puppeteer: { headless: true, ...(config.executablePath ? { executablePath: config.executablePath } : {}) } });
  // Signed Storage URLs only: HTTPS, no redirects, bounded time and size.
  const fetchFile = async url => {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error("DOCUMENT_DOWNLOAD_FAILED");
    return Buffer.from(await response.arrayBuffer());
  };
  return runEnrolledConnector({ transport, client, captureGroups: config.captureGroups === true, sendDocuments: config.sendDocuments === true,
    fetchFile, createMedia: (mimetype, data, filename) => new MessageMedia(mimetype, data, filename), encodeQr: qr => qrcode.toDataURL(qr, { margin: 1, width: 320 }),
    resetLocalSession: async id => { if (id !== binding.id) throw Error("SESSION_ID_MISMATCH"); await fs.rm(sessionDir, { recursive: true, force: true }); } });
}
module.exports = { runEnrolledConnector, startExplicitly };
