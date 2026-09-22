import fs from "node:fs";

const checks = [];

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function requireText(file, text, description) {
  checks.push({ file, description, ok: read(file).includes(text) });
}

function rejectText(file, text, description) {
  checks.push({ file, description, ok: !read(file).includes(text) });
}

requireText(
  "src/components/DocsModal.tsx",
  'where("rootId", "==", solicitudRootId)',
  "Los documentos de solicitudes se consultan dentro del root autorizado",
);
requireText(
  "src/components/DocsModal.tsx",
  "No se pudieron cargar los documentos de esta solicitud.",
  "La interfaz muestra los errores de lectura y no los confunde con cero documentos",
);
requireText(
  "src/app/integraciones/iq/page.tsx",
  "Editar cuenta IQ",
  "La administración conserva la edición de cuentas IQ",
);
requireText(
  "src/app/integraciones/iq/page.tsx",
  "Eliminar la cuenta IQ",
  "La administración conserva el retiro de cuentas IQ",
);
rejectText(
  "functions/src/modules/iq/callables.ts",
  '.collection("iqCredentialProfiles")\n    .where("rootId", "==", auth.rootId)\n    .orderBy("createdAt"',
  "El listado de cuentas IQ no vuelve a depender de un índice inexistente",
);

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.description} (${check.file})`);
}

if (failed.length > 0) {
  console.error(`\nPublicación bloqueada: fallaron ${failed.length} controles críticos.`);
  process.exit(1);
}

console.log(`\n${checks.length} controles críticos aprobados.`);
