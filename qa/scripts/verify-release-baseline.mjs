import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "config", "release-baseline.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

for (const requirement of manifest.requiredCommits) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", requirement.commit, "HEAD"], {
      cwd: root,
      stdio: "ignore",
    });
    console.log(`PASS historia: ${requirement.capability} (${requirement.commit.slice(0, 8)})`);
  } catch {
    failures.push(`Falta el commit requerido ${requirement.commit}: ${requirement.capability}`);
  }
}

function inspect(requirement, shouldExist) {
  const target = path.join(root, requirement.file);
  const content = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const found = content.includes(requirement.text);
  const ok = shouldExist ? found : !found;
  console.log(`${ok ? "PASS" : "FAIL"} capacidad: ${requirement.capability} (${requirement.file})`);
  if (!ok) failures.push(`${requirement.capability}: ${shouldExist ? "no se encontro" : "reaparecio"} el contrato esperado`);
}

for (const requirement of manifest.requiredText) inspect(requirement, true);
for (const requirement of manifest.forbiddenText || []) inspect(requirement, false);

console.log(`HEAD verificado: ${git(["rev-parse", "--short=12", "HEAD"])}`);
if (failures.length) {
  console.error("\nDEPLOY BLOQUEADO POR REGRESION ACUMULATIVA:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nBaseline acumulativo de release verificado.");
