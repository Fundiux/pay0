"use client";

import { useEffect, useState } from "react";
import { getHugoComplementInventoryPage, type ComplementInventoryCounts, type ComplementInventoryException } from "@/services/paymentComplements";

const empty: ComplementInventoryCounts = { scanned: 0, detected: 0, processed: 0, pending: 0, errors: 0, excluded: 0, iq: 0, facturama: 0, emisor: 0,
  waitingB: 0, requestedC: 0, uncertainC: 0, attachmentAvailable: 0, exceptionBlocked: 0, otherPending: 0 };
const keys = Object.keys(empty) as (keyof ComplementInventoryCounts)[];
const reasons: Record<string, string> = {
  SOURCE_ID_INVALID: "Identificadores de origen inválidos",
  SOURCE_SCOPE_OR_PARENT_MISSING: "Falta solicitud o pago, o está fuera del ámbito",
  INVOICE_TYPE_MISMATCH: "La factura y la aplicación discrepan sobre PPD",
  RECEIPT_EVIDENCE_MISMATCH: "Recepción sin evidencia documental consistente",
  DOCUMENTS_NEED_VERIFICATION: "Hay archivos que requieren validación",
  FOLLOWUP_NOT_RECORDED: "Seguimiento aún no registrado",
  NEEDS_FISCAL_DATA: "Faltan datos fiscales",
  WAITING_IQ_APPLICATION: "Esperando aplicación confirmada en IQ",
  PENDING_PROVIDER_CONTRACT: "Pendiente del proveedor",
  REQUESTED: "Solicitado; esperando REP",
  PENDING_B: "Esperando la siguiente lectura B",
  REQUEST_STATE_UNKNOWN: "Solicitud C con resultado incierto; no se reenviará",
  ATTACHMENT_PENDING: "Solicitud C realizada; esperando adjunto",
  QUEUED: "En cola",
  PREPARING: "En validación",
  SENDING: "En envío",
  UNKNOWN: "Resultado externo incierto",
  BLOCKED: "Bloqueado para revisión",
  REVIEW_REQUIRED: "Requiere revisión",
  REP_GATE_MASTER_OFF: "Master Switch de IQ apagado",
  REP_GATE_LOOKUP_OFF: "Consulta de complementos IQ pausada",
  REP_GATE_REQUEST_OFF: "Solicitud de complementos IQ pausada",
  REP_GATE_CLIENT_PERMISSION: "Sin permiso vigente sobre el cliente",
  REP_GATE_IQ_ACCESS_CHANGED: "Acceso o perfil IQ cambió",
  REP_GATE_PROFILE_UNAVAILABLE: "Perfil IQ no disponible",
  REP_GATE_QUOTA_ZERO: "Cuota de consulta deshabilitada",
};
const recoveryLabel = (row: ComplementInventoryException) => row.bReadState === "EXCEPTION"
  ? "Lectura B detenida; Hugo aisló este expediente y requiere revisión de la excepción"
  : row.operationalTags?.includes("uncertainC")
  ? "Resultado de C incierto; Hugo seguirá consultando el adjunto mediante B, sin repetir C"
  : row.operationalTags?.includes("requestedC")
    ? "Solicitud C registrada; Hugo seguirá consultando el adjunto mediante B"
  : row.operationalTags?.includes("waitingB")
    ? `Hugo revisará el adjunto en la siguiente corrida diaria${row.nextCheckAt ? `, elegible desde ${new Date(row.nextCheckAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })} CDMX` : ""}`
  : row.recoveryState === "GATE_BLOCKED"
  ? `Hugo encontró el caso, pero no tiene autorización para consultar IQ: ${reasons[row.recoveryReason || ""] || row.recoveryReason}`
  : row.recoveryState === "WAITING_IQ_APPLICATION" ? "Sin confirmación suficiente de aplicación IQ"
  : row.recoveryState === "READY_FOR_IQ_LOOKUP" ? "Listo localmente para consulta IQ; IQ aún no consultado"
  : row.recoveryState === "LOCAL_EVIDENCE_INCOMPLETE" ? "Falta evidencia local para consultar IQ" : "";

