"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderOpen,
  RefreshCcw,
  Search,
  ShieldAlert,
} from "lucide-react";

import { formatMoneyMXN } from "@/lib/money";
import { mergeModules } from "@/lib/roles";
import { useUserProfile } from "@/lib/useUserProfile";
import { getLocalMaterialityDashboard } from "@/lib/materialityLocalPreview";
import { getMaterialityDashboard } from "@/services/materiality";

function statusLabel(status: string | undefined | null) {
  const value = String(status || "").toUpperCase();
  if (value === "COMPLETE") return "Completo";
  if (value === "INCOMPLETE") return "Con faltantes";
  if (value === "NO_OPERATIONS") return "Sin operaciones";
  return value || "Sin estado";
}

function statusClass(status: string | undefined | null) {
  const value = String(status || "").toUpperCase();
  if (value === "COMPLETE") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
  if (value === "INCOMPLETE") return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  if (value === "NO_OPERATIONS") return "border-slate-400/20 bg-slate-400/10 text-slate-200";
  return "border-sky-400/20 bg-sky-400/10 text-sky-100";
}

function StatCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  helper: string;
  icon: any;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-50">{value}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sky-200">
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-400">{helper}</p>
    </div>
  );
}

export default function MaterialidadPage() {
  const { profile, loading } = useUserProfile();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canViewMaterialidad = !!modules?.materialidad?.view;

  async function loadDashboard() {
    if (!canViewMaterialidad) return;

    setLoadingDashboard(true);
    setError(null);

    try {
      const result = await getMaterialityDashboard();
      setDashboard(result);
    } catch (err: any) {
      const isLocalPreview =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

      if (isLocalPreview) {
        setDashboard(getLocalMaterialityDashboard());
        setError("Modo local preview: tablero con expediente demo. El dato real requiere callable desplegada o emulator.");
      } else {
        setError(err?.message || "No se pudo cargar Materialidad.");
      }
    } finally {
      setLoadingDashboard(false);
    }
  }

  useEffect(() => {
    if (!loading && canViewMaterialidad) {
      void loadDashboard();
    }
  }, [loading, canViewMaterialidad]);

  const folders = Array.isArray(dashboard?.folders) ? dashboard.folders : [];
  const alerts = Array.isArray(dashboard?.alerts) ? dashboard.alerts : [];
  const summary = dashboard?.summary || {};

  const filteredFolders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return folders.filter((folder: any) => {
      const status = String(folder.status || "").toUpperCase();
      const matchesStatus = statusFilter === "ALL" || status === statusFilter;
      const haystack = [
        folder.clienteNombre,
        folder.clienteId,
        folder.companyName,
        folder.companyId,
        folder.materialityClientCompanyId,
        folder.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [folders, query, statusFilter]);

  if (loading) {
    return <div className="w-full max-w-none px-4 py-6 text-slate-300">Cargando materialidad...</div>;
  }

  if (!canViewMaterialidad) {
    return (
      <div className="w-full max-w-none px-4 py-6">
        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-5 text-sm text-slate-300">
          No tienes permiso para ver Materialidad.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none px-4 py-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">PAY0 auditoria interna</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-50">Materialidad / Expediente</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
            Tablero interno para revision fiscal, alertas documentales y trazabilidad por Cliente + Empresa. Solicitudes se mantiene limpio.
          </p>
        </div>

        <button
          type="button"
          onClick={loadDashboard}
          disabled={loadingDashboard}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCcw size={16} className={loadingDashboard ? "animate-spin" : ""} />
          Actualizar tablero
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FolderOpen} title="Expedientes" value={summary.totalFolders ?? folders.length} helper="Cliente + Empresa con carpeta interna." />
        <StatCard icon={AlertTriangle} title="Con faltantes" value={summary.incompleteFolders ?? 0} helper="Expedientes con alerta documental." />
        <StatCard icon={CheckCircle2} title="Completos" value={summary.completeFolders ?? 0} helper="Sin faltantes requeridos detectados." />
        <StatCard icon={Database} title="Monto activo" value={formatMoneyMXN(Number(summary.totalActiveAmount || 0))} helper="Suma operativa vinculada." />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <ShieldAlert size={17} className="text-emerald-300" />
                Tablero de expedientes
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Vista interna. No se expone desde Solicitudes.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar cliente o empresa"
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#101827] pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400/30 sm:w-72"
                />
              </label>

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 rounded-xl border border-white/10 bg-[#101827] px-3 text-sm text-slate-100 outline-none focus:border-sky-400/30"
              >
                <option value="ALL">Todos</option>
                <option value="INCOMPLETE">Con faltantes</option>
                <option value="COMPLETE">Completos</option>
                <option value="NO_OPERATIONS">Sin operaciones</option>
              </select>
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              {error}
            </div>
          ) : null}

          <div className="mt-5 space-y-3">
            {filteredFolders.length > 0 ? (
              filteredFolders.map((folder: any) => {
                const folderId = folder.materialityClientCompanyId || folder.id;
                const missingLabels = Array.isArray(folder.missingTypeLabels) ? folder.missingTypeLabels : [];

                return (
                  <div key={folderId} className="rounded-2xl border border-white/10 bg-[#121827] p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">
                          {folder.clienteNombre || folder.clienteId || "Cliente"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {folder.companyName || folder.companyId || "Empresa"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(folder.status)}`}>
                          {statusLabel(folder.status)}
                        </span>

                        <Link
                          href={`/materialidad/${encodeURIComponent(folder.materialityClientCompanyId || folder.id)}`}
                          className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-400/15"
                        >
                          Ver expediente
                        </Link>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-xs text-slate-500">Operaciones</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{folder.operationCount || 0}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-xs text-slate-500">Monto activo</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{formatMoneyMXN(Number(folder.totalAmount || 0))}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-xs text-slate-500">Faltantes</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{missingLabels.length}</p>
                      </div>
                    </div>

                    {missingLabels.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {missingLabels.map((label: string) => (
                          <span key={label} className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-white/10 bg-[#121827] p-4 text-sm text-slate-400">
                Sin expedientes para mostrar. Cuando existan relaciones internas de materialidad, apareceran aqui.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <AlertTriangle size={17} />
              Alertas internas
            </div>
            <p className="mt-2 text-sm leading-6 text-amber-50/90">
              Las alertas de materialidad viven aqui. Solicitudes no muestra checklist fiscal ni boton de expediente.
            </p>

            <div className="mt-4 space-y-2">
              {alerts.length > 0 ? (
                alerts.map((alert: any) => (
                  <div key={alert.id} className="rounded-xl border border-amber-300/20 bg-black/10 p-3">
                    <p className="text-xs font-semibold text-amber-100">{alert.title}</p>
                    <p className="mt-1 text-xs leading-5 text-amber-50/80">{alert.message}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs text-emerald-100">
                  Sin alertas documentales.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-5">
            <p className="text-sm font-semibold text-slate-100">Canon M1-D5-G</p>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Relacion interna: solicitud - operacion material - expediente Cliente + Empresa.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Operacion diaria limpia: nada de Materialidad dentro de Solicitudes.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Smoke local: expediente demo solo para validar tablero y detalle sin deploy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}