"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import { useGlobalLoading } from "@/components/GlobalLoading";
import {
  linkSolicitudToMaterialityOperation,
  readMaterialityOperation,
  type MaterialityOperation,
} from "@/services/materiality";

type Props = {
  open: boolean;
  solicitud: any;
  onClose: () => void;
};

const REQUIRED_LABELS: Record<string, string> = {
  CONTRATO_MARCO: "Contrato marco",
  ORDEN_COMPRA: "Orden de Compra",
  PRESUPUESTO: "Presupuesto / Cotizacion",
  FACTURA_XML: "Factura XML",
  FACTURA_PDF: "Factura PDF",
  COMPROBANTE_PAGO: "Comprobante de Pago",
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function labelDocType(type: string): string {
  return REQUIRED_LABELS[type] || type || "Documento";
}

function money(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getSolicitudId(solicitud: any): string {
  return cleanText(solicitud?.id || solicitud?.solicitudId);
}

function getStatusClass(status: string) {
  const s = cleanText(status).toUpperCase();

  if (s === "COMPLETE") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }

  if (s === "CANCELLED") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-300";
  }

  if (s === "INCOMPLETE") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }

  return "border-sky-500/20 bg-sky-500/10 text-sky-300";
}

function getStatusLabel(status: string) {
  const s = cleanText(status).toUpperCase();

  if (s === "COMPLETE") return "Completo";
  if (s === "INCOMPLETE") return "Incompleto";
  if (s === "CANCELLED") return "Cancelado";
  if (s === "OPEN") return "Abierto";

  return "Pendiente";
}

export default function MaterialityModal({ open, solicitud, onClose }: Props) {
  const globalLoading = useGlobalLoading();

  const solicitudId = getSolicitudId(solicitud);
  const [operation, setOperation] = useState<MaterialityOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;

    setOperation(null);
    setMsg("");
  }, [open, solicitudId]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  const localStatus = cleanText(solicitud?.materialityStatus);
  const status = cleanText(operation?.status || localStatus || "OPEN");

  const completedTypes = useMemo(() => {
    return Array.isArray(operation?.completedTypes)
      ? operation.completedTypes
      : [];
  }, [operation]);

  const missingTypes = useMemo(() => {
    if (Array.isArray(operation?.missingTypes)) return operation.missingTypes;
    if (Array.isArray(solicitud?.materialityMissingTypes)) return solicitud.materialityMissingTypes;
    return [];
  }, [operation, solicitud]);

  const requiredTypes = useMemo(() => {
    if (Array.isArray(operation?.requiredTypes) && operation.requiredTypes.length > 0) {
      return operation.requiredTypes;
    }

    return [
      "CONTRATO_MARCO",
      "ORDEN_COMPRA",
      "PRESUPUESTO",
      "FACTURA_XML",
      "FACTURA_PDF",
      "COMPROBANTE_PAGO",
    ];
  }, [operation]);

  async function syncMateriality() {
    if (!solicitudId || busy) return;

    setBusy(true);
    setMsg("");

    try {
      await globalLoading.run(undefined, async () => {
        const linked = await linkSolicitudToMaterialityOperation({ solicitudId });
        const read = await readMaterialityOperation({ solicitudId });

        setOperation(
          read.operation || {
            id: linked.materialityOperationId,
            solicitudId,
            materialityClientCompanyId: linked.materialityClientCompanyId,
            status: linked.status,
            completedTypes: linked.completedTypes,
            missingTypes: linked.missingTypes,
            missingTypeLabels: linked.missingTypes.map(labelDocType),
          }
        );

        setMsg("Expediente sincronizado.");
      });
    } catch (error: any) {
      setMsg(
        error?.message ||
          "No se pudo sincronizar. En localhost sin deploy/emulator esto es esperado."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open || !solicitud) return null;

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        className="relative flex max-h-[86vh] w-full max-w-4xl flex-col overflow-visible rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
          aria-label="Cerrar"
          title="Cerrar"
        >
          <X size={16} strokeWidth={1.9} />
        </button>

        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-normal text-white">
                <FolderOpen size={18} className="text-amber-300" />
                Expediente de materialidad
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {solicitud?.folio || solicitudId || "Solicitud"} · {solicitud?.clienteNombre || "---"}
              </div>
            </div>

            <span
              className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-normal uppercase tracking-widest ${getStatusClass(status)}`}
            >
              <ShieldCheck size={13} />
              {getStatusLabel(status)}
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Cliente</div>
              <div className="mt-1 truncate text-sm text-white">{solicitud?.clienteNombre || "---"}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Empresa PAY0</div>
              <div className="mt-1 truncate text-sm text-white">{solicitud?.empresaNombre || "---"}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Monto</div>
              <div className="mt-1 text-sm text-white">{money(solicitud?.monto)}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Folio</div>
              <div className="mt-1 truncate text-sm text-sky-300">{solicitud?.folio || solicitudId || "---"}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-normal uppercase tracking-widest text-slate-300">
                  Documentos requeridos
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Esta vista no duplica archivos; resume lo que ya vive en uploads/documentos.
                </div>
              </div>

              <button
                type="button"
                onClick={syncMateriality}
                disabled={busy || !solicitudId}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] font-normal uppercase text-amber-200 transition hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
                {busy ? "Sincronizando" : "Sincronizar expediente"}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {requiredTypes.map((type) => {
                const complete = completedTypes.includes(type) || (!missingTypes.includes(type) && !!operation);

                return (
                  <div
                    key={type}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-[12px] ${
                      complete
                        ? "border-emerald-500/15 bg-emerald-500/5 text-emerald-200"
                        : "border-white/10 bg-white/[0.03] text-slate-300"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {complete ? <CheckCircle2 size={15} /> : <FileCheck2 size={15} />}
                      {labelDocType(type)}
                    </span>

                    <span className="text-[10px] uppercase tracking-widest text-slate-500">
                      {complete ? "OK" : "Pendiente"}
                    </span>
                  </div>
                );
              })}
            </div>

            {missingTypes.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 text-[12px] text-amber-200">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-normal">Faltan documentos para cerrar expediente.</div>
                  <div className="mt-1 text-amber-100/75">
                    {missingTypes.map(labelDocType).join(", ")}
                  </div>
                </div>
              </div>
            )}

            {msg && (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-[12px] text-slate-300">
                {msg}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-sky-400/10 bg-sky-400/[0.04] p-4 text-[12px] text-slate-300">
            <div className="font-normal text-sky-200">Siguiente fase</div>
            <div className="mt-1 text-slate-400">
              Despues se agregara contrato marco cliente-empresa, presupuesto generado por PAY0,
              token publico/privado, QR verificable y pagina publica segura.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}