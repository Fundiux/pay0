"use client";

import { useCallback, useEffect, useState } from "react";

import { formatDateTime24 } from "@/lib/dateTime";
import {
  getIqBeneficiaryCreateState,
  retryIqBeneficiaryLinks,
  setIqBeneficiaryCreateConfig,
  type IqBeneficiaryCreateState,
} from "@/services/iq";

// Why a method is not yet in IQ, in plain Spanish. Unknown codes fall back to a generic text, never a raw code.
const REASONS: Record<string, string> = {
  IQ_MASTER_OFF: "La integración con IQ está apagada",
  CREATE_DISABLED: "La creación automática en IQ está apagada",
  CREATE_CONTRACT_UNVERIFIED: "Falta verificar el contrato de creación en IQ",
  DAILY_LIMIT_REACHED: "Se alcanzó el límite diario de creación",
  ABSENCE_NOT_PROVEN: "Falta comprobar que la cuenta no existe en IQ",
  CATALOG_STALE: "Catálogo de IQ desactualizado; se espera una lectura completa",
  LOOKUP_FAILED: "No se pudo consultar IQ; se reintenta solo",
  PARTNER_UNKNOWN: "Falta el asociado de IQ del cliente",
  ACCOUNT_IN_CATALOG: "La cuenta aparece cancelada o rechazada en IQ",
  CREATE_OUTCOME_UNKNOWN: "No se sabe si IQ la creó; se revisa sin duplicar",
  OUTCOME_UNKNOWN: "No se sabe si IQ la creó; se revisa sin duplicar",
  CREATE_NOT_SENT: "No se pudo enviar a IQ; se reintenta solo",
  PENDING_CONCILIATION: "Creada en IQ; falta que la concilien",
  EXISTS_UNRESOLVED: "IQ dice que ya existe; falta ubicarla",
  RETRY_EXHAUSTED: "Se agotaron los reintentos; requiere revisión",
};
const STATUSES: Record<string, string> = {
  PENDING_RETRY: "En espera",
  REVIEW_REQUIRED: "Requiere revisión",
  NOT_CONCILIATED: "Falta conciliar en IQ",
  NOT_FOUND: "No encontrada en IQ",
};

function reasonText(status: string, reason: string) {
  if (REASONS[reason]) return REASONS[reason];
  if (reason.startsWith("SAFETY_")) return "La protección de IQ la pausó; se reintenta solo";
  return status === "NOT_CONCILIATED" ? REASONS.PENDING_CONCILIATION : "Pendiente de vincular con IQ";
}

