"use client";

import { useState } from "react";
import { useUserProfile } from "@/lib/useUserProfile";
import {
  diagnosePagoFinancialContext,
  preparePagoFinancialPosting,
} from "@/services/pagosFinancial";

export default function PagosReprocesoPage() {
  const { profile } = useUserProfile();
  const role = String((profile as any)?.role || "").trim().toLowerCase();
  const isSuperadmin = role === "superadmin";

  const [pagoId, setPagoId] = useState("");
  const [operationTypeKey, setOperationTypeKey] = useState("01");
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState("");

  async function handleDiagnose() {
    setLoading(true);
    setResultText("");

    try {
      const data = await diagnosePagoFinancialContext({
        pagoId: pagoId.trim(),
        operationTypeKey: operationTypeKey.trim().toUpperCase(),
      });

      setResultText(JSON.stringify(data, null, 2));
    } catch (error: any) {
      setResultText(error?.message || "Error al diagnosticar pago.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReprocess() {
    setLoading(true);
    setResultText("");

    try {
      const data = await preparePagoFinancialPosting({
        pagoId: pagoId.trim(),
        operationTypeKey: operationTypeKey.trim().toUpperCase(),
        postNow: true,
      });

      setResultText(JSON.stringify(data, null, 2));
    } catch (error: any) {
      setResultText(error?.message || "Error al reprocesar pago.");
    } finally {
      setLoading(false);
    }
  }

  if (!isSuperadmin) {
    return (
      <div className="p-6 text-white">
        <h1 className="text-2xl font-bold">Reproceso pago financiero</h1>
        <p className="mt-4 text-rose-400">Solo superadmin puede usar esta pantalla.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Reproceso pago financiero</h1>
        <p className="text-sm text-slate-400">
          Diagnostico y reproceso canonico de pagos conciliados que no pegaron en wallet.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-slate-300">Pago ID</label>
            <input
              value={pagoId}
              onChange={(e) => setPagoId(e.target.value)}
              placeholder="ID del pago"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-300">operationTypeKey</label>
            <input
              value={operationTypeKey}
              onChange={(e) => setOperationTypeKey(e.target.value.toUpperCase())}
              placeholder="01"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleDiagnose}
            disabled={loading || !pagoId.trim() || !operationTypeKey.trim()}
            className="rounded-xl border border-sky-600 px-4 py-2 text-sky-300 disabled:opacity-50"
          >
            {loading ? "Procesando..." : "Diagnosticar"}
          </button>

          <button
            type="button"
            onClick={handleReprocess}
            disabled={loading || !pagoId.trim() || !operationTypeKey.trim()}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {loading ? "Procesando..." : "Reprocesar y postear"}
          </button>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Resultado</label>
          <pre className="min-h-[320px] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200 whitespace-pre-wrap">
            {resultText || "Sin ejecucion."}
          </pre>
        </div>
      </div>
    </div>
  );
}