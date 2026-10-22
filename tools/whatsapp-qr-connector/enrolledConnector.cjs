"use strict";
// Controlled adapter for the recovered WhatsApp Web client. No Admin credentials,
// .env, default connector, historic session import, timers or browser at import.
const { createAuthorityTransport } = require("./connectorAuthority.cjs");
const readChats = require("./readChats.cjs");
async function runEnrolledConnector({ transport, client, encodeQr, resetLocalSession, setTimer = setInterval, clearTimer = clearInterval }) {
  if (!transport?.getBinding() || !client || typeof resetLocalSession !== "function") throw Error("ENROLLED_DEPENDENCIES_REQUIRED");
  let ready = false, busy = false, stopped = false, pendingResetId = null;
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
  // Verify live server ownership/revocation BEFORE initializing WhatsApp.
  await status({ status: "DISCONNECTED" });
  await client.initialize();
  timers.push(setTimer(() => poll().catch(() => undefined), 10000));
  timers.push(setTimer(async () => {
    if (busy || !ready || stopped) return;
    busy = true;
    try { await synchronize(); } catch { await close(); } finally { busy = false; }
  }, 60000));
  return { poll, synchronize, stop: async () => { stopped = true; for (const timer of timers) clearTimer(timer); await client.destroy(); } };
}

async function startExplicitly(config) {
  // Caller-owned configuration is only transport/key/session location. It
  // grants no server root/owner authority; the first signed request must pass.
  const { Client, LocalAuth } = require("whatsapp-web.js"), qrcode = require("qrcode");
  const fs = require("node:fs/promises"), path = require("node:path");
  const transport = createAuthorityTransport(config), binding = transport.getBinding();
  if (!binding || !/^[a-f0-9-]{36}$/.test(binding.id)) throw Error("SERVER_BINDING_REQUIRED");
  const sessionRoot = path.resolve(config.sessionRoot), sessionDir = path.resolve(sessionRoot, "session-" + binding.id);
  if (path.dirname(sessionDir) !== sessionRoot) throw Error("SESSION_BOUNDARY_REJECTED");
  const client = new Client({ authStrategy: new LocalAuth({ clientId: binding.id, dataPath: sessionRoot }),
    puppeteer: { headless: true, ...(config.executablePath ? { executablePath: config.executablePath } : {}) } });
  return runEnrolledConnector({ transport, client, encodeQr: qr => qrcode.toDataURL(qr, { margin: 1, width: 320 }),
    resetLocalSession: async id => { if (id !== binding.id) throw Error("SESSION_ID_MISMATCH"); await fs.rm(sessionDir, { recursive: true, force: true }); } });
}
module.exports = { runEnrolledConnector, startExplicitly };
