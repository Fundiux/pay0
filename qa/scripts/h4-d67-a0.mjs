import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const index = read("functions/src/index.ts");
const setup = read("src/app/setup-superadmin/page.tsx");
const users = read("src/app/usuarios/page.tsx");
const services = read("src/services/users.ts");
const callableNames = read("src/lib/callableNames.ts");
const routeGuard = read("src/components/RouteAccessGuard.tsx");

const bootstrapPath = path.join(
  root,
  "functions",
  "src",
  "modules",
  "users",
  "bootstrap.ts",
);

const activeBootstrapPatterns = [
  /^\s*export\s*\{[^}\r\n]*\bbootstrapSuperAdmin\b[^}\r\n]*\}\s*from\s*["'][^"']+["']\s*;?/m,
  /^\s*export\s+(?:const|let|var|function)\s+bootstrapSuperAdmin\b/m,
  /^\s*(?:const|let|var|function)\s+bootstrapSuperAdmin\b/m,
  /^\s*import\s+[^;\r\n]*\bbootstrapSuperAdmin\b[^;\r\n]*from\s*["'][^"']+["']\s*;?/m,
  /^\s*(?:import|export)[^;\r\n]*["']\.\/modules\/users\/bootstrap["']\s*;?/m,
];

ensure(
  !fs.existsSync(bootstrapPath),
  "bootstrap.ts sigue presente.",
);

for (const pattern of activeBootstrapPatterns) {
  ensure(
    !pattern.test(index),
    `index.ts conserva una referencia ejecutable: ${pattern}`,
  );
}

ensure(
  setup.includes("Acceso pendiente"),
  "La ruta de cuenta sin perfil no muestra el estado correcto.",
);
ensure(
  !setup.includes("Convertirme en Superadmin") &&
    !setup.includes("bootstrapSuperAdmin") &&
    !setup.includes("@/services/users"),
  "La pantalla antigua conserva una ruta de elevacion de privilegios.",
);
ensure(
  !users.includes("bootstrapSuperAdmin") &&
    !users.includes("bootstrapMe"),
  "La pagina Usuarios conserva referencias al bootstrap.",
);
ensure(
  !services.includes("bootstrapSuperAdmin"),
  "El servicio cliente conserva el wrapper del bootstrap.",
);
ensure(
  !callableNames.includes("bootstrapSuperAdmin"),
  "El registro cliente conserva el nombre del callable.",
);
ensure(
  routeGuard.includes('router.replace("/setup-superadmin")'),
  "Se rompio la ruta controlada para cuentas autenticadas sin perfil.",
);

console.log("H4-D67-A0 QA OK");
console.log("- bootstrapSuperAdmin retirado del codigo backend.");
console.log("- UI y servicios cliente sin elevacion de privilegios.");
console.log("- Ruta de cuenta sin perfil conservada como pantalla informativa.");