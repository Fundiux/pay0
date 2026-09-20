import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { overdue } from "../../functions/lib/modules/paymentApplications/complementPolicy.js";

const index = readFileSync("functions/src/index.ts", "utf8");
const constancias = readFileSync("functions/src/modules/constancias/service.ts", "utf8");
const cotizaciones = readFileSync("functions/src/modules/cotizaciones/callables.ts", "utf8");
const materialityTrigger = readFileSync("functions/src/modules/materiality/triggers.ts", "utf8");

const upsert = index.slice(index.indexOf("export const upsertUser"), index.indexOf("export const createSolicitud"));
assert.match(upsert, /if \(!snap\.exists\) \{\s*throw new HttpsError\(\s*"permission-denied"/s);
assert.doesNotMatch(upsert, /role:\s*"admin"/);
assert.doesNotMatch(upsert, /getDefaultModules\("admin"\)/);

for (const [label, source] of [["constancia", constancias], ["cotizacion", cotizaciones]]) {
  const publicCallable = source.slice(source.indexOf("getPublic"), source.length);
  assert.match(publicCallable, /upload\.active !== true/);
  assert.match(publicCallable, /return \{ valid: false \}/);
  console.log(`PASS ${label}: token inactivo no valida`);
}

console.log("PASS upsertUser: perfil inexistente no puede autoaprovisionar privilegios");
assert.match(materialityTrigger, /document: "uploads\/\{uploadId\}"/);
assert.match(materialityTrigger, /linkSolicitudToMaterialityOperationCore/);
console.log("PASS Materialidad: documentos de Solicitud y Pago activan refresco de expediente");

const requestedAt = { toMillis: () => Date.parse("2026-09-01T12:00:00Z") };
assert.equal(overdue(requestedAt, new Date("2026-09-07T23:00:00Z")), false);
assert.equal(overdue(requestedAt, new Date("2026-09-08T12:00:00Z")), true);
console.log("PASS Complementos: alerta operativa a los 7 días");
