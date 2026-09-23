process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "pay-0-system";

await import("./verify-solicitud-documents-read.mjs");
await import("./verify-payment-document-reads.mjs");
await import("./verify-wallet-client-reads.mjs");

console.log("PASS suite de reglas para documentos y beneficiarios");
