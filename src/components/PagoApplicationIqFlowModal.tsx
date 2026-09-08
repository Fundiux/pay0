"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";

type Props = {
  open: boolean;
  flow: any;
  busy: boolean;
  humanConfirmed: boolean;
  onHumanConfirmedChange: (value: boolean) => void;
  onExecute: () => void;
  onRetryPreparation: () => void;
  onRefreshStatus: () => void;
  onDiagnoseMethods?: () => void;
  onClose: () => void;
};

function money2(value: any) {
  const parsed = Number(String(value ?? 0).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function currency(value: any) {
  return money2(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function clean(value: any) {
  return String(value ?? "").trim();
}

function upper(value: any) {
  return clean(value).toUpperCase();
}

function stageLabel(stage: string) {
  const map: Record<string, string> = {
    PREPARING: "Preparando PAY0 e IQ",
    PREPARATION_ERROR: "Prevalidacion pendiente",
    READY: "Plan IQ listo para revision",
    EXECUTING: "Ejecutando en IQ",
    IN_PROGRESS: "Ejecucion IQ en progreso",
    FAILED_SAFE: "Fallo seguro antes de confirmar",
    CLIENT_UNKNOWN: "Resultado por consultar",
    REVIEW_REQUIRED: "Revision obligatoria",
    SUCCEEDED: "Aplicacion IQ confirmada",
  };
  return map[stage] || "Flujo de aplicacion IQ";
}

function statusClass(stage: string) {
  if (stage === "SUCCEEDED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (["REVIEW_REQUIRED", "CLIENT_UNKNOWN"].includes(stage)) return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (["PREPARATION_ERROR", "FAILED_SAFE"].includes(stage)) return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-sky-500/30 bg-sky-500/10 text-sky-200";
}

export default function PagoApplicationIqFlowModal(props: Props) {
  const {
    open,
    flow,
    busy,
    humanConfirmed,
    onHumanConfirmedChange,
    onExecute,
    onRetryPreparation,
    onRefreshStatus,
    onDiagnoseMethods,
    onClose,
  } = props;

  const stage = upper(flow?.stage);

  useEffect(() => {
    if (!open || !flow || stage !== "IN_PROGRESS" || busy) return;

    const timer = window.setTimeout(() => {
      onRefreshStatus();
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [open, flow, stage, busy, onRefreshStatus]);

  if (!open || !flow) return null;
  const planResult = flow.planResult || {};
  const executionResult = flow.executionResult || {};
  const plan = planResult.plan || {};
  const items = Array.isArray(plan.items) ? plan.items : [];
  const canExecute = ["READY", "FAILED_SAFE"].includes(stage);
  const canRetryPreparation = stage === "PREPARATION_ERROR";
  const canRefresh = ["CLIENT_UNKNOWN", "IN_PROGRESS"].includes(stage);
  const total = money2(plan.totalAmount || flow.totalAmount || items.reduce((sum: number, item: any) => sum + money2(item?.amount), 0));
  const message = clean(flow.message || executionResult.message || plan.iqExecutionMessage);
  const browserEvidence = executionResult?.browserResult || plan?.iqExecutionResult || {};
  const evidenceItems = Array.isArray(browserEvidence?.itemResults) ? browserEvidence.itemResults : [];
  const fieldChecks = Array.isArray(browserEvidence?.fieldChecks) ? browserEvidence.fieldChecks : [];
  const diagnosticMethods = Array.isArray(flow?.diagnosticResult?.methods) ? flow.diagnosticResult.methods : [];
  const browserResponseMessage = clean(browserEvidence?.responseMessage || browserEvidence?.message);
  const evidenceAttemptId = clean(executionResult?.attemptId || plan?.iqExecutionAttemptId);
  const evidenceIqApplicationId = clean(executionResult?.iqApplicationId || plan?.iqApplicationId);
  const evidenceStatus = upper(executionResult?.iqExecutionStatus || plan?.iqExecutionStatus);
  const evidenceAttemptCount = Number(executionResult?.attemptNumber || plan?.actualIqAttemptCount || 0);
  const hasExecutionEvidence = Boolean(
    evidenceAttemptId || evidenceIqApplicationId || evidenceStatus || evidenceItems.length > 0 || fieldChecks.length > 0 || browserResponseMessage,
  );

  return (
    <div className="fixed inset-0 z-[1320] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <div className="max-h-[94vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
        <div className="flex items-start justify-between border-b border-white/10 bg-white/5 px-6 py-5">
          <div>
            <div className="text-base font-normal text-white">Aplicacion de pagos en IQ</div>
            <div className="mt-1 text-[11px] text-slate-400">
              Pago {clean(flow?.pago?.id) || "---"} - {clean(flow?.pago?.clienteNombre) || "---"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            title="Cerrar sin ejecutar automaticamente"
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(94vh-86px)] overflow-y-auto p-6">
          <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${statusClass(stage)}`}>
            {stage === "SUCCEEDED" ? (
              <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
            ) : ["REVIEW_REQUIRED", "CLIENT_UNKNOWN", "PREPARATION_ERROR", "FAILED_SAFE"].includes(stage) ? (
              <AlertTriangle className="mt-0.5 shrink-0" size={18} />
            ) : busy || ["PREPARING", "EXECUTING", "IN_PROGRESS"].includes(stage) ? (
              <LoaderCircle className="mt-0.5 shrink-0 animate-spin" size={18} />
            ) : (
              <ShieldCheck className="mt-0.5 shrink-0" size={18} />
            )}
            <div>
              <div className="text-sm font-normal">{stageLabel(stage)}</div>
              <div className="mt-1 text-xs opacity-85">
                {message || "Revisa el deposito, las facturas y los montos antes de confirmar."}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Deposito IQ</div>
              <div className="mt-1 font-mono text-sm text-sky-300">{clean(plan.pagoIqFolio) || "Pendiente"}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Facturas</div>
              <div className="mt-1 font-mono text-sm text-white">{items.length || flow.applicationCount || 0}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Total del lote</div>
              <div className="mt-1 font-mono text-sm text-emerald-300">${currency(total)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Plan IQ</div>
              <div className="mt-1 truncate font-mono text-[11px] text-slate-300" title={clean(planResult.planId)}>
                {clean(planResult.planId) || "Aun no creado"}
              </div>
            </div>
          </div>

          {items.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-[1000px] w-full text-left text-[11px]">
                <thead className="bg-white/5 text-[10px] uppercase text-slate-400">
                  <tr>
                    <th className="p-3">Folio PAY0</th>
                    <th className="p-3">Factura IQ</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3 text-right">Aplicar</th>
                    <th className="p-3 text-right">Saldo antes</th>
                    <th className="p-3 text-right">Saldo despues</th>
                    <th className="p-3">Seguimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={clean(item?.planItemId || item?.applicationId || item?.solicitudId)} className="border-t border-white/5 text-slate-200">
                      <td className="p-3 font-mono text-sky-300">{clean(item?.solicitudFolio) || clean(item?.solicitudId) || "---"}</td>
                      <td className="p-3 font-mono">{clean(item?.solicitudIqFolio) || "---"}</td>
                      <td className="p-3">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px]">{upper(item?.invoiceType) || "---"}</span>
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-300">${currency(item?.amount)}</td>
                      <td className="p-3 text-right font-mono">${currency(item?.balanceBefore)}</td>
                      <td className="p-3 text-right font-mono">${currency(item?.balanceAfter)}</td>
                      <td className="p-3 text-[10px] text-slate-400">
                        {item?.requiresComplement === true
                          ? "PPD: complemento pendiente"
                          : item?.requiresSameMonthSettlement === true
                            ? "PUE: liquidar dentro del mes"
                            : "PUE: liquidada, sin complemento"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasExecutionEvidence && (
            <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4">
              <div className="text-[10px] uppercase tracking-wider text-violet-200">Evidencia del intento IQ</div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <div>
                  <div className="text-[10px] text-slate-500">Estado backend</div>
                  <div className="mt-1 font-mono text-xs text-white">{evidenceStatus || "---"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Intento</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-violet-200" title={evidenceAttemptId}>{evidenceAttemptId || "---"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Aplicacion IQ</div>
                  <div className="mt-1 font-mono text-xs text-emerald-300">{evidenceIqApplicationId || "---"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Numero de intento</div>
                  <div className="mt-1 font-mono text-xs text-white">{evidenceAttemptCount || "---"}</div>
                </div>
              </div>

              {(browserEvidence?.status || browserEvidence?.submitClicked !== undefined || browserEvidence?.confirmationClicked !== undefined) && (
                <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-[10px] text-slate-300 md:grid-cols-3">
                  <div>Resultado navegador: <span className="font-mono text-white">{clean(browserEvidence?.status) || "---"}</span></div>
                  <div>Envio final: <span className="font-mono text-white">{browserEvidence?.submitClicked === true ? "SI" : "NO"}</span></div>
                  <div>Confirmacion final: <span className="font-mono text-white">{browserEvidence?.confirmationClicked === true ? "SI" : "NO"}</span></div>
                </div>
              )}



              {fieldChecks.length > 0 && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Verificacion de campos IQ</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {fieldChecks.map((check: any) => (
                      <div key={`${clean(check?.field)}-${clean(check?.expected)}`} className={check?.ok ? "rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-200" : "rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200"}>
                        <span className="font-mono text-white">{clean(check?.field) || "CAMPO"}</span>{" "}
                        <span>{check?.ok ? "OK" : "NO"}</span>
                        <div className="mt-1 text-slate-300">Esperado: <span className="font-mono text-white">{clean(check?.expected) || "---"}</span></div>
                        <div className="text-slate-300">Seleccionado: <span className="font-mono text-white">{clean(check?.selected) || "---"}</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diagnosticMethods.length > 0 && (
                <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-200">Diagnostico de 3 metodos IQ sin Crear</div>
                  <div className="mt-2 space-y-2">
                    {diagnosticMethods.map((method: any, index: number) => {
                      const methodChecks = Array.isArray(method?.fieldChecks) ? method.fieldChecks : [];
                      const methodOk = upper(method?.status) === "IQ_PAYMENT_APPLICATION_DIAGNOSTIC_READY";
                      return (
                        <div key={`${clean(method?.diagnosticMethod)}-${index}`} className={methodOk ? "rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3" : "rounded-lg border border-amber-400/25 bg-amber-500/10 p-3"}>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                            <span className="font-mono text-white">{clean(method?.diagnosticMethod) || `METODO_${index + 1}`}</span>
                            <span className={methodOk ? "text-emerald-300" : "text-amber-300"}>{clean(method?.status) || "---"}</span>
                          </div>
                          {methodChecks.length > 0 && (
                            <div className="mt-2 grid gap-1 md:grid-cols-2">
                              {methodChecks.map((check: any) => (
                                <div key={`${clean(method?.diagnosticMethod)}-${clean(check?.field)}`} className="text-[10px] text-slate-300">
                                  <span className="font-mono text-white">{clean(check?.field)}</span> {check?.ok ? "OK" : "NO"}: esperado <span className="font-mono text-white">{clean(check?.expected)}</span>, seleccionado <span className="font-mono text-white">{clean(check?.selected) || "---"}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}


              {browserResponseMessage && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-[10px] text-slate-300">
                  <div className="mb-1 uppercase tracking-wider text-slate-500">Detalle navegador</div>
                  <div className="font-mono text-[10px] text-slate-200">{browserResponseMessage}</div>
                </div>
              )}

              {evidenceItems.length > 0 && (
                <div className="mt-3 space-y-1">
                  {evidenceItems.map((item: any) => (
                    <div key={clean(item?.key || item?.solicitudIqFolio)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/15 px-3 py-2 text-[10px]">
                      <span className="font-mono text-sky-300">Factura IQ {clean(item?.solicitudIqFolio) || "---"}</span>
                      <span className="font-mono text-white">${currency(item?.amountMatched || item?.expectedAmount)}</span>
                      <span className={upper(item?.status) === "VERIFIED" ? "text-emerald-300" : "text-amber-300"}>{upper(item?.status) || "---"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {canExecute && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              <input
                type="checkbox"
                checked={humanConfirmed}
                onChange={(event) => onHumanConfirmedChange(event.target.checked)}
                disabled={busy}
                className="mt-1 h-4 w-4"
              />
              <span>
                Confirmo que revise el deposito IQ, cada factura, el tipo PUE/PPD y los montos. Autorizo una sola confirmacion final en IQ.
              </span>
            </label>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {canRetryPreparation && (
              <button
                type="button"
                onClick={onRetryPreparation}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-3 text-xs text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
              >
                <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
                Reintentar prevalidacion
              </button>
            )}

            {canRefresh && (
              <button
                type="button"
                onClick={onRefreshStatus}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-500/15 px-4 py-3 text-xs text-sky-100 hover:bg-sky-500/25 disabled:opacity-50"
              >
                <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
                Consultar estado
              </button>
            )}

            {canExecute && onDiagnoseMethods && (
              <button
                type="button"
                onClick={onDiagnoseMethods}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-3 text-xs text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
              >
                <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
                Probar 3 metodos sin Crear
              </button>
            )}

            {canExecute && (
              <button
                type="button"
                onClick={onExecute}
                disabled={busy || !humanConfirmed}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-normal text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                {stage === "FAILED_SAFE" ? "Confirmar reintento seguro" : "Confirmar y ejecutar en IQ"}
              </button>
            )}
          </div>

          <div className="mt-4 text-[10px] text-slate-500">
            H4-D66-A5: piloto productivo controlado; ninguna ejecucion IQ ocurre al abrir o cerrar esta ventana; la evidencia del intento permanece disponible al consultar el estado.
          </div>
        </div>
      </div>
    </div>
  );
}
