"use strict";

const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");

const root = resolve(__dirname, "../..");

function verifyFiles(sourceRoot, contract) {
  const failures = [];
  if (contract.version !== 1 || !Array.isArray(contract.files) || !contract.files.length) {
    return ["Contrato MAT inválido"];
  }
  const seen = new Set();
  for (const entry of contract.files) {
    if (typeof entry.path !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256 || "") || seen.has(entry.path)) {
      failures.push(`Entrada inválida o repetida: ${entry.path}`);
      continue;
    }
    seen.add(entry.path);
    const file = resolve(sourceRoot, entry.path);
    if (!file.startsWith(resolve(sourceRoot) + require("node:path").sep)) {
      failures.push(`Ruta fuera del proyecto: ${entry.path}`);
      continue;
    }
    try {
      const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (actual !== entry.sha256) failures.push(`Cambió ${entry.path}`);
    } catch {
      failures.push(`Falta ${entry.path}`);
    }
  }
  return failures;
}

if (require.main === module) {
  const contract = JSON.parse(readFileSync(join(root, "config/mat-release-contract.json"), "utf8"));
  const failures = verifyFiles(root, contract);
  if (failures.length) {
    console.error("MAT_RELEASE_CONTRACT_FAIL: la versión aprobada de MAT cambió; revisar y actualizar su contrato antes de publicar.");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`MAT_RELEASE_CONTRACT_PASS files=${contract.files.length} approvedSource=${contract.approvedSource}`);
  }
}

module.exports = { verifyFiles };
