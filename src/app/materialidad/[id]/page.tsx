"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  FileText,
  FolderOpen,
  ReceiptText,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";

import { formatDateTime24 } from "@/lib/dateTime";
import { formatMoneyMXN } from "@/lib/money";
import { mergeModules } from "@/lib/roles";
import { useUserProfile } from "@/lib/useUserProfile";
import { getLocalMaterialityOverview } from "@/lib/materialityLocalPreview";
import { getMaterialityClientCompanyOverview } from "@/services/materiality";

const DEFAULT_REQUIRED_TYPES = [
  "ORDEN_COMPRA",
  "PRESUPUESTO",
  "FACTURA_XML",
  "FACTURA_PDF",
  "COMPROBANTE_PAGO",
];

function documentLabel(type: string) {
  switch (String(type || "").toUpperCase()) {
    case "CONTRATO_MARCO":
      return "Contrato marco";
    case "ORDEN_COMPRA":
      return "Orden de Compra";
    case "PRESUPUESTO":
      return "Presupuesto / Cotizacion";
    case "FACTURA_XML":
      return "Factura XML";
    case "FACTURA_PDF":
      return "Factura PDF";
    case "COMPROBANTE_PAGO":
      return "Comprobante de Pago";
    case "EVIDENCIA_OPERATIVA":
      return "Evidencia Operativa";
    case "OTRO":
      return "Otro";
    default:
      return type || "Documento";
  }
}

function statusLabel(status: string | undefined | null) {
  const value = String(status || "").toUpperCase();
  if (value === "COMPLETE") return "Completo";
  if (value === "INCOMPLETE") return "Con faltantes";
  if (value === "NO_OPERATIONS") return "Sin operaciones";
  if (value === "CANCELLED") return "Cancelado";
  return value || "Sin estado";
}

