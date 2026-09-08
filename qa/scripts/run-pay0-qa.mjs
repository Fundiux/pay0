import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const auditDir = path.join(root, "audit", `QA-MODEL-1A-${stamp()}`);
fs.mkdirSync(auditDir, { recursive: true });

const results = [];

function write(name, content) {
  fs.writeFileSync(path.join(auditDir, name), content, "utf8");
}

function runStep(name, command, args, options = {}) {
  const res = spawnSync(command, args, {
    cwd: options.cwd || root,
    shell: true,
    encoding: "utf8",
    env: process.env
  });

  const output = [
    `${command} ${args.join(" ")}`,
    "",
    "STDOUT:",
    res.stdout || "",
    "",
    "STDERR:",
    res.stderr || "",
    "",
    `EXIT_CODE: ${res.status ?? "null"}`
  ].join("\n");

  write(`${name}.txt`, output);

  const ok = res.status === 0;
  results.push({ name, ok });
  console.log(ok ? `[OK] ${name}` : `[FAIL] ${name}`);
  if (!ok) throw new Error(`${name} failed`);
}

let finalOk = false;

try {
  runStep("frontend-build", "npm", ["run", "build"]);
  runStep("functions-build", "npm", ["run", "build"], { cwd: path.join(root, "functions") });
  runStep("utf8-bom", "node", ["qa/scripts/check-utf8-bom.mjs"]);
  runStep("forbidden-files", "node", ["qa/scripts/check-forbidden-files.mjs"]);
  runStep("materiality-canon", "node", ["qa/scripts/check-materiality-canon.mjs"]);
  runStep("pay0-structure", "node", ["qa/scripts/check-pay0-structure.mjs"]);
  finalOk = true;
} catch (err) {
  results.push({ name: "error", ok: false, message: err.message });
}

const lines = [
  "PAY0 QA-MODEL-1A RESULTADO",
  `Root: ${root}`,
  `Audit: ${auditDir}`,
  "",
  ...results.map((r) => `${r.ok ? "[OK]" : "[FAIL]"} ${r.name}${r.message ? " - " + r.message : ""}`),
  "",
  `RESULTADO FINAL: ${finalOk ? "OK" : "FAIL"}`
];

write("RESULTADO.txt", lines.join("\n"));
console.log(lines.join("\n"));
process.exit(finalOk ? 0 : 1);
