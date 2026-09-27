import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "pay-0-system";

await import("./verify-solicitud-documents-read.mjs");
await import("./verify-payment-document-reads.mjs");
await import("./verify-wallet-client-reads.mjs");
execFileSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./verify-activity-log-rules.mjs", import.meta.url))], {
  stdio: "inherit",
});

console.log("PASS suite de reglas para documentos, beneficiarios y actividad");