export default function IqBeneficiaryCreatePanel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<IqBeneficiaryCreateState | null>(null);
  const [limitText, setLimitText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await getIqBeneficiaryCreateState();
      setState(next);
      setLimitText(next.dailyLimit === null ? "" : String(next.dailyLimit));
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "No se pudo leer el estado del alta en IQ.");
    }
  }, []);

  useEffect(() => {
    if (open && !state) void load();
  }, [open, state, load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
      setMessage(done);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const saveLimit = () => {
    const trimmed = limitText.trim();
    if (trimmed !== "" && (!/^\d+$/.test(trimmed) || Number(trimmed) > 200)) {
      setMessage("El límite debe ser un entero de 0 a 200, o vacío para no tener límite.");
      return;
    }
    void run(() => setIqBeneficiaryCreateConfig({ dailyLimit: trimmed === "" ? null : Number(trimmed) }), trimmed === "" ? "Sin límite diario." : `Límite diario: ${trimmed}.`);
  };

  const toggle = (field: "enabled" | "contractVerified", value: boolean) => {
    const label = field === "enabled" ? "Creación automática en IQ" : "Contrato verificado";
    if (value && !window.confirm(field === "enabled"
      ? "Esto permite que PAY0 cree beneficiarios en IQ de forma automática. ¿Encender?"
      : "Confirma que ya se comprobó con una creación real que el contrato con IQ funciona. ¿Marcar como verificado?")) return;
    void run(() => setIqBeneficiaryCreateConfig({ [field]: value }), `${label}: ${value ? "encendido" : "apagado"}.`);
  };

  const retry = (methodId?: string) => {
    if (!window.confirm("Se reintentará vincular o crear en IQ. Solo se crea si las compuertas lo permiten. ¿Continuar?")) return;
    void run(async () => {
      const result = await retryIqBeneficiaryLinks(methodId ? { methodId } : {});
      setMessage(`Reintentadas: ${result.retried}.`);
    }, "Reintento terminado.");
  };

  const retriable = state?.pending.filter((row) => row.retriable) ?? [];
  const switchClass = (on: boolean) =>
    `rounded-xl border px-3 py-1.5 text-[13px] transition disabled:opacity-60 ${on ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-300"}`;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] text-slate-200">
        <span>Alta automática de beneficiarios en IQ</span>
        <span className="text-slate-500">{open ? "Ocultar" : "Mostrar"}</span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-slate-800 px-4 py-4 text-[13px] text-slate-300">
          {!state ? <div className="text-slate-500">Cargando...</div> : (
            <>
              {!state.masterEnabled ? <div className="rounded-xl border border-orange-400/40 bg-orange-500/10 px-3 py-2 text-orange-200">La integración con IQ está apagada: nada se creará hasta encenderla en Integraciones.</div> : null}

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy} onClick={() => toggle("enabled", !state.enabled)} className={switchClass(state.enabled)}>
                  Creación automática: {state.enabled ? "encendida" : "apagada"}
                </button>
                <button type="button" disabled={busy} onClick={() => toggle("contractVerified", !state.contractVerified)} className={switchClass(state.contractVerified)}>
                  Contrato verificado: {state.contractVerified ? "sí" : "no"}
                </button>
                <label className="flex items-center gap-2">
                  <span>Límite diario</span>
                  <input
                    value={limitText}
                    onChange={(event) => setLimitText(event.target.value)}
                    placeholder="Sin límite"
                    inputMode="numeric"
                    className="h-[34px] w-[110px] rounded-xl border border-slate-800 bg-slate-950/80 px-3 text-white outline-none placeholder:text-slate-500"
                  />
                  <button type="button" disabled={busy} onClick={saveLimit} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 transition disabled:opacity-60">Guardar</button>
                </label>
                <span className="text-slate-500">Creadas hoy: {state.createdToday}</span>
              </div>

              <div className="space-y-1 text-slate-400">
                {state.catalogs.map((catalog) => (
                  <div key={catalog.catalog}>
                    Catálogo de IQ: {catalog.partnerSyncedAtMs ? `lectura completa el ${formatDateTime24(new Date(catalog.partnerSyncedAtMs))}` : "aún sin una lectura completa reciente"}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <div className="text-slate-200">Cuentas que aún no están en IQ ({state.pending.length})</div>
                <button type="button" disabled={busy || retriable.length === 0} onClick={() => retry()} className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-amber-200 transition disabled:opacity-50">
                  Reintentar todas
                </button>
              </div>

              {state.pending.length === 0 ? <div className="text-slate-500">No hay cuentas pendientes.</div> : (
                <div className="overflow-x-auto">
                  <table className="min-w-[720px] text-left text-[12px]">
                    <thead className="text-slate-500">
                      <tr><th className="py-1 pr-3">Beneficiario</th><th className="pr-3">Cliente</th><th className="pr-3">Cuenta</th><th className="pr-3">Estatus</th><th className="pr-3">Motivo</th><th /></tr>
                    </thead>
                    <tbody>
                      {state.pending.map((row) => (
                        <tr key={`${row.methodId}-${row.catalog}`} className="border-t border-slate-800/70">
                          <td className="py-1 pr-3 text-slate-200">{row.beneficiaryName || "-"}</td>
                          <td className="pr-3">{row.clientName || "-"}</td>
                          <td className="pr-3">{row.bankName || "-"} ****{row.last4 || "----"}</td>
                          <td className="pr-3">{STATUSES[row.status] || "Pendiente"}</td>
                          <td className="pr-3">{reasonText(row.status, row.reason)}</td>
                          <td>
                            {row.retriable ? (
                              <button type="button" disabled={busy} onClick={() => retry(row.methodId)} className="rounded-lg border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-amber-400/50 disabled:opacity-50">Reintentar</button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {message ? <div className="text-slate-400">{message}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
