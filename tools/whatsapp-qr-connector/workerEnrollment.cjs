"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const { createWorkerKey, createAuthorityTransport } = require("./connectorAuthority.cjs");
function privateVault({ pythonPath, vaultPath }, operation, input) {
  if (!path.isAbsolute(pythonPath) || !path.isAbsolute(vaultPath)) throw Error("ABSOLUTE_VAULT_PATH_REQUIRED");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [path.join(__dirname, "privateVault.py"), operation, vaultPath], {
      windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    });
    let data = Buffer.alloc(0), failed = false;
    const timeout = setTimeout(() => { failed = true; child.kill(); }, 30000);
    child.stdout.on("data", chunk => { data = Buffer.concat([data, chunk]); if (data.length > 20000) { failed = true; child.kill(); } });
    child.stderr.resume(); // Never copy key-bearing pipes or diagnostics into logs.
    child.on("error", () => { clearTimeout(timeout); reject(Error("PRIVATE_VAULT_FAILED")); });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0 || failed) return reject(Error("PRIVATE_VAULT_FAILED"));
      try { resolve(JSON.parse(data.toString("utf8"))); } catch { reject(Error("PRIVATE_VAULT_FAILED")); }
      finally { data.fill(0); }
    });
    child.stdin.end(input ? JSON.stringify(input) : "");
  });
}
async function createLocalWorker(options) {
  const pair = createWorkerKey();
  await privateVault(options, "create", pair);
  return { protocol: "pay0-wa-worker-public-v1", publicKeyPem: pair.publicKeyPem };
}
async function consumeEnrollmentTransfer(options, transfer) {
  if (!transfer || Object.keys(transfer).sort().join(",") !== "enrollment,protocol" || transfer.protocol !== "pay0-wa-enrollment-transfer-v1") throw Error("TRANSFER_INVALID");
  const vault = await privateVault(options, "load");
  const transport = createAuthorityTransport({ ...options, privateKeyPem: vault.privateKeyPem, binding: vault.binding });
  if (vault.binding) {
    await transport.operate("HEARTBEAT", { ready: false, poll: false });
    return { ok: true, bindingId: vault.binding.id, externalAccountVerified: false, recoveredReceipt: true };
  }
  const result = await transport.consume(transfer.enrollment);
  await privateVault(options, "binding", { binding: result.binding });
  return { ok: true, bindingId: result.binding.id, externalAccountVerified: false };
}
async function reconnectLocalWorker(options) {
  const vault = await privateVault(options, "load");
  if (!vault.binding) throw Error("ENROLLMENT_TRANSFER_REQUIRED");
  const transport = createAuthorityTransport({ ...options, privateKeyPem: vault.privateKeyPem, binding: vault.binding });
  await transport.operate("HEARTBEAT", { ready: false, poll: false });
  return transport;
}
// Para arrancar el conector: devuelve la configuración de transporte con la llave y el vínculo guardados en la bóveda.
async function loadWorkerRuntime(options) {
  const vault = await privateVault(options, "load");
  if (!vault.binding) throw Error("ENROLLMENT_TRANSFER_REQUIRED");
  return { ...options, privateKeyPem: vault.privateKeyPem, binding: vault.binding };
}
module.exports = { createLocalWorker, consumeEnrollmentTransfer, reconnectLocalWorker, loadWorkerRuntime };