export default function HugoComplementInventory() {
  const [counts, setCounts] = useState(empty);
  const [exceptions, setExceptions] = useState<ComplementInventoryException[]>([]);
  const [complete, setComplete] = useState(false);
  const [checkedAt, setCheckedAt] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function scan() {
      let cursor: string | undefined;
      const total = { ...empty };
      const findings: ComplementInventoryException[] = [];
      try {
        while (!cancelled) {
          const page = await getHugoComplementInventoryPage(cursor);
          if (cancelled) return;
          for (const key of keys) total[key] += page.counts[key];
          findings.push(...page.exceptions.slice(0, Math.max(0, 12 - findings.length)));
          setCounts({ ...total });
          setExceptions([...findings]);
          setCheckedAt(page.checkedAt);
          if (page.complete) { setComplete(true); return; }
          if (!page.cursor || page.cursor === cursor) throw Error("El inventario no avanzó de página.");
          cursor = page.cursor;
        }
      } catch (cause: any) { if (!cancelled) setError(cause?.message || "No se pudo completar el inventario."); }
    }
    void scan();
    return () => { cancelled = true; };
  }, []);

  const cards = [
    ["Detectados", counts.detected], ["Procesados", counts.processed],
    ["Pendientes", counts.pending], ["Errores", counts.errors],
  ] as const;
  const states = [
    ["Esperando lectura B", counts.waitingB], ["Solicitud C realizada", counts.requestedC],
    ["Solicitud C incierta", counts.uncertainC], ["Adjunto por validar", counts.attachmentAvailable],
    ["Excepción o bloqueo", counts.exceptionBlocked], ["Otros pendientes", counts.otherPending],
  ] as const;
  return <section className="mt-6 rounded-2xl border border-violet-500/20 bg-slate-900 p-5 text-slate-200">
    <h2 className="text-lg font-semibold text-white">Complementos de pago</h2>
    <p className="mt-1 text-xs text-slate-400">Inventario histórico de solo lectura · aplicaciones PPD aplicadas · todos los proveedores</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) =>
      <div key={label} className="rounded-xl border border-slate-700 bg-slate-950 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl font-semibold text-white">{value.toLocaleString("es-MX")}</p></div>)}</div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{states.map(([label, value]) =>
      <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"><p className="text-xs text-slate-400">{label}</p><p className="text-lg font-semibold text-slate-100">{value.toLocaleString("es-MX")}</p></div>)}</div>
    <p className="mt-2 text-xs text-slate-500">Un expediente puede aparecer en más de un estado operativo, por ejemplo una solicitud C incierta y un bloqueo de lectura B.</p>
    <p className="mt-3 text-xs text-slate-400" role="status">{complete ? "Cobertura completa" : error ? "Cobertura parcial" : "Revisando histórico…"} · {counts.scanned.toLocaleString("es-MX")} aplicaciones revisadas · {counts.excluded.toLocaleString("es-MX")} fuera de alcance · IQ {counts.iq}, Facturama {counts.facturama}, otros {counts.emisor}{checkedAt ? ` · última revisión ${new Date(checkedAt).toLocaleString("es-MX")}` : ""}</p>
    {error && <p className="mt-2 text-xs text-amber-300">{error}. Los conteos mostrados son parciales.</p>}
    {exceptions.length > 0 && <div className="mt-4 border-t border-slate-800 pt-3"><p className="text-xs font-medium text-slate-300">Muestra de pendientes y errores ({exceptions.length} casos)</p>
      <ul className="mt-2 space-y-1 text-xs text-slate-400">{exceptions.map(row => <li key={row.applicationId}><span className={row.outcome === "ERROR" ? "text-rose-300" : "text-amber-300"}>{row.outcome === "ERROR" ? "Error" : "Pendiente"}</span> · {row.applicationFolio || row.applicationId} · {row.provider} · {reasons[row.reason] || `Revisar código ${row.reason}`}{recoveryLabel(row) && <span className="block pl-4 text-sky-300">{recoveryLabel(row)}</span>}{row.bReadReason && <span className="block pl-4 text-rose-300">Lectura B: {reasons[row.bReadReason] || row.bReadReason}</span>}</li>)}</ul></div>}
  </section>;
}
