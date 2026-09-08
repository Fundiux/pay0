import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const indexPath = path.join(root, "functions", "src", "index.ts");
const text = fs.readFileSync(indexPath, "utf8");

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const removed = [
  "processIqReconciliationQueue",
  "processIqCreateQueue",
  "processIqInvoiceImportQueue",
  "discoverIqWorkCandidates",
];

for (const name of removed) {
  ensure(!text.includes(name), `${name} sigue exportada desde index.ts`);
}

ensure(
  text.includes('export { reconcileSolicitudIq } from "./modules/iq/solicitudReconciliationCallables";'),
  "Se perdio reconcileSolicitudIq."
);

ensure(
  text.includes('export { enqueueSolicitudIqCreation } from "./modules/iq/solicitudCreateQueueCallables";'),
  "Se perdio enqueueSolicitudIqCreation."
);

ensure(
  text.includes("syncIqSolicitudInvoice") &&
    text.includes("enqueueExistingIqFolioInvoiceImports"),
  "Se perdieron callables manuales de importacion."
);

ensure(
  text.includes("processIqPagoDepositCreateQueueOnWrite"),
  "Se altero por error el OnWrite de Pagos."
);

ensure(
  text.includes("processIqPagoDepositOnDemandTask"),
  "Se altero por error la task queue de Pagos."
);

ensure(
  text.includes("H4_D67_A1_SOLICITUD_IQ_SCHEDULERS_REMOVED"),
  "Falta marcador H4-D67-A1."
);

console.log("H4-D67-A1 QA OK");
console.log("- Cuatro schedulers IQ de Solicitudes fuera de index.ts.");
console.log("- Callables manuales conservadas.");
console.log("- OnWrite y task queue de Pagos conservados.");