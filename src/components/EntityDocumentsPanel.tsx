"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Download, FileText, Plus, RefreshCw, RotateCcw, UploadCloud, X } from "lucide-react";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "@/lib/firebaseClient";

import {
  deactivateEntityDocument,
  reactivateEntityDocument,
  readEntityDocuments,
  type EntityDocumentEntityType,
  type EntityDocumentFiscalAdminType,
  type EntityDocumentLegalPersonType,
  type EntityDocumentRecord,
  type EntityDocumentType,
} from "@/services/entityDocuments";
import { uploadEntityDocument } from "@/lib/uploadEntityDocument";
import UiSelect from "@/components/UiSelect";



function toEntityDocumentDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "object") {
    const maybeTimestamp = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    };

    if (typeof maybeTimestamp.toDate === "function") {
      const parsed = maybeTimestamp.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const seconds =
      typeof maybeTimestamp.seconds === "number"
        ? maybeTimestamp.seconds
        : typeof maybeTimestamp._seconds === "number"
          ? maybeTimestamp._seconds
          : null;

    if (seconds !== null) {
      return new Date(seconds * 1000);
    }
  }

  return null;
}

function formatEntityDocumentDate(value: unknown): string {
  const date = toEntityDocumentDate(value);
  if (!date) return "---";

  return date.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getEntityDocumentUploadedDate(row: EntityDocumentRecord): string {
  return formatEntityDocumentDate(row.finalizedAt || row.createdAt);
}


function getEntityDocumentValidationLabel(row: EntityDocumentRecord): string {
  const status = row.validationStatus || "PENDIENTE_VALIDACION";

  switch (status) {
    case "VALIDADO":
      return "Validado";
    case "RECHAZADO":
      return "Rechazado";
    case "VALIDACION_FALLIDA":
      return "Fallo validacion";
    case "NO_APLICA":
      return "No aplica";
    case "PENDIENTE_VALIDACION":
    default:
      return "Pendiente validacion";
  }
}

function getEntityDocumentValidationClass(row: EntityDocumentRecord): string {
  const status = row.validationStatus || "PENDIENTE_VALIDACION";

  switch (status) {
    case "VALIDADO":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
    case "RECHAZADO":
    case "VALIDACION_FALLIDA":
      return "border-rose-400/20 bg-rose-400/10 text-rose-200";
    case "NO_APLICA":
      return "border-slate-400/20 bg-slate-400/10 text-slate-300";
    case "PENDIENTE_VALIDACION":
    default:
      return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  }
}


function isEntityDocumentDownloadable(row: EntityDocumentRecord): boolean {
  const status = String(row.status || "").toUpperCase();
  return Boolean(row.storagePath) && row.active !== false && status !== "INACTIVE" && status !== "REPLACED";
}

function getEntityDocumentDownloadName(row: EntityDocumentRecord): string {
  return (
    row.fileName ||
    row.filename ||
    row.originalName ||
    row.storagePath?.split("/").pop() ||
    "documento"
  );
}
type Props = {
  entityType: EntityDocumentEntityType;
  entityId: string;
  canManage: boolean;
  scopeLabel?: string;
};

const DOCUMENT_TYPES: Array<{ value: EntityDocumentType; label: string; period: boolean }> = [
  { value: "ACTA_CONSTITUTIVA", label: "Acta constitutiva", period: false },
  { value: "CONSTANCIA_SITUACION_FISCAL", label: "Constancia situacion fiscal", period: true },
  { value: "OPINION_SAT", label: "Opinion SAT", period: true },
  { value: "OPINION_IMSS", label: "Opinion IMSS", period: true },
  { value: "OPINION_INFONAVIT", label: "Opinion INFONAVIT", period: true },
  { value: "OPINION_ESTATAL", label: "Opinion estatal", period: true },
  { value: "RFC", label: "RFC", period: false },
  { value: "CURP", label: "CURP", period: false },
  { value: "IDENTIFICACION_OFICIAL", label: "Identificacion oficial", period: false },
  { value: "COMPROBANTE_DOMICILIO", label: "Comprobante domicilio", period: false },
  { value: "PODER_REPRESENTANTE", label: "Poder representante", period: false },
  { value: "ESTADO_CUENTA", label: "Estado de cuenta", period: true },
  { value: "DECLARACION_MENSUAL", label: "Declaracion mensual", period: true },
  { value: "DECLARACION_ANUAL", label: "Declaracion anual", period: true },
  { value: "PAGO_IMPUESTOS", label: "Pago impuestos", period: true },
  { value: "ALTA_PATRONAL", label: "Alta patronal", period: false },
  { value: "IMSS", label: "IMSS", period: true },
  { value: "ALTA_BAJA_TRABAJADOR", label: "Alta/Baja trabajador", period: true },
  { value: "CSD_EFIRMA", label: "CSD / e.firma", period: false },
  { value: "DOCUMENTO_CONTABLE", label: "Documento contable", period: true },
  { value: "OTRO", label: "Otro", period: false },
];

const LEGAL_PERSON_TYPES: Array<{ value: EntityDocumentLegalPersonType; label: string }> = [
  { value: "PERSONA_MORAL", label: "Persona moral" },
  { value: "PERSONA_FISICA", label: "Persona fisica" },
  { value: "PERSONA_FISICA_ACTIVIDAD_EMPRESARIAL", label: "PFAE" },
];

const FISCAL_ADMIN_TYPES: Array<{ value: EntityDocumentFiscalAdminType; label: string }> = [
  { value: "SOLO_OPERATIVO", label: "Solo operativo" },
  { value: "CLIENTE_ADMINISTRADO", label: "Cliente administrado" },
  { value: "TERCERO", label: "Tercero" },
  { value: "PROPIA_PAY0", label: "Propia PAY0" },
];

function formatSize(bytes?: number | null) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "---";

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }

  return `${value} B`;
}

