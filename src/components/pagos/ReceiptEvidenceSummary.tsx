"use client";

import type { ParsedPagoReceipt } from "@/services/pagoReceipt";

const labels = [
  ["transferAmount", "Importe"], ["executionDate", "Fecha"], ["executionTime", "Hora"],
  ["senderName", "Ordenante"], ["beneficiaryName", "Beneficiario"],
  ["sourceBankName", "Banco emisor"], ["destinationBankName", "Banco receptor"],
  ["bankName", "Institución identificada"],
  ["sourceAccount", "Cuenta origen"], ["destinationAccount", "Cuenta destino"],
  ["reference", "Referencia"], ["trackingKey", "Clave de rastreo"], ["folio", "Folio"],
  ["transactionId", "Operación"], ["concept", "Concepto"],
  ["accountBalance", "Saldo informado"], ["bankCommission", "Comisión bancaria"],
] as const;
const status = {
  DETECTED: { label: "Detectado", style: "text-emerald-300" },
  INFERRED: { label: "Inferido · revisar", style: "text-amber-300" },
  MISSING: { label: "No disponible", style: "text-slate-400" },
};

export default function ReceiptEvidenceSummary({ receipt }: { receipt: NonNullable<ParsedPagoReceipt["semanticReceipt"]> }) {
  const rows = labels.map(([key, label]) => {
    const field = receipt.fields[key];
    const provenance = field?.value == null ? "MISSING" : field.provenance || (field.excerpt ? "DETECTED" : "INFERRED");
    return { key, label, field, provenance };
  });
  return <section aria-label="Resultado de lectura del comprobante" className="mt-3 space-y-3">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" role="status">
      {Object.entries(status).map(([key, entry]) => <span key={key} className={entry.style}>{rows.filter(row => row.provenance === key).length} {key === "DETECTED" ? "detectados" : key === "INFERRED" ? "inferidos" : "no disponibles"}</span>)}
    </div>
    <p className="text-xs text-slate-400">Detectado indica evidencia en el documento; no confirma por sí solo la validez del pago. Los datos inferidos requieren revisión.</p>
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(({ key, label, field, provenance }) => <div key={key} className="min-w-0 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2" title={field?.excerpt || undefined}>
        <dt className="text-xs text-slate-400">{label}</dt>
        <dd className="break-words text-sm text-slate-100">{field?.value == null ? "—" : key === "transferAmount" && typeof field.value === "number" ? field.value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(field.value)}</dd>
        <dd className={`mt-1 text-xs ${status[provenance].style}`}>{status[provenance].label}{provenance === "DETECTED" && field?.decision === "REVIEW" ? " · revisar" : ""}</dd>
      </div>)}
    </dl>
  </section>;
}
