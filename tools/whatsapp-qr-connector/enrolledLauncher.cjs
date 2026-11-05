"use strict";
// Lanzador explícito del conector enrolado por servidor. Importarlo no inicia nada.
//   node enrolledLauncher.cjs <keygen|enroll|run> --config <config.json>
// config.json NO contiene secretos: la llave privada vive solo en la bóveda DPAPI (privateVault.py).
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED = ["baseUrl", "pythonPath", "vaultPath", "sessionRoot"];

function loadConfig(file, readFile = fs.readFileSync) {
  const raw = JSON.parse(readFile(file, "utf8"));
  for (const key of REQUIRED) if (typeof raw[key] !== "string" || !raw[key]) throw Error("CONFIG_FIELD_REQUIRED:" + key);
  for (const key of ["pythonPath", "vaultPath", "sessionRoot"]) if (!path.isAbsolute(raw[key])) throw Error("CONFIG_ABSOLUTE_PATH_REQUIRED:" + key);
  if (path.basename(raw.vaultPath) !== "worker.dpapi" || path.basename(path.dirname(raw.vaultPath)) !== "pay0-wa-worker-vault") throw Error("CONFIG_VAULT_PATH_SHAPE");
  if (!/^https:\/\//.test(raw.baseUrl)) throw Error("CONFIG_HTTPS_REQUIRED");
  if (raw.executablePath !== undefined && (typeof raw.executablePath !== "string" || !path.isAbsolute(raw.executablePath))) throw Error("CONFIG_ABSOLUTE_PATH_REQUIRED:executablePath");
  if (raw.captureGroups !== undefined && typeof raw.captureGroups !== "boolean") throw Error("CONFIG_CAPTURE_GROUPS_BOOLEAN");
  const policyModule = raw.policyModule ? path.resolve(raw.policyModule) : path.resolve(__dirname, "../../functions/lib/modules/documentDelivery/whatsappConnectorPolicy.js");
  return { baseUrl: raw.baseUrl, pythonPath: raw.pythonPath, vaultPath: raw.vaultPath, sessionRoot: raw.sessionRoot,
    executablePath: raw.executablePath, captureGroups: raw.captureGroups === true, policyModule };
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv) {
  const command = argv[0], file = argument(argv, "--config");
  if (!["keygen", "enroll", "run"].includes(command) || !file) throw Error("USAGE: enrolledLauncher.cjs <keygen|enroll|run> --config <config.json>");
  const config = loadConfig(file);
  const policy = require(config.policyModule);
  const options = { baseUrl: config.baseUrl, pythonPath: config.pythonPath, vaultPath: config.vaultPath, policy };
  const { createLocalWorker, consumeEnrollmentTransfer, loadWorkerRuntime } = require("./workerEnrollment.cjs");
  if (command === "keygen") {
    // Imprime solo la llave PÚBLICA para pegarla en /whatsapp ("Crear enrolamiento"). Falla si ya existe una bóveda.
    fs.mkdirSync(path.dirname(config.vaultPath), { recursive: true });
    console.log(JSON.stringify(await createLocalWorker(options)));
    return;
  }
  if (command === "enroll") {
    // Lee por stdin el JSON de transferencia que mostró /whatsapp (válido 10 minutos).
    const result = await consumeEnrollmentTransfer(options, JSON.parse(await readStdin()));
    console.log(JSON.stringify({ ok: result.ok, bindingId: result.bindingId }));
    return;
  }
  const { startExplicitly } = require("./enrolledConnector.cjs");
  const runtime = await loadWorkerRuntime(options);
  fs.mkdirSync(config.sessionRoot, { recursive: true });
  await startExplicitly({ ...runtime, sessionRoot: config.sessionRoot, executablePath: config.executablePath, captureGroups: config.captureGroups });
  console.log(JSON.stringify({ status: "RUNNING", bindingId: runtime.binding.id, captureGroups: config.captureGroups }));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    // Solo códigos estables: nunca imprimir llaves, vínculos ni cuerpos de respuesta.
    console.error(JSON.stringify({ status: "ERROR", code: /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "LAUNCHER_FAILED" }));
    process.exitCode = 1;
  });
}

module.exports = { loadConfig };