function formatDate(value: any) {
  if (!value) return "---";

  const seconds = Number(value?.seconds || 0);
  if (seconds > 0) {
    return new Date(seconds * 1000).toLocaleDateString("es-MX");
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("es-MX");
  }

  return "---";
}

function getDocumentLabel(type: EntityDocumentType) {
  return DOCUMENT_TYPES.find((item) => item.value === type)?.label || type;
}

function isPeriodicDocument(type: EntityDocumentType) {
  return DOCUMENT_TYPES.some((item) => item.value === type && item.period);
}

function currentYear() {
  return new Date().getFullYear();
}

function currentMonth() {
  return new Date().getMonth() + 1;
}

function isLocalPreview() {
  if (typeof window === "undefined") return false;

  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export default function EntityDocumentsPanel({ entityType, entityId, canManage, scopeLabel = "entidad" }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const localPreview = false;

  const [docs, setDocs] = useState<EntityDocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const [documentType, setDocumentType] =
    useState<EntityDocumentType | "">("");
  const [legalPersonType, setLegalPersonType] =
    useState<EntityDocumentLegalPersonType | "">("");
  const [fiscalAdminType, setFiscalAdminType] =
    useState<EntityDocumentFiscalAdminType>("SOLO_OPERATIVO");
  const [periodYear, setPeriodYear] = useState(currentYear());
  const [periodMonth, setPeriodMonth] = useState(currentMonth());
  const [notes, setNotes] = useState("");

  const requiresPeriod = useMemo(() => Boolean(documentType) && isPeriodicDocument(documentType as EntityDocumentType), [documentType]);

  const loadDocs = useCallback(async () => {
    if (!entityId || !canManage) {
      setDocs([]);
      return;
    }

        if (localPreview) {
      setDocs([]);
      setErr("");
      setLoading(false);
      return;
    }
setLoading(true);
    setErr("");

    try {
      const result = await readEntityDocuments({
        entityType,
        entityId,
      });

      setDocs(result.documents || []);
    } catch (error: any) {
      setErr(error?.message || "No se pudo cargar papeleria fiscal/legal.");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, canManage, localPreview]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);
  useEffect(() => {
    if (!uploadModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setUploadModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [uploadModalOpen, busy]);


  async function handleUpload() {
    if (!canManage || busy) return;

        if (localPreview) {
      setErr("Modo local preview: subida deshabilitada hasta deploy o emulator.");
      return;
    }
if (!documentType) {

  setErr("Selecciona tipo documento.");

  return;

}

    if (!legalPersonType) {
      setErr("Selecciona persona fiscal.");
      return;
    }



const file = fileInputRef.current?.files?.[0];

if (!file) {
      setErr("Selecciona un archivo.");
      return;
    }

    setBusy(true);
    setProgress(0);
    setErr("");

    try {
      await uploadEntityDocument({
        entityType,
        entityId,
        documentType: documentType as EntityDocumentType,
        legalPersonType: legalPersonType as EntityDocumentLegalPersonType,
        fiscalAdminType,
        file,
        periodYear: requiresPeriod ? periodYear : null,
        periodMonth: requiresPeriod ? periodMonth : null,
        notes: notes.trim() || null,
        onProgress: (value) => setProgress(value.progress),
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      setNotes("");
      await loadDocs();
    } catch (error: any) {
      setErr(error?.message || "No se pudo subir el documento.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleDownload(row: EntityDocumentRecord) {
    if (!row.storagePath) {
      setErr("El documento no tiene storagePath.");
      return;
    }

    try {
      const url = await getDownloadURL(ref(storage, row.storagePath));
      const link = document.createElement("a");

      link.href = url;
      link.download = getEntityDocumentDownloadName(row);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      setErr(error?.message || "No se pudo descargar el documento.");
    }
  }

  async function handleDeactivate(row: EntityDocumentRecord) {
    if (!canManage || busy) return;

    if (localPreview) {
      setErr("Modo local preview: desactivar documentos requiere deploy o emulator.");
      return;
    }

    const ok = window.confirm("Desactivar este documento? Se conservara el historico.");
    if (!ok) return;

    setBusy(true);
    setErr("");

    try {
      await deactivateEntityDocument({
        entityDocumentId: row.id,
        reason: `Desactivado desde papeleria fiscal/legal de ${scopeLabel}.`,
      });

      await loadDocs();
    } catch (error: any) {
      setErr(error?.message || "No se pudo desactivar el documento.");
    } finally {
      setBusy(false);
    }
  }


  async function handleReactivate(row: EntityDocumentRecord) {
    if (!canManage || busy) return;

    const status = String(row.status || (row.active ? "ACTIVE" : "INACTIVE")).toUpperCase();
    if (status !== "INACTIVE") {
      setErr("Solo se pueden reactivar documentos inactivos.");
      return;
    }

    if (localPreview) {
      setErr("Modo local preview: reactivar documentos requiere deploy o emulator.");
      return;
    }

    const ok = window.confirm("Reactivar este documento? Puede reemplazar el documento vigente del mismo tipo/periodo.");
    if (!ok) return;

    setBusy(true);
    setErr("");

    try {
      await reactivateEntityDocument({
        entityDocumentId: row.id,
        reason: `Reactivado desde papeleria fiscal/legal de ${scopeLabel}.`,
      });

      await loadDocs();
    } catch (error: any) {
      setErr(error?.message || "No se pudo reactivar el documento.");
    } finally {
      setBusy(false);
    }
  }
  if (!canManage) {
    return (
      <div className="mt-5 w-full min-w-0 rounded-2xl border border-white/5 bg-[#161d2b] px-4 py-5 text-sm text-slate-400 shadow-2xl">
        Esta seccion esta disponible solo para superadmin por ahora.
      </div>
    );
  }

  return (
    <div className="mt-5 w-full min-w-0 space-y-4">
      <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="min-h-9" />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void loadDocs()}
            disabled={loading || busy}
            title="Actualizar"
            aria-label="Actualizar"
            className="h-9 rounded-xl border border-white/10 px-3 text-[11px] font-normal text-slate-400 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={15} />
          </button>

          <button
            type="button"
            onClick={() => {
              setErr("");
              setUploadModalOpen(true);
            }}
            disabled={busy || localPreview}
            className="h-9 rounded-xl bg-sky-500 px-4 text-[11px] font-normal text-black transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Agregar Papeleria
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {err}
        </div>
      )}

      <div className="w-full min-w-0 rounded-2xl border border-white/5 bg-[#161d2b] shadow-2xl overflow-x-auto">
        <table className="pay0-entity-documents-table pay0-table w-full min-w-[1260px] text-left">
          <thead className="uppercase">
            <tr className="pay0-table-head-row">
              <th className="pay0-th !text-[13px] !py-[6px] font-normal">Documento</th>
              <th className="pay0-th !text-[13px] !py-[6px] font-normal">Periodo</th>
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Version</th>
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Estado</th>
              <th className="pay0-th !text-[13px] !py-[6px] font-normal">Archivo</th>
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Subida</th>
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Doc</th>
            </tr>
          </thead>

          <tbody className="[&>tr:nth-child(odd)]:bg-white/[0.025] [&>tr:nth-child(even)]:bg-slate-950/20">
            {loading && (
              <tr>
                <td colSpan={7} className="pay0-td text-center text-slate-400">
                  Cargando documentos...
                </td>
              </tr>
            )}

            {!loading && docs.length === 0 && (
              <tr>
                <td colSpan={7} className="pay0-td text-center text-slate-400">
                  Sin documentos registrados.
                </td>
              </tr>
            )}

            {!loading &&
              docs.map((row) => {
                const status = String(row.status || (row.active ? "ACTIVE" : "INACTIVE")).toUpperCase();
                const canOpen = isEntityDocumentDownloadable(row);

                return (
                  <tr key={row.id} className="border-b border-white/5 text-[11px] font-normal text-white hover:bg-white/[0.02]">
                    <td className="pay0-td truncate" title={row.documentTypeLabel || getDocumentLabel(row.documentType)}>
                      <div className="truncate text-slate-100">
                        {row.documentTypeLabel || getDocumentLabel(row.documentType)}
                      </div>
                    </td>

                    <td className="pay0-td text-slate-300">
                      {row.documentPeriod || "---"}
                    </td>

                    <td className="pay0-td text-center text-slate-300">
                      <span className="font-mono">v{row.version || 1}</span>
                      {row.isCurrent ? (
                        <span className="ml-2 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[9px] text-emerald-200">
                          Vigente
                        </span>
                      ) : null}
                    </td>

                    <td className="pay0-td text-center">
                      <span
                        className={`inline-flex h-6 min-w-[90px] items-center justify-center rounded-full border px-3 py-1 text-[10px] uppercase tracking-tighter ${
                          status === "ACTIVE"
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                            : status === "REPLACED"
                              ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                              : "border-slate-500/20 bg-slate-500/10 text-slate-400"
                        }`}
                      >
                        {status}
                      </span>
                    </td>

                    <td className="pay0-td truncate text-slate-300" title={row.originalName || row.filename || row.fileName || row.id}>
                      <div className="truncate">
                        {row.originalName || row.filename || row.fileName || row.id}
                      </div>
                    </td>

                    <td className="pay0-td text-center text-slate-300">
                      {getEntityDocumentUploadedDate(row)}
                    </td>

                    <td className="pay0-td text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleDownload(row)}
                          disabled={!canOpen}
                          title={canOpen ? "Abrir documento" : "Documento inactivo"}
                          aria-label={canOpen ? "Abrir documento" : "Documento inactivo"}
                          className="rounded p-1 text-sky-400 transition hover:bg-sky-500/10 hover:text-sky-100 disabled:cursor-not-allowed disabled:text-slate-700 disabled:hover:bg-transparent"
                        >
                          <Download size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDeactivate(row)}
                          title="Desactivar documento"
                          aria-label="Desactivar documento"
                          disabled={busy || status !== "ACTIVE"}
                          className="rounded p-1 text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-100 disabled:cursor-not-allowed disabled:text-slate-700 disabled:hover:bg-transparent"
                        >
                          <Ban size={16} />
                        </button>

                        {status === "INACTIVE" ? (
                          <button
                            type="button"
                            onClick={() => void handleReactivate(row)}
                            title="Reactivar documento"
                            aria-label="Reactivar documento"
                            disabled={busy}
                            className="rounded p-1 text-emerald-400 transition hover:bg-emerald-500/10 hover:text-emerald-100 disabled:cursor-not-allowed disabled:text-slate-700 disabled:hover:bg-transparent"
                          >
                            <RotateCcw size={16} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {uploadModalOpen && (
        <div
          className="fixed inset-0 z-[1320] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setUploadModalOpen(false);
            }
          }}
        >
          <div className="relative w-full max-w-[420px] overflow-visible rounded-2xl border border-white/10 bg-[#161d2b] shadow-2xl shadow-black/50">
            <button
              type="button"
              onClick={() => setUploadModalOpen(false)}
              disabled={busy}
              className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X size={16} strokeWidth={1.9} />
            </button>

            <div className="space-y-4 p-5 pt-6">
              {err && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[12px] text-slate-200">
                  {err}
                </div>
              )}

              <div className="space-y-2">

                <UiSelect
                  value={documentType}
                  onChange={(value) => {
                    if (!busy) setDocumentType(value as EntityDocumentType);
                  }}
                  options={DOCUMENT_TYPES.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                  placeholder="Tipo documento"
                />
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <UiSelect
                    value={legalPersonType}
                    onChange={(value) => {
                      if (!busy) setLegalPersonType(value as EntityDocumentLegalPersonType);
                    }}
                    options={LEGAL_PERSON_TYPES.map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                    placeholder="Persona fiscal"
                  />
                </div>
              </div>

              {requiresPeriod && (
                <div className="space-y-3">
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={periodYear}
                    onChange={(event) => setPeriodYear(Number(event.target.value))}
                    disabled={busy || localPreview}
                    placeholder="Anio periodo"
                    className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[12px] text-slate-100 outline-none disabled:opacity-60"
                  />

                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={periodMonth}
                    onChange={(event) => setPeriodMonth(Number(event.target.value))}
                    disabled={busy || localPreview}
                    placeholder="Mes periodo"
                    className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[12px] text-slate-100 outline-none disabled:opacity-60"
                  />
                </div>
              )}

              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={busy || localPreview}
                rows={2}
                className="w-full resize-none rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[12px] text-slate-100 outline-none disabled:opacity-60"
                placeholder="Notas opcionales"
              />

              <div className="rounded-2xl border border-dashed border-sky-400/60 bg-[#0b1220] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="inline-flex cursor-pointer items-center gap-3 text-[12px] text-slate-200">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-400/30 bg-sky-500/10 text-sky-300">
                      <UploadCloud size={15} />
                    </span>
                    <span>
                      <span className="block font-normal text-slate-100">Seleccionar archivo</span>
                      <span className="block text-[10px] text-slate-500">
                        Versiona el mismo tipo y conserva historico.
                      </span>
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      disabled={busy || localPreview}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => void handleUpload()}
                    disabled={busy || localPreview}
                    className="inline-flex items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-[11px] font-normal uppercase text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    title={busy ? "Subiendo..." : "Subir documento"}
                  >
                    {busy ? `Subiendo ${progress || 0}%` : "Subir"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}