function statusClass(status: string | undefined | null) {
  const value = String(status || "").toUpperCase();
  if (value === "COMPLETE") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
  if (value === "INCOMPLETE") return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  if (value === "CANCELLED") return "border-rose-400/25 bg-rose-400/10 text-rose-100";
  return "border-slate-400/20 bg-slate-400/10 text-slate-200";
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function StatBox({
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

function OperationCard({ operation }: { operation: any }) {
  const missing = uniqueValues(operation.missingTypes || []);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121827] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-100">
            {operation.solicitudFolio || operation.solicitudId || operation.id}
          </p>
          <p className="mt-1 text-xs text-slate-500">{operation.concepto || "Operacion sin concepto"}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(operation.status)}`}>
            {statusLabel(operation.status)}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
            {formatMoneyMXN(Number(operation.monto || 0))}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-slate-500">Orden de compra</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{operation.ordenCompraUploadId ? "Detectada" : "Pendiente"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-slate-500">Factura PDF/XML</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {operation.facturaPdfUploadId || operation.facturaXmlUploadId ? "Detectada" : "Pendiente"}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-slate-500">Comprobante de pago</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {operation.comprobantePagoUploadId ? "Detectado desde Pagos" : "Pendiente"}
          </p>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Faltantes de esta operacion</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missing.map((type) => (
              <span key={type} className="rounded-full border border-amber-300/20 bg-black/10 px-3 py-1 text-xs text-amber-50">
                {documentLabel(type)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          Operacion sin faltantes requeridos detectados.
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Ultima revision: {formatDateTime24(operation.updatedAt || operation.createdAt)}
      </p>
    </div>
  );
}

export default function MaterialityDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const materialityClientCompanyId = decodeURIComponent(
    Array.isArray(rawId) ? String(rawId[0] || "") : String(rawId || "")
  );

  const { profile, loading } = useUserProfile();
  const [overview, setOverview] = useState<any>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canViewMaterialidad = !!modules?.materialidad?.view;

  async function loadOverview() {
    if (!canViewMaterialidad || !materialityClientCompanyId) return;

    setLoadingOverview(true);
    setError(null);

    try {
      const result = await getMaterialityClientCompanyOverview({ materialityClientCompanyId });
      setOverview(result);
    } catch (err: any) {
      const isLocalPreview =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

      if (isLocalPreview) {
        setOverview(getLocalMaterialityOverview(materialityClientCompanyId));
        setError("Modo local preview: detalle con expediente demo. El dato real requiere callable desplegada o emulator.");
      } else {
        setError(err?.message || "No se pudo cargar el expediente.");
      }
    } finally {
      setLoadingOverview(false);
    }
  }

  useEffect(() => {
    if (!loading && canViewMaterialidad) {
      void loadOverview();
    }
  }, [loading, canViewMaterialidad, materialityClientCompanyId]);

  const folder = overview?.folder;
  const operations = overview?.operations || [];
  const contracts = overview?.contracts || [];
  const summary = overview?.summary || {};

  const requiredTypes = useMemo(() => {
    const fromSummary = uniqueValues(summary?.requiredTypes || []);
    if (fromSummary.length > 0) return fromSummary;
    const fromOperations = uniqueValues(operations.flatMap((operation: any) => operation.requiredTypes || []));
    return fromOperations.length > 0 ? fromOperations : DEFAULT_REQUIRED_TYPES;
  }, [operations, summary]);

  const completedTypes = useMemo(() => {
    const fromSummary = uniqueValues(summary?.completedTypes || []);
    if (fromSummary.length > 0) return fromSummary;
    return uniqueValues(operations.flatMap((operation: any) => operation.completedTypes || []));
  }, [operations, summary]);

  const missingTypes = useMemo(() => {
    const fromSummary = uniqueValues(summary?.missingTypes || []);
    if (fromSummary.length > 0) return fromSummary;
    return uniqueValues(operations.flatMap((operation: any) => operation.missingTypes || []));
  }, [operations, summary]);

  const completedSet = useMemo(() => new Set(completedTypes.map((type) => type.toUpperCase())), [completedTypes]);
  const missingSet = useMemo(() => new Set(missingTypes.map((type) => type.toUpperCase())), [missingTypes]);

  const titleCliente = folder?.clienteNombre || folder?.clienteId || "Cliente";
  const titleCompany = folder?.companyName || folder?.companyId || "Empresa";

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
          <Link href="/materialidad" className="inline-flex items-center gap-2 text-sm font-semibold text-sky-200 hover:text-sky-100">
            <ArrowLeft size={16} />
            Volver a Materialidad
          </Link>

          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">PAY0 auditoria interna</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-50">Detalle interno de expediente</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {titleCliente} / {titleCompany}
          </p>
          <p className="mt-1 text-xs text-slate-500">ID expediente: {materialityClientCompanyId}</p>
        </div>

        <button
          type="button"
          onClick={loadOverview}
          disabled={loadingOverview}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCcw size={16} className={loadingOverview ? "animate-spin" : ""} />
          Actualizar expediente
        </button>
      </div>

      {error ? (
        <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">{error}</div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatBox icon={FolderOpen} title="Operaciones" value={summary?.operationCount ?? operations.length} helper="Solicitudes vinculadas internamente." />
        <StatBox icon={AlertTriangle} title="Faltantes" value={missingTypes.length} helper="Alertas documentales internas." />
        <StatBox icon={CheckCircle2} title="Contratos" value={summary?.contractCount ?? contracts.length} helper="Contrato marco no requerido por default." />
        <StatBox icon={ReceiptText} title="Monto activo" value={formatMoneyMXN(Number(summary?.totalAmount || 0))} helper="Suma de operaciones activas." />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <FileCheck2 size={17} className="text-emerald-300" />
            Resumen documental
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Checklist fiscal interno. No se muestra en Solicitudes.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {requiredTypes.map((type) => {
              const normalized = type.toUpperCase();
              const isCompleted = completedSet.has(normalized);
              const isMissing = missingSet.has(normalized) || !isCompleted;

              return (
                <div
                  key={type}
                  className={`rounded-xl border p-4 ${
                    isMissing
                      ? "border-amber-400/20 bg-amber-400/10"
                      : "border-emerald-400/15 bg-emerald-400/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{documentLabel(type)}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {isMissing ? "Pendiente / no detectado" : "Detectado"}
                      </p>
                    </div>
                    {isMissing ? (
                      <AlertTriangle size={18} className="text-amber-200" />
                    ) : (
                      <CheckCircle2 size={18} className="text-emerald-200" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <ShieldCheck size={17} className="text-sky-300" />
            Estado del expediente
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-slate-500">Estado general</p>
              <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(summary?.status)}`}>
                {statusLabel(summary?.status)}
              </span>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-slate-500">Ultima revision</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{formatDateTime24(summary?.updatedAt || folder?.updatedAt)}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-slate-500">Regla fiscal</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">
                El expediente no incluye dispersiones. El comprobante de pago se toma desde pagos relacionados.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <FileText size={17} className="text-sky-300" />
          Operaciones vinculadas
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Relacion interna solicitud - expediente. Esta informacion se consulta aqui, no desde Solicitudes.
        </p>

        <div className="mt-5 space-y-3">
          {operations.length > 0 ? (
            operations.map((operation: any) => <OperationCard key={operation.id} operation={operation} />)
          ) : (
            <div className="rounded-xl border border-white/10 bg-[#121827] p-4 text-sm text-slate-400">
              Sin operaciones vinculadas.
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <FileText size={17} className="text-emerald-300" />
          Contratos / soporte marco
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Contrato marco puede existir como soporte, pero no es requerido por default para completar operaciones.
        </p>

        <div className="mt-5 space-y-3">
          {contracts.length > 0 ? (
            contracts.map((contract: any) => (
              <div key={contract.id} className="rounded-xl border border-white/10 bg-[#121827] p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{contract.documentType || "Contrato marco"}</p>
                    <p className="mt-1 text-xs text-slate-500">Version: {contract.version || 1}</p>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                    {contract.status || "Registrado"}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-white/10 bg-[#121827] p-4 text-sm text-slate-400">
              Sin contrato marco registrado. Esto no bloquea el expediente por default.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}