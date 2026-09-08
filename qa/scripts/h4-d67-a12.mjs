import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const bootstrapPath = path.join(
  root,
  "functions",
  "src",
  "modules",
  "users",
  "bootstrap.ts",
);

const index = read("functions/src/index.ts");
const setup = read("src/app/setup-superadmin/page.tsx");
const users = read("src/app/usuarios/page.tsx");
const services = read("src/services/users.ts");
const callableNames = read("src/lib/callableNames.ts");
const routeGuard = read("src/components/RouteAccessGuard.tsx");

const activeBootstrapPatterns = [
  /^\s*export\s*\{[^}\r\n]*\bbootstrapSuperAdmin\b[^}\r\n]*\}\s*from\s*["'][^"']+["']\s*;?/m,
  /^\s*export\s+(?:const|let|var|function)\s+bootstrapSuperAdmin\b/m,
  /^\s*(?:const|let|var|function)\s+bootstrapSuperAdmin\b/m,
  /^\s*import\s+[^;\r\n]*\bbootstrapSuperAdmin\b[^;\r\n]*from\s*["'][^"']+["']\s*;?/m,
  /^\s*(?:import|export)[^;\r\n]*["']\.\/modules\/users\/bootstrap["']\s*;?/m,
];

console.log("=== H4-D67-A12 | Retiro definitivo de bootstrapSuperAdmin ===");

assert.equal(
  fs.existsSync(bootstrapPath),
  false,
  "bootstrap.ts sigue presente",
);

for (const pattern of activeBootstrapPatterns) {
  assert.doesNotMatch(
    index,
    pattern,
    `index.ts conserva referencia ejecutable: ${pattern}`,
  );
}

console.log("PASS backend sin export, import ni implementacion bootstrap");

for (const [name, source] of [
  ["setup", setup],
  ["usuarios", users],
  ["services", services],
  ["callableNames", callableNames],
]) {
  assert.doesNotMatch(
    source,
    /bootstrapSuperAdmin|Convertirme en Superadmin|bootstrapMe/,
    `${name} conserva una referencia de autoelevacion`,
  );
}

assert.match(setup, /Acceso pendiente/);
assert.match(
  routeGuard,
  /router\.replace\("\/setup-superadmin"\)/,
);

console.log("PASS cliente sin llamada de autoelevacion y ruta pendiente conservada");
console.log("H4-D67-A12 QA OK");