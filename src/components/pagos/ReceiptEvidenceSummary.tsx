"use client";

import { useState } from "react";
import type { ParsedPagoReceipt, ReceiptCorrectionField } from "@/services/pagoReceipt";

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
  HUMAN_CORRECTION: { label: "Corregido por usuario", style: "text-sky-300" },
  MISSING: { label: "No disponible", style: "text-slate-400" },
};

type Props = {
  receipt: NonNullable<ParsedPagoReceipt["semanticReceipt"]>;
  disabled?: boolean;
  onCorrect?: (field: ReceiptCorrectionField, value: string, correctedField?: ReceiptCorrectionField) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
};
const primary = new Set(["transferAmount", "executionDate", "reference", "concept"]);
const identifiers = new Set(["reference", "trackingKey", "folio", "transactionId"]);
const editable = new Set(["transferAmount", "executionDate", "executionTime", "senderName", "beneficiaryName", "sourceBankName", "destinationBankName", "bankName", "sourceAccount", "destinationAccount", "concept", "reference", "trackingKey", "folio", "transactionId"]);

export default function ReceiptEvidenceSummary({ receipt, disabled, onCorrect, onEditingChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [targetField, setTargetField] = useState<ReceiptCorrectionField>("reference");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const rows = labels.map(([key, label]) => {
    const field = receipt.fields[key];
    const provenance = field?.value == null ? "MISSING" : field.provenance || (field.excerpt ? "DETECTED" : "INFERRED");
    return { key, label, field, provenance };
  });
  async function save(field: ReceiptCorrectionField) {
    if (!onCorrect || saving || disabled || !draft.trim()) return;
    setSaving(true); setMessage("");
    try { await onCorrect(field, draft.trim(), targetField); setEditing(null); onEditingChange?.(false); setMessage("Corrección guardada y datos revalidados."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la corrección."); }
    finally { setSaving(false); }
  }
  function renderRow({ key, label, field, provenance }: typeof rows[number]) {
    const isEditing = editing === key;
    return <div key={key} className="min-w-0 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2">
      <dt className="flex items-center justify-between gap-2 text-xs text-slate-400">{label}
        {onCorrect && editable.has(key) && !isEditing && <button type="button" aria-label={`Corregir ${label}`} disabled={disabled || saving || editing !== null} onClick={() => { setEditing(key); setTargetField(key as ReceiptCorrectionField); onEditingChange?.(true); setDraft(String(field?.value ?? "")); setMessage(""); }} className="rounded px-2 py-1 text-sky-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-40">Editar</button>}
      </dt>
      {isEditing ? <dd className="mt-2 space-y-2">
        {identifiers.has(key) && <select aria-label={`Clasificación de ${label}`} value={targetField} disabled={saving || disabled} onChange={event => setTargetField(event.target.value as ReceiptCorrectionField)} className="w-full rounded border border-white/10 bg-slate-950 px-2 py-2 text-xs">
          {labels.filter(([fieldKey]) => identifiers.has(fieldKey)).map(([fieldKey, fieldLabel]) => <option key={fieldKey} value={fieldKey}>{fieldLabel}</option>)}
        </select>}
        <input aria-label={label} autoFocus type={key === "executionDate" ? "date" : "text"} inputMode={key === "transferAmount" ? "decimal" : undefined} value={draft} disabled={saving || disabled} onChange={event => setDraft(event.target.value)} className="w-full rounded border border-sky-400/40 bg-slate-950 px-2 py-2 text-sm text-white" />
        <div className="flex flex-wrap gap-2"><button type="button" disabled={saving || disabled || !draft.trim()} onClick={() => void save(key as ReceiptCorrectionField)} className="rounded bg-sky-500/20 px-3 py-2 text-xs text-sky-200 disabled:opacity-40">{saving ? "Guardando..." : "Guardar"}</button><button type="button" disabled={saving} onClick={() => { setEditing(null); onEditingChange?.(false); }} className="rounded px-3 py-2 text-xs">Cancelar</button></div>
      </dd> : <dd className="break-words text-sm text-slate-100">{field?.value == null ? "—" : key === "transferAmount" && typeof field.value === "number" ? field.value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(field.value)}</dd>}
      <dd className={`mt-1 text-xs ${status[provenance].style}`}>{status[provenance].label}{provenance === "DETECTED" && field?.decision === "REVIEW" ? " · revisar" : ""}</dd>
      {field?.excerpt && !primary.has(key) && <dd className="mt-1 break-words text-xs text-slate-500">{field.excerpt}</dd>}
    </div>;
  }
  return <section aria-label="Resultado de lectura del comprobante" className="mt-3 space-y-3">
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">{rows.filter(row => primary.has(row.key)).map(renderRow)}</dl>
    {message && <p role="status" className="text-xs text-sky-200">{message}</p>}
    <details className="rounded-lg border border-white/10 p-3">
      <summary className="cursor-pointer text-xs text-slate-300">Detalles del comprobante</summary>
      <div className="my-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" role="status">
        {Object.entries(status).map(([key, entry]) => <span key={key} className={entry.style}>{rows.filter(row => row.provenance === key).length} {key === "DETECTED" ? "detectados" : key === "INFERRED" ? "inferidos" : key === "HUMAN_CORRECTION" ? "corregidos" : "no disponibles"}</span>)}
      </div>
      <p className="mb-3 text-xs text-slate-400">La lectura del documento no confirma por sí sola la validez del pago. Los datos inferidos requieren revisión.</p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">{rows.filter(row => !primary.has(row.key)).map(renderRow)}</dl>
      {rows.some(row => row.field?.humanCorrection) && <div className="mt-3 space-y-2 border-t border-white/10 pt-3" aria-label="Historial de correcciones">
        <p className="text-xs font-medium text-slate-200">Correcciones guardadas</p>
        {rows.filter(row => row.field?.humanCorrection).map(({ key, label, field }) => <div key={key} className="break-words text-xs text-slate-400">
          <span className="text-slate-200">{label}: </span>{String(field.humanCorrection?.originalValue ?? "Sin dato")} → {String(field.value ?? "Sin dato")}
          <div>Usuario: {field.humanCorrection?.actorUid} · Fecha: {field.humanCorrection?.correctedAt}</div>
        </div>)}
      </div>}
    </details>
  </section>;
}